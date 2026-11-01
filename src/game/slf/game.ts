import { NET, SLF } from '../../config';
import { mulberry32 } from '../../core/rng';
import type { DeckId } from '../../words/types';
import { newSalt } from '../gleich/logic';
import type { GameNet, Minigame } from '../minigame';
import { byTableOrder } from '../tableOrder';
import { stepKey } from '../undo';
import {
  categoryPool,
  cleanAnswer,
  cleanCaption,
  drawCategories,
  drawLetter,
  imageCommit,
  parseIntent,
  SlfHost,
  textCommit,
  verifyImage,
  verifyText,
  type Intent,
  type SlfMode,
  type SlfState,
} from './logic';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrings = (v: unknown, max = 8, len = 64): v is string[] => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && x.length <= len);

/** Answers are the only free text in the state: anything that isn't a clean answer becomes "nothing". */
function parseAnswers(v: unknown, n: number): Record<string, (string | null)[]> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, (string | null)[]> = {};
  for (const [k, a] of Object.entries(v)) {
    if (!Array.isArray(a) || a.length !== n) return null;
    out[k] = a.map((x) => (x === null ? null : cleanAnswer(x) || null));
  }
  return out;
}

/** Shape check of the host's broadcast; the host is trusted for game decisions anyway. */
export function parseState(v: unknown): (SlfState & { sentAt: number }) | null {
  if (!isRecord(v)) return null;
  if (!['write', 'lock', 'reveal', 'rate', 'done'].includes(v.phase as string) || !['text', 'bild'].includes(v.mode as string)) return null;
  if (!isStrings(v.players) || !isStrings(v.ready) || !isStrings(v.judged) || !isStrings(v.categories, 8, 80) || !v.categories.length) return null;
  if (typeof v.letter !== 'string' || v.letter.length !== 1 || !isRecord(v.commits) || !isRecord(v.scores) || !Array.isArray(v.flags) || !Array.isArray(v.results)) return null;
  if (typeof v.round !== 'number' || typeof v.cat !== 'number' || typeof v.sentAt !== 'number' || typeof v.voteNo !== 'number') return null;
  const answers = v.answers === null ? null : parseAnswers(v.answers, v.categories.length);
  if (v.answers !== null && !answers) return null;
  return { ...(v as unknown as SlfState), answers, sentAt: v.sentAt };
}

/** Room settings the game reads when it starts a round. */
export interface SlfRoom {
  decks(): readonly DeckId[];
  mode(): SlfMode;
  /** The room's own categories (lists "Kategorien"), used with the deck "Eigene". */
  custom?(): readonly string[];
}

export interface Pic {
  img: string;
  cap: string;
}

interface Secret {
  round: number;
  salt: string;
  commits: string[];
  texts: string[];
  pics: Pic[];
}

type RawReveal = { round: number; cat: number; answers?: unknown; img?: unknown; cap?: unknown; salt: unknown };

const same = (a: readonly string[] | undefined, b: readonly string[]) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * "Stadt, Land, Fluss" on one client. The host part (rules, votes, points) runs only on the host.
 * Answers and pictures stay on their writer's client as a draft until the writing is over; then
 * only a commitment goes out, and once all are in, the content goes to everyone directly.
 */
export class SlfGame implements Minigame {
  state: SlfState | null = null;
  private host: SlfHost | null = null;
  private scores: Record<string, number> = {};
  private hostSkew = 0;
  private listeners = new Set<() => void>();
  private lastPublish = 0;
  /** What I'm writing (or the pictures I picked) this round. */
  readonly draft: { round: number; texts: string[]; pics: Pic[] } = { round: -1, texts: [], pics: [] };
  private secret: Secret | null = null;
  private locking = false;
  /** Round I committed in (by "Stopp!" or at the end of the writing): once is final. */
  private lockedRound = -1;
  /** Text: answers that checked out against their commitment, by player (this round). */
  private verified = new Map<string, string[]>();
  /** Pictures that checked out, by their commitment: a rejoiner's new id keeps the same commitment. */
  private pictures = new Map<string, Pic>();
  private checkRound = -1;
  private raw = new Map<string, RawReveal & { from: string }>();
  private checking = new Set<string>();
  /** Members who have my reveal this round. */
  private sentTo = new Set<string>();
  private votedKey = '';
  private judgedKey = '';
  /** Letters of this session, so the next round brings a new one. */
  private letters = new Set<string>();
  private goneSince = new Map<string, number>();
  private dropAsked = new Map<string, number>();

  constructor(
    private net: GameNet,
    private room: SlfRoom,
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

  /** Answers are being written: talking is reading them out, so the Schaffner may come. */
  get writing(): boolean {
    const p = this.state?.phase;
    return p === 'write' || p === 'lock';
  }

  get leftS(): number {
    const d = this.state?.deadline;
    return d ? Math.max(0, (d - (Date.now() + this.hostSkew)) / 1000) : 0;
  }

  get voteLeftS(): number {
    const v = this.state?.vote;
    return v ? Math.max(0, (v.deadline - (Date.now() + this.hostSkew)) / 1000) : 0;
  }

  get playing(): boolean {
    return !!this.state?.players.includes(this.selfId);
  }

  /** My answers are locked (stopped, or the writing is over) and I hold the secret to them. */
  get locked(): boolean {
    const s = this.state;
    const k = this.secret;
    return !!s && !!k && k.round === s.round && same(s.commits[this.selfId], k.commits);
  }

  /** I may still change my answers. */
  get canEdit(): boolean {
    const s = this.state;
    return s?.phase === 'write' && this.playing && this.lockedRound !== s.round && !this.locking;
  }

  /** Every category has an answer (or a picture): "Stopp!" is allowed. */
  get filled(): boolean {
    const s = this.state;
    if (!s) return false;
    this.syncDraft();
    return s.categories.every((_, c) => (s.mode === 'text' ? !!cleanAnswer(this.draft.texts[c]) : !!this.draft.pics[c]?.img));
  }

  get iVoted(): boolean {
    const s = this.state;
    // Raising a flag is already my yes.
    return !!s?.vote && (s.vote.voters.includes(this.selfId) || this.votedKey === this.voteKey(s));
  }

  get iJudged(): boolean {
    const s = this.state;
    return !!s && (s.judged.includes(this.selfId) || this.judgedKey === this.judgeKey(s));
  }

  // With the undo count: a vote or verdict taken back may be given again.
  private voteKey(s: SlfState): string {
    return `${stepKey(s)}|${s.cat}|${s.vote?.flag}|${s.flags.length}|${s.voteNo}`;
  }

  private judgeKey(s: SlfState): string {
    return `${stepKey(s)}|${s.cat}|${s.voteNo}`;
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

  /** The draft belongs to the running round; a new round starts empty. */
  private syncDraft(): void {
    const s = this.state;
    if (!s || this.draft.round === s.round) return;
    this.draft.round = s.round;
    this.draft.texts = s.categories.map(() => '');
    this.draft.pics = s.categories.map(() => ({ img: '', cap: '' }));
  }

  setText(cat: number, text: string): void {
    if (!this.canEdit) return;
    this.syncDraft();
    this.draft.texts[cat] = text;
  }

  setPic(cat: number, img: string): void {
    if (!this.canEdit) return;
    this.syncDraft();
    this.draft.pics[cat] = { ...(this.draft.pics[cat] ?? { cap: '' }), img };
    this.emit();
  }

  setCaption(cat: number, cap: string): void {
    if (!this.canEdit) return;
    this.syncDraft();
    this.draft.pics[cat] = { ...(this.draft.pics[cat] ?? { img: '' }), cap };
  }

  /** Text answers as I see them: the host's, except one I checked myself and found different shows as nothing. */
  answersView(): Record<string, (string | null)[]> | null {
    const a = this.state?.answers;
    if (!a) return null;
    const out: Record<string, (string | null)[]> = {};
    for (const [id, list] of Object.entries(a)) {
      const mine = this.verified.get(id);
      out[id] = list.map((x, c) => (mine && (mine[c] || null) !== x ? null : x));
    }
    return out;
  }

  /** A player's picture for a category, once it checked out here. */
  picOf(id: string, cat: number): Pic | null {
    const c = this.state?.commits[id]?.[cat];
    const p = c ? this.pictures.get(c) : undefined;
    return p && p.img ? p : null;
  }

  start(): void {
    if (!this.isHost) return;
    const order = [...this.net.members()].sort((a, b) => byTableOrder(a.seat, b.seat)).map((m) => m.id);
    if (order.length < 2) return;
    if (this.host) this.scores = { ...this.host.state.scores };
    const mode = this.room.mode();
    const rng = mulberry32((Date.now() ^ (Math.random() * 2 ** 31)) | 0);
    if (this.letters.size >= SLF.letters.length - 3) this.letters.clear();
    const letter = drawLetter(rng, this.letters);
    this.letters.add(letter);
    const { fixed, pool } = categoryPool(mode, this.room.decks(), this.room.custom?.() ?? []);
    const categories = drawCategories(fixed, pool, SLF.count[mode], rng);
    this.host = new SlfHost(order, mode, letter, categories, this.scores, (this.host?.state.round ?? 0) + 1, Date.now());
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

  /** Host: take back the last decision ("Zug zurück"): see `SlfHost.history`. */
  undo(): void {
    if (this.isHost && this.host?.undo(Date.now())) this.publish();
  }

  /** The Schaffner's fine, only while answers are being written. */
  penalize(id: string, points: number): boolean {
    if (!this.host || (this.host.state.phase !== 'write' && this.host.state.phase !== 'lock')) return false;
    this.host.penalize(id, points);
    this.publish();
    return true;
  }

  /** "Stopp!": my answers are complete; they lock, and the others get a few seconds more. */
  async stop(): Promise<boolean> {
    if (!this.canEdit || !this.filled) return false;
    const c = await this.commit();
    if (!c) return false;
    this.toHost({ a: 'stop', c });
    this.emit();
    return true;
  }

  /** Commit my draft: the secret stays here, only the commitments go out. */
  private async commit(): Promise<string[] | null> {
    const s = this.state;
    if (!s || !this.playing || this.locking) return null;
    this.syncDraft();
    this.locking = true;
    try {
      const salt = newSalt();
      const texts = s.categories.map((_, c) => cleanAnswer(this.draft.texts[c]));
      const pics = s.categories.map((_, c) => ({ img: this.draft.pics[c]?.img ?? '', cap: cleanCaption(this.draft.pics[c]?.cap) }));
      const commits = s.mode === 'text' ? [await textCommit(texts, salt)] : await Promise.all(pics.map((p, c) => imageCommit(c, p.img, p.cap, salt)));
      const now = this.state;
      if (!now || now.round !== s.round || (now.phase !== 'write' && now.phase !== 'lock')) return null;
      // Before the intent: as host my own intent can already end the writing, and the reveal needs the secret.
      this.secret = { round: s.round, salt, commits, texts, pics };
      this.lockedRound = s.round;
      return commits;
    } finally {
      this.locking = false;
    }
  }

  flagBad(target: string): void {
    this.toHost({ a: 'flag', kind: 'bad', target });
  }

  flagSame(target: string, other: string): void {
    this.toHost({ a: 'flag', kind: 'same', target, other });
  }

  vote(v: boolean): void {
    const s = this.state;
    if (!s?.vote || this.iVoted || !s.vote.eligible.includes(this.selfId)) return;
    this.votedKey = this.voteKey(s);
    this.toHost({ a: 'vote', v });
    this.emit();
  }

  /** Pictures: my verdict on the others' pictures of this category, and the best one. */
  judge(ok: Record<string, boolean>, best: string | null): void {
    const s = this.state;
    if (!s || s.mode !== 'bild' || s.phase !== 'rate' || s.step !== 'vote' || this.iJudged || !this.playing) return;
    this.judgedKey = this.judgeKey(s);
    this.toHost({ a: 'judge', cat: s.cat, ok, best });
    this.emit();
  }

  ready(): void {
    this.toHost({ a: 'ready' });
  }

  toHost(i: Intent): void {
    if (this.isHost) this.applyIntent(this.selfId, i);
    else {
      const h = this.net.hostId();
      if (h) this.net.send('sl:intent', i, h);
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
      if (h) this.net.send('sl:drop', id, h);
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
    // Pictures go to newcomers too (someone who reloaded lost them).
    this.sendReveals();
    if (this.host && !this.isHost) this.host = null;
    // A new host (the old one left) takes over a running round from its public state.
    if (!this.host && this.isHost && this.state) {
      this.host = SlfHost.fromState(this.state);
      this.scores = { ...this.state.scores };
      this.host.present = this.hereSet();
      this.feedHost();
      this.publish(now);
    }
    if (!this.host) return;
    const t = Date.now();
    const here = this.hereSet();
    this.host.present = here;
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
      if (t - since > SLF.absentLeaveS * 1000) {
        this.goneSince.delete(p);
        changed = this.host.removePlayer(p, t) || changed;
      }
    }
    // A slow heartbeat re-syncs anyone who missed a message.
    if (changed || now - this.lastPublish > 3000) this.publish(now);
  }

  /** New host: what this client already checked goes into the collecting, so nobody has to reveal twice. */
  private feedHost(): void {
    const s = this.state;
    if (!this.host || !s || s.phase !== 'reveal') return;
    const t = Date.now();
    for (const [id, a] of this.verified) this.host.revealText(id, a, t);
    if (s.mode === 'bild') {
      for (const id of s.players) {
        s.commits[id]?.forEach((c, cat) => {
          const p = this.pictures.get(c);
          if (p) this.host!.revealImage(id, cat, !!p.img, t);
        });
      }
    }
  }

  onMessage(type: string, data: unknown, from: string): void {
    if (type === 'sl:state') {
      if (from !== this.net.hostId()) return;
      const s = parseState(data);
      if (s) {
        this.hostSkew = s.sentAt - Date.now();
        this.applyState(s);
      }
    } else if (type === 'sl:drop') {
      if (typeof data === 'string') this.dropNow(data);
    } else if (type === 'sl:intent') {
      const i = parseIntent(data);
      if (i && this.host) this.applyIntent(from, i);
    } else if (type === 'sl:reveal') {
      const d = data as Partial<RawReveal> | null;
      if (!d || !Number.isInteger(d.round) || !Number.isInteger(d.cat) || d.cat! < 0 || d.cat! > 8) return;
      this.raw.set(`${from}|${d.cat}`, { round: d.round!, cat: d.cat!, answers: d.answers, img: d.img, cap: d.cap, salt: d.salt, from });
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
    this.net.send('sl:state', s);
    this.applyState(s);
  }

  private applyState(s: SlfState): void {
    s.undo ??= 0;
    if (s.round !== this.checkRound) {
      this.checkRound = s.round;
      this.verified.clear();
      this.pictures.clear();
      this.checking.clear();
      this.raw.clear();
      this.sentTo.clear();
    }
    this.state = s;
    this.syncDraft();
    // The writing is over and I haven't locked yet: commit what I have (empty fields count as nothing).
    if (s.phase === 'lock' && this.playing && this.lockedRound !== s.round && !this.locking) {
      void this.commit().then((c) => {
        if (c) this.toHost({ a: 'lock', c });
        this.emit();
      });
    }
    this.sendReveals();
    this.checkReveals();
    this.emit();
  }

  /**
   * Once the writing is over my answers go to everyone with the salt that proves them. Text answers
   * then live in the public state; pictures don't, so whoever joins later gets them too.
   */
  private sendReveals(): void {
    const s = this.state;
    const k = this.secret;
    if (!s || !k || k.round !== s.round || !same(s.commits[this.selfId], k.commits)) return;
    if (s.phase !== 'reveal' && !(s.mode === 'bild' && (s.phase === 'rate' || s.phase === 'done'))) return;
    const me = this.selfId;
    if (!this.sentTo.has(me)) {
      this.sentTo.add(me);
      // My own reveal counts as checked here.
      if (s.mode === 'text') {
        this.verified.set(me, k.texts);
        if (this.host?.revealText(me, k.texts, Date.now())) this.publish();
      } else {
        k.pics.forEach((p, cat) => {
          this.pictures.set(k.commits[cat], p);
          if (this.host?.revealImage(me, cat, !!p.img, Date.now())) this.publish();
        });
      }
    }
    for (const m of this.net.members()) {
      if (m.id === me || this.sentTo.has(m.id)) continue;
      this.sentTo.add(m.id);
      if (s.mode === 'text') this.net.send('sl:reveal', { round: k.round, cat: 0, answers: k.texts, salt: k.salt }, m.id);
      else k.pics.forEach((p, cat) => this.net.send('sl:reveal', { round: k.round, cat, img: p.img, cap: p.cap, salt: k.salt }, m.id));
    }
  }

  /** Check every waiting reveal against the commitment in the state; the result may let the host judge. */
  private checkReveals(): void {
    const s = this.state;
    // Commitments are final once the writing is over; before that a reveal has to wait.
    if (!s || (s.phase !== 'reveal' && s.phase !== 'rate' && s.phase !== 'done')) return;
    for (const [key, r] of [...this.raw]) {
      const commit = s.commits[r.from]?.[s.mode === 'text' ? 0 : r.cat];
      if (r.round !== s.round || !commit || this.checking.has(key)) continue;
      if (s.mode === 'text' ? this.verified.has(r.from) : this.pictures.has(commit)) {
        this.raw.delete(key);
        continue;
      }
      this.checking.add(key);
      const done = (fed: boolean) => {
        this.checking.delete(key);
        this.raw.delete(key);
        if (fed) this.publish();
        else this.emit();
      };
      if (s.mode === 'text') {
        void verifyText(commit, r.answers, r.salt, s.categories.length).then((a) => {
          if (this.state?.round !== r.round) return;
          if (a) this.verified.set(r.from, a);
          done(!!this.host?.revealText(r.from, a, Date.now()));
        });
      } else {
        void verifyImage(commit, r.cat, r.img, r.cap, r.salt).then((ok) => {
          if (this.state?.round !== r.round) return;
          if (ok) this.pictures.set(commit, { img: r.img as string, cap: r.cap as string });
          done(!!this.host?.revealImage(r.from, r.cat, ok ? r.img !== '' : null, Date.now()));
        });
      }
    }
  }
}
