# uKnowHeDoesntKnow

Browser-Partyspiel für 2 bis 4 Freunde: Ihr sitzt euch in einem viel zu schnellen U-Bahn-Wagen gegenüber,
draußen rast der Tunnel vorbei, drinnen flackert das Neon, und die Mitreisenden starren aufs Handy.
Der Wagen heißt „Hypertrain“ und ist die erste Map, das erste Minigame ist „Wer bin ich?“.
Nur PC, nur Browser, nur private Räume, kein Server.

**Stand: M7 (alle Meilensteine aus dem Auftrag umgesetzt).** Details und offene Fragen: `teamlead/SUPERDOC.md`.

## Spielen

1. Name eintragen (oder leer lassen für einen Zufallsnamen), **Raum erstellen**, Link an die anderen schicken
   (im Spiel: <kbd>Esc</kbd> → **Link kopieren**).
2. Wer den Link öffnet, hat den Code schon im Feld und klickt **Beitreten**. Das Verbinden dauert ein paar Sekunden.
3. Figur und Accessoires im Tab **Charakter**, Ton und Grafik in **Einstellungen**. Der Browser merkt sich alles.

Seid ihr schon im TeamSpeak oder Discord: beim Erstellen „Raum ohne Sprachchat“ anhaken. Der Host kann den Sprachchat
auch später im Esc-Menü für alle abschalten.

### Wer bin ich?

- Oben steht, ob es losgehen kann. Der Host startet mit <kbd>G</kbd>.
- Jeder sucht ein Bild für den Nachbarn: Link, <kbd>Strg</kbd>+<kbd>V</kbd>, reinziehen oder Datei. Die Karte schwebt über
  dessen Kopf; die eigene sieht man nicht.
- Wer dran ist, stellt laut eine Ja/Nein-Frage und drückt <kbd>F</kbd>. Die anderen stimmen geheim ab:
  <kbd>1</kbd> Ja, <kbd>2</kbd> Nein, <kbd>3</kbd> Weiß nicht. Bei Ja darf man weiterfragen, sonst ist der Nächste dran.
- „Ich bin …“ sagen und <kbd>R</kbd> drücken: die anderen stimmen ab, ob es stimmt. <kbd>P</kbd> gibt den Zug weiter.
- Wer zuerst errät, bekommt 3 Punkte, dann 2, dann 1. Wer zu lange zu laut ist, bekommt Besuch vom Schaffner: −1 Punkt.
- Unten links stehen Phase, Reihenfolge, Punkte und wer schon abgestimmt hat.

### Steuerung

| Taste | Was |
|---|---|
| ins Bild klicken, Maus | umsehen |
| rechte Maustaste halten | heranzoomen (Karten lesen) |
| <kbd>M</kbd> | Mikro stumm |
| <kbd>V</kbd> | Push-to-talk (wenn eingestellt; sonst Offen oder Automatisch ab Schwelle) |
| <kbd>Esc</kbd> | Menü: Raum, Charakter, Einstellungen, Raum verlassen |

Kopfhörer sind am besten. Chrome rechnet Spielton nicht aus dem Mikro heraus, Firefox schon.

### Alleine ausprobieren

**Einstellungen → Benchmark starten**: allein im Wagen mit simulierten Mitreisenden, FPS und Grafik live einstellen.
<kbd>G</kbd> startet dort eine Testrunde „Wer bin ich?“ gegen Bots. Mehrere Tabs auf einem Rechner gehen auch als Mitspieler.

### Wenn etwas hakt

- **Neu geladen oder kurz raus:** Im selben Tab geht es automatisch zurück in den Raum, auf denselben Platz, mit Punkten
  und Karten (innerhalb von 5 Minuten).
- **Host weg:** Wer am längsten dabei ist, übernimmt, auch mitten in einer Runde.
- **Mikro geht nicht:** Einstellungen → Stimme → Test zeigt den Grund des Browsers.
- **Andere hören Tippen, Lüfter oder Rauschen:** Einstellungen → Stimme → Rauschfilter auf **KI** (Standard). Pumpt das
  Rauschen in Sprechpausen hoch, Auto-Pegel ausschalten.
- **Ruckelt:** Einstellungen → Grafik → Auflösung runter oder Leuchten aus; im Benchmark sieht man den Effekt sofort.

## Entwickeln

```bash
npm install
npm run dev        # http://localhost:5190
npm run dev:lan    # https://<LAN-IP>:5190 für Tests mit anderen Rechnern (Zertifikatswarnung einmal bestätigen)
npm test           # Unit-Tests: Uhr, Netz-Logik, Regeln, Geheimhaltung, Schaffner
npm run build      # Bundle nach dist/
```

Nur im Dev-Server oder mit `?debug`: <kbd>^</kbd> öffnet das Debug-Panel (Kamera, Sitzwahl, Kopf-Regler, Accessoires,
„Meine Sicht“, Draw-Calls, Szenengraph). `?seed=1234` überspringt das Menü (deterministische Solo-Szene),
`?voteS=300` verlängert Abstimmungen für langsame Testbrowser.

## Deploy

Jeder Push auf `main` baut und veröffentlicht über GitHub Actions nach GitHub Pages (`.github/workflows/pages.yml`).
Einmalig im Repo: *Settings → Pages → Source: GitHub Actions*.

## Zugang, Datenschutz und Grenzen

GitHub Pages ist öffentlich: Jeder mit dem Link kann die Seite laden. Einen Raum betritt nur, wer den **Raumcode** kennt.

- Der Code ist das einzige Geheimnis. Er steht im Link hinter `#`; dieser Teil geht nicht an GitHub, landet aber im Verlauf.
- Signaling läuft über öffentliche Nostr-Relays. Sie sehen, dass sich Peers unter einem gehashten Raumnamen treffen;
  die Verbindungsdaten sind mit dem Raumcode verschlüsselt. Ton, Bilder und Spieldaten laufen direkt zwischen euch (WebRTC).
- Direkte Verbindungen zeigen euren Mitspielern eure öffentliche IP. Das ist bei P2P unvermeidbar.
- Kartenbilder werden im Browser verkleinert, bleiben im Speicher und gehen nur an die Mitspieler, nie an die Person,
  für die sie sind, und nirgendwo sonst hin. Bei einem Bild-Link lädt nur der Ersteller das Bild; verschickt werden die Daten.
- Ein clientseitiges Passwort wäre nur eine Hürde. Echten Zugangsschutz gäbe es erst mit Cloudflare Access vor einem
  Cloudflare-Pages-Hosting.
- Durchsagen und Schaffner sprechen mit der Sprachausgabe des Browsers; welche Stimme kommt, hängt vom System ab.

## Lizenzen

Alles ist prozedural, siehe `CREDITS.md`.
