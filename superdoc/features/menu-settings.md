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

- `src/ui/store.ts:Settings` is the full interface; `settings` is the one live object. **Change it only via `updateSettings(patch)`**, which does `Object.assign`, writes to storage (with the version, `persistedSettings`) and calls every listener. `onSettings(f)` registers a listener and returns the unsubscribe function. Non-UI code (renderer, voice, audio, `main.ts:applyRender`) reads `settings.x` directly and re-reads on `onSettings`.
- Storage keys: `ukhdk.settings.v1` (all of `Settings` plus `version`, including the pending `room` options) and `ukhdk.profile.v1` (own character and name, `loadProfile`/`saveProfile`). The `.v1` in the key is not the settings version: that lives inside the saved object. Other `ukhdk.*` keys are written elsewhere: `ukhdk.lists.v1`, `ukhdk.deckkey.v1`, `ukhdk.player.v1`, `ukhdk.token.<code>` (see [custom-lists.md](custom-lists.md)), and the session key `ukhdk.inroom`.
- Storage can be missing or throw (private window, blocked site data): `read`/`write` swallow the error, everything works, nothing is remembered. A profile without a valid name counts as the first visit and starts onboarding.

#### Settings version and upgrade chain

- `SETTINGS_VERSION` (now 1) is stored in every save. `UPGRADES[n]` is one step that turns a version-n save into a version-n+1 save; a save without `version` counts as 0.
- Load (`loadSettings`): `upgradeSettings` runs every step from the save's version up to the current one, in order, then `parseSettings` validates the result field by field (numbers inside `min..max`, booleans, enums, `micDevice` a short string, `room` through `parseOpts`; anything broken or missing takes its default from `defaults()`). If the save was older, it is written back at once, so the next load needs no steps and dropped fields are gone. A save with a *newer* version than the code knows (a rolled-back deploy) is only validated, never upgraded.
- The per-field validation stays as the safety net for hand-edited or damaged values; it is not the migration mechanism.
- **The rule.** When you change the settings *shape* (rename, remove or re-scale a field, change what a value means): bump `SETTINGS_VERSION` by one, append ONE step to `UPGRADES`, and add a test in `tests/settings.test.ts`. An old save then runs every step in order, so nothing the player set is lost. Adding a plain new field with a default needs none of this (the validator fills it in).
  *Why:* "so we can properly migrate older configs … without losing any data" (the maintainer's requirement). A bare "invalid field -> default" rule silently resets a setting whose meaning changed; a step carries the old value over.
- **How to add an upgrade step:**
  1. Change `Settings`, `defaults()` and `parseSettings` to the new shape.
  2. Raise `SETTINGS_VERSION` from n to n+1.
  3. Append a function `(o) => ...` to `UPGRADES` (so it sits at index n). It receives the raw stored object and returns the n+1 shape: read the old keys, write the new ones, drop what is gone. Do not call `defaults()` or reuse live constants that may change later; a step describes one historical change and must not change when the code does. (Step 0 -> 1 reads `GLOW_LEVELS`, which is acceptable only because those levels are fixed.)
  4. Test in `tests/settings.test.ts`: feed `upgradeSettings` a realistic old save and check the new fields, and check that an older save passes through every step to the current version.
- Step 0 -> 1 (the settings rework): `musicOn: false` becomes `musicVolume` 0, `announcements: false` becomes `announceVolume` 0, `bloom: false` becomes `glow: 'aus'`, otherwise `bloomStrength` becomes the nearest `glow` level (1, 0.5, 0.15, 0; above 1 lands on `standard`). It drops `light`, `shakeOn`, `shakeMm`, `musicOn`, `announcements`, `bloom`, `bloomStrength`. *Why:* switches became levels and sliders, and the light preset and shake strength are fixed now (see [rendering-scene.md](rendering-scene.md), [maps.md](maps.md)).
- `defaults()` reads `prefers-reduced-motion`: with it set, `reduceMotion` starts on.
- To add a setting: field + comment in `Settings`, default in `defaults`, validator in `parseSettings`, a control in `SettingsView` (sliders need the key in `SliderKey`, toggles in `ToggleKey`). If it changes the shape of existing data, also add an upgrade step as above.

### Settings view

- `src/ui/settingsView.ts:SettingsView` renders the settings and is embedded in three places: the main menu's settings tab, the Esc menu's settings tab (both through `MenuShell.show`) and the benchmark panel (`src/ui/benchPanel.ts:BenchPanel`, `new SettingsView(null, ['gfx', 'input'])`, so graphics and controls only, untabbed, without the key list). The constructor's second argument selects the sections.
- Sub-tabs, in order: `Stimme` (voice, first because it has to work before anything else), `Ton`, `Grafik`, `Steuerung`. With fewer than three sections the groups stay in one column instead of tabs. *Why:* the full list became too long for one column. All panes stay built and only one is shown, so the microphone test meter keeps running while another sub-tab is open. The last sub-tab is remembered in `lastSection` (this page load only); the sub-tab strip wraps.
- Every control sits in a titled group (`fieldset.group`, heading always shown). Contents:
  - **Stimme**: `Mikrofon` (on/off, `Gerät`, `Mikro-Pegel`, the `Test` meter); `Sprechen` (`Modus`: `Nur Mundbewegung` first, `Offen`, `Automatisch`, `Push-to-talk (V)`; `Schwelle` only for `Nur Mundbewegung` and `Automatisch`, because only those two have a gate); `Erweitert`, collapsed by default behind a disclosure button (`Rauschfilter`, `Echofilter`, `Auto-Pegel`). *Why* collapsed: rarely touched, and they made the page long.
  - **Ton**: `Lautstärke` (`Umgebung`, `Musik`, `Durchsagen` with the hint `Der Schaffner spricht immer.`, `Stimmen` plus the `Testton` button); `Umgebung` (`Ruhige Umgebung`).
  - **Grafik**: `Darstellung` (`Auflösung`, `Bildhelligkeit`, `Renderhelligkeit`, `Kartengröße`); `Effekte` (`Leuchten` as a segmented choice, `Nachschärfen`, `Vignette`, `Unschärfe hinter Fenstern`); `Komfort` (`Weniger Bewegung`, `Weniger Flackern`, `Stromausfälle überblenden`, shown only while `Weniger Flackern` is on; the value is stored independently and has no effect without it); then the benchmark group.
  - **Steuerung**: `Maus` (`Empfindlichkeit` with the Gecko hint below, `Maus Y umkehren`, `Direkte Mauseingabe`, only offered when `'onpointerrawupdate' in window`, i.e. Chromium); `Tasten` (key list, only in the tabbed view).
- The `extra` element (`MenuShell.settingsExtra`; the main menu returns the `Benchmark starten` group, the Esc menu none) is appended after the graphics groups. *Why:* that is where you go to tune the frame rate.
- Helpers, all private methods that register a re-sync function in `syncs`, so every control follows `settings` whatever changed it (another view, the debug panel). Each builds a `field` row; `RowOpts` is `hint` (text, a function of the settings, or ready-made markup), `enabled()` (dims the row with `.off` and disables its controls), `visible()` (hides the row), `top` (label at the top, for tall content such as the mic test) and `control`:
  - `field(label, content, opts)`: label + control + hint row.
  - `seg(label, opts, key, hint?)`: segmented buttons with `aria-pressed`.
  - `toggle(label, key, hint?, rowOpts?)`: an `An`/`Aus` button; `key` is a `ToggleKey`.
  - `slider(label, key, min, max, step, show, opts?)`: range input plus `<output>`; `key` is a `SliderKey`; `opts.extra` appends an element (the test-tone button).
- **`Unschärfe hinter Fenstern`** (`uiBlur`): `onSettings` in `settingsView.ts` toggles the class `ui-blur` on `body`; `src/style.css` then gives every window a translucent background plus `backdrop-filter: blur(12px)`: menu frame, room dialog, debug and bench panels, hint line, mic, absent notice, "Zug zurück", problem box, and in all six minigames the scoreboard, card maker/sheet, end screen, bars (also the lobby bar) and the result banner (the "Wer bin ich?" vote result is `.wi-banner`). Name tags and head cards are left out, and so are the solid boxes inside a window. With the setting on, the Esc menu's own full-screen 4px blur is switched off so the frame does the blurring (a backdrop-filter parent would block the child's). *Why:* off by default, because a blur over the live canvas is redone every frame; name tags and cards are many and move every frame, so they stay sharp.
- **Gecko hint**: `isGeckoLinux(ua)` is true for a `Gecko/<digits>` token without `like Gecko`, on Linux, not Android. Only then the `Empfindlichkeit` row shows the tip to start the browser with `MOZ_ENABLE_WAYLAND=0`. *Why:* in Gecko browsers on Linux/Wayland slow mouse moves barely register; running through XWayland helped in a test, so this is a likely but not certain cause. There is no input-code workaround; the README carries the same tip.
- `dispose()` unsubscribes from `onSettings` and cancels the meter's `requestAnimationFrame`; call it whenever a view is removed.

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
5. `Einstellungen` has the sub-tabs `Stimme`, `Ton`, `Grafik`, `Steuerung`, each split into titled groups; every change applies at once and is remembered in this browser.

## Options

| Storage key | Content | Validation |
| --- | --- | --- |
| `ukhdk.settings.v1` | whole `Settings` object, incl. `room`, plus `version` | upgrade chain, then per field, bad value -> default |
| `ukhdk.profile.v1` | own `PersonState` | `parseState` and `parseName`, else first visit |

Selected `Settings` fields touched by this page:

| Field | Default | Range / values |
| --- | --- | --- |
| `mouseSens` | 1 | 0.2 to 3 |
| `invertY` | false | boolean |
| `mouseRaw` | true | boolean; only effective where `pointerrawupdate` exists |
| `renderScale` | 1 | 0.5 to 1 |
| `reduceMotion` | `prefers-reduced-motion` | boolean, "Weniger Bewegung" |
| `reduceFlicker` / `fadeBlackouts` | false / false | booleans, "Weniger Flackern" / "Stromausfälle überblenden" (the second only acts with the first) |
| `glow` | `standard` | `standard` / `mittel` / `niedrig` / `aus` (`GLOW_LEVELS` 1 / 0.5 / 0.15 / 0) |
| `imageBrightness` / `renderBrightness` | 1 / 1 | 0.5 to 1.5 |
| `sharpen` / `vignette` / `uiBlur` | false | booleans |
| `voiceMode` | `mouth` | `mouth` / `open` / `auto` / `ptt` |
| `musicVolume` / `announceVolume` | 0.7 / 0.8 | 0 to 1.5; 0 means off (no on/off switches any more) |
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
