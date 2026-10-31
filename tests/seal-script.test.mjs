import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveKey, openVault, parseVault } from '../src/words/vault';
import { FIXTURE } from './fixtures/content';

// scripts/seal-content.mjs against fixture content in a temp folder (plain JS like the script; the
// project has no Node types). The password file is a temp file too, never the real one.

const PASS = 'test-passwort-123';
const __dirname = dirname(fileURLToPath(import.meta.url));

describe('vault: the seal script', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ukhdk-seal-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(__dirname, '..', 'scripts', 'seal-content.mjs');
  const content = join(dir, 'content');
  const out = join(dir, 'vault.json');
  const passFile = join(dir, 'pass');
  mkdirSync(content);
  const lines = (xs) => `# Kommentar\n\n${xs.join('\n')}\n`;
  const cards = (xs) => lines(xs.map(([w, ...t]) => `${w}: ${t.join(', ')}`));
  writeFileSync(join(content, 'woerter-normal.txt'), cards(FIXTURE.words.normal));
  writeFileSync(join(content, 'woerter-nsfw.txt'), cards(FIXTURE.words.nsfw));
  writeFileSync(join(content, 'gleich-normal.txt'), lines(FIXTURE.gleich.normal));
  writeFileSync(join(content, 'gleich-nsfw.txt'), lines(FIXTURE.gleich.nsfw));
  writeFileSync(join(content, 'zeig-normal.txt'), lines(FIXTURE.zeig.normal));
  writeFileSync(join(content, 'zeig-nsfw.txt'), lines(FIXTURE.zeig.nsfw));
  writeFileSync(join(content, 'slf-text.txt'), lines(FIXTURE.slf.text));
  writeFileSync(join(content, 'slf-bild.txt'), lines(FIXTURE.slf.image));
  writeFileSync(join(content, 'slf-nsfw.txt'), lines(FIXTURE.slf.nsfw));
  const run = (args, pass) =>
    spawnSync(process.execPath, [script, '--content', content, '--out', out, ...args], {
      env: { ...process.env, UKHDK_DECK_PASS_FILE: pass ?? join(dir, 'gibt-es-nicht') },
      encoding: 'utf8',
    });

  it('without a password file: a clear German message, nothing written', () => {
    const r = run([], null);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Keine Passwortdatei gefunden');
    expect(r.stderr).toContain('read -rs');
  });

  it('seals what the browser opens, and never prints the password or the content', async () => {
    writeFileSync(passFile, `${PASS}\n`, { mode: 0o600 });
    const r = run([], passFile);
    expect(r.status, r.stderr).toBe(0);
    const v = parseVault(JSON.parse(readFileSync(out, 'utf8')));
    expect(v).not.toBeNull();
    expect(await openVault(v, await deriveKey(PASS, v))).toEqual(FIXTURE);
    const check = run(['--check'], passFile);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain('Tresor geht auf');
    for (const o of [r.stdout + r.stderr, check.stdout + check.stderr]) {
      expect(o).not.toContain(PASS);
      expect(o).not.toContain(FIXTURE.words.normal[0][0]);
    }
    writeFileSync(passFile, 'ein-anderes-passwort');
    const wrong = run(['--check'], passFile);
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain('nicht auf');
  }, 20_000);

  it('refuses duplicates', () => {
    writeFileSync(passFile, PASS);
    writeFileSync(join(content, 'zeig-nsfw.txt'), lines([...FIXTURE.zeig.nsfw, FIXTURE.zeig.nsfw[0].toUpperCase()]));
    const r = run([], passFile);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('doppelt');
    writeFileSync(join(content, 'zeig-nsfw.txt'), lines(FIXTURE.zeig.nsfw));
  });

  it('is plain node, no build step', () => {
    expect(() => execFileSync(process.execPath, ['--check', script])).not.toThrow();
  });
});
