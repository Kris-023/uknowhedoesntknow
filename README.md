# uKnowHeDoesntKnow

Browser-Partyspiel für 2 bis 4 Freunde: Ihr sitzt euch in einem viel zu schnellen U-Bahn-Wagen
gegenüber, draußen rast der Tunnel vorbei, drinnen flackert das Neon, und die Mitreisenden vom Kotti
starren aufs Handy. Der Wagen heißt „Hypertrain“ und ist die erste Map. Darin laufen Minigames wie „Wer bin ich?“. Nur PC, nur Browser, nur private Lobbys.

**Stand: M6 („Wer bin ich?“).** Bis zu vier Leute treffen sich per Raumcode im selben Wagen, mit eigenem Namen und
eigener Figur, Kopfdrehung live und Sprachchat: Die Stimme kommt vom Kopf der Person, und der Mund klappt beim Sprechen auf.
Zehn Mitreisende beschäftigen sich mit Handy, Zeitung und Bier oder schlafen, Pfandflaschen rollen, Gegenzüge knallen vorbei,
vor jedem Halt gongt es. Das erste Minigame „Wer bin ich?“ ist spielbar (Roadmap in `teamlead/SUPERDOC.md`).

## Spielen

Name, Figur und Einstellungen merkt sich der Browser.

1. Eine Person klickt **Raum erstellen** und schickt den Link an die anderen (im Spiel: Esc → **Link kopieren**).
2. Wer den Link öffnet, hat den Code schon im Feld und klickt **Beitreten**. Das Verbinden dauert ein paar Sekunden.
3. Wer den Raum erstellt hat, ist Host. Geht der Host, übernimmt automatisch, wer am längsten dabei ist.

Seid ihr schon im TeamSpeak oder Discord, setzt beim Erstellen den Haken „Raum ohne Sprachchat“; der Host kann den
Sprachchat auch später im Esc-Menü für alle abschalten.

**Wer bin ich?** Der Host startet die Runde mit <kbd>G</kbd> (oben wird angezeigt, wenn es losgehen kann). Jeder sucht ein Bild für den Nachbarn (Link, Strg+V, reinziehen
oder Datei). Die Karte schwebt über dem Kopf, nur man selbst sieht die eigene nicht. Reihum laut eine Ja/Nein-Frage stellen
(<kbd>F</kbd>), die anderen stimmen geheim ab (<kbd>1</kbd> Ja, <kbd>2</kbd> Nein, <kbd>3</kbd> Weiß nicht), bei Ja darf man
weiterfragen. <kbd>R</kbd> heißt „Ich rate“. Wer zu laut wird, bekommt Besuch vom Schaffner und einen Punkt abgezogen.
Bilder bleiben im Speicher und gehen nur an die Mitspieler.

Ohne Namen bekommst du einen Zufallsnamen. Unter **Einstellungen → Benchmark starten** fährst du allein mit drei
simulierten Mitreisenden und siehst FPS, während du Grafik und Maus live anpasst. Dort startet Esc → „Testrunde mit Bots“
eine Runde „Wer bin ich?“ gegen Bots. Mehrere Tabs auf einem Rechner
funktionieren auch als Mitspieler.

Im Spiel: ins Bild klicken und mit der Maus umsehen, rechte Maustaste zoomt, <kbd>M</kbd> schaltet stumm,
<kbd>V</kbd> ist Push-to-talk; in den Einstellungen wählbar: Offen, Automatisch (sendet erst ab einer Schwelle) oder Push-to-talk, <kbd>Esc</kbd> öffnet das Menü mit Raum, Charakter
und Einstellungen. Kopfhörer sind am besten.

## Starten

```bash
npm install
npm run dev        # http://localhost:5190
npm run dev:lan    # https://<LAN-IP>:5190, für Tests mit anderen Rechnern (Zertifikatswarnung einmal bestätigen)
npm test           # Unit-Tests (Determinismus von Uhr, Flackern, Wackeln)
npm run build      # Bundle nach dist/
```

Nur im Dev-Server oder mit `?debug`: Taste <kbd>`</kbd> (bzw. <kbd>^</kbd> auf deutscher Tastatur) blendet das Debug-Panel ein und aus.
Dort gibt es Kamera (Wagen oder POV: einmal ins Bild klicken, dann dreht die Maus den Kopf, Esc lässt los),
„Ich bin“ (Spieler 1–4), Kopf-Regler und „Seitenblick“, Accessoires und Würfeln, „Meine Sicht“ (Wireframe nach Rolle),
Tempo, Wackeln, Draw-Calls, Dreiecke, FPS und den Szenengraphen. Im Raum bestimmt nur der Host Tempo und Ausfall,
„Ich bin“ vergibt der Host. `?seed=1234` in der URL überspringt die Lobby und fixiert den Seed (Solo).

## Deploy

Jeder Push auf `main` baut und veröffentlicht über GitHub Actions nach GitHub Pages
(`.github/workflows/pages.yml`). Einmalig im Repo: *Settings → Pages → Source: GitHub Actions*.

## Zugang und Grenzen

GitHub Pages ist öffentlich. Jeder mit dem Link kann die Seite laden. Eine Lobby betritt nur, wer den
**Raumcode** kennt; er ist das einzige Geheimnis. Was das heißt:

- Der Raumcode schützt nur, solange er nicht weitergegeben wird. Wer ihn kennt, ist drin.
- Der Code steht im Link hinter `#`. Dieser Teil wird nicht an GitHub geschickt, landet aber im Browserverlauf.
- Signaling läuft über öffentliche Nostr-Relays. Die sehen, dass sich Peers unter einem gehashten Raumnamen
  treffen. Die Verbindungsdaten sind mit dem Raumcode verschlüsselt, und was ihr sprecht, sehen sie nicht. Ton und Daten laufen direkt
  zwischen euch (WebRTC, verschlüsselt).
- Direkte Verbindungen zeigen euren Mitspielern eure öffentliche IP. Das ist bei P2P unvermeidbar.
- Ein clientseitiges Passwort wäre nur eine Hürde, kein Schutz. Echten Zugangsschutz gäbe es erst mit
  Cloudflare Access vor einem Cloudflare-Pages-Hosting.

## Lizenzen

Alles ist prozedural, siehe `CREDITS.md`.
