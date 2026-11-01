# Menu, settings and input — start screen, Esc menu, mouse look

Everything the player touches outside the 3D scene: the main menu before a room, the Esc menu during play, room creation and joining, the persisted settings, and the pointer-lock mouse input that turns the head.

## How it works

### Menu shell and the four tabs

- `src/ui/menu.ts:MenuShell` is the shared frame: a header with title and tab strip, one `menu-panel` below, and a character preview on the side that exists only while the character tab is open. *Why:* the preview owns its own WebGL context (`src/ui/preview.ts`), so it is created and disposed per visit of the tab instead of living as long as the menu.
- Tab ids (`TabId`): `play` (label `Spielen` in the main menu, `Spiel` in the Esc menu), `character` (`Charakter`), `words` (`Eigene Listen`, see [custom-lists.md](custom-lists.md)), `settings` (`Einstellungen`). Left/Right arrows move between tabs (roving `tabindex`).
- `MenuShell.show` rebuilds the panel from scratch on every tab switch and disposes the previous `SettingsView` and `ListsView`. Views hold no state across tab switches, except `lastSection` in `src/ui/settingsView.ts` (the last settings sub-tab, this page load only).
- `src/ui/menu.ts:MainMenu` is the start screen. `choose()` returns a promise of a `LobbyChoice` (`create`, `join` or `bench`); `src/main.ts:start` awaits it. `connecting`, `message` and `close` are driven by `main.ts` while the transport connects.
- `src/ui/menu.ts:PauseMenu` is the in-game Esc menu. The game keeps running behind it (multiplayer, nothing to pause). It adds resume/leave buttons, the room box (code, players, per-player voice sliders, ping), the host's room-settings button, the minigame block (`gameControls`, supplied by the game) and the key list. `onResume`, `onRoomOpts`, `onMap`, `volume` and `gameControls` are callbacks wired in `main.ts`.
- Leaving is `location.reload()` after clearing the hash (`history.replaceState`). *Why:* tearing down a Trystero room cleanly and starting over is simplest as a fresh page.
- A nameless player is never blocked: `MainMenu.pick` assigns `fallbackName` (`src/ui/names.ts:randomName`, e.g. "Taube 42") when the name field is empty.

### Room create and join

- `MainMenu.renderPlay` builds the play tab: name field, `Raum erstellen`, `Raum-Einstellungen`, a one-line summary (`src/ui/roomDialog.ts:roomSummary`), a code field with `Beitreten`, and the map row.
- Create: `newRoomCode()` from `src/net/roomCode.ts` plus `settings.room` as the options. Join: `normalizeRoomCode` accepts a bare code or a whole URL (it takes everything after the last `#`, lowercases, strips spaces and dashes, checks the length against `NET.codeLength` and the alphabet). Error text: "Der Code hat 8 Zeichen, z. B. ABCD-EFGH."
- **Invite link:** the room code lives in the URL hash. `main.ts:start` writes `history.replaceState(null, '', '#code')` once a room is chosen; the Esc menu's `Link kopieren` copies `location.href`. Opening such a link makes `renderPlay` prefill the code field, show "Du wurdest eingeladen, der Code ist schon eingetragen." and swap emphasis (`Beitreten` becomes the big button, `Raum erstellen` the ghost one). *Why:* the hash is never sent to the hosting server, and the code is the only secret of a room.
- Rejoin after reload: `main.ts:rejoinCode` reads the `sessionStorage` key `ukhdk.inroom` and honours it only if it equals the hash, so the same tab goes straight back into the room without the menu.
- Rooms need a secure context (WebCrypto for Trystero). `MainMenu.pick` refuses create/join when `window.isSecureContext` is false and says "Räume brauchen eine sichere Verbindung (https oder localhost). Im LAN: npm run dev:lan." See [debug-build.md](debug-build.md).
- Waiting for a host: `connecting` shows a status; after `NET.orphanMs` (20 s) it offers `Raum selbst eröffnen` (`session.takeOver`).
- **Room dialog:** `src/ui/roomDialog.ts:openRoomDialog` is a native `<dialog>` (`showModal`) with segmented rows built by a local `seg` helper: voice, Schaffner mode, vote length (`ROOM.voteChoices` from `src/config.ts:ROOM`), blackouts, decks (multi-select; the last deck cannot be switched off; NSFW cannot be switched on while the sealed decks are locked), "Sag's anders" mode, turn length (`ROOM.turnChoices`), and "Stadt, Land, Fluss" mode. Every click calls `onChange` immediately; there is no apply button (`Fertig` just closes). Two callers: the main menu saves into `settings.room` via `updateSettings`; the host in the Esc menu sends the options to everyone via `PauseMenu.onRoomOpts` and passes `withMap = true` so the map can be switched too (title "Raum-Einstellungen (für alle)"). Guests only see `roomSummary`.
- The dialog's `keydown` handler stops Escape from propagating. *Why:* a native `<dialog>` closes on Esc by itself; without `stopPropagation` the window-level Esc handler in `main.ts` would also toggle the pause menu.
- `RoomOpts` and its validator `src/net/protocol.ts:parseOpts` define the option set. The same parser is used for saved settings and for options received from peers, so a stale save or an older peer falls back to defaults per field.

### Settings store

- `src/ui/store.ts:Settings` is the full interface; `settings` is the one live object. **Change it only via `updateSettings(patch)`**, which does `Object.assign`, writes to storage and calls every listener. `onSettings(f)` registers a listener and returns the unsubscribe function. Non-UI code (renderer, voice, audio, `main.ts:applyLight`) reads `settings.x` directly and re-reads on `onSettings`.
- Storage keys: `ukhdk.settings.v1` (all of `Settings`, including the pending `room` options) and `ukhdk.profile.v1` (own character and name, `loadProfile`/`saveProfile`). Other `ukhdk.*` keys are written elsewhere: `ukhdk.lists.v1`, `ukhdk.deckkey.v1`, `ukhdk.player.v1`, `ukhdk.token.<code>` (see [custom-lists.md](custom-lists.md)), and the session key `ukhdk.inroom`.
- **Per-field validation, no migrations.** `loadSettings` reads the JSON and validates every field on its own: numbers must be inside the field's `min..max` (`num`), booleans must be booleans (`bool`), enums must match a known value, `light` must be a key of `LIGHT_PRESETS`, `micDevice` a string under 300 characters, `room` goes through `parseOpts`. An invalid or missing field takes its default from `defaults()`; the others survive. Unknown keys are dropped at the next `updateSettings` write because the whole `settings` object is rewritten. *Why:* the `.v1` suffix is a last-resort escape hatch, not a migration scheme. Adding a field needs only a default and a validator line; old saves keep working, so there is no version bump and no migration code to maintain.
- `defaults()` reads `prefers-reduced-motion`: with it set, `shakeOn` starts off.
- Storage can be missing or throw (private window, blocked site data): `read`/`write` swallow the error, everything works, nothing is remembered. A profile without a valid name counts as the first visit and starts onboarding.
- To add a setting: field + comment in `Settings`, default in `defaults`, validator in `loadSettings`, a control in `SettingsView`; sliders also need the key in `SliderKey`, toggles in the key union of `toggle`.

### Settings view

- `src/ui/settingsView.ts:SettingsView` renders the settings and is embedded in three places: the main menu's settings tab, the Esc menu's settings tab (both through `MenuShell.show`) and the benchmark panel (`src/ui/benchPanel.ts:BenchPanel`, `new SettingsView(null, ['gfx', 'input'])`, so graphics and controls only). The constructor's second argument selects the sections.
- Sub-tabs, in order: `Stimme` (voice, first because it has to work before anything else), `Ton`, `Grafik`, `Steuerung`. With fewer than three sections (the benchmark) the groups stay in one column instead of tabs. *Why:* the full list became too long for one column. All panes stay built and only one is shown, so the microphone test meter keeps running while another sub-tab is open.
- The `extra` element (`MenuShell.settingsExtra`; the main menu returns the `Benchmark starten` group) is appended to the graphics pane. *Why:* that is where you go to tune the frame rate.
- Helpers, all private methods that register a re-sync function in `syncs`, so every control follows `settings` whatever changed it (another view, the debug panel):
  - `field(label, content, hint?, enabled?)`: label + control + hint row; `enabled` greys the row (`.off`) without disabling it.
  - `seg(label, opts, key, hint?)`: segmented buttons with `aria-pressed`.
  - `toggle(label, key, hint?)`: an `An`/`Aus` button; `key` is limited to the boolean settings listed in its signature.
  - `slider(label, key, min, max, step, show, enabled?, hint?)`: range input plus `<output>`; `key` is a `SliderKey`.
- Controls under `Steuerung`: `Maus` sensitivity slider (0.2 to 3), `Direkte Mauseingabe` toggle (only offered when `'onpointerrawupdate' in window`, i.e. Chromium), `Maus Y umkehren`.
- `dispose()` unsubscribes from `onSettings` and cancels the meter's `requestAnimationFrame`; call it whenever a view is removed.
- The set of settings is going to be reworked (categories, new comfort options, removal of the `Licht` choice). This page describes the code as it is now.

### UI scale

- `src/ui/scale.ts:uiScale` maps the window size to the CSS variable `--ui`: `min(w/1440, h/900) ** 0.85`, clamped to 0.92..2.2. `initUiScale` sets it on `<html>` at start and on every `resize`. Menu sizes are expressed with `--ui` (see [../ui/STYLING-GUIDE.md](../ui/STYLING-GUIDE.md)). *Why:* plain CSS pixels make menus tiny on 4K at 100 % and cramped on 1366x768; the exponent below 1 keeps big screens from going cartoonish.
- `src/ui/stageSize.ts:trackSize` gives an element's size from a shared `ResizeObserver` instead of reading `clientWidth` in the frame loop. *Why:* reading layout after the overlays wrote their transforms forced a style recalculation every frame. `Placer` (same file) skips writes that moved less than half a pixel; the nametag overlay `src/ui/nametags.ts` is one of its users.

### Profile

- The profile is a `PersonState` (character look + name). `main.ts` loads it with `loadProfile`; edits go through `MenuShell.setProfile` (also updates the preview) and `main.ts:setProfile`, which saves only when `parseName` accepts the name. The play tab's name field and the character tab's field share one value (`MenuShell.setName`). Character editing itself: [characters.md](characters.md).

### Mouse lock and input

- **Lock.** A click on the stage in POV calls `src/main.ts:lockMouse`, which requests pointer lock with `{ unadjustedMovement: true }` and, only on `NotSupportedError`, retries with a plain lock. *Why:* without raw counts Chrome hands out movement after OS acceleration and, at display scaling above 100 %, rounds small steps down to zero, so slow pans did nothing until a jerk. The mode that was obtained is recorded in `MouseTrace.lockMode` for the benchmark report.
- **Esc opens the pause menu through the browser's unlock.** The browser releases pointer lock on Esc (a rule the page cannot override) and fires `pointerlockchange`; the handler in `launch` then calls `pause.open()`. The window `keydown` Esc handler ignores any Esc within 300 ms of an unlock (`unlockedAt`) so it does not toggle the menu right back; otherwise it toggles the menu. Inside the menu, `PauseMenu` closes itself on Esc. In the benchmark (`bench`) the side panel is the menu, so unlock only frees the mouse and never opens the pause menu.
- **Quiet unlock.** `src/ui/dom.ts:releaseMouse` dispatches the window event `ukhdk:release-mouse` if the pointer is locked; `main.ts` listens, sets `quietUnlock` and calls `document.exitPointerLock()`; the `pointerlockchange` handler then skips `pause.open()` once and resets the flag. *Why:* a plain `exitPointerLock` looks exactly like Esc to the game and would open the pause menu on top of the dialog that wanted the mouse (the "Gleich gedacht" text input, the card maker, end-of-round dialogs). `PauseMenu.onResume` also refuses to re-lock while `body.wi-dialog` is set.
- **Middle button frees the mouse.** `mousedown` with button 1 on the stage calls `releaseMouse()`, so it goes through the quiet unlock above (no pause menu) and HUD buttons can be clicked. `preventDefault` on that mousedown stops the browser's autoscroll circle and middle-click paste, and an `auxclick` handler swallows button 1 as well. A left click into the view locks again. *Why:* Esc opens the pause menu, which is too much when you only want to press a button for a moment.
- **Hint.** `syncHint` shows "Klick ins Bild, um dich umzusehen · Esc öffnet das Menü" only in POV, unlocked, menu closed; it appends a headphone note when room voice is on and echo needs headphones.
- **Look.** Raw `movementX/Y` is multiplied by `k = CAMERA.mouseSensitivity * settings.mouseSens * world.fovFactor` (`mouseK`, so zoom slows the turn) and added to `players.look` (yaw clamped to `HEAD.maxYaw`, pitch to `HEAD.minPitch`/`HEAD.maxPitch`); `invertY` flips the pitch sign. Two listeners exist, `mousemove` and Chromium-only `pointerrawupdate`; `onLook` accepts events from exactly one of them, chosen by `settings.mouseRaw && rawMouse`, and only while the stage is locked. *Why:* raw events arrive at the device's rate instead of once per frame, which felt clearly less sluggish; the toggle (`Direkte Mauseingabe`) is the escape hatch for devices that misbehave.
- **Zoom.** Hold the right mouse button in POV: `mousedown` (button 2) sets `world.zoom = 1`, the window-level `mouseup` clears it; `contextmenu` is suppressed on the stage. The release listener is on `window`, so letting go outside the canvas cannot leave the zoom stuck.

### Controls list

`PauseMenu.renderPlay` builds a `dl.keys` from a literal array in `src/ui/menu.ts`. Current entries:

| Key | Text shown |
| --- | --- |
| Maus | umsehen (erst ins Bild klicken) |
| Rechte Maustaste | heranzoomen |
| Mittlere Maustaste | Maus freigeben |
| M | Mikro stumm an/aus |
| V | halten zum Sprechen (bei Push-to-talk) |
| G | Wer bin ich? starten (Host) |
| F / R / P | fragen, raten, weitergeben (wenn du dran bist) |
| 1 / 2 / 3 | Ja, Nein, Weiß nicht |
| Esc | dieses Menü |

This list is text only. The real handling lives with each game and with `VOICE.pttKey`/`VOICE.muteKey` in `src/config.ts` (see [voice-audio.md](voice-audio.md)), so update the list by hand when a binding changes.

## Using it

1. Open the page. Tabs: `Spielen`, `Charakter`, `Eigene Listen`, `Einstellungen`.
2. Type a name (or skip; a random one is used). `Raum erstellen` makes a code and starts hosting; `Raum-Einstellungen` opens the dialog first. The map choice sits under the buttons.
3. To join: paste the code or open an invite link and press `Beitreten`.
4. In play, click into the picture to lock the mouse, move to look, hold the right button to zoom. Esc releases the mouse and opens the menu; `Zurück ins Spiel` locks it again.
5. `Einstellungen` has the sub-tabs `Stimme`, `Ton`, `Grafik`, `Steuerung`; every change applies at once and is remembered in this browser.

## Options

| Storage key | Content | Validation |
| --- | --- | --- |
| `ukhdk.settings.v1` | whole `Settings` object, incl. `room` | per field, bad value -> default |
| `ukhdk.profile.v1` | own `PersonState` | `parseState` and `parseName`, else first visit |

Selected `Settings` fields touched by this page:

| Field | Default | Range / values |
| --- | --- | --- |
| `mouseSens` | 1 | 0.2 to 3 |
| `invertY` | false | boolean |
| `mouseRaw` | true | boolean; only effective where `pointerrawupdate` exists |
| `renderScale` | 1 | 0.5 to 1 |
| `shakeOn` | `!prefers-reduced-motion` | boolean |
| `room` | `parseOpts(undefined)` | see `RoomOpts` |

## Related links

- [debug-build.md](debug-build.md) — dev server, LAN HTTPS, benchmark panel
- [characters.md](characters.md) — the character tab and profile data
- [custom-lists.md](custom-lists.md) — the `Eigene Listen` tab and deck lock
- [rendering-scene.md](rendering-scene.md) — what the graphics settings change
- [voice-audio.md](voice-audio.md) — what the voice and sound settings change
- [../architecture/overview.md](../architecture/overview.md)
- [../meta/TERMINOLOGY.md](../meta/TERMINOLOGY.md)
- [../ui/STYLING-GUIDE.md](../ui/STYLING-GUIDE.md)
