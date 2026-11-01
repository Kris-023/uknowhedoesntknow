import { SLF } from '../../config';
import type { Rand } from '../../core/rng';
import type { SlfMode } from '../../net/protocol';
import { normWord } from '../../words/custom';
import { FALLBACK } from '../../words/fallback';
import { uniqueTexts } from '../../words/lists';
import { content } from '../../words/content';
import type { Content, DeckId } from '../../words/types';
import { cleanWord, commitOf, matches } from '../gleich/logic';
import { keepFines, renameDeep, UndoStack } from '../undo';
import { parseCardData } from '../whoami/cardImage';

// Rules of "Stadt, Land, Fluss" as a pure state machine on the host. A letter, a few categories,
// everybody writes (or finds a picture) for each; then the table goes through the categories one
// by one and the points follow the classic rules.
//
// Anti-copying works like "Gleich gedacht": while writing nothing leaves a client but commitments
// (SHA-256 of salt and content). The answers are revealed to everyone only after the writing is
// over, and the commitments in the public state prove nobody changed theirs after seeing others'.
//
// Before the writing comes the step "Kategorien" (phase 'pick'): the list is public and editable,
// the host's changes apply at once, everybody else's become proposals the host accepts or rejects.
// No letter and no timer yet: the host says when the list is done.

export type { SlfMode } from '../../net/protocol';

export interface Flag {
  /** "ungültig", or "gleich wie" another answer the automatic check missed. */
  kind: 'bad' | 'same';
  target: string;
  /** 'same': the other answer's author. */
  other: string | null;
  by: string;
  /** null while it is voted on. */
  result: 'yes' | 'no' | null;
  yes: number;
  no: number;
}

/** A finished (or, in text rounds, live) category. */
export interface CatResult {
  /** Counts: a valid answer, or a picture the others accepted. */
  valid: Record<string, boolean>;
  /** Text: players who wrote the same answer (groups of two or more). */
  groups: string[][];
  /** Pictures: the most "bestes Bild" votes (all of them on a tie). */
  best: string[];
  points: Record<string, number>;
  /** Pictures: votes per author [zählt, zählt nicht, bestes Bild]. */
  tally?: Record<string, [number, number, number]>;
}

/** How a new category was found: typed, picked from the pool, or drawn at random ("neu würfeln"). */
export type PickHow = 'free' | 'pool' | 'roll';
export type PresetName = 'klassisch' | 'zufall';

/** A change to the category list as the host applies it: anything random is already drawn. */
export type Edit =
  | { op: 'set'; at: string; text: string; how: PickHow }
  | { op: 'add'; text: string; how: PickHow }
  | { op: 'remove'; at: string }
  | { op: 'preset'; name: PresetName; list: string[] };

/** A change as a player asks for it; the host draws what is random ("roll", `add` without text, "Zufall"). */
export type PickEdit =
  | { op: 'roll'; at: string }
  | { op: 'set'; at: string; text: string; how: 'free' | 'pool' }
  | { op: 'add'; text: string | null; how: PickHow }
  | { op: 'remove'; at: string }
  | { op: 'preset'; name: PresetName };

/** Someone other than the host wants to change the list; the host accepts or rejects it. */
export interface Proposal {
  id: number;
  by: string;
  edit: Edit;
}

export interface SlfState {
  /**
   * `pick`: the table settles the categories (no letter, no timer); `lock`: writing is over, the last
   * commitments come in; `reveal`: collecting the revealed answers.
   */
  phase: 'pick' | 'write' | 'lock' | 'reveal' | 'rate' | 'done';
  mode: SlfMode;
  round: number;
  /** Public: everyone writes to the same letter. '' while picking: drawn when the writing starts, so nobody thinks ahead. */
  letter: string;
  categories: string[];
  /** Pick step: proposals waiting for the host, oldest first. Public, so a new host keeps them. */
  proposals: Proposal[];
  /** Last proposal id handed out (ids stay unique across a host change). */
  seq: number;
  /** Host's "Für nächste Runden behalten": the next round starts with this round's list. */
  keep: boolean;
  /** Seat order. */
  players: string[];
  /** Commitments: text rounds one for all answers, picture rounds one per category. Present = locked. */
  commits: Record<string, string[]>;
  /** Who called "Stopp!" first. */
  stopBy: string | null;
  /** Host ms: end of writing, of collecting, of a category. */
  deadline: number | null;
  /** Text: verified answers by player and category (null = none); null until revealed. */
  answers: Record<string, (string | null)[]> | null;
  /** Pictures: whose picture per category checked out (the host's check); null until revealed. */
  shown: Record<string, boolean[]> | null;
  /** The category being rated. */
  cat: number;
  /** Pictures: everyone judges the category ('vote'), then the result shows ('show'). Text: always 'show'. */
  step: 'vote' | 'show';
  /** Text: flags of the running category. */
  flags: Flag[];
  /** Text: the open vote on a flag. Single votes stay on the host. */
  vote: { flag: number; eligible: string[]; voters: string[]; deadline: number } | null;
  /** Pictures: who has judged the running category. */
  judged: string[];
  /** Bumps when a vote starts over (new host): everybody votes again. */
  voteNo: number;
  ready: string[];
  /** One per finished category. */
  results: CatResult[];
  scores: Record<string, number>;
  /** Moves the host took back this round. */
  undo: number;
}

/** What the host needs to go back to: the state and the verified reveals that had come in. */
interface Snap {
  state: SlfState;
  texts: [string, string[] | null][];
  pics: [string, (boolean | null | undefined)[]][];
}

export interface Judgement {
  /** Per author: counts or not. Missing = no opinion. */
  ok: Record<string, boolean>;
  best: string | null;
}

export type Intent =
  | { a: 'stop'; c: string[] }
  | { a: 'lock'; c: string[] }
  | { a: 'flag'; kind: 'bad'; target: string }
  | { a: 'flag'; kind: 'same'; target: string; other: string }
  | { a: 'vote'; v: boolean }
  | { a: 'judge'; cat: number; ok: Record<string, boolean>; best: string | null }
  | { a: 'ready' }
  | { a: 'end' }
  | { a: 'pick'; e: PickEdit }
  | { a: 'accept'; id: number }
  | { a: 'reject'; id: number }
  | { a: 'withdraw'; id: number }
  | { a: 'keep'; on: boolean };

const HEX64 = /^[0-9a-f]{64}$/;
const SALT = /^[0-9a-f]{16,64}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

export function parseIntent(v: unknown): Intent | null {
  if (!isRecord(v)) return null;
  switch (v.a) {
    case 'stop':
    case 'lock':
      return Array.isArray(v.c) && v.c.length >= 1 && v.c.length <= 8 && v.c.every((c) => typeof c === 'string' && HEX64.test(c)) ? { a: v.a, c: v.c as string[] } : null;
    case 'flag':
      if (v.kind === 'bad' && isId(v.target)) return { a: 'flag', kind: 'bad', target: v.target };
      if (v.kind === 'same' && isId(v.target) && isId(v.other) && v.target !== v.other) return { a: 'flag', kind: 'same', target: v.target, other: v.other };
      return null;
    case 'vote':
      return typeof v.v === 'boolean' ? { a: 'vote', v: v.v } : null;
    case 'judge': {
      if (!Number.isInteger(v.cat) || !isRecord(v.ok) || Object.keys(v.ok).length > 8 || !(v.best === null || isId(v.best))) return null;
      const ok: Record<string, boolean> = {};
      for (const [k, b] of Object.entries(v.ok)) {
        if (!isId(k) || typeof b !== 'boolean') return null;
        ok[k] = b;
      }
      return { a: 'judge', cat: v.cat as number, ok, best: v.best as string | null };
    }
    case 'ready':
    case 'end':
      return { a: v.a };
    case 'pick': {
      const e = parsePickEdit(v.e);
      return e ? { a: 'pick', e } : null;
    }
    case 'accept':
    case 'reject':
    case 'withdraw':
      return isSeq(v.id) ? { a: v.a, id: v.id } : null;
    case 'keep':
      return typeof v.on === 'boolean' ? { a: 'keep', on: v.on } : null;
    default:
      return null;
  }
}

const isSeq = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) < 1e9;
const isHow = (v: unknown): v is PickHow => v === 'free' || v === 'pool' || v === 'roll';
const isPreset = (v: unknown): v is PresetName => v === 'klassisch' || v === 'zufall';

/**
 * A category from the network or the keyboard: control characters out, blanks collapsed, at most
 * `max` characters (longer is refused, not cut: a cut category means something else). Null if empty.
 */
export function cleanCategory(raw: unknown, max: number = SLF.pick.maxLen): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  return t && [...t].length <= max ? t : null;
}

function parsePickEdit(v: unknown): PickEdit | null {
  if (!isRecord(v)) return null;
  const at = cleanCategory(v.at);
  const text = cleanCategory(v.text);
  switch (v.op) {
    case 'roll':
      return at ? { op: 'roll', at } : null;
    case 'set':
      return at && text && (v.how === 'free' || v.how === 'pool') ? { op: 'set', at, text, how: v.how } : null;
    case 'add':
      if (v.text === null) return { op: 'add', text: null, how: 'roll' };
      return text && (v.how === 'free' || v.how === 'pool') ? { op: 'add', text, how: v.how } : null;
    case 'remove':
      return at ? { op: 'remove', at } : null;
    case 'preset':
      return isPreset(v.name) ? { op: 'preset', name: v.name } : null;
    default:
      return null;
  }
}

/** A resolved change in the host's state (shape check on the clients). */
export function parseEdit(v: unknown): Edit | null {
  if (!isRecord(v)) return null;
  const at = cleanCategory(v.at);
  const text = cleanCategory(v.text);
  switch (v.op) {
    case 'set':
      return at && text && isHow(v.how) ? { op: 'set', at, text, how: v.how } : null;
    case 'add':
      return text && isHow(v.how) ? { op: 'add', text, how: v.how } : null;
    case 'remove':
      return at ? { op: 'remove', at } : null;
    case 'preset': {
      if (!isPreset(v.name) || !Array.isArray(v.list) || v.list.length < 1 || v.list.length > SLF.pick.max.text) return null;
      const list = v.list.map((x) => cleanCategory(x));
      return list.every((x): x is string => !!x) ? { op: 'preset', name: v.name, list } : null;
    }
    default:
      return null;
  }
}

// ---------- the step "Kategorien" ----------

/** How short and how long the list may be in this mode. */
export const pickBounds = (mode: SlfMode) => ({ min: SLF.pick.min[mode], max: SLF.pick.max[mode] });

const indexIn = (list: readonly string[], text: string) => list.findIndex((c) => normWord(c) === normWord(text));
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((c, k) => c === b[k]);

/** The list after `e`, or null if it doesn't apply (the category is gone, the new one is there already, out of bounds). */
export function applyEdit(list: readonly string[], e: Edit, mode: SlfMode): string[] | null {
  const { min, max } = pickBounds(mode);
  switch (e.op) {
    case 'set': {
      const i = indexIn(list, e.at);
      if (i < 0 || indexIn(list, e.text) >= 0) return null;
      return list.map((c, k) => (k === i ? e.text : c));
    }
    case 'add':
      return list.length < max && indexIn(list, e.text) < 0 ? [...list, e.text] : null;
    case 'remove': {
      const i = indexIn(list, e.at);
      return i >= 0 && list.length > min ? list.filter((_, k) => k !== i) : null;
    }
    case 'preset':
      return !sameList(list, e.list) && e.list.length >= min && e.list.length <= max ? [...e.list] : null;
  }
}

/**
 * Can never apply again: the category it is about is gone, or the new one is in the list already.
 * Merely out of bounds is not stale: after a removal an "add" fits again.
 */
export function staleEdit(list: readonly string[], e: Edit): boolean {
  if ((e.op === 'set' || e.op === 'remove') && indexIn(list, e.at) < 0) return true;
  if ((e.op === 'set' || e.op === 'add') && indexIn(list, e.text) >= 0) return true;
  return e.op === 'preset' && sameList(list, e.list);
}

/** Two proposals asking for the same thing: one is enough. A roll means "this one, anything else", whatever it drew. */
export function editKey(e: Edit): string {
  switch (e.op) {
    case 'set':
      return e.how === 'roll' ? `roll|${normWord(e.at)}` : `set|${normWord(e.at)}|${normWord(e.text)}`;
    case 'add':
      return `add|${normWord(e.text)}`;
    case 'remove':
      return `remove|${normWord(e.at)}`;
    case 'preset':
      return `preset|${e.name}`;
  }
}

// ---------- answers ----------

/** An answer as typed: cleaned like a "Gleich gedacht" word, '' for nothing. */
export function cleanAnswer(raw: unknown): string {
  return cleanWord(raw, SLF.maxAnswerLen) ?? '';
}

export function cleanCaption(raw: unknown): string {
  return cleanWord(raw, SLF.maxCaptionLen) ?? '';
}

const ARTICLE = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+/i;

/** First letter of a text, upper case, umlauts and accents folded (Ä → A, É → E); '' if there is none. */
export function firstLetter(text: string): string {
  const m = text.normalize('NFD').match(/\p{L}/u);
  return m ? m[0].toLocaleUpperCase('de') : '';
}

/**
 * Starts with the letter: the first letter after trimming, or after dropping a leading article
 * ("die Elbe" counts for E). Both ways count, because names like "Den Haag" carry their article.
 */
export function startsWithLetter(answer: string | null | undefined, letter: string): boolean {
  const t = (answer ?? '').trim();
  if (!t) return false;
  const l = letter.toLocaleUpperCase('de');
  return firstLetter(t) === l || firstLetter(t.replace(ARTICLE, '')) === l;
}

// ---------- commit / reveal ----------

export function textCommit(answers: readonly string[], salt: string): Promise<string> {
  return commitOf(JSON.stringify(answers), salt);
}

export function imageCommit(cat: number, img: string, cap: string, salt: string): Promise<string> {
  return commitOf(`${cat}|${cap}|${img}`, salt);
}

/** The revealed answers if they are what the player locked (and in the cleaned form), else null. */
export async function verifyText(commit: string | undefined, answers: unknown, salt: unknown, n: number): Promise<string[] | null> {
  if (!commit || typeof salt !== 'string' || !SALT.test(salt) || !Array.isArray(answers) || answers.length !== n) return null;
  if (!answers.every((a) => typeof a === 'string' && cleanAnswer(a) === a)) return null;
  return (await textCommit(answers as string[], salt)) === commit ? (answers as string[]) : null;
}

/** A revealed picture (or nothing: '' and '') checks out against its commitment. */
export async function verifyImage(commit: string | undefined, cat: number, img: unknown, cap: unknown, salt: unknown): Promise<boolean> {
  if (!commit || typeof salt !== 'string' || !SALT.test(salt) || typeof img !== 'string' || typeof cap !== 'string') return false;
  if (img !== '' && parseCardData(img) !== img) return false;
  if (cleanCaption(cap) !== cap) return false;
  return (await imageCommit(cat, img, cap, salt)) === commit;
}

// ---------- drawing ----------

/** A letter not used lately in this session (all letters used: any). */
export function drawLetter(rng: Rand, avoid: ReadonlySet<string> = new Set()): string {
  const all = [...SLF.letters];
  const left = all.filter((l) => !avoid.has(l));
  const from = left.length ? left : all;
  return from[Math.floor(rng() * from.length)];
}

/** The decks are locked: the games draw from the public fallback. */
export const isLocked = (from: Content = content()): boolean => from === FALLBACK;

/** A room that plays only "Eigene" and has enough own categories plays only those. */
export function ownOnly(mode: SlfMode, decks: readonly DeckId[], custom: readonly string[]): boolean {
  return !decks.includes('normal') && !decks.includes('nsfw') && decks.includes('custom') && uniqueTexts(custom).length >= SLF.count[mode];
}

export interface PoolGroup {
  /** "Normal" (the sealed deck), "Ersatzstapel" (locked: the public fallback), "NSFW", "Eigene". */
  label: string;
  items: string[];
}

/**
 * Where categories come from, grouped for the picker: the built-in ones of the mode (sealed once
 * unlocked, else the public fallback), the NSFW extras with that deck, the room's own lists with
 * "Eigene". A room with only "Eigene" and enough of them has only its own. No entry twice.
 */
export function categoryGroups(mode: SlfMode, decks: readonly DeckId[], custom: readonly string[], from: Content = content()): PoolGroup[] {
  const ok = (list: readonly string[]) => list.filter((c) => cleanCategory(c) === c);
  const own = decks.includes('custom') ? uniqueTexts(ok(custom)) : [];
  if (ownOnly(mode, decks, custom)) return [{ label: 'Eigene', items: own }];
  const seen: string[] = [];
  const groups: PoolGroup[] = [];
  const add = (label: string, list: readonly string[]) => {
    const items = uniqueTexts(ok(list), seen);
    seen.push(...items);
    if (items.length) groups.push({ label, items });
  };
  add(isLocked(from) ? 'Ersatzstapel' : 'Normal', mode === 'text' ? from.slf.text : from.slf.image);
  if (decks.includes('nsfw')) add('NSFW', from.slf.nsfw);
  add('Eigene', own);
  return groups;
}

/** Every category of the pool, once. */
export function categoryPool(mode: SlfMode, decks: readonly DeckId[], custom: readonly string[], from: Content = content()): string[] {
  return categoryGroups(mode, decks, custom, from).flatMap((g) => g.items);
}

/** Up to `n` random ones from the pool, none twice and none of `avoid`. */
export function drawCategories(pool: readonly string[], n: number, rng: Rand, avoid: readonly string[] = []): string[] {
  const out: string[] = [];
  const left = pool.filter((c) => indexIn(avoid, c) < 0);
  while (out.length < n && left.length) out.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
  return out;
}

/**
 * The preset "Klassisch": Stadt, Land, Fluss, filled up from the public fallback of the mode. Always
 * on offer, locked or not. *Why the fallback:* it is the same at every table and needs no password.
 */
export function classicCategories(mode: SlfMode): string[] {
  return uniqueTexts([...SLF.fixed, ...(mode === 'text' ? FALLBACK.slf.text : FALLBACK.slf.image)]).slice(0, SLF.count[mode]);
}

/**
 * The list a round starts with (unless the host kept the last one). Locked decks: "Klassisch",
 * because the fallback pool is so small that a draw would be the same few anyway. Unlocked: a random
 * draw from the whole pool, Stadt, Land, Fluss not forced. Only "Eigene" with enough: a draw of those.
 */
export function defaultCategories(mode: SlfMode, decks: readonly DeckId[], custom: readonly string[], rng: Rand, from: Content = content()): string[] {
  if (isLocked(from) && !ownOnly(mode, decks, custom)) return classicCategories(mode);
  const drawn = drawCategories(categoryPool(mode, decks, custom, from), SLF.count[mode], rng);
  return drawn.length >= SLF.pick.min[mode] ? drawn : classicCategories(mode);
}

// ---------- points ----------

/**
 * One category of a text round. Valid = starts with the letter and not voted invalid. Same answers
 * (automatic match, or voted "gleich") form groups. 10 for a unique answer, 5 for one someone else
 * has too, 20 for the only valid answer of the category, 0 for none.
 */
export function judgeText(
  players: readonly string[],
  answers: Readonly<Record<string, string | null | undefined>>,
  letter: string,
  bad: ReadonlySet<string> = new Set(),
  same: readonly (readonly [string, string])[] = [],
): CatResult {
  const valid: Record<string, boolean> = {};
  for (const p of players) valid[p] = startsWithLetter(answers[p], letter) && !bad.has(p);
  const ok = players.filter((p) => valid[p]);
  const sameAs = (a: string, b: string) => matches(answers[a]!, answers[b]!) || same.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const groups: string[][] = [];
  const seen = new Set<string>();
  for (const p of ok) {
    if (seen.has(p)) continue;
    const comp = [p];
    seen.add(p);
    for (let k = 0; k < comp.length; k++) {
      for (const q of ok) {
        if (!seen.has(q) && sameAs(comp[k], q)) {
          seen.add(q);
          comp.push(q);
        }
      }
    }
    if (comp.length >= 2) groups.push(ok.filter((x) => comp.includes(x)));
  }
  const points: Record<string, number> = {};
  for (const p of players) {
    if (!valid[p]) points[p] = 0;
    else if (ok.length === 1 && players.length >= 2) points[p] = SLF.points.only;
    else points[p] = groups.some((g) => g.includes(p)) ? SLF.points.same : SLF.points.unique;
  }
  return { valid, groups, best: [], points };
}

/**
 * One category of a picture round. A picture counts unless more of the others said "zählt nicht"
 * than "zählt" (a tie counts). The most "bestes Bild" votes among counting pictures get the bonus.
 */
export function judgeImages(players: readonly string[], shown: Readonly<Record<string, boolean>>, votes: ReadonlyMap<string, Judgement>): CatResult {
  const tally: Record<string, [number, number, number]> = {};
  for (const p of players) tally[p] = [0, 0, 0];
  for (const [voter, j] of votes) {
    for (const [author, ok] of Object.entries(j.ok)) {
      if (author === voter || !tally[author]) continue;
      tally[author][ok ? 0 : 1]++;
    }
    if (j.best && j.best !== voter && tally[j.best]) tally[j.best][2]++;
  }
  const valid: Record<string, boolean> = {};
  for (const p of players) valid[p] = !!shown[p] && tally[p][1] <= tally[p][0];
  const top = Math.max(0, ...players.filter((p) => valid[p]).map((p) => tally[p][2]));
  const best = top > 0 ? players.filter((p) => valid[p] && tally[p][2] === top) : [];
  const points: Record<string, number> = {};
  for (const p of players) points[p] = (valid[p] ? SLF.imagePoints : 0) + (best.includes(p) ? SLF.bestBonus : 0);
  return { valid, groups: [], best, points, tally };
}

/** The running text category as it stands: answers with every decided flag applied. */
export function liveText(s: SlfState, cat = s.cat): CatResult | null {
  if (!s.answers) return null;
  const answers: Record<string, string | null> = {};
  for (const p of s.players) answers[p] = s.answers[p]?.[cat] ?? null;
  const bad = new Set(s.flags.filter((f) => f.kind === 'bad' && f.result === 'yes').map((f) => f.target));
  const same = s.flags.filter((f) => f.kind === 'same' && f.result === 'yes' && f.other).map((f) => [f.target, f.other!] as const);
  return judgeText(s.players, answers, s.letter, bad, same);
}

// ---------- host ----------

const stopS = (mode: SlfMode) => (mode === 'text' ? SLF.stopS : SLF.imageStopS);

export class SlfHost {
  state: SlfState;
  /** Who is in the room right now; null = everyone (tests). Absent players never block anything. */
  present: ReadonlySet<string> | null = null;
  /** Text: the open flag's votes. */
  private votes = new Map<string, boolean>();
  /** Pictures: judgements of the running category. */
  private judges = new Map<string, Judgement>();
  /** Text: verified answers as they came in (null = didn't match the commitment). */
  private texts = new Map<string, string[] | null>();
  /** Pictures: per category true (a picture), false (left empty), null (didn't match); undefined = not yet. */
  private pics = new Map<string, (boolean | null | undefined)[]>();
  /**
   * "Zug zurück". A decision is the outcome of a flag vote ("ungültig" / "gleich wie"), moving on
   * from a category (text: "Weiter" or the timer; pictures: after the result), the result of a
   * picture category (the judging) and the host's "end". Each goes back to just before it, with
   * points and the other decisions up to then, and a fresh timer for the phase it lands in:
   * - a flag vote: the flag is gone as if never raised, so it can be raised and voted anew;
   * - moving on: the category again with its decided flags, everyone has to press "Weiter" again;
   * - a picture result: the judging of that category again, nobody has judged yet;
   * - the end: the phase it ended in (with the reveals collected so far).
   * Pictures and answers are keyed by their commitments and stay on the clients, so a restored
   * state finds them. Schaffner fines are kept; a player leaving ends the history.
   */
  private history = new UndoStack<Snap>();
  /** The state right before the running flag was raised, saved when it closes. */
  private beforeVote: Snap | null = null;
  /** Pick step: where "neu würfeln", a random addition and "Zufall" draw from. The game sets it (room decks, own lists). */
  pool: () => readonly string[] = () => [];
  rng: Rand = Math.random;

  /**
   * A round that starts with the step "Kategorien": no letter and no timer yet; `begin` starts the
   * writing once the host is happy with the list.
   */
  static picking(players: string[], mode: SlfMode, categories: string[], scores: Record<string, number> = {}, round = 1, keep = false): SlfHost {
    const h = new SlfHost(players, mode, '', categories, scores, round);
    h.state.phase = 'pick';
    h.state.deadline = null;
    h.state.keep = keep;
    return h;
  }

  constructor(players: string[], mode: SlfMode, letter: string, categories: string[], scores: Record<string, number> = {}, round = 1, now = Date.now()) {
    this.state = {
      phase: 'write',
      mode,
      round,
      letter,
      categories: [...categories],
      proposals: [],
      seq: 0,
      keep: false,
      players: [...players],
      commits: {},
      stopBy: null,
      deadline: now + (mode === 'text' ? SLF.writeS : SLF.imageS) * 1000,
      answers: null,
      shown: null,
      cat: 0,
      step: mode === 'bild' ? 'vote' : 'show',
      flags: [],
      vote: null,
      judged: [],
      voteNo: 0,
      ready: [],
      results: [],
      scores: Object.fromEntries(players.map((p) => [p, scores[p] ?? 0])),
      undo: 0,
    };
  }

  private snap(): Snap {
    return { state: structuredClone(this.state), texts: [...this.texts], pics: [...this.pics] };
  }

  get canUndo(): boolean {
    return this.history.size > 0;
  }

  /** Back to before the last decision, points with it (fines stay), with a fresh timer for the phase it lands in. */
  undo(now: number): boolean {
    const r = this.history.pop();
    if (!r) return false;
    const s = r.snap.state;
    s.undo = this.state.undo + 1;
    // The toggle is a setting, not a move.
    s.keep = this.state.keep;
    if (s.phase === 'pick') {
      // A taken-back accept or reject brings that proposal back; ones that came in since stay.
      const known = new Set(s.proposals.map((p) => p.id));
      s.proposals = [...s.proposals, ...this.state.proposals.filter((p) => !known.has(p.id))].sort((a, b) => a.id - b.id);
      s.seq = Math.max(s.seq, this.state.seq);
    }
    // Votes and "Weiter" of the step were part of the decision: they come again.
    s.vote = null;
    s.ready = [];
    if (s.phase === 'rate' && s.step === 'vote') s.judged = [];
    const secs =
      s.phase === 'write'
        ? s.stopBy
          ? stopS(s.mode)
          : s.mode === 'text'
            ? SLF.writeS
            : SLF.imageS
        : s.phase === 'lock'
          ? SLF.lockS
          : s.phase === 'reveal'
            ? s.mode === 'text'
              ? SLF.collectS
              : SLF.collectImageS
            : s.phase === 'rate'
              ? s.mode === 'bild'
                ? s.step === 'vote'
                  ? SLF.imageVoteS
                  : SLF.showS
                : SLF.rateS
              : null;
    s.deadline = secs === null ? null : now + secs * 1000;
    keepFines(s.scores, r.later);
    this.state = s;
    this.texts = new Map(r.snap.texts);
    this.pics = new Map(r.snap.pics);
    this.votes.clear();
    this.judges.clear();
    this.beforeVote = null;
    return true;
  }

  /** Continue a round from its public state: the new host after the old one left. Secret votes are gone with the old host. */
  static fromState(state: SlfState, now = Date.now()): SlfHost {
    const h = new SlfHost(state.players, state.mode, state.letter, state.categories, state.scores, state.round, now);
    const s = structuredClone(state);
    s.undo ??= 0;
    s.proposals ??= [];
    s.seq ??= 0;
    s.keep ??= false;
    // Pick step: the list and the proposals are public, so they simply carry on.
    h.state = s;
    if (s.vote) {
      // The flag can simply be raised again.
      s.flags.splice(s.vote.flag, 1);
      s.vote = null;
    }
    if (s.phase === 'lock') s.deadline = now + SLF.lockS * 1000;
    // The clients' verified answers are fed back in by the game.
    if (s.phase === 'reveal') s.deadline = now + (s.mode === 'text' ? SLF.collectS : SLF.collectImageS) * 1000;
    if (s.phase === 'rate' && s.step === 'vote') {
      s.judged = [];
      s.voteNo++;
      s.deadline = now + SLF.imageVoteS * 1000;
    }
    return h;
  }

  here(): string[] {
    return this.state.players.filter((p) => !this.present || this.present.has(p));
  }

  private commitsOk(c: readonly string[]): boolean {
    return c.length === (this.state.mode === 'text' ? 1 : this.state.categories.length);
  }

  /** Apply an intent from `from`. Returns whether the public state changed. */
  intent(from: string, i: Intent, now: number, isHost: boolean): boolean {
    const s = this.state;
    if (i.a === 'keep') {
      if (!isHost || s.keep === i.on) return false;
      s.keep = i.on;
      return true;
    }
    if (i.a === 'pick' || i.a === 'accept' || i.a === 'reject' || i.a === 'withdraw') return this.pick(from, i, now, isHost);
    if (i.a === 'end') {
      if (!isHost || s.phase === 'done') return false;
      this.history.push(s.vote ? (this.beforeVote ?? this.snap()) : this.snap(), now);
      this.finish();
      return true;
    }
    if (!s.players.includes(from)) return false;
    switch (i.a) {
      case 'stop':
        if (s.phase !== 'write' || !this.commitsOk(i.c)) return false;
        s.commits[from] = [...i.c];
        if (!s.stopBy) {
          s.stopBy = from;
          s.deadline = Math.min(s.deadline ?? Infinity, now + stopS(s.mode) * 1000);
        }
        this.step(now);
        return true;
      case 'lock':
        // Locking again replaces the commitment (came back without my secret).
        if ((s.phase !== 'write' && s.phase !== 'lock') || !this.commitsOk(i.c)) return false;
        s.commits[from] = [...i.c];
        this.step(now);
        return true;
      case 'flag':
        return this.flag(from, i, now);
      case 'vote': {
        const v = s.vote;
        if (!v || !v.eligible.includes(from) || this.votes.has(from)) return false;
        this.votes.set(from, i.v);
        v.voters.push(from);
        this.step(now);
        return true;
      }
      case 'judge': {
        if (s.mode !== 'bild' || s.phase !== 'rate' || s.step !== 'vote' || i.cat !== s.cat || s.judged.includes(from)) return false;
        const ok: Record<string, boolean> = {};
        for (const [p, v] of Object.entries(i.ok)) if (p !== from && s.players.includes(p)) ok[p] = v;
        const best = i.best && i.best !== from && s.shown?.[i.best]?.[s.cat] ? i.best : null;
        this.judges.set(from, { ok, best });
        s.judged.push(from);
        this.step(now);
        return true;
      }
      case 'ready':
        if (s.phase !== 'rate' || s.step !== 'show' || s.ready.includes(from)) return false;
        s.ready.push(from);
        this.step(now);
        return true;
    }
  }

  /** Pick step: the host changes the list directly; anybody else's change waits as a proposal. */
  private pick(from: string, i: Extract<Intent, { a: 'pick' | 'accept' | 'reject' | 'withdraw' }>, now: number, isHost: boolean): boolean {
    const s = this.state;
    if (s.phase !== 'pick') return false;
    if (i.a === 'pick') {
      // Spectators may propose too: they join the round when the writing starts.
      if (!isHost && !s.players.includes(from) && !this.present?.has(from)) return false;
      const e = this.resolve(i.e);
      if (!e || !applyEdit(s.categories, e, s.mode)) return false;
      if (isHost) return this.change(e, now);
      if (s.proposals.filter((p) => p.by === from).length >= SLF.pick.maxProposals) return false;
      const key = editKey(e);
      if (s.proposals.some((p) => editKey(p.edit) === key)) return false;
      s.proposals.push({ id: ++s.seq, by: from, edit: e });
      return true;
    }
    const k = s.proposals.findIndex((p) => p.id === i.id);
    const p = s.proposals[k];
    if (!p) return false;
    if (i.a === 'withdraw') {
      if (p.by !== from) return false;
      s.proposals.splice(k, 1);
      return true;
    }
    if (!isHost) return false;
    if (i.a === 'accept') {
      if (!applyEdit(s.categories, p.edit, s.mode)) return false;
      // Snapshot with the proposal still open: taking the accept back brings it back pending.
      const before = this.snap();
      s.proposals.splice(k, 1);
      return this.change(p.edit, now, before);
    }
    this.history.push(this.snap(), now);
    s.proposals.splice(k, 1);
    return true;
  }

  /** Draw what a pick edit leaves to chance, from the pool and without what the list has already. */
  private resolve(e: PickEdit): Edit | null {
    const s = this.state;
    const one = () => drawCategories(this.pool(), 1, this.rng, s.categories)[0] ?? null;
    switch (e.op) {
      case 'roll': {
        const text = one();
        return text ? { op: 'set', at: e.at, text, how: 'roll' } : null;
      }
      case 'add': {
        const text = e.text ?? one();
        return text ? { op: 'add', text, how: e.text === null ? 'roll' : e.how } : null;
      }
      case 'preset':
        return { op: 'preset', name: e.name, list: e.name === 'klassisch' ? classicCategories(s.mode) : drawCategories(this.pool(), SLF.count[s.mode], this.rng) };
      default:
        return { ...e };
    }
  }

  /** Apply a change to the list (a decision for Zug zurück); proposals it made pointless go. */
  private change(e: Edit, now: number, before: Snap = this.snap()): boolean {
    const s = this.state;
    const next = applyEdit(s.categories, e, s.mode);
    if (!next) return false;
    this.history.push(before, now);
    s.categories = next;
    s.proposals = s.proposals.filter((p) => !staleEdit(next, p.edit));
    return true;
  }

  /**
   * The host is happy with the list: the writing starts with `letter`. `players` may bring in who
   * joined meanwhile. Open proposals are dropped, and the history ends: Zug zurück never leads back
   * into the pick step, since the letter is out and answers are being typed against the list.
   */
  begin(letter: string, now: number, players: readonly string[] = this.state.players): boolean {
    const s = this.state;
    const { min, max } = pickBounds(s.mode);
    if (s.phase !== 'pick' || s.categories.length < min || s.categories.length > max || players.length < 2 || letter.length !== 1) return false;
    s.phase = 'write';
    s.letter = letter;
    s.players = [...players];
    for (const p of s.players) s.scores[p] ??= 0;
    s.proposals = [];
    s.deadline = now + (s.mode === 'text' ? SLF.writeS : SLF.imageS) * 1000;
    this.history.clear();
    return true;
  }

  private flag(from: string, i: Extract<Intent, { a: 'flag' }>, now: number): boolean {
    const s = this.state;
    if (s.mode !== 'text' || s.phase !== 'rate' || s.vote) return false;
    const live = liveText(s);
    if (!live) return false;
    const other = i.kind === 'same' ? i.other : null;
    if (!live.valid[i.target] || (other !== null && !live.valid[other])) return false;
    if (other !== null && live.groups.some((g) => g.includes(i.target) && g.includes(other))) return false;
    const pair = (f: Flag) => (f.target === i.target && f.other === other) || (f.target === other && f.other === i.target);
    if (s.flags.some((f) => f.kind === i.kind && pair(f))) return false;
    const authors = other ? [i.target, other] : [i.target];
    const here = this.here();
    this.beforeVote = this.snap();
    // The others decide; with too few of them (two players) the authors vote too, so nobody decides alone.
    let eligible = here.filter((p) => !authors.includes(p));
    if (eligible.length < 2) eligible = here;
    s.flags.push({ kind: i.kind, target: i.target, other, by: from, result: null, yes: 0, no: 0 });
    this.votes.clear();
    const voters: string[] = [];
    // Raising the flag is the flagger's yes.
    if (eligible.includes(from)) {
      this.votes.set(from, true);
      voters.push(from);
    }
    s.vote = { flag: s.flags.length - 1, eligible, voters, deadline: now + SLF.voteS * 1000 };
    s.ready = [];
    this.step(now);
    return true;
  }

  /** Text: the reveal of `from`, checked by the game (null = didn't match its commitment). */
  revealText(from: string, answers: string[] | null, now: number): boolean {
    const s = this.state;
    if (s.mode !== 'text' || s.phase !== 'reveal' || !s.players.includes(from) || !s.commits[from] || this.texts.has(from)) return false;
    this.texts.set(from, answers);
    this.step(now);
    return true;
  }

  /** Pictures: one category of `from` checked by the game: true a picture, false left empty, null didn't match. */
  revealImage(from: string, cat: number, has: boolean | null, now: number): boolean {
    const s = this.state;
    if (s.mode !== 'bild' || s.phase !== 'reveal' || !s.players.includes(from) || !s.commits[from] || cat < 0 || cat >= s.categories.length) return false;
    const got = this.pics.get(from) ?? s.categories.map(() => undefined);
    if (got[cat] !== undefined) return false;
    got[cat] = has;
    this.pics.set(from, got);
    this.step(now);
    return true;
  }

  /** Per tick: deadlines, and everything that waited for people who turned out to be absent. */
  tick(now: number): boolean {
    return this.step(now);
  }

  private step(now: number): boolean {
    const s = this.state;
    const here = this.here();
    const late = (t: number | null | undefined) => now >= (t ?? Infinity);
    let changed = false;
    if (s.phase === 'write' && here.length > 0) {
      if (here.every((p) => s.commits[p])) {
        this.toReveal(now);
        changed = true;
      } else if (late(s.deadline)) {
        s.phase = 'lock';
        s.deadline = now + SLF.lockS * 1000;
        changed = true;
      }
    }
    if (s.phase === 'lock' && (late(s.deadline) || here.every((p) => s.commits[p]))) {
      this.toReveal(now);
      changed = true;
    }
    if (s.phase === 'reveal') {
      const waiting = here.filter((p) => s.commits[p]);
      const done = s.mode === 'text' ? waiting.every((p) => this.texts.has(p)) : waiting.every((p) => this.pics.get(p)?.every((x) => x !== undefined));
      if (late(s.deadline) || done) {
        this.judge(now);
        changed = true;
      }
    }
    if (s.phase === 'rate') {
      if (s.mode === 'text') {
        const v = s.vote;
        if (v) {
          if (late(v.deadline) || v.eligible.filter((p) => here.includes(p)).every((p) => v.voters.includes(p))) {
            this.closeVote(now);
            changed = true;
          }
        } else if (late(s.deadline) || (here.length > 0 && here.every((p) => s.ready.includes(p)))) {
          this.nextCat(now);
          changed = true;
        }
      } else if (s.step === 'vote') {
        if (late(s.deadline) || (here.length > 0 && here.every((p) => s.judged.includes(p)))) {
          this.tallyImages(now);
          changed = true;
        }
      } else if (late(s.deadline) || (here.length > 0 && here.every((p) => s.ready.includes(p)))) {
        this.nextCat(now);
        changed = true;
      }
    }
    return changed;
  }

  private toReveal(now: number): void {
    const s = this.state;
    s.phase = 'reveal';
    s.deadline = now + (s.mode === 'text' ? SLF.collectS : SLF.collectImageS) * 1000;
    this.texts.clear();
    this.pics.clear();
  }

  private judge(now: number): void {
    const s = this.state;
    const n = s.categories.length;
    if (s.mode === 'text') {
      s.answers = {};
      for (const p of s.players) {
        const got = s.commits[p] ? this.texts.get(p) : null;
        s.answers[p] = Array.from({ length: n }, (_, c) => got?.[c] || null);
      }
    } else {
      s.shown = {};
      for (const p of s.players) {
        const got = s.commits[p] ? this.pics.get(p) : undefined;
        s.shown[p] = Array.from({ length: n }, (_, c) => got?.[c] === true);
      }
    }
    s.phase = 'rate';
    this.startCat(0, now);
  }

  private startCat(cat: number, now: number): void {
    const s = this.state;
    s.cat = cat;
    s.flags = [];
    s.vote = null;
    this.beforeVote = null;
    s.ready = [];
    s.judged = [];
    this.votes.clear();
    this.judges.clear();
    s.step = s.mode === 'bild' ? 'vote' : 'show';
    s.deadline = now + (s.mode === 'bild' ? SLF.imageVoteS : SLF.rateS) * 1000;
  }

  private closeVote(now: number): void {
    const s = this.state;
    const v = s.vote!;
    const all = [...this.votes.values()];
    const yes = all.filter(Boolean).length;
    const no = all.length - yes;
    this.history.push(this.beforeVote ?? this.snap(), now);
    this.beforeVote = null;
    const f = s.flags[v.flag];
    if (f) Object.assign(f, { result: yes > no ? 'yes' : 'no', yes, no });
    s.vote = null;
    this.votes.clear();
    s.deadline = Math.max(s.deadline ?? 0, now + SLF.afterVoteS * 1000);
  }

  private tallyImages(now: number): void {
    const s = this.state;
    this.history.push(this.snap(), now);
    const shown = Object.fromEntries(s.players.map((p) => [p, !!s.shown?.[p]?.[s.cat]]));
    const r = judgeImages(s.players, shown, this.judges);
    s.results.push(r);
    for (const p of s.players) s.scores[p] = (s.scores[p] ?? 0) + r.points[p];
    s.step = 'show';
    s.ready = [];
    s.deadline = now + SLF.showS * 1000;
    this.judges.clear();
  }

  private nextCat(now: number): void {
    const s = this.state;
    this.history.push(this.snap(), now);
    if (s.mode === 'text') {
      const r = liveText(s)!;
      s.results.push(r);
      for (const p of s.players) s.scores[p] = (s.scores[p] ?? 0) + r.points[p];
    }
    if (s.cat + 1 >= s.categories.length) this.finish();
    else this.startCat(s.cat + 1, now);
  }

  private finish(): void {
    const s = this.state;
    s.phase = 'done';
    s.vote = null;
    s.deadline = null;
  }

  /** The Schaffner's fine, only while people are writing (reading out answers would be copying). */
  penalize(id: string, points: number): void {
    if (!(id in this.state.scores)) return;
    this.state.scores[id] -= points;
    this.history.fine(id, points);
  }

  /** A player came back under a new id (reload): everything that names them follows. */
  replace(oldId: string, newId: string): boolean {
    const s = this.state;
    if (!s.players.includes(oldId)) return false;
    const r = (id: string) => (id === oldId ? newId : id);
    this.history.rename(oldId, newId);
    if (this.beforeVote) this.beforeVote = renameDeep(this.beforeVote, oldId, newId);
    const rk = <T>(rec: Record<string, T> | null | undefined) => {
      if (rec && oldId in rec) {
        rec[newId] = rec[oldId];
        delete rec[oldId];
      }
    };
    s.players = s.players.map(r);
    for (const p of s.proposals) p.by = r(p.by);
    s.ready = s.ready.map(r);
    s.judged = s.judged.map(r);
    if (s.stopBy === oldId) s.stopBy = newId;
    if (s.vote) {
      s.vote.eligible = s.vote.eligible.map(r);
      s.vote.voters = s.vote.voters.map(r);
    }
    for (const f of s.flags) {
      f.target = r(f.target);
      f.by = r(f.by);
      if (f.other) f.other = r(f.other);
    }
    for (const res of s.results) {
      rk(res.valid);
      rk(res.points);
      rk(res.tally);
      res.groups = res.groups.map((g) => g.map(r));
      res.best = res.best.map(r);
    }
    rk(s.scores);
    rk(s.answers);
    rk(s.shown);
    // A commitment made while writing is worthless after a reload (the answers went with it): write again.
    if (s.phase === 'write' || s.phase === 'lock') delete s.commits[oldId];
    else rk(s.commits);
    for (const m of [this.votes, this.texts, this.pics, this.judges] as Map<string, unknown>[]) {
      if (m.has(oldId)) {
        m.set(newId, m.get(oldId));
        m.delete(oldId);
      }
    }
    for (const j of this.judges.values()) {
      if (j.best === oldId) j.best = newId;
      rk(j.ok);
    }
    return true;
  }

  /** Someone left for good: out of the round (their earlier points stay in the table); too few people end it. */
  removePlayer(id: string, now: number): boolean {
    const s = this.state;
    if (!s.players.includes(id)) return false;
    const not = (p: string) => p !== id;
    // An undo would bring them back into a round they left: the history ends here.
    this.history.clear();
    this.beforeVote = null;
    s.players = s.players.filter(not);
    s.proposals = s.proposals.filter((p) => p.by !== id);
    s.ready = s.ready.filter(not);
    s.judged = s.judged.filter(not);
    delete s.commits[id];
    if (s.answers) delete s.answers[id];
    if (s.shown) delete s.shown[id];
    if (s.vote) {
      const f = s.flags[s.vote.flag];
      if (f && (f.target === id || f.other === id)) {
        // A vote about their answer is moot now.
        s.flags.splice(s.vote.flag, 1);
        s.vote = null;
        this.votes.clear();
      } else {
        s.vote.eligible = s.vote.eligible.filter(not);
        s.vote.voters = s.vote.voters.filter(not);
        this.votes.delete(id);
      }
    }
    s.flags = s.flags.filter((f) => f.result === null || (f.target !== id && f.other !== id));
    if (s.vote) s.vote.flag = s.flags.findIndex((f) => f.result === null);
    this.texts.delete(id);
    this.pics.delete(id);
    this.judges.delete(id);
    for (const j of this.judges.values()) {
      delete j.ok[id];
      if (j.best === id) j.best = null;
    }
    if (s.players.length < 2) {
      if (s.phase !== 'done') this.finish();
      return true;
    }
    this.step(now);
    return true;
  }
}
