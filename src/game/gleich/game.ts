import { GLEICH, NET } from '../../config';
import { mulberry32 } from '../../core/rng';
import { content } from '../../words/content';
import { questionPool } from '../../words/lists';
import type { DeckId } from '../../words/types';
import type { GameNet, Minigame } from '../minigame';
import { byTableOrder } from '../tableOrder';
import { tabStore, type TabStore } from '../tabStore';
import { cleanWord, commitOf, GleichHost, HEX64, newSalt, parseIntent, SALT, verifyReveal, type GleichState, type Intent, type Words } from './logic';

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 8 && v.every((x) => typeof x === 'string' && x.length <= 64);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Words are the only free text in the state: anything that isn't a clean word becomes "nothing". */
function parseWords(v: unknown): Words | null {
  if (!isRecord(v)) return null;
  const out: Words = {};
  for (const [k, w] of Object.entries(v)) out[k] = w === null ? null : cleanWord(w);
  return out;
}

/** The ballots of a running vote, as the host broadcasts them next to its state (for a host change only). */
function parseBallots(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (isRecord(v)) for (const [k, b] of Object.entries(v)) if (typeof b === 'boolean') out[k] = b;
  return out;
}

/** Shape check of the host's broadcast; the host is trusted for game decisions anyway. */
function parseState(v: unknown): (GleichState & { sentAt: number }) | null {
  if (!isRecord(v)) return null;
  if (!['write', 'reveal', 'done'].includes(v.phase as string) || !isStrings(v.players) || !isStrings(v.ready) || !isStrings(v.group)) return null;
  if (!isRecord(v.questions) || !isRecord(v.commits) || !isRecord(v.scores) || !Array.isArray(v.history) || v.history.length > GLEICH.maxTries) return null;
  if (typeof v.round !== 'number' || typeof v.tryNo !== 'number' || typeof v.sentAt !== 'number') return null;
  const words = v.words === null ? null : parseWords(v.words);
  const history = v.history.map(parseWords);
  if ((v.words !== null && !words) || history.some((h) => !h)) return null;
  // The ballots travel beside the state, not in it: nothing the screens read.
  const { ballots: _ballots, ...rest } = v;
  return { ...(rest as unknown as GleichState), words, history: history as Words[], sentAt: v.sentAt };
}

/** Room settings the game reads when it draws questions. */
export interface GleichRoom {
  decks(): readonly DeckId[];
  /** The room's own start questions (lists "Startfragen"), used with the deck "Eigene". */
  custom?(): readonly string[];
}

interface Secret {
  round: number;
  tryNo: number;
  word: string;
  salt: string;
  commit: string;
}

/** What this tab keeps of my locked word, so a reload doesn't lose it (key `word.<round>`). */
interface StoredWord {
  tryNo: number;
  word: string;
  salt: string;
  commit: string;
}

const isStoredWord = (v: unknown): v is StoredWord =>
  isRecord(v) && Number.isInteger(v.tryNo) && cleanWord(v.word) === v.word && typeof v.salt === 'string' && SALT.test(v.salt) && typeof v.commit === 'string' && HEX64.test(v.commit);

/** The word typed but not yet locked (key `draft.<round>`). */
interface Draft {
  tryNo: number;
  text: string;
}

const isDraft = (v: unknown): v is Draft => isRecord(v) && Number.isInteger(v.tryNo) && typeof v.text === 'string';

interface RawReveal {
  round: number;
  tryNo: number;
  word: unknown;
  salt: unknown;
}

/**
 * "Gleich gedacht" on one client. The host part (rules, votes, points) runs only on the host. A
 * word leaves its writer only as a commitment until the host calls the reveal; then everybody
 * sends {word, salt} to everybody and every client checks it against the commitment in the state.
 *
 * Reload (F5): the typed draft and the locked word with its salt are kept in this tab (`tabStore`)
 * and come back with the next state, so the word can still be revealed. A running vote's ballots
 * ride along the host's state to the others, so a new host can go on with it (never shown).
 */
export class GleichGame implements Minigame {
  state: GleichState | null = null;
  private host: GleichHost | null = null;
  private scores: Record<string, number> = {};
  private hostSkew = 0;
  private listeners = new Set<() => void>();
  private lastPublish = 0;
  /** What I locked this try; never leaves this client before the reveal. */
  private secret: Secret | null = null;
  /** Words of the running try that checked out against their commitment, by player (mine included). */
  private verified = new Map<string, string>();
  private verifiedKey = '';
  /** Reveals that came in, waiting for their turn to be checked. */
  private raw = new Map<string, RawReveal>();
  private checking = new Set<string>();
  private sentKey = '';
  private votedKey = '';
  /** Questions used in this session, so a new round starts with fresh ones. */
  private asked = new Set<string>();
  private goneSince = new Map<string, number>();
  private dropAsked = new Map<string, number>();
  /** Ballots of the host's running vote as last broadcast; only read when this client becomes the host. */
  private ballots: Record<string, boolean> = {};
  private draftMem: (Draft & { round: number }) | null = null;
  /** The try I looked for a stored word of (once per try), the round whose keys I hold, the end I cleaned up after. */
  private restoredKey = '';
  private storedRound: number | null = null;
  private cleanedKey = '';
  private relockAt = -Infinity;

  constructor(
    private net: GameNet,
    private room: GleichRoom,
    /** This tab's private store, looked up at each use (the room code in the address may come after the game). Tests give each client its own. */
    private tab: () => TabStore = () => tabStore('gleich'),
  ) {
    net.onMessage((t, d, f) => this.onMessage(t, d, f));
  }

  get selfId(): string {
    return this.net.selfId;
  }

  get isHost(): boolean {
    return this.net.isHost();
  }

  get running(): boolean {
    return !!this.state && this.state.phase !== 'done';
  }

  /** Words are being written: talking is cheating, so the Schaffner may come. */
  get writing(): boolean {
    return this.state?.phase === 'write';
  }

  /** Seconds left of the running timer (writing, or the reveal screen). */
  get leftS(): number {
    const d = this.state?.deadline;
    return d ? Math.max(0, (d - (Date.now() + this.hostSkew)) / 1000) : 0;
  }

  get voteLeftS(): number {
    const v = this.state?.vote;
    return v ? Math.max(0, (v.deadline - (Date.now() + this.hostSkew)) / 1000) : 0;
  }

  private get store(): TabStore {
    return this.tab();
  }

  /**
   * My locked word of this try, if I hold the secret to it (kept over a reload; without it I write
   * again). While writing the secret counts even if the host hasn't got my commitment (yet).
   */
  get myWord(): string | null {
    const s = this.state;
    const k = this.secret;
    if (!s || !k || k.round !== s.round || k.tryNo !== s.tryNo) return null;
    return s.phase === 'write' || s.commits[this.selfId] === k.commit ? k.word : null;
  }

  /** What I typed in this try without locking it; survives a reload. */
  get draft(): string {
    const s = this.state;
    if (!s) return '';
    let d = this.draftMem;
    if (!d || d.round !== s.round) {
      const st = this.store.get(`draft.${s.round}`, isDraft);
      d = st ? { ...st, round: s.round } : null;
    }
    return d && d.tryNo === s.tryNo ? [...d.text].slice(0, GLEICH.maxWordLen).join('') : '';
  }

  setDraft(text: string): void {
    const s = this.state;
    if (!s || s.phase !== 'write') return;
    if (!text) return this.clearDraft(s.round);
    this.draftMem = { round: s.round, tryNo: s.tryNo, text };
    this.store.set(`draft.${s.round}`, { tryNo: s.tryNo, text });
  }

  private clearDraft(round: number): void {
    this.draftMem = null;
    this.store.remove(`draft.${round}`);
  }

  get iVoted(): boolean {
    const s = this.state;
    // Also from the public list: after a reload my own mark is gone, but the host remembers I voted.
    return !!s && (this.votedKey === `${s.round}|${s.tryNo}|${s.undo}` || !!s.vote?.voters.includes(this.selfId));
  }

  nameOf(id: string | null): string {
    return this.net.members().find((m) => m.id === id)?.name || 'Jemand';
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit(): void {
    for (const f of this.listeners) f();
  }

  /**
   * The words of the judged try as I see them: the host's verdict, except that a word I checked
   * myself and found different from what the host reports shows as nothing.
   */
  wordsView(): Words | null {
    const w = this.state?.words;
    if (!w) return null;
    const out: Words = {};
    for (const [id, word] of Object.entries(w)) out[id] = this.verified.has(id) && this.verified.get(id) !== word ? null : word;
    return out;
  }

  start(): void {
    if (!this.isHost) return;
    const order = [...this.net.members()].sort((a, b) => byTableOrder(a.seat, b.seat)).map((m) => m.id);
    if (order.length < 2) return;
    if (this.host) this.scores = { ...this.host.state.scores };
    const { normal, nsfw } = content().gleich;
    const pool = questionPool(this.room.decks(), normal, nsfw, this.room.custom?.() ?? [], order.length);
    if (this.asked.size > pool.length - order.length * 2) this.asked.clear();
    this.host = new GleichHost(order, this.scores, (this.host?.state.round ?? 0) + 1, Date.now(), mulberry32((Date.now() ^ (Math.random() * 2 ** 31)) | 0), pool, this.asked);
    for (const q of Object.values(this.host.state.questions)) this.asked.add(q);
    this.host.present = this.hereSet();
    this.publish();
  }

  end(): void {
    this.toHost({ a: 'end' });
  }

  /** Host: there is a decision of this round to take back. */
  get canUndo(): boolean {
    return this.isHost && !!this.host?.canUndo;
  }

  /** Host: take back the last judgment ("Zug zurück"): back to the shown words of that try. */
  undo(): void {
    if (this.isHost && this.host?.undo(Date.now())) this.publish();
  }

  /** The Schaffner's fine, only while words are being written. */
  penalize(id: string, points: number): boolean {
    if (!this.host || this.host.state.phase !== 'write') return false;
    this.host.penalize(id, points);
    this.publish();
    return true;
  }

  /** Lock my word for this try: only its commitment goes out. Resolves false if the word isn't usable or the try moved on. */
  async lock(raw: string): Promise<boolean> {
    const s = this.state;
    const word = cleanWord(raw);
    if (!s || s.phase !== 'write' || !word || !s.players.includes(this.selfId)) return false;
    const salt = newSalt();
    const commit = await commitOf(word, salt);
    const now = this.state;
    if (!now || now.phase !== 'write' || now.round !== s.round || now.tryNo !== s.tryNo) return false;
    // Before the intent: as host my own intent can already end the writing, and the reveal needs the secret.
    this.secret = { round: s.round, tryNo: s.tryNo, word, salt, commit };
    this.relockAt = performance.now();
    this.store.set(`word.${s.round}`, { tryNo: s.tryNo, word, salt, commit } satisfies StoredWord);
    this.clearDraft(s.round);
    this.toHost({ a: 'lock', c: commit });
    this.emit();
    return true;
  }

  call(): void {
    this.toHost({ a: 'call' });
  }

  vote(v: boolean): void {
    const s = this.state;
    if (!s?.vote || this.iVoted) return;
    // With the undo count: a vote taken back may be cast again.
    this.votedKey = `${s.round}|${s.tryNo}|${s.undo}`;
    this.toHost({ a: 'vote', v });
    this.emit();
  }

  ready(): void {
    this.toHost({ a: 'ready' });
  }

  toHost(i: Intent): void {
    if (this.isHost) this.applyIntent(this.selfId, i);
    else {
      const h = this.net.hostId();
      if (h) this.net.send('gg:intent', i, h);
    }
  }

  /** Host: someone reloaded and came back with a new id; they keep place and points. */
  rejoin(oldId: string, newId: string): void {
    if (!this.host?.replace(oldId, newId)) return;
    this.goneSince.delete(oldId);
    this.publish();
  }

  absent(): string[] {
    const s = this.state;
    if (!s || s.phase === 'done') return [];
    const here = this.hereSet();
    return s.players.filter((p) => !here.has(p));
  }

  drop(id: string): void {
    if (this.isHost) this.dropNow(id);
    else {
      const h = this.net.hostId();
      if (h) this.net.send('gg:drop', id, h);
    }
  }

  private hereSet(): Set<string> {
    return new Set(this.net.members().map((m) => m.id));
  }

  /**
   * Host: someone asked to play on without `id`. Only someone who really isn't in the room is dropped;
   * the asker may see them gone a moment before the host does, so the request waits a little.
   */
  private dropNow(id: string): void {
    if (!this.host) return;
    if (this.net.members().some((m) => m.id === id)) {
      this.dropAsked.set(id, Date.now());
      return;
    }
    this.dropAsked.delete(id);
    this.goneSince.delete(id);
    this.host.present = this.hereSet();
    if (this.host.removePlayer(id, Date.now())) this.publish();
  }

  tick(now: number): void {
    // Gave way to another host (network split): their state counts from now on.
    if (this.host && !this.isHost) this.host = null;
    // A new host (the old one left) takes over a running round from its public state.
    if (!this.host && this.isHost && this.state) {
      this.host = GleichHost.fromState(this.state, Date.now(), this.hostSkew, this.ballots);
      this.scores = { ...this.state.scores };
      this.host.present = this.hereSet();
      for (const [id, w] of this.verified) this.host.reveal(id, w, Date.now());
      this.publish(now);
    }
    this.relock(now);
    if (!this.host) return;
    const t = Date.now();
    const here = this.hereSet();
    this.host.present = here;
    // Absent players block nothing: the host just carries on with whoever is here.
    let changed = this.host.tick(t);
    for (const p of [...this.host.state.players]) {
      if (here.has(p)) {
        this.goneSince.delete(p);
        continue;
      }
      const since = this.goneSince.get(p) ?? t;
      this.goneSince.set(p, since);
      const asked = this.dropAsked.get(p);
      if (asked !== undefined) {
        this.dropAsked.delete(p);
        if (t - asked < NET.dropWaitMs) {
          this.dropNow(p);
          changed = true;
          continue;
        }
      }
      if (t - since > GLEICH.absentLeaveS * 1000) {
        this.goneSince.delete(p);
        changed = this.host.removePlayer(p, t) || changed;
      }
    }
    // A slow heartbeat re-syncs anyone who missed a message.
    if (changed || now - this.lastPublish > 3000) this.publish(now);
  }

  onMessage(type: string, data: unknown, from: string): void {
    if (type === 'gg:state') {
      if (from !== this.net.hostId()) return;
      const s = parseState(data);
      if (s) {
        this.hostSkew = s.sentAt - Date.now();
        this.ballots = s.vote ? parseBallots((data as Record<string, unknown>).ballots) : {};
        this.applyState(s);
      }
    } else if (type === 'gg:drop') {
      if (typeof data === 'string') this.dropNow(data);
    } else if (type === 'gg:intent') {
      const i = parseIntent(data);
      if (i && this.host) this.applyIntent(from, i);
    } else if (type === 'gg:reveal') {
      const d = data as Partial<RawReveal> | null;
      if (!d || !Number.isInteger(d.round) || !Number.isInteger(d.tryNo)) return;
      this.raw.set(from, { round: d.round!, tryNo: d.tryNo!, word: d.word, salt: d.salt });
      this.checkReveals();
    }
  }

  private applyIntent(from: string, i: Intent): void {
    if (!this.host) return;
    this.host.present = this.hereSet();
    if (this.host.intent(from, i, Date.now(), from === this.selfId)) this.publish();
  }

  private publish(now = performance.now()): void {
    if (!this.host) return;
    this.lastPublish = now;
    const s = { ...structuredClone(this.host.state), sentAt: Date.now() };
    // The ballots go next to the state: the others keep them for a host change and never show them.
    this.net.send('gg:state', s.vote ? { ...s, ballots: this.host.ballots() } : s);
    this.applyState(s);
  }

  /** The secret is mine alone; the commitment in the state is what the others hold. */
  private get lockedSecret(): Secret | null {
    const s = this.state;
    const k = this.secret;
    return s && k && k.round === s.round && k.tryNo === s.tryNo ? k : null;
  }

  /**
   * The host doesn't hold my commitment (it dropped it when I came back under a new id) but I still
   * hold the word: lock again with the same commitment. Not more than every 2 s.
   */
  private relock(now: number): void {
    const s = this.state;
    const k = this.lockedSecret;
    if (!s || !k || s.phase !== 'write' || !s.players.includes(this.selfId) || s.commits[this.selfId] || now - this.relockAt < 2000) return;
    this.relockAt = now;
    this.toHost({ a: 'lock', c: k.commit });
  }

  /** This tab's private state follows the state: the word and draft of a reload come back, finished rounds are cleaned up. */
  private syncStore(s: GleichState, key: string): void {
    if (this.storedRound !== null && this.storedRound !== s.round) {
      this.store.remove(`word.${this.storedRound}`);
      this.clearDraft(this.storedRound);
    }
    this.storedRound = s.round;
    if (s.phase === 'done') {
      // Nothing of this round is needed any more (a taken-back result lands on shown words).
      const end = `${s.round}|${s.undo}`;
      if (this.cleanedKey !== end) {
        this.cleanedKey = end;
        this.store.clear();
        this.draftMem = null;
      }
      return;
    }
    this.cleanedKey = '';
    if (this.restoredKey === key) return;
    this.restoredKey = key;
    if (this.lockedSecret) return;
    const w = this.store.get(`word.${s.round}`, isStoredWord);
    if (w && w.tryNo === s.tryNo) this.secret = { round: s.round, ...w };
  }

  private applyState(s: GleichState): void {
    s.undo ??= 0;
    const key = `${s.round}|${s.tryNo}`;
    if (key !== this.verifiedKey) {
      this.verifiedKey = key;
      this.verified.clear();
      this.checking.clear();
      this.raw.clear();
    }
    this.state = s;
    this.syncStore(s, key);
    this.relock(performance.now());
    // The host called the reveal: my word goes to everyone, with the salt that proves it is the one I locked.
    const k = this.secret;
    if (s.phase === 'reveal' && k && k.round === s.round && k.tryNo === s.tryNo && s.commits[this.selfId] === k.commit && this.sentKey !== key) {
      this.sentKey = key;
      this.net.send('gg:reveal', { round: k.round, tryNo: k.tryNo, word: k.word, salt: k.salt });
      this.verified.set(this.selfId, k.word);
      if (this.host?.reveal(this.selfId, k.word, Date.now())) this.publish();
    }
    this.checkReveals();
    this.emit();
  }

  /** Check every waiting reveal against the commitment in the state; the result may let the host judge. */
  private checkReveals(): void {
    const s = this.state;
    // Commitments are final once the writing is over; before that a reveal has to wait.
    if (!s || s.phase !== 'reveal') return;
    for (const [from, r] of [...this.raw]) {
      const commit = s.commits[from];
      if (r.round !== s.round || r.tryNo !== s.tryNo || !commit || this.verified.has(from) || this.checking.has(from)) continue;
      this.checking.add(from);
      void verifyReveal(commit, r.word, r.salt).then((ok) => {
        this.checking.delete(from);
        const cur = this.state;
        if (!cur || cur.round !== r.round || cur.tryNo !== r.tryNo) return;
        this.raw.delete(from);
        // A word that doesn't match its commitment is dropped for good: that player shows as "—".
        if (!ok) {
          if (this.host?.reveal(from, null, Date.now())) this.publish();
          return;
        }
        this.verified.set(from, r.word as string);
        if (this.host?.reveal(from, r.word as string, Date.now())) this.publish();
        else this.emit();
      });
    }
  }
}
