# uKnowHeDoesntKnow

Browser-Partyspiel für 2 bis 4 Freunde: Ihr sitzt euch in einem viel zu schnellen U-Bahn-Wagen
gegenüber, draußen rast der Tunnel vorbei, drinnen flackert das Neon, und die Mitreisenden vom Kotti
starren aufs Handy. Der Wagen heißt „Hypertrain“ und ist die erste Map. Darin laufen Minigames wie „Wer bin ich?“. Nur PC, nur Browser, nur private Lobbys.

**Stand: M3 (Netzwerk).** Wagen, Tunnel, Neon, Wackeln, Figuren mit Accessoires und POV laufen, und bis zu vier
Leute treffen sich per Raumcode im selben Wagen: Kopfdrehung live, Looks und Accessoires synchron. Voice und
Minigames folgen (Roadmap in `teamlead/SUPERDOC.md`).

## Spielen

1. Eine Person klickt **Raum erstellen** und schickt den Link (Knopf **Link kopieren** oben links) an die anderen.
2. Wer den Link öffnet, hat den Code schon im Feld und klickt **Beitreten**. Das Verbinden dauert ein paar Sekunden.
3. Wer den Raum erstellt hat, ist Host. Geht der Host, übernimmt automatisch, wer am längsten dabei ist.

**Allein testen** startet ohne Netzwerk mit drei simulierten Mitreisenden. Mehrere Tabs auf einem Rechner
funktionieren auch als Mitspieler.

## Starten

```bash
npm install
npm run dev        # http://localhost:5190
npm test           # Unit-Tests (Determinismus von Uhr, Flackern, Wackeln)
npm run build      # Bundle nach dist/
```

Im Spiel: Taste <kbd>`</kbd> (bzw. <kbd>^</kbd> auf deutscher Tastatur) blendet das Debug-Panel ein und aus.
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
