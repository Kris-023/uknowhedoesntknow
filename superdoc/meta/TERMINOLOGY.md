# Terminology

Project-specific vocabulary. When the user uses a term defined here, use the same meaning. German terms are kept verbatim (they are the UI text); definitions are in English.

**If the user uses a non-standard term that is not defined here, ask what they mean by it before acting on it.** Once its meaning is clear, add it to this file. Keep this file up to date automatically: whenever the user introduces or clarifies a term, add or amend the entry here.

## Terms

### Rooms and people

- **Raumcode** — the room's 8-character code (`NET.codeLength`), drawn from a 31-symbol alphabet without `0`, `o`, `1`, `l`, `i` (they get misread over voice chat). Shown as `ABCD-EFGH` (`src/net/roomCode.ts:formatRoomCode`), stored internally lowercase without the dash, put in the URL hash, and used as the Trystero room password. It is the only access secret. See [networking](../features/networking.md).
- **Host / Client** — one player in a room is the host and owns the authoritative game state; everyone else is a client. The host can change (host takeover when the host leaves, or Host übergeben on purpose). See [networking](../features/networking.md) and [minigame-framework](../features/minigame-framework.md).
- **Host übergeben / Host transfer** — the host hands the host role to another connected player on purpose, via a button in the Esc menu's player list (`src/net/session.ts:Session.handOver`). The old host becomes a client and the round goes on. Not the same as host takeover, which happens when the host leaves. See [networking](../features/networking.md), "Host transfer".
- **Sitz / Seat** — one of the 4 player seats at the table (`NET.maxPlayers`). Seats are filled in the order `NET.seatOrder` = `[0, 2, 1, 3]` (`src/config.ts:seatOrder`); it is only the fill order and the host-takeover rank, not the turn order (see Tischreihenfolge).
- **Tischreihenfolge / Table order** — turn order in all games and the menu roster: counter-clockwise around the table seen from above, starting top right. Derived from the map's real seat positions, because maps number their seats differently (`src/game/tableOrder.ts`; see [maps](../features/maps.md), "Seat layouts and turn order").
- **Host-Epoche / Host epoch** — a number every host carries in `welcome` and `roster` (`Session.epoch`): the room creator starts at 0, a newly elected host claims one less until a player of the room confirms it, then two more; a handover target claims two more at once. Of two hosts the higher epoch stays, on a tie the smaller peer id. See [networking](../features/networking.md), "Host migration and split brain".
- **Rejoin** — coming back into a room after leaving or reloading. The seat is held for `NET.rejoinMs` (30 minutes). See [networking](../features/networking.md).
- **Lobby** — the state of a room before a minigame starts, where the host picks the map, decks and game (`src/game/lobby.ts`).
- **Bots** — fake players that sit on the free seats in the solo test round (see Bench) so games can be tried alone (`src/game/fakePeers.ts`, per-game `bots.ts`).

### Places and ambience

- **Map** — the room around the table (geometry, light, background people, events, sound). Six exist: Hypertrain, Waschsalon, Bürgeramt, Späti 3 Uhr, WG-Wohnzimmer, Diner. See [maps](../features/maps.md).
- **Hypertrain** — the default map, a U-Bahn coach at night, built from the shared scene modules in `src/scene/`.
- **Stromausfall / Blackout** — a short power cut on a map: lights drop to the supply value `power` (0..1), driven by `src/core/motion.ts:coachPower`. Deterministic from the shared clock, so every peer sees it at the same moment. See [shared-clock-determinism](../features/shared-clock-determinism.md).
- **Durchsage** — a spoken announcement through the browser's speech synthesis (halts on the Hypertrain, calls in the Bürgeramt, and the Schaffner's scolding). Setting "Durchsagen" switches the ambient ones; the Schaffner's always play.
- **Schaffner** — the conductor figure who scolds players who talk too loud (`src/game/schaffner.ts`). Three modes: off (`Schaffner aus`), `nur ermahnen` (warns only), `mit Punktabzug` (warns and costs a point). See [voice-audio](../features/voice-audio.md).
- **Ruhige Umgebung** — setting `quietAmbience`: lowers the steady ambience bed (rumble, hum, rain), one-off noises like a bell or knock stay as they are.
- **Nur Mundbewegung** — voice mode `voiceMode: 'mouth'`, the default: no audio is sent, only the player's mouth level (message `lvl`) while it is above the Schwelle, so mouths and the Schaffner work while the group talks over another voice app. The other modes are Offen, Automatisch, Push-to-talk. See [voice-audio](../features/voice-audio.md).
- **Schwelle** — setting `vadLevel`: the level above which Automatisch opens the gate or Nur Mundbewegung moves the mouth.

### Graphics and comfort

- **Leuchten** — setting `glow`, the strength of the bloom around bright lights: Standard (100 %), Mittel (50 %), Niedrig (15 %), Aus (0 %); `src/ui/store.ts:GLOW_LEVELS`. See [rendering-scene](../features/rendering-scene.md).
- **Renderhelligkeit** — setting `renderBrightness`: the renderer's exposure multiplier, so lit parts and glow change with it; 50 to 200 %. It is the only brightness control: the former `Bildhelligkeit` (CSS filter on the canvas) was removed, as was the old `Licht` (Nacht/Hell) choice.
- **Weniger Bewegung** — setting `reduceMotion`: no camera shake and slower tunnel lines on the hypertrain (shake itself is a fixed 5 mm times the map factor; the old `Wackeln` strength is gone).
- **Weniger Flackern** — setting `reduceFlicker`: lights stay steady instead of flickering, and a blackout becomes one clean cut. Visual only; events, sounds and timing stay as they are.
- **Stromausfälle überblenden** — setting `fadeBlackouts`: with Weniger Flackern, blackouts fade out and in softly instead of cutting. On by default; has no effect (and is hidden) without Weniger Flackern. Not the same as the room option **Stromausfälle** (whether random blackouts happen at all).
- **Vignette / Unschärfe hinter Fenstern** — picture effects (on by default, can be switched off): darker corners, and blur behind every window-like box (menus, HUD panels, game bars and banners). `Nachschärfen` (sharpen) was removed.

### Games and content

- **Minigame** — one of the six games a room can play: "Wer bin ich?", "Sag's anders", "Gleich gedacht", "Zeig drauf", "Ahnungslos", "Stadt, Land, Fluss" (`src/game/lobby.ts`). See [minigame-framework](../features/minigame-framework.md).
- **Ahnungslos** — both a minigame and a role in it: everyone knows the word except one player, "der Ahnungslose" (the clueless one), who only learns "Du bist ahnungslos". See [minigames-zeig-ahnungslos-slf](../features/minigames-zeig-ahnungslos-slf.md).
- **Stapel / Wortstapel** — a content deck that words, questions and categories are drawn from. Three can be switched on per room: Normal, NSFW, Eigene. See [content-decks](../features/content-decks.md).
- **Eigene Listen** — a player's own named lists, stored in their browser. Kinds: `words`, `zeig`, `fragen`, `kategorien` (`src/words/lists.ts:LIST_KINDS`). Lists switched on join the Stapel "Eigene" in a room. See [custom-lists](../features/custom-lists.md).
- **Tresor / Vault** — the sealed, encrypted file `src/words/vault.json` holding the built-in deck content. Only the unlock password opens it.
- **Freischalten** — entering the password in the unlock box (`src/ui/deckLockView.ts:DeckLockView`) so the vault opens and NSFW and the full built-in decks become available.
- **Versiegeln** — encrypting the plaintext decks into the vault with `npm run seal` (`scripts/seal-content.mjs`). The plaintext lives only in the gitignored `private/` folder.
- **Zug zurück** — undo: the host takes back a wrong decision of the game shown last (`src/main.ts`, `src/game/undo.ts`).
- **Gaze / Kopfblick** — picking a player by looking at their head with the camera ray, used by "Zeig drauf" and "Ahnungslos" (`src/game/gaze.ts:Gaze`). "Kopfblick" is the German name used in conversation; it does not appear in the code.

### Tools and code names

- **Meine Sicht** — debug view that swaps tagged meshes for role-coloured wireframes (`src/debug/sight.ts`). Cyan in the UI. See [debug-build](../features/debug-build.md).
- **Bench / Benchmark** — a solo round against bots with live frame stats and recorders, started from the main menu (`Einstellungen` → `Grafik` → `Benchmark starten`; `src/ui/benchPanel.ts`).
- **Mundbewegung testen** — toggle in the Bench panel: the own microphone level (with the Schwelle) moves the mouths of all bots, to check the mouth animation alone.
- **Settings version / Upgrade chain (Upgrade-Kette)** — `SETTINGS_VERSION` in `src/ui/store.ts` and the list `UPGRADES` of one-step migrations; an old saved settings object runs through every step so no setting is lost. Rule and recipe: [menu-settings](../features/menu-settings.md), "Settings version and upgrade chain".
- **Coach** — ambiguous, always say which one:
  - *the coach in `src/main.ts`* is the game driver: it wires the minigames to the net, UI and scene through the `Minigame`/`PlayableGame` interfaces.
  - *the coach in `src/scene/coach.ts`* is the train car (Wagen) geometry of the Hypertrain.
  When the user says "Coach" without context, ask which is meant. Docs should write "game driver (`main.ts`)" or "train coach (`scene/coach.ts`)".
