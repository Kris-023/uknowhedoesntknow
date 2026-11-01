# `ukhdk-listen` – eingebaute Stapel im Terminal pflegen

Terminal-Programm (Rust, ratatui, läuft auch per SSH) für die eingebauten Stapel von uKnowHeDoesntKnow: Wörter,
„Gleich gedacht“-Startfragen, „Zeig drauf“-Fragen und „Stadt, Land, Fluss“-Kategorien, je Normal/NSFW (SLF:
Text/Bilder/NSFW), zusammen neun Listen.

Es arbeitet **direkt auf dem verschlüsselten Tresor** `src/words/vault.json`: entschlüsselt im Speicher, prüft
Einträge mit denselben Regeln wie `npm run seal`, versiegelt wieder und pusht **nur** den Tresor. Klartext-Dateien
braucht niemand, `private/content/` darf fehlen. Hintergrund: [Entscheidung 0002](../../superdoc/decisions/0002-sealed-decks.md),
Details: [Built-in decks](../../superdoc/features/content-decks.md).

## Start

```bash
npm run listen                     # im Projektordner; der erste Start baut das Programm (~30 s, braucht cargo)
npm run listen -- --root /pfad     # anderer Projektordner (z. B. eine Kopie zum Ausprobieren)
```

Passwort: aus derselben Datei wie bei `npm run seal` (`UKHDK_DECK_PASS_FILE`, sonst `~/.config/ukhdk/deck-pass`,
Rechte 600). Fehlt sie oder passt sie nicht, fragt das Programm verdeckt danach („Passwort falsch.“, <kbd>Esc</kbd>
beendet). Das Passwort bleibt nur im Speicher und wird nirgends geschrieben oder ausgegeben.

Passwortdatei einmal anlegen (zsh; in bash `read -rsp "Passwort: " p`):

```zsh
mkdir -p ~/.config/ukhdk && read -rs "p?Passwort: " && printf '%s' "$p" > ~/.config/ukhdk/deck-pass && chmod 600 ~/.config/ukhdk/deck-pass && unset p
```

## Steuerung

Die Leiste unten zeigt immer nur die Tasten, die gerade gehen. Buchstabe drücken genügt.

| Taste | Was |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd>, <kbd>Bild↑</kbd> <kbd>Bild↓</kbd>, <kbd>Pos1</kbd> <kbd>Ende</kbd>, Maus | Zeile wählen |
| <kbd>Tab</kbd>, <kbd>←</kbd> <kbd>→</kbd> | Listen (links) ↔ Einträge (rechts) |
| <kbd>1</kbd>–<kbd>9</kbd> | direkt zur Liste |
| <kbd>a</kbd> | neuer Eintrag (Wörter: Begriff + verbotene Wörter mit Komma) |
| <kbd>e</kbd> / <kbd>Enter</kbd> | bearbeiten |
| <kbd>d</kbd> / <kbd>Entf</kbd> | löschen (j/n) |
| <kbd>m</kbd> | in eine andere Liste derselben Art verschieben (Normal ↔ NSFW; SLF: Auswahl) |
| <kbd>/</kbd> | suchen (auch in verbotenen Wörtern); <kbd>Enter</kbd> fertig, <kbd>Esc</kbd> löscht den Filter |
| <kbd>u</kbd> / <kbd>Strg+Z</kbd> | letzte noch nicht versiegelte Änderung zurück |
| <kbd>i</kbd> | importieren (siehe unten) |
| <kbd>s</kbd> | versiegeln nach `src/words/vault.json` im Arbeitsordner, ohne Commit (j/n) |
| <kbd>p</kbd> | pushen mit Zusammenführen (siehe unten) |
| <kbd>x</kbd> | Klartext-Backup nach `private/content/` (nur wenn gitignored; j/n) |
| <kbd>r</kbd> | Tresor neu laden |
| <kbd>?</kbd> / <kbd>F1</kbd> | alle Tasten |
| <kbd>q</kbd> | beenden (warnt bei nicht Versiegeltem); <kbd>Strg+C</kbd> überall außer während eines Pushs |

In Dialogen: <kbd>j</kbd> ja, <kbd>n</kbd>/<kbd>Esc</kbd> nein; im Formular <kbd>Tab</kbd> nächstes Feld,
<kbd>Enter</kbd> übernehmen.

Markierungen: rot = ungültig (z. B. zu lang, leer), gelb = doppelt, jeweils mit Grund. ● an einer Liste = noch nicht
versiegelt.

## Importieren

<kbd>i</kbd>, dann Text einfügen (auch einfach ins Terminal einfügen) und <kbd>Strg+S</kbd> für die Vorschau, oder
<kbd>Tab</kbd> → Dateipfad + <kbd>Enter</kbd>. Importierbar: Exporte aus „Eigene Listen“ im Spiel (Liste als JSON,
alte Wortliste `{ukhdkWords, cards}`, JSON-Array) oder ein Eintrag pro Zeile (Wörter als `Wort: verboten, verboten`).
Die Vorschau zeigt neu/doppelt/ungültig; Zielliste mit <kbd>←</kbd> <kbd>→</kbd>, <kbd>Enter</kbd> übernimmt nur die
neuen.

## Pushen und Zusammenführen

<kbd>p</kbd> → „Pushen? (j/n)“ → Prüfungen → `git fetch` → hat jemand auf `origin/main` inzwischen die Stapel
geändert, werden beide Seiten mit dem Ausgangsstand (Tresor bei `HEAD` beim Start) Eintrag für Eintrag
zusammengeführt → Regeln prüfen → `main` vorspulen → versiegeln → nur den Tresor stagen → zweites j/n mit Übersicht →
Commit („Stapel aktualisiert (Anzahlen)“, nie Wörter) + Push.

- Neues von beiden Seiten bleibt, Gelöschtes verschwindet, Verschobenes wandert mit.
- **Konflikt** nur, wenn beide denselben Eintrag verschieden geändert, in verschiedene Listen verschoben, einer
  gelöscht und der andere geändert oder beide denselben Eintrag verschieden neu angelegt haben. Der Bildschirm zeigt
  Vorher / deins / seins: <kbd>↑</kbd> <kbd>↓</kbd> Konflikt, <kbd>←</kbd>/<kbd>m</kbd> deine, <kbd>→</kbd>/<kbd>t</kbd>
  andere Version, <kbd>Enter</kbd> weiter, <kbd>Esc</kbd> bricht ohne Änderung ab.
- Verletzt das Ergebnis die Regeln, wird nicht gepusht; es bleibt zum Korrigieren im Programm.
- Lehnt GitHub ab, weil gerade jemand gepusht hat: einmal neu holen und zusammenführen, dann Abbruch mit Meldung.
- Gleiches Passwort → gleiches Salz: freigeschaltete Browser bleiben freigeschaltet. Wurde das Passwort auf
  `origin/main` geändert, fragt es nach dem neuen.

**Abbruch mit Meldung**, wenn: Branch nicht `main`; etwas aus `private/` ist in git oder nicht ignoriert; etwas
anderes ist schon gestaged; `main` hat ungepushte Commits; Vorspulen scheitert an anderen lokalen Änderungen; der
Tresor wurde außerhalb geändert; der Tresor auf `origin/main` hat fremde Felder; gestaged wäre mehr als
`src/words/vault.json`. Ohne Änderungen: „nichts zu pushen“.

Voraussetzung: direkte Schreibrechte auf das Repo (`origin` = das gemeinsame Repo, nicht ein Fork).

## Für Agents

- **Nie** die Passwortdatei lesen, ausgeben oder kopieren, nie den echten Tresor entschlüsseln und Inhalte zeigen,
  nie Einträge aus `private/content/` zitieren. Höchstens Anzahlen ausgeben.
- Das Programm ist interaktiv (Vollbild-TUI). Agents starten es nicht selbst für Nutzer-Änderungen; Bedienung dem
  Nutzer erklären (Tabelle oben) und ihn `npm run listen` ausführen lassen.
- Testdaten nur mit Fantasiewörtern. Vor einem Commit Leak-Check gegen `private/content/` (nur Treffer zählen) und den
  Hygiene-Grep aus `superdoc/claude-instructions/public-repo-hygiene.md`.
- Entwickeln: `cd tools/listen && cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`.
  Die Tests bauen ein Fake-Projekt mit lokalem Bare-Remote und Test-Passwortdatei (`UKHDK_DECK_PASS_FILE`); die
  Vergleichstests mit `scripts/seal-content.mjs` und `src/words/vault.ts` brauchen `node` (sonst übersprungen).
  `vitest` schließt `tools/**` aus.
- Aufbau: `vault.rs` (Format, PBKDF2 + AES-256-GCM, kompatibel zu `vault.ts`), `content.rs` (Listen, JSON wie
  `JSON.stringify`), `validate.rs` (Regeln von `seal-content.mjs` – bei Regeländerungen beide anpassen), `merge.rs`
  (Drei-Wege-Merge), `push.rs` (git-Schritte, feste Argumente, keine Shell), `app.rs` (Zustand, Abläufe), `ui.rs`,
  `input.rs`, `import.rs`.
- Grenzen: Passwort, Schlüssel und entschlüsselte Rohdaten werden nach Gebrauch überschrieben, die geparsten Listen
  im Speicher nicht vollständig. Nur unter Linux getestet.
