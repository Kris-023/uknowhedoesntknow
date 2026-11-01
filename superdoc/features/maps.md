# Maps — the places the four players sit in

A map is the room around the table: geometry, light, background people, ambient events and sound. The host picks one per room (`RoomOpts.map`, default `hypertrain`) and can swap it while the room keeps running. Six exist: Hypertrain, Waschsalon, Bürgeramt, Späti 3 Uhr, WG-Wohnzimmer and Diner. For how the scene is rendered see [rendering-scene.md](rendering-scene.md); for the shared clock that drives everything see [shared-clock-determinism.md](shared-clock-determinism.md); for the voice and sound bus see [voice-audio.md](voice-audio.md). Vocabulary (Schaffner, ...) is in [../meta/TERMINOLOGY.md](../meta/TERMINOLOGY.md); the module map is in [../architecture/overview.md](../architecture/overview.md).

## How it works

### The contract (`src/maps/types.ts`)

- `MapDef` is the registry entry: `id` (a `MapId`), German `name`, one-line `blurb` for the picker, `build(scene, seed): MapScene` and `sound(kit, seed): MapSound`. `src/maps/index.ts:MAPS` is a `Record<MapId, MapDef>`, so adding an id to `src/maps/types.ts:MAP_IDS` without registering it fails to compile. `src/maps/index.ts:mapDef` falls back to Hypertrain for an unknown id; `src/maps/index.ts:mapList` gives the picker order.
- `MapScene` is what `build` returns and what `src/scene/world.ts:World` holds as `map`:
  - `root`: parent of everything the world adds (people sit in this space).
  - `seats`: four `Spot`s in seat-index order. The layout differs per map (see "Seat layouts and turn order"), so never assume which seat index sits where. `World` hands these positions to `setTableSeats` when it builds a map. A `Spot` is `{x, y, z, yaw}` of a person's root; seated people use the seat height (0.525 for a chair, lower for a sofa or bean bag), yaw 0 faces +z.
  - `npcs`: `NpcSpot[]` (`act`: `phone`, `paper`, `beer` or `sleep`; `pose`: `sit` or `stand`; optional `can`). The world hands them to `src/game/npcs.ts:Npcs`.
  - `scoldSpot(i)`: where the Schaffner (or the map's stand-in) stands to tell seat `i` off, feet on the floor.
  - `overview`: camera position, look target and fov for the non-first-person view.
  - `power`: supply 0..1 after the last `update`. Drives the relay clunk (`src/audio/ambience.ts:Ambience`), the frame tracer's "Stromausfall" and display states.
  - `events()`: German labels of what is happening this frame, shown by the stutter recorder (`src/main.ts` pushes them into the tags). Examples: `Gegenzug`, `Unwucht`, `Nachbar klopft`.
  - `shake`: camera shake factor (see the table). `speedFov`: optional extra fov degrees at full train speed; only Hypertrain sets it (6).
  - `update(f: FrameCtx)`: per frame; `FrameCtx` carries `t`, `dt`, `kmh`, `distance`, `blackouts`, `forcedBlackoutAt`, `comfort`, `camera`.
- `SoundKit` is what a map's sound code gets (implemented by `src/audio/ambience.ts:Ambience`): `ctx`, `out` (one-off noises, follows the "Umgebung" volume), `bed` (steady layers, "Ruhige Umgebung" turns it down), `music` (own volume and switch), `noise` (2 s of white noise), `burst(at, dur)`, `announce(text, important?)` (ceiling-speaker chime, then browser speech) and `clunk(gain)`. `MapSound.update(t, power, kmh)` runs each frame while the room is open.
  *Why:* three channels (`out`, `bed`, `music`) so a player can quiet the constant hiss without losing the bell, the knock or the fuse, and mute the jukebox without losing either.

### Everything ambient is a pure function of clock and seed

- Each map derives every light, machine, car, knock and sound from `FrameCtx.t` (the shared clock) and the room seed. No map sends or receives a network message. *Why:* all peers see and hear the same event at the same moment for free, and a late joiner or a reload needs no catch-up. See [shared-clock-determinism.md](shared-clock-determinism.md).
- Randomness is `src/core/rng.ts:hash01` over `(seed, windowIndex, salt)`: each clock window of N seconds has a `chance` of one event at a hashed start time. Window lengths of different events are picked coprime-ish so they rarely stack. Keep functions stateless; if one needs "what happened before", sample backwards (see `src/maps/buergeramt/logic.ts:failureAge`).
- People are placed by the world, not the map: `World` builds the map first, then `Players` on `seats` and `Npcs` on `npcs`. *Why:* Hypertrain bakes copies of its coach into neighbour coaches, and people must not be inside those copies. Bespoke "extras" (Bürgeramt official, Späti owner, WG cat, ...) are built and animated by the map itself because the generic NPC acts cannot do their routines.

### Blackouts, power and flicker

- Power is `src/core/motion.ts:coachPower(t, seed, window, forcedAt)`. A `BlackoutWindow` (`windowS`, `chance`, `minS`, `maxS`) says how often an outage starts; each outage is a stutter, darkness, then the lights struggling back. `forcedAt` fires one outage at a clock time (host or debug button: `src/net/session.ts:triggerBlackout`, which ends up in `World.forcedBlackoutAt`).
- The room option `blackouts` ("Stromausfälle") reaches maps as `FrameCtx.blackouts`. Off means the map swaps its window for one with `chance: -1`; a forced outage still works. A map change carries the setting and the forced time over (`src/scene/world.ts:World.adopt`).
- Each map writes the result to `MapScene.power` and dims by it: tubes, point lights, glowing materials, screens. `Ambience.update` clunks the relay when power drops below 0.5 and again once it has stayed above for 0.8 s. *Why:* the restore also stutters, so a single threshold would clunk repeatedly.
- Flicker sources: neon `src/core/motion.ts:flick` (Hypertrain, Späti, Waschsalon, Bürgeramt); `src/core/motion.ts:windowFlash` and the oncoming-train strobe (`src/core/motion.ts:oncoming`), Hypertrain; the Diner's dying sign letter (`src/maps/diner/events.ts:signLetters`); the WG fairy lights on a loose contact (`src/maps/wg/events.ts:fairyContact`, tested in `tests/map-wg.test.ts`); the Bürgeramt number display blinking `0001`; the Waschsalon sign buzz.
- **Comfort (`Weniger Flackern`, `Stromausfälle überblenden`).** `FrameCtx.comfort` is a `Comfort {steady, fade}` (`src/core/motion.ts:comfortOf`; `fade` is true only together with `steady`). It changes how light is *drawn*, never what *happens*:
  - `steady` (`Weniger Flackern`): `flick(t, seed, steady)` returns a constant (`STEADY_NEON` 0.95) and `windowFlash(..., steady)` the mean of the strobe, so brightness stays the same on average. Each map steadies its own sites: neon tubes (Hypertrain, neighbour coaches, Späti, Bürgeramt, the Waschsalon's bad tube), the Hypertrain window strobes and the oncoming-train strobe, the Diner's dying letter and fryer glow, the WG fairy lights, candle and TV, the Späti shop neon and TV, the Bürgeramt flickering tube and `0001` blink, the Waschsalon sign buzz. Slow blinks (below about 3 Hz) are left alone.
  - Blackouts: each map keeps a `LightPower` (`src/core/motion.ts`) and feeds `LightPower.step(power, dt, comfort)` to its lights. Without comfort it returns the raw power unchanged. With `steady` the stuttery start and restore collapse into one clean cut: dark from the first dip below 0.5, back once the supply has been at or above 0.5 for 0.25 s. With `fade` that cut is eased with an exponential, time constant 0.15 s.
  - *Why* the raw value stays: `map.power` / `world.power` are still the real supply, because sounds (relay clunk), display states, labels and game timing read them. Comfort is local and visual only, so it cannot desync anyone. `LightPower` is per-frame local state, not derived from the clock; it is the one exception to the pure-function rule in [shared-clock-determinism.md](shared-clock-determinism.md), allowed because nothing but this player's lights reads it.
  - Adding a flickering light: take `f.comfort` from `FrameCtx`, pass `steady` to `flick`/`windowFlash` or write an explicit steady branch, and dim by the `LightPower` result, not by `map.power`.
- Camera shake: `src/core/motion.ts:shake` scaled by `MapScene.shake`; `World.update` computes `shakeAmplitude(reduceMotion, SHAKE.defaultMm, map.shake)`: a fixed 5 mm base times the map factor, 0 on every map when `Weniger Bewegung` is on. *Why:* a coach rattles, a laundromat or diner barely does; standing NPCs still sway a little with it.
- Lights read the global `src/config.ts:LIGHTS` values (the night look, one frozen literal) every frame. Maps are tuned for exactly these and follow them through `LIGHTS.neonTubeHdr`, `LIGHTS.neonBlue` and `LIGHTS.hemi`. The player's brightness settings do not touch `LIGHTS`; see [rendering-scene.md](rendering-scene.md).

### Changing the map in a running room

`src/main.ts:swapMap` builds the new `World`, calls `World.adopt` (camera mode, train speed, blackout setting, zoom, people on their seats via `Players.adopt`), rebuilds the Schaffner figure and the `Ambience` (held silent, then faded in), and frees the old scene with `src/scene/dispose.ts:disposeExcept`, which keeps any geometry, material or texture the new scene shares. Covered by `tests/mapswap.test.ts`. *Why:* voices share the audio bus and must keep playing through a map change, so only the map's own sound chain is unplugged.

## The six maps

| id | German name | Seats | NPCs | Events (`events()` labels) | Blackouts | Shake | Sound |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `hypertrain` | Hypertrain | 4, two rows facing across the aisle | 10 generic (`src/config.ts:NPC_DEFS`) | `Stromausfall`, `Gegenzug` | window 37 s, chance 0.45, 1.2–4.5 s (`src/config.ts:BLACKOUT`) | 1 (`speedFov` 6) | rumble and motor hum follow speed; gong and station announcements |
| `waschsalon` | Waschsalon | 4, two chairs per side of a folding table | 2 generic (sleeper on the dryer, phone) + 2 extras | `Unwucht`, `Sicherung raus` | no random ones; the fuse trips after each imbalance event; forced works | dynamic: 0.06 + 0.6 × imbalance shake | mains hum, sloshing, bad-tube buzz, rain, dryer beeps, coin clink, imbalance rumble |
| `buergeramt` | Bürgeramt | 4, two bolted chair rows facing across x | 3 queue + 1 sleeping clerk, + 2 extras | `Systemausfall`, `Nummernaufruf` | window 120 s, chance 0.45, 3–6 s (`FAILURE`); screens stay blue 9 s after | 0.08 | tube hum, printer, water glug, ticket, ding per number, rare spoken call, collective sigh |
| `spaeti` | Späti 3 Uhr | 4, crate seats in two facing pairs | 1 generic (beer on a crate outside) + 3 extras | `Stromausfall`, `Polizeistreife`, `Pfandsammler` | window 53 s, chance 0.32, 2.5–6 s (`SPAETI_BLACKOUT`) | 0.12 | cycling fridge compressor, tube buzz, slush machine, traffic, patrol engine (no siren), door chime |
| `wg` | WG-Wohnzimmer | 4, sofa, armchair and bean bag round a low table | 0 generic, 3 extras + cat | `Sicherung raus`, `Nachbar klopft`, `Lavablase` | window 53 s, chance 0.3, 1.5–4 s (`FUSE`) | 0.12 | neighbour's party bass (122 bpm, muffled), TV snow hiss, fridge, thuds |
| `diner` | Diner | 4, middle booth, benches facing | 3 generic (sleeper at the counter, two phones in a booth) + waitress, cook | `Stromausfall`, `Fritteuse brennt`, `Neonbuchstabe` | window 53 s, chance 0.35, 1.5–4 s (`FUSE`, defined in `src/maps/diner/index.ts`) | 0.08 (`DINER_SHAKE`) | fryer, fridge, jukebox songs, coffee machine, order bell, sign transformer buzz |

Unlabelled constants (`FAILURE`, `SPAETI_BLACKOUT`, `FUSE`, `DINER_SHAKE`) live in `src/maps/<id>/config.ts` of the map in that row. "Generic" NPCs are `NpcSpot`s driven by `Npcs`; "extras" are figures the map builds itself. *Why:* per-map numbers live next to the map and not in `src/config.ts`, which belongs to Hypertrain and the shared parts, so a map can be tuned without touching anything another map reads.

### Hypertrain (`src/maps/hypertrain/index.ts`)

The default, and the only map built from the shared scene modules (`src/scene/coach.ts`, `lighting.ts`, `tunnel.ts`, `neighbours.ts`, `junk.ts`). U-Bahn coach at up to 1200 km/h: neon strips, tunnel streaks, neighbour coaches, a halt countdown through eight stations with a gong and a spoken line before each stop (`src/maps/hypertrain/index.ts:sound`). Power is `coachPower` with `BLACKOUT`; `lighting.passing` raises `Gegenzug` for the oncoming train (light only; the whoosh and rail clicks were dropped as too present). It is the only map that really uses `kmh` and `distance`; others may read `kmh` as "how busy". The Schaffner is the figure `scoldSpot` is written for. *Why:* the shake multiplier is 1 because it is the reference the other maps are scaled against (0.08 to 0.12).

### Waschsalon (`src/maps/waschsalon/index.ts`)

Laundromat at 3 a.m.: tumbling drums, rain on the window, one bad ceiling tube (`flick` with `src/maps/waschsalon/schedule.ts:badTubeSeed`), a sign with its own buzz. Extras (`src/maps/waschsalon/people.ts`): the woman folding one sock forever and the man the coin changer keeps robbing. The signature event is the imbalance (`src/maps/waschsalon/schedule.ts:imbalanceAt`): once per 64 s window with chance 0.6 one washer ramps up (3 s), rages (6.5 s), settles (4 s), and the fuse trips 0.9 s later; the machine walks out from the wall and is shoved back, the shake factor rises, the extras look up. `src/maps/waschsalon/schedule.ts:laundromatPower` is `coachPower` with random outages disabled, taking the minimum of the forced outage and the post-imbalance fuse. With `blackouts` off the imbalance still happens, but the fuse holds. *Why:* the outage is tied to the event so the room "causes" its own blackout instead of the light dying at an unrelated moment, and it keeps the same stutter-out, dark, stutter-on shape so relay clunks and the frame tracer behave as on the coach. Tested in `tests/map-waschsalon.test.ts`.

### Bürgeramt (`src/maps/buergeramt/index.ts`)

Late-shift waiting hall: dim greenish tubes (several dead, one that cannot decide), a red number display, a queue that never moves (the back two shuffle on a 26 s cycle), a wall clock that runs wrong (`src/maps/buergeramt/logic.ts:clockHands`), an official who walks door to door with his mug (`logic.ts:officialAt`), a citizen on her endless form (`src/maps/buergeramt/figures.ts`). Numbers are called in absurd order (`logic.ts:callNumber`; the players' own 4712 is never called) and only every fifth slot can be announced (`logic.ts:announces`). The "Systemausfall" (`logic.ts:power`, `logic.ts:failureAge`) is rarer and longer than the coach blackout (about every four to five minutes): the hall goes dark, an emergency light by the exit takes over, the display blinks `0001`, and screens show the blue error texture for 9 s after the power is back. *Why:* `failureAge` samples backwards because the outage is only a function of `t` and nothing remembers when it ended; the long window makes it a signature event, not the weather.

### Späti 3 Uhr (`src/maps/spaeti/index.ts`)

Night kiosk, players on crates in a corner. A fridge row with a compressor that cycles (`src/maps/spaeti/sound.ts:compressorOn`), a slush machine, a flickering tube, a street lamp. Outside, driven by `src/maps/spaeti/events.ts:pass`: cars sweeping headlights through the window (9 s window), a delivery cyclist, and a slow police patrol with blue light and no siren (`events.ts:patrolAt`); while the patrol is in front of the window the people in the shop freeze (`events.ts:freezeAt`). The bottle collector (`events.ts:collectorAt`, 70 s cycle) walks in, returns bottles at the counter and leaves, with a door chime. The owner counts coins, then watches football on his phone. Blackouts use `SPAETI_BLACKOUT`, a little rarer than the coach's. Tested in `tests/map-spaeti.test.ts`. *Why:* `freezeAt` also returns the clock time they froze at, so poses can be re-evaluated there and blended, which keeps the freeze a pure function.

### WG-Wohnzimmer (`src/maps/wg/index.ts`)

Altbau living room at 2 a.m.: low tile table, worn sofa, armchair, bean bag (seat heights 0.46, 0.5, 0.41, because the seated rig reaches 0.49 below its root and lower would push the feet through the floor). Fairy lights on a loose contact (`src/maps/wg/events.ts:fairyContact`), a lava lamp whose blob tears off now and then (`events.ts:lavaDetach`), a TV looping test card and snow (`events.ts:tvSnow`; `src/maps/wg/sound.ts` plays the snow as band-passed hiss; the test card is silent, there is no tone), a cat on the window sill. The signature event is the downstairs neighbour's knock (`events.ts:knock`, 61 s window, 22 s long): three thuds and a shout, everyone freezes, the fairy lights and the bass drop out and come back one after the other. The party bass is the map's `music` channel. The blackout is the `FUSE` window ("Sicherung raus"). `npcs` is empty: the three flatmates (sleeper, caller in the door, guest with a beer) are extras in `src/maps/wg/figures.ts` because they freeze on the knock, which generic NPC acts cannot do. *Why:* freeze, lights and bass all derive from the same knock phase, so the event is one coherent beat on every client. Tested in `tests/map-wg.test.ts`.

### Diner (`src/maps/diner/index.ts`)

"Brätlingshof", 4 a.m.: red vinyl booths along the window wall, a counter with stools, a kitchen behind a hatch, a street with a neon sign outside. Players sit in the middle booth, seats 0 and 2 on one bench, 1 and 3 across it, so the "Sag's anders" teams sit side by side. A waitress (`src/maps/diner/events.ts:waitressPose`) and a cook (`events.ts:cookPose`, the bell rings once per 19 s loop) run on loops (`src/maps/diner/figures.ts`). Events: the deep-fryer flare (`events.ts:fryerFlare`, 64 s window, chance 0.75, with smoke-detector beeps) and a dying letter in the sign (`events.ts:signLetters`). `forceFlare` on the diner's map object lets the debug panel trigger the flare. The flames ignore the fuse: the kitchen light is added on top of the dimmed supply. The jukebox plays 16-bar songs in a seed-chosen key on the `music` channel. Blackouts use the `FUSE` window defined at the top of `src/maps/diner/index.ts`.

## Seat layouts and turn order

Seen from above (x to the right, z towards the bottom of the picture), the maps number their seats differently:

| Maps | Seat 0 | Seat 1 | Seat 2 | Seat 3 |
| --- | --- | --- | --- | --- |
| `hypertrain`, `diner` | top left | bottom left | top right | bottom right |
| `waschsalon`, `buergeramt`, `spaeti`, `wg` | top left | top right | bottom left | bottom right |

Turn order in every game (and the roster in the menu) is counter-clockwise around the table seen from above, starting top right: top right, top left, bottom left, bottom right. It is computed from the real seat positions by `src/game/tableOrder.ts:tableOrder`, so it is right on every layout; the `World` constructor calls `setTableSeats(map.seats)`, which also covers a map swap. *Why:* the seat numbers are not geometry, and a fixed table of seat numbers would be wrong on half the maps. `NET.seatOrder` is a separate thing, only the order seats are filled and the host-takeover rank ([Networking](networking.md)). Details of the helper: [Minigame framework](minigame-framework.md), "Rounds".

## How to add a map

1. Add the id to `src/maps/types.ts:MAP_IDS`. `MapId`, the room-option validation (`src/net/protocol.ts` checks `MAP_IDS.includes`) and the picker follow from it. Register it in `src/maps/index.ts:MAPS`; the `Record<MapId, MapDef>` does not compile until you do.
2. For a pickable stub first, use `src/maps/placeholder.ts:placeholderMap` (a bare room with four chairs) and replace it when the real map exists.
3. Create `src/maps/<id>/` with `config.ts` (all numbers), `index.ts` (exports a `MapDef`), `sound.ts` and whatever scene or figure files you need. Keep constants out of `src/config.ts`.
4. In `build(scene, seed)`: set `scene.background` and `scene.fog`, make a root with `src/scene/build.ts:group`, and return a `MapScene` with four seats (their layout decides the turn order, see "Seat layouts and turn order"), `npcs` (may be empty), `scoldSpot`, `overview`, `power`, `shake`, `events` and `update`. Do not add people; the world does that after `build`.
5. In `update(f)`: compute power with `coachPower` and a `BlackoutWindow` (use `chance: -1` when `f.blackouts` is false), store it in `map.power`, dim lights and glowing materials by it, and derive every ambient event from `f.t` and `seed` through `hash01` windows. No `Math.random`, no network. *Why:* any randomness or state outside the clock makes peers diverge silently.
6. Scale light through `LIGHTS`, `LIGHT_SCALE` and `POINT_LIGHT_SCALE` and tune for `nacht`. Keep the number of real point lights low (the maps use four or five).
7. In `sound(kit, seed)`: steady layers to `kit.bed`, one-offs to `kit.out`, music to `kit.music`; return `{ update(t, power, kmh) }`. Endless sources started while `sound()` runs are stopped on a map change by `Ambience`; do not start your own timers.
8. Share geometry and materials freely: `disposeExcept` frees only what the next map does not use. Merge static parts (see `src/maps/waschsalon/batch.ts` and `src/maps/spaeti/merge.ts`) so a map with hundreds of boxes costs few draw calls.
9. Test the pure parts like `tests/map-wg.test.ts`: events fall inside their window, the same `(t, seed)` gives the same result, seats are about a metre apart.
10. Give it a German `name` and `blurb`; they show up in the picker (`src/ui/roomDialog.ts`, `src/ui/menu.ts`) and in the map-change toast.

## Options

| Option | Where | Meaning |
| --- | --- | --- |
| `RoomOpts.map` | `src/net/protocol.ts` | host's map for the room, default `hypertrain`; the host can change it live |
| `RoomOpts.blackouts` ("Stromausfälle") | `src/net/protocol.ts` | random power failures on or off (forced ones still work) |
| "Weniger Flackern", "Stromausfälle überblenden", "Weniger Bewegung" | `src/ui/store.ts` settings | per-player comfort, reaches maps as `FrameCtx.comfort` and the shake amplitude |
| "Umgebung", "Ruhige Umgebung", "Musik" volume (0 = off) | `src/ui/store.ts` settings | per-player sound channels (`out`, `bed`, `music`) |

## Related links

- [rendering-scene.md](rendering-scene.md)
- [voice-audio.md](voice-audio.md)
- [shared-clock-determinism.md](shared-clock-determinism.md)
- [../architecture/overview.md](../architecture/overview.md)
- [../meta/TERMINOLOGY.md](../meta/TERMINOLOGY.md)
