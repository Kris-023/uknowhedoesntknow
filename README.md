# uKnowHeDoesntKnow

Browser-Partyspiel für 2 bis 4 Freunde: Ihr sitzt euch in einem viel zu schnellen U-Bahn-Wagen gegenüber,
draußen rast der Tunnel vorbei, drinnen flackert das Neon, und die Mitreisenden starren aufs Handy.
Sechs Maps: Hypertrain (der U-Bahn-Wagen), Waschsalon, Bürgeramt, Späti 3 Uhr, WG-Wohnzimmer und Diner. Die Minigames
sind „Wer bin ich?“, „Sag's anders“, „Gleich gedacht“, „Zeig drauf“ und „Ahnungslos“.
Nur PC, nur Browser, nur private Räume, kein Server.

**Stand: M7 (alle Meilensteine aus dem Auftrag umgesetzt).** Details und offene Fragen: `teamlead/SUPERDOC.md`.

## Spielen

1. Name eintragen (oder leer lassen für einen Zufallsnamen), **Raum erstellen**, Link an die anderen schicken
   (im Spiel: <kbd>Esc</kbd> → **Link kopieren**).
2. Wer den Link öffnet, hat den Code schon im Feld und klickt **Beitreten**. Das Verbinden dauert ein paar Sekunden.
3. Figur und Accessoires im Tab **Charakter**, Ton und Grafik in **Einstellungen**. Umgebung, Musik und Durchsagen haben
   eigene Regler; „Ruhige Umgebung“ dämpft das Dauerrauschen der Map. Der Browser merkt sich alles.

Die **Map** wählst du im Spielen-Tab vor dem Erstellen; sie gilt für den ganzen Raum. Der Host kann sie im Esc-Menü unter
Raum-Einstellungen jederzeit wechseln, auch mitten in einer Runde: Raum, Plätze und Punkte bleiben. Jede Map hat ihre eigenen
Mitreisenden, Geräusche und ein eigenes Ereignis (Unwucht, Systemausfall, Streife, Nachbar klopft, Fritteuse brennt).

Neben „Raum erstellen“ liegen die **Raum-Einstellungen**: Sprachchat an/aus (aus, wenn ihr schon im TeamSpeak oder
Discord seid), Schaffner aus / nur ermahnen / mit Punktabzug, Abstimmungszeit, Stromausfälle, Wortstapel und Zeit pro
Zug. Der Host kann sie im Esc-Menü jederzeit für alle ändern.

Zwischen den Runden steht oben, welches Minigame als Nächstes kommt: <kbd>T</kbd> wechselt, <kbd>G</kbd> startet (nur der Host).

### Wer bin ich?

- Jeder sucht ein Bild für den Nachbarn: Link, <kbd>Strg</kbd>+<kbd>V</kbd>, reinziehen oder Datei. Die Karte schwebt über
  dessen Kopf; die eigene sieht man nicht.
- Wer dran ist, stellt laut eine Ja/Nein-Frage und drückt <kbd>F</kbd>. Die anderen stimmen geheim ab:
  <kbd>1</kbd> Ja, <kbd>2</kbd> Nein, <kbd>3</kbd> Weiß nicht. Bei Ja darf man weiterfragen, sonst ist der Nächste dran.
- „Ich bin …“ sagen und <kbd>R</kbd> drücken: die anderen stimmen ab, ob es stimmt. <kbd>P</kbd> gibt den Zug weiter.
- Wer zuerst errät, bekommt 3 Punkte, dann 2, dann 1. Wer zu lange zu laut ist, bekommt Besuch vom Schaffner: −1 Punkt.
- Unten links stehen Phase, Reihenfolge, Punkte und wer schon abgestimmt hat.

### Sag's anders

Ein Wort erklären, ohne das Wort selbst und ohne die rot durchgestrichenen Wörter auf der Karte zu sagen.

- **Modus** in den Raum-Einstellungen: **Teams** (Standard) oder **Jeder gegen jeden**. Teams gehen nur zu viert;
  mit 2–3 Spielern spielt immer jeder gegen jeden.
- **Teams:** Blau gegen Gelb, je zwei gegenüber. Wer erklärt, sieht die Karte; das eigene Team rät laut,
  das andere Team sieht die Karte mit und drückt <kbd>B</kbd>, sobald ein verbotenes Wort fällt (+1 für sie).
  Erraten mit <kbd>Leertaste</kbd> gibt dem erklärenden Team 1 Punkt.
- **Jeder gegen jeden:** Alle anderen raten; wer es errät, bekommt 2 Punkte, wer erklärt hat, 1.
  Wer es erraten hat, wählt der Erklärer mit <kbd>1</kbd>–<kbd>3</kbd>. Danach sehen alle die Karte noch 8 Sekunden und
  können mit <kbd>B</kbd> anfechten: dann fallen die Punkte weg und der Erklärer verliert 1.
- <kbd>Leertaste</kbd> startet den eigenen Zug (60 s, einstellbar), <kbd>P</kbd> überspringt eine Karte. Jeder erklärt zweimal.
- Wortstapel: **Normal**, **NSFW** (richtig derb, nur für Leute, die das wollen) und **Eigene**. Eigene Wörter trägst du
  im Menü-Tab **Wörter** ein; sie bleiben in deinem Browser und kommen im Raum zu allen, ohne dass sie vorher jemand sieht.
  Mit „Liste kopieren“ oder als Datei gibst du sie weiter; am Rundenende kannst du gespielte Wörter anderer übernehmen.

### Gleich gedacht

Alle schreiben ein Wort, bis alle dasselbe denken. Ohne Absprache, alle gewinnen zusammen.

- Im ersten Versuch bekommt jeder eine andere Frage und antwortet mit einem Wort. Danach schreibt jeder ein Wort, das die
  Wörter des letzten Versuchs verbindet.
- Festlegen mit <kbd>Enter</kbd>. Aufgedeckt wird erst, wenn alle festgelegt haben, dann stehen die Wörter über den Köpfen.
  Vorher sieht niemand ein fremdes Wort, auch der Host nicht.
- Groß-/Kleinschreibung, Artikel, Umlaute, einfache Mehrzahl und ein Tippfehler zählen automatisch als gleich. Für alles
  andere (Synonyme, andere Sprache) stimmt ihr mit <kbd>F</kbd> ab: „Zählt als gleich?“, <kbd>1</kbd> Ja, <kbd>2</kbd> Nein.
- Höchstens 10 Versuche; je schneller, desto mehr Punkte für alle. Reden während des Schreibens ruft den Schaffner.

### Zeig drauf

„Wer würde am ehesten …?“ Ab drei Spielern. Alle zeigen gleichzeitig, und zwar mit dem Kopf.

- Pro Runde 8 Fragen. Schau 10 Sekunden lang die Person an, die es am ehesten tun würde: ihr Name leuchtet auf,
  oben steht „Du zeigst auf …“. Wen du anschaust, wenn die Zeit um ist, der zählt. <kbd>Enter</kbd> oder <kbd>Leertaste</kbd>
  legt dich vorher fest; ohne Maus-Blick geht es auch per Klick auf den Namen.
- Danach zeigt jeder Kopf, wie viele auf ihn gezeigt haben und wer. Wer mit der Mehrheit gezeigt hat (bei Gleichstand mit
  einem der Meistgewählten), bekommt 1 Punkt; hat jeder nur eine Stimme, gibt es keinen. Weiter mit <kbd>Enter</kbd>.
- Am Ende stehen alle Fragen mit dem jeweiligen „Gewinner“. Mit dem NSFW-Stapel kommen auch derbe Fragen dazu.

### Ahnungslos

Alle kennen das Wort, nur einer nicht. Ab drei Spielern.

- Der Host zieht ein Wort aus den Stapeln des Raums (mit „Eigene“ auch aus euren Wörtern). Alle sehen es oben, nur einer
  liest „Du bist ahnungslos“ und muss mitbluffen.
- Reihum, zwei Runden lang, sagt jeder **ein** Wort dazu: tippen und <kbd>Enter</kbd> (30 Sekunden), es steht dann über dem
  Kopf. Laut sagen darf man es auch. Das Wort selbst ist tabu.
- Dann zeigen alle 15 Sekunden lang mit dem Kopf auf den Verdächtigen (wie bei „Zeig drauf“, <kbd>Enter</kbd> legt fest).
- Falsche Person oder Gleichstand: der Ahnungslose kommt davon (+3). Erwischt: er darf das Wort raten (20 Sekunden);
  richtig +2 für ihn, falsch +1 für alle anderen.
- Fällt der Host mitten in der Runde aus, wird sie abgebrochen: nur er wusste, wer ahnungslos ist. Der Host-Rechner
  kennt das Wort technisch immer, auch wenn der Host selbst ahnungslos ist; das Spiel zeigt es ihm nur nicht.

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
<kbd>T</kbd> wählt das Minigame, <kbd>G</kbd> startet eine Testrunde gegen Bots. Mehrere Tabs auf einem Rechner gehen auch als Mitspieler.

### Wenn etwas hakt

- **Neu geladen oder rausgeflogen:** Im selben Tab geht es automatisch zurück in den Raum, auf denselben Platz, mit Punkten
  und Karten (innerhalb von 30 Minuten). Aus einem anderen Tab oder Browser reicht der Raumcode mit demselben Namen.
  Solange jemand fehlt, wird der Zug übersprungen und der Platz bleibt frei. Oben links steht, wer fehlt, und mit
  „Ohne … weiterspielen“ kann die Runde auch ohne die Person weitergehen.
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
