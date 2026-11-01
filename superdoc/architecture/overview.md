# Architecture Overview

The first page to read when you need to find your way around the code. It summarises the shape of the app, names the design rules that everything else follows, and points to the page that covers each area. It links out instead of repeating: the detail lives in the [feature pages](../README.md), the vocabulary in [Terminology](../meta/TERMINOLOGY.md).

## Big picture

uKnowHeDoesntKnow is a browser party game for up to four players who sit around a table in a 3D night scene (default map: a U-Bahn coach at night; five more places exist). The UI is German. Rooms are peer-to-peer (Trystero over WebRTC, no game server), and six minigames can be played in a room. Stack: Vite, TypeScript, three.js; the repo is public, so nothing personal or secret may ever be committed ([Public repo hygiene](../claude-instructions/public-repo-hygiene.md)).

The runtime path, in order:

1. **Boot.** `src/main.ts:start` removes the boot screen and shows the main menu (`src/ui/menu.ts:MainMenu`). With `?seed=N` it skips the menu and launches a deterministic solo scene.
2. **Menu.** The player edits character and settings, then chooses: create a room, join with a code or link, or start the solo benchmark. A reload inside a room with the same `#code` rejoins without the menu (`src/main.ts:rejoinCode`).
3. **Room.** For create/join, `src/net/trystero.ts:trysteroTransport` opens a Trystero room and `src/net/session.ts:Session` runs on top of it: roles, roster, seats, rejoin, host migration. A joiner waits for the host's `welcome` (seed, start time, roster, room options) before anything is built.
4. **Scene and games.** `src/main.ts:launch` builds the `World` (the map plus the people in it), the render `Pipeline`, voice and ambience, and all six minigames, then runs the frame loop. `src/main.ts:connect` is the glue between `Session` and the scene.
5. **Solo (bench) mode.** The same `launch` without a session: the other three seats are scripted fake peers, and a test round can be played against bots on an in-memory `LocalGameRoom`. It doubles as the performance benchmark ([Debug tools, build and deploy](../features/debug-build.md)).

`src/main.ts` is the one hub module: it owns no rules, it wires everything else together. Its word "coach" means this game driver, not the train car ([Terminology](../meta/TERMINOLOGY.md), "Coach").

## Data flow

Input becomes either a local change (look direction, own profile, a setting) or an **intent** sent to the host. The host applies intents to the authoritative game state and publishes it; clients render what they receive. Everything ambient is not state at all but a pure function of the shared clock and the room seed.

```
mouse, keys, mic          player's own browser
      |  look yaw/pitch -> src/net/session.ts:Session.sendPose (peer to peer, cosmetic)
      |  game action    -> intent, sent to the host over channel 'mg'
      v
src/game/<name>/game.ts   client side of a minigame (private data stays here)
      |  intent
      v
src/game/<name>/logic.ts  <Name>Host on the HOST only: validates, applies, undo stack
      |  publish() the whole public state ('<prefix>:state', plus a 3 s heartbeat)
      v
every peer's game.ts      accepts it only from hostId, after parseState
      |  onChange
      v
ui.ts + src/scene/ + src/render/pipeline.ts:Pipeline.render        what you see

room seed (host welcome) + src/core/clock.ts:SharedClock.now()
      |  pure functions: src/core/motion.ts, src/core/rng.ts:hash01
      v
flicker, blackouts, oncoming trains, NPCs, map events, ambience     same picture on every peer, zero messages
```

*Why:* a single writer per game means no merge logic, and sending a seed and a clock offset once replaces a stream of ambient updates. Only genuine decisions travel, and those travel from the host. Details: [Networking](../features/networking.md), [Shared clock and determinism](../features/shared-clock-determinism.md), [Minigame framework](../features/minigame-framework.md).

## Core design principles

- **The host is the authority; the room survives its loss.** One player owns the roster, room options, train profile and every game's rules state. *Why:* one writer is the simplest consistent model without a server. Because people reload and lose WiFi, **every** peer remembers who left (`Session.gone`, 30 minutes) and every game can rebuild its host object from the last public state (`<Name>Host.fromState`). A returning player gets their seat and score back (rejoin), and when the host leaves the player with the best seat-order rank (longest in the room) takes over (host takeover) without any extra message, since all peers hold the same roster. The host can also hand the role to a chosen player (host transfer, Esc menu). See [Networking](../features/networking.md).
- **Peers are untrusted.** Every byte from the wire goes through a strict `parse*` function (`src/net/protocol.ts`, per-game `parseIntent`/`parseState`) and unknown or missing fields fall back to defaults. Senders are checked (state only from the host, game messages only from roster members; a message from someone the roster does not list yet is held briefly, not dropped). *Why:* every peer is just another browser, and old clients keep running while the format grows. Never cast `data`.
- **Determinism from clock and seed.** Ambient state is derived from `clock.now()` and the room seed, never from `Math.random()`, `Date.now()` or `performance.now()` for anything every peer must see. *Why:* it costs no bandwidth and a late joiner gets the value for "now" directly. See [Shared clock and determinism](../features/shared-clock-determinism.md).
- **The room code is the only secret.** 8 symbols (`src/net/roomCode.ts`), kept in the URL hash (never sent to the static host) and used as the Trystero room password. There is no account and no pre-check whether a code is in use. *Why:* a game for friends should need nothing but a link; the hash and password keep the code off the relays and the web server.
- **Private data travels member to member, never through the host.** Dealt cards, other players' custom lists and the deck key are sent straight to each member (`src/game/roomLists.ts:RoomLists`, `src/game/roomKey.ts:RoomKey`, per-game secrets) and never enter a published `*State`. *Why:* the host is a player too; anything routed through it would let it see the answers. See [Custom lists](../features/custom-lists.md), [Built-in decks](../features/content-decks.md).
- **Everything is procedural.** No models, no images, no audio files: people, maps, textures and sound are generated from code (`src/characters/`, `src/maps/`, `src/scene/textures.ts`, `src/audio/ambience.ts`). The only thing loaded from outside is the web fonts (`index.html`). *Why:* nothing to license, host or download, and the repo stays small; the sealed deck file `src/words/vault.json` is the one data asset.
- **The UI is German and hard-coded.** There is no i18n layer; labels and messages are string literals next to the code that shows them, and docs quote them verbatim. *Why:* the game is played by a German-speaking table, and a translation layer would add indirection for no user.
- **Pure logic is separated from glue, so it is testable.** Rules live in DOM-free, network-free classes; networking sits behind `src/net/transport.ts:Transport` (Trystero in the browser, `MemoryHub` in tests). *Why:* the fragile parts (election, rejoin, undo) must be tested without WebRTC or a browser.

## Module map

| Area | Main paths | Page |
| --- | --- | --- |
| Entry, wiring, frame loop | `src/main.ts` (`start`, `launch`, `connect`, `GameEntry`), `src/config.ts` (all tunables), `index.html`, `src/style.css` | this page, [Menu, settings and input](../features/menu-settings.md) |
| Shared clock, motion, comfort (steady light, blackout fade), randomness | `src/core/clock.ts`, `src/core/motion.ts`, `src/core/rng.ts` | [Shared clock and determinism](../features/shared-clock-determinism.md) |
| Networking | `src/net/session.ts`, `src/net/protocol.ts`, `src/net/transport.ts`, `src/net/trystero.ts`, `src/net/roomCode.ts` | [Networking](../features/networking.md) |
| Minigame framework | `src/game/minigame.ts`, `src/game/lobby.ts`, `src/game/undo.ts`, `src/game/gaze.ts`, `src/game/schaffner.ts`, `src/game/players.ts`, `src/game/npcs.ts`, `src/game/fakePeers.ts` | [Minigame framework](../features/minigame-framework.md) |
| Games: Wer bin ich?, Sag's anders, Gleich gedacht | `src/game/whoami/`, `src/game/sagsanders/`, `src/game/gleich/` | [Wer bin ich? / Sag's anders / Gleich gedacht](../features/minigames-whoami-sags-gleich.md) |
| Games: Zeig drauf, Ahnungslos, Stadt, Land, Fluss | `src/game/zeig/`, `src/game/ahnungslos/`, `src/game/slf/` | [Zeig drauf / Ahnungslos / Stadt, Land, Fluss](../features/minigames-zeig-ahnungslos-slf.md) |
| Maps | `src/maps/types.ts`, `src/maps/index.ts`, one folder per map | [Maps](../features/maps.md) |
| Scene (hypertrain parts, world) | `src/scene/world.ts`, `src/scene/coach.ts`, `src/scene/lighting.ts`, `src/scene/tunnel.ts`, `src/scene/neighbours.ts` | [Rendering and scene](../features/rendering-scene.md) |
| Render pipeline (bloom, tone mapping, vignette) | `src/render/pipeline.ts` | [Rendering and scene](../features/rendering-scene.md) |
| Characters | `src/characters/`, `src/ui/editor.ts`, `src/ui/preview.ts` | [Characters](../features/characters.md) |
| Audio | `src/audio/voice.ts`, `src/audio/ambience.ts`, `src/audio/denoise.ts` | [Voice and audio](../features/voice-audio.md) |
| UI | `src/ui/` (menu, settings, room dialog, editor, lists, panels), `src/style.css` | [Menu, settings and input](../features/menu-settings.md), [Styling guide](../ui/STYLING-GUIDE.md) |
| Words, decks, lists | `src/words/` (`vault.ts`, `content.ts`, `lists.ts`, `custom.ts`), `src/game/roomKey.ts`, `src/game/roomLists.ts` | [Built-in decks](../features/content-decks.md), [Custom lists](../features/custom-lists.md) |
| Debug | `src/debug/` (panel, "Meine Sicht", frame and mouse traces, GPU timer), `src/ui/benchPanel.ts` | [Debug tools, build and deploy](../features/debug-build.md) |
| Scripts, build, CI | `scripts/seal-content.mjs`, `vite.config.ts`, `package.json`, `.github/workflows/pages.yml` | [Debug tools, build and deploy](../features/debug-build.md), [Built-in decks](../features/content-decks.md) |
| Tests | `tests/*.test.ts` (flat, one file per feature or game), `tests/fixtures/` | [Shared clock and determinism](../features/shared-clock-determinism.md) ("Testing"), [Minigame framework](../features/minigame-framework.md) |

User-facing rules of every game are in the repo's [README](../../README.md) (German); the pages above describe the code.

## Where to look for X

- **Add a minigame** — [Minigame framework](../features/minigame-framework.md), "Using it": new `src/game/<name>/` (`logic.ts`, `game.ts`, `ui.ts`, `bots.ts`), an id and entry in `src/game/lobby.ts:GAMES`, one `GameEntry` in `src/main.ts:launch`.
- **Change the rules of an existing game** — the game's `logic.ts` `*Host` class; behaviour per game in [whoami / sags / gleich](../features/minigames-whoami-sags-gleich.md) or [zeig / ahnungslos / slf](../features/minigames-zeig-ahnungslos-slf.md).
- **Add a map** — [Maps](../features/maps.md), "How to add a map": `src/maps/types.ts:MAP_IDS`, `src/maps/index.ts:MAPS`, a `MapDef` in `src/maps/<id>/index.ts`.
- **Change a setting (per-browser)** — `src/ui/store.ts:Settings` (field, default, validator), a control in `src/ui/settingsView.ts:SettingsView`; if you rename, remove or re-scale a field, bump `SETTINGS_VERSION` and add an `UPGRADES` step plus a test (rule and recipe in [Menu, settings and input](../features/menu-settings.md), "Settings version and upgrade chain").
- **Add or change a room option (the host decides for everyone)** — `src/net/protocol.ts:RoomOpts` and `parseOpts`, the choices in `src/config.ts:ROOM`, the dialog in `src/ui/roomDialog.ts:openRoomDialog`.
- **Add a wire message** — a `parse*` function in `src/net/protocol.ts`, a handler in the `Session` constructor (`src/net/session.ts`) that checks the sender (host-only where it is a host decision), a sender method, a case in `tests/session.test.ts`. Game traffic needs none of this: use `GameNet.send` with a prefixed type (`src/game/minigame.ts:GameNet`). See [Networking](../features/networking.md), "Untrusted peers".
- **Fix reconnect, rejoin, host takeover or host transfer** — `src/net/session.ts` (`onHello`, `remember`, `findGone`, `becomeHost`, `hostClash`, `handOver`, `onHandover`, `stepDown`), the tab token and rejoin code in `src/main.ts`, and each game's `Host.replace` / `fromState`; see [Networking](../features/networking.md), "Rejoin" and "Host migration and split brain".
- **Change seat fill order** — `NET.seatOrder` in `src/config.ts`: the order seats fill and the host-takeover rank only ([Networking](../features/networking.md), "Roles, roster, welcome").
- **Change turn order or add a map with its own seat layout** — `src/game/tableOrder.ts` (`tableOrder`, `setTableSeats`, `byTableOrder`); the order comes from the map's seat positions, `World` registers them. See [Minigame framework](../features/minigame-framework.md), "Rounds", and [Maps](../features/maps.md), "Seat layouts and turn order".
- **Keep private game data across a reload** — `src/game/tabStore.ts:tabStore` (per-tab `sessionStorage`); **get lost data back from other players** — `src/game/minigame.ts:Recovery` (`mg:ask` / `mg:have`). Each game's usage is on its page; see [Minigame framework](../features/minigame-framework.md), "Reconnect helpers".
- **Add something ambient that every peer sees** — a pure function in `src/core/motion.ts` taking `t` from `clock.now()` and randomness from `src/core/rng.ts:hash01`, covered in `tests/motion.test.ts` ([Shared clock and determinism](../features/shared-clock-determinism.md), "Rules for new ambient features").
- **Tweak lighting, glow or brightness** — the fixed night values in `src/config.ts:LIGHTS`, `src/config.ts:BLOOM`, the levels in `src/ui/store.ts:GLOW_LEVELS`, the neon rig in `src/scene/lighting.ts:buildLighting`, the passes (incl. `FinishPass`) in `src/render/pipeline.ts:Pipeline`; see [Rendering and scene](../features/rendering-scene.md).
- **Make a light calmer for "Weniger Flackern" or fade it at blackouts** — `FrameCtx.comfort` and `src/core/motion.ts:LightPower`, `flick(..., steady)`; see [Maps](../features/maps.md), "Blackouts, power and flicker".
- **Add a UI control or screen** — build it with `src/ui/dom.ts:el` and the existing classes in `src/style.css`; rules in the [Styling guide](../ui/STYLING-GUIDE.md).
- **Add a character item or look option** — `src/characters/accessories.ts:ITEMS` (an item is one registry entry), `src/characters/look.ts:Look` for options; validation in `src/net/protocol.ts:parseLook` and `parseState`. See [Characters](../features/characters.md).
- **Change voice, the noise filter, the "Nur Mundbewegung" level path or the Schaffner** — `src/audio/voice.ts:Voice` (`peerLevel`, `setMouthLevel`), the `lvl` parser in `src/net/protocol.ts`, `src/audio/ambience.ts:announceGain`, `src/game/schaffner.ts`; see [Voice and audio](../features/voice-audio.md) and [Minigame framework](../features/minigame-framework.md), "Schaffner".
- **Seal or update the built-in decks** — `npm run seal` (`scripts/seal-content.mjs`) writes `src/words/vault.json`; unlock and key sharing in `src/words/content.ts:DeckLock`. See [Built-in decks](../features/content-decks.md). Never commit plaintext deck content or the password.
- **Work with own word lists** — `src/words/lists.ts:ListStore`, sharing in `src/game/roomLists.ts:RoomLists`, UI in `src/ui/listsView.ts:ListsView`; see [Custom lists](../features/custom-lists.md).
- **Inspect a scene or hunt a stutter** — `?debug`, `?seed=N`, the benchmark and `src/debug/`; see [Debug tools, build and deploy](../features/debug-build.md).
- **Allow a LAN host name on the dev server, or change the build and deploy** — `vite.config.ts` and `.github/workflows/pages.yml`; see [Debug tools, build and deploy](../features/debug-build.md).
- **Add a term to the vocabulary or update the docs** — [Terminology](../meta/TERMINOLOGY.md) and [Working with the Docs](../claude-instructions/documentation.md).

## Known open areas

Stated as they are today; none of these is a commitment.

- **Remaining reconnect gaps.** The reconnect work closed most holes (private drafts, cards, votes, Ahnungslos host loss). Left: in a two-player "Wer bin ich?" round with storage blocked or the tab reopened, the author's card is lost on a reload; undo history is lost on a host takeover; words and questions may repeat after a host change (the new host does not know what was drawn); and nothing calls `clearTabGame` on leaving a room, so a tab's stored game data stays until the tab closes or the game clears it ([Minigame framework](../features/minigame-framework.md), "Reconnect helpers"; per-game details on the game pages).
- **Firefox on one machine.** No STUN servers are configured, so two Firefox tabs on the same machine can fail ICE; across machines and with Chrome it works ([Networking](../features/networking.md), "Known limitations").
- **Bundle size.** The main bundle is about 604 kB, just over Vite's default 600 kB chunk warning; the three.js and vendor chunks are already split out ([Debug tools, build and deploy](../features/debug-build.md), "Chunk split"). Measured at the end of the settings rework; re-check before relying on the number.
