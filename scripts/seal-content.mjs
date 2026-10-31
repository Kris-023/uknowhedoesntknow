#!/usr/bin/env node
// Seals the plaintext content in private/content/ into src/words/vault.json (AES-256-GCM, key from
// PBKDF2-SHA256 over a password). The password is read only from a file, never from argv or stdin,
// and is never printed. `--check` only verifies that the committed vault opens with that password.
//
//   npm run seal            seal private/content -> src/words/vault.json
//   npm run seal:check      decrypt the vault with the local password, print counts only
//
// Options (no secrets): --content <dir>, --out <file> (tests point these at fixtures).
// Password file: $UKHDK_DECK_PASS_FILE, else ~/.config/ukhdk/deck-pass.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// OWASP 2023 recommendation for PBKDF2-HMAC-SHA256. Players derive once per browser, then keep the key.
const ITERATIONS = 600_000;
const LIMITS = { word: 40, taboo: 8, question: 120, category: 40 };

const FILES = {
  wordsNormal: 'woerter-normal.txt',
  wordsNsfw: 'woerter-nsfw.txt',
  gleichNormal: 'gleich-normal.txt',
  gleichNsfw: 'gleich-nsfw.txt',
  zeigNormal: 'zeig-normal.txt',
  zeigNsfw: 'zeig-nsfw.txt',
  slfText: 'slf-text.txt',
  slfImage: 'slf-bild.txt',
  slfNsfw: 'slf-nsfw.txt',
};

class Fail extends Error {}

function args() {
  const a = process.argv.slice(2);
  const opt = (name, def) => {
    const i = a.indexOf(name);
    return i >= 0 && a[i + 1] ? resolve(a[i + 1]) : def;
  };
  return {
    check: a.includes('--check'),
    content: opt('--content', join(ROOT, 'private', 'content')),
    out: opt('--out', join(ROOT, 'src', 'words', 'vault.json')),
  };
}

function readPassword() {
  const file = process.env.UKHDK_DECK_PASS_FILE || join(homedir(), '.config', 'ukhdk', 'deck-pass');
  if (!existsSync(file)) {
    throw new Fail(
      [
        `Keine Passwortdatei gefunden: ${file}`,
        'Einmal anlegen (das Passwort wird dabei nicht angezeigt):',
        "  mkdir -p ~/.config/ukhdk && (umask 077; read -rs -p 'Stapel-Passwort: ' p && printf '%s' \"$p\" > ~/.config/ukhdk/deck-pass); echo",
        'Oder eine andere Datei angeben: UKHDK_DECK_PASS_FILE=/pfad/zur/datei npm run seal',
      ].join('\n'),
    );
  }
  if ((statSync(file).mode & 0o077) !== 0) console.warn(`Hinweis: ${file} ist für andere lesbar. Besser: chmod 600 ${file}`);
  // A trailing newline from `echo >` is not part of the password.
  const pw = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  if (pw.length < 8) throw new Fail(`Das Passwort in ${file} ist leer oder kürzer als 8 Zeichen.`);
  return pw;
}

const norm = (s) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');

function readLines(dir, name) {
  const file = join(dir, name);
  if (!existsSync(file)) throw new Fail(`Datei fehlt: ${file} (Aufbau: private/content/README.md)`);
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l, i) => ({ text: l.trim().replace(/\s+/g, ' '), at: `${name}:${i + 1}` }))
    .filter((l) => l.text && !l.text.startsWith('#'));
}

function unique(items, key, what) {
  const seen = new Map();
  for (const it of items) {
    const k = norm(key(it));
    if (seen.has(k)) throw new Fail(`${it.at}: doppelt (${what}), schon in ${seen.get(k)}`);
    seen.set(k, it.at);
  }
}

function texts(dir, name, max) {
  const lines = readLines(dir, name);
  for (const l of lines) if ([...l.text].length > max) throw new Fail(`${l.at}: länger als ${max} Zeichen`);
  unique(lines, (l) => l.text, 'Eintrag');
  return lines;
}

function words(dir, name) {
  const cards = readLines(dir, name).map((l) => {
    const i = l.text.indexOf(':');
    if (i < 0) throw new Fail(`${l.at}: Format ist „Begriff: verboten, verboten“`);
    const word = l.text.slice(0, i).trim();
    const taboo = l.text
      .slice(i + 1)
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (!word || [...word].length > LIMITS.word) throw new Fail(`${l.at}: Begriff leer oder länger als ${LIMITS.word} Zeichen`);
    if (!taboo.length || taboo.length > LIMITS.taboo) throw new Fail(`${l.at}: 1 bis ${LIMITS.taboo} verbotene Wörter`);
    return { word, taboo, at: l.at };
  });
  unique(cards, (c) => c.word, 'Begriff');
  return cards;
}

function readContent(dir) {
  const wordsNormal = words(dir, FILES.wordsNormal);
  const wordsNsfw = words(dir, FILES.wordsNsfw);
  unique([...wordsNormal, ...wordsNsfw], (c) => c.word, 'Begriff in Normal und NSFW');
  const list = (name, max) => texts(dir, name, max).map((l) => l.text);
  const card = (c) => [c.word, ...c.taboo];
  const content = {
    v: 1,
    words: { normal: wordsNormal.map(card), nsfw: wordsNsfw.map(card) },
    gleich: { normal: list(FILES.gleichNormal, LIMITS.question), nsfw: list(FILES.gleichNsfw, LIMITS.question) },
    zeig: { normal: list(FILES.zeigNormal, LIMITS.question), nsfw: list(FILES.zeigNsfw, LIMITS.question) },
    slf: { text: list(FILES.slfText, LIMITS.category), image: list(FILES.slfImage, LIMITS.category), nsfw: list(FILES.slfNsfw, LIMITS.category) },
  };
  for (const c of ['Stadt', 'Land', 'Fluss']) if (!content.slf.text.includes(c)) throw new Fail(`${FILES.slfText}: „${c}“ fehlt (ist in jeder Schreib-Runde dabei)`);
  for (const [k, v] of Object.entries({ ...content.words, ...prefix('gleich', content.gleich), ...prefix('zeig', content.zeig) }))
    if (!v.length) throw new Fail(`Keine Einträge: ${k}`);
  return content;
}

const prefix = (p, o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`${p}.${k}`, v]));

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function counts(c) {
  return [
    `Wörter ${c.words.normal.length} + NSFW ${c.words.nsfw.length}`,
    `Gleich gedacht ${c.gleich.normal.length} + ${c.gleich.nsfw.length}`,
    `Zeig drauf ${c.zeig.normal.length} + ${c.zeig.nsfw.length}`,
    `SLF ${c.slf.text.length} / Bilder ${c.slf.image.length} / NSFW ${c.slf.nsfw.length}`,
  ].join(' · ');
}

async function seal(o) {
  const content = readContent(o.content);
  const password = readPassword();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(content))));
  const vault = {
    format: 'ukhdk-vault',
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS },
    cipher: 'AES-256-GCM',
    salt: b64(salt),
    iv: b64(iv),
    data: b64(data),
  };
  writeFileSync(o.out, JSON.stringify(vault, null, 2) + '\n');
  console.log(`Versiegelt: ${o.out}\n${counts(content)}`);
}

async function check(o) {
  if (!existsSync(o.out)) throw new Fail(`Kein Tresor: ${o.out} (erst npm run seal)`);
  const v = JSON.parse(readFileSync(o.out, 'utf8'));
  if (v.format !== 'ukhdk-vault' || v.v !== 1) throw new Fail(`${o.out} ist kein Tresor in Format 1.`);
  const key = await deriveKey(readPassword(), unb64(v.salt), v.kdf.iterations);
  let content;
  try {
    content = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, key, unb64(v.data))));
  } catch {
    throw new Fail('Der Tresor geht mit diesem Passwort nicht auf (falsches Passwort oder Datei beschädigt).');
  }
  console.log(`Tresor geht auf: ${counts(content)}`);
  if (existsSync(o.content)) {
    const local = readContent(o.content);
    console.log(JSON.stringify(local) === JSON.stringify(content) ? 'Stimmt mit private/content überein.' : 'Weicht von private/content ab: npm run seal ausführen.');
  }
}

const o = args();
try {
  await (o.check ? check(o) : seal(o));
} catch (e) {
  if (e instanceof Fail) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
