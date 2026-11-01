# Rendering and scene: the post-processed night-train look

How a frame gets drawn: one HDR render target with MSAA, optional bloom, tone mapping at the end. It also covers the hypertrain coach scene that feeds it (lighting, tunnel, neighbour coaches, junk), the camera, and the quirks that are easy to break. Other maps build their own scenes but share the pipeline, the `LIGHTS` values and the camera in `world.ts`; see [maps.md](maps.md).

## How it works

### Render pipeline

- `src/render/pipeline.ts:Pipeline` owns the `WebGLRenderer` (`antialias: false`) and an `EffectComposer` with three passes: `RenderPass` -> `ScaledBloomPass` -> `OutputPass`.
- The composer's target is a `HalfFloatType` render target with `RENDER.msaaSamples` (4, clamped to `capabilities.maxSamples`). *Why:* with post-processing only fullscreen quads reach the canvas, so canvas MSAA does nothing. Earlier versions had no antialiasing at all with bloom on, and bloom off fell back to the costly MSAA canvas. Now both paths are antialiased and tone-mapped identically; bloom off only skips one pass (`bloom.enabled`).
- `src/render/pipeline.ts:ScaledBloomPass` is `UnrealBloomPass` working at `BLOOM.resolutionScale` (0.5) of the render size by overriding `setSize`. *Why:* glow is soft anyway and full-size bloom cost about 10 % GPU; `BLOOM.strength` (0.72) and `radius` (0.25) were retuned lower for the half-size mips, which spread more haze.
- `OutputPass` applies ACES filmic tone mapping and sRGB conversion. Because of that, materials write linear HDR values and colours above 1 are meaningful (see the neon tubes below).
- `Pipeline.render` re-reads `LIGHTS.exposure` and `LIGHTS.bloomThreshold` and sets `bloom.strength = BLOOM.strength * bloomStrength` every frame. *Why:* the active light preset is mutable global state, so no plumbing is needed to switch it.
- `r.info.autoReset = false` plus a manual `info.reset()` per `render()`. *Why:* the composer runs several passes, and the stats readout should count the whole frame.
- `Pipeline.setView(scene, camera)` swaps what the `RenderPass` draws on a map change, so renderer, canvas and passes survive.
- `src/main.ts:applyBloom` (despite the name it applies all three settings) pushes `settings.bloom && !panel.state.sight`, `settings.bloomStrength` and `settings.renderScale` into the pipeline, on start and on every settings change. The "Meine Sicht" debug view forces bloom off.

### Render scale

- `Pipeline.setRenderScale(k)` (setting `renderScale`, clamped 0.5..1 in `src/ui/store.ts`) multiplies the pixel ratio: `min(devicePixelRatio, RENDER.maxPixelRatio) * k`. The canvas still fills the window and the browser upscales (`setSize(w, h, false)` leaves the CSS size alone).
- `Pipeline.renderSize` reports the real device-pixel size for the benchmark readout.

### Colour management quirk

- `src/main.ts` sets `THREE.ColorManagement.enabled = false` right after the imports. *Why:* the palette was tuned on three r128, where hex colours went into shaders unconverted. With management on (the modern default) every `0x...` colour would be treated as sRGB and converted to linear, and the whole look shifts. Textures still decode as sRGB (`canvasTex` sets `colorSpace = SRGBColorSpace`) and the renderer outputs `SRGBColorSpace`.
- Light units are the same story: r155+ uses physical units, r128 multiplied direct light by PI. `src/config.ts:LIGHT_SCALE` (= PI) restores the old numbers, and `POINT_LIGHT_SCALE` (0.9) is smaller because physical falloff explodes within 1 m while the neon lights hang 10 to 30 cm below the ceiling. Config values stay in "prototype units"; multiply at the point of use.
- Do NOT turn `ColorManagement` back on or convert hex colours to "fix" something; retune the value instead, or every colour in every map shifts.

### Lighting and presets

- `src/config.ts:LIGHT_PRESETS` has two looks, `nacht` (default; neon carries the room, everything else a faint fill, exposure 0.85, bloom threshold 0.28) and `hell` (the brighter first look, exposure 1.15, threshold 0.62, tubes lifted to HDR 3.2). A preset is a `LightPreset`: `hemi`, `ceilingWhite`, `neonBlue`, `window`, `neonTubeHdr`, `frameOpacity`, `exposure`, `bloomThreshold`.
- `src/config.ts:LIGHTS` is the active preset, a mutable copy of `nacht`. `src/main.ts:applyLight` runs `Object.assign(LIGHTS, LIGHT_PRESETS[settings.light])` at start and on every settings change. Every consumer reads `LIGHTS` per frame instead of caching it. *Why:* switching is one `Object.assign`, no plumbing through scenes.
- Maps are tuned for `nacht`. Other maps scale their own constants by ratios against the nacht numbers (for example `LIGHTS.neonBlue / 0.9` in `src/maps/waschsalon/index.ts`, `LIGHTS.bloomThreshold / 0.28` in `src/maps/spaeti/index.ts`), so they follow the preset without hard-coding it.
- *Why* `bloomThreshold` must sit above the brightest lit wall: only the neon tubes should glow. The tubes are pushed above the threshold with `neonTubeHdr` (colour multiplied above 1); the walls they light stay below it.
- `src/scene/lighting.ts:buildLighting` (hypertrain): 20 neon segments (5 per row, ceiling and floor, both sides), each flickering with `core/motion.ts:flick` on its own seed. The lobby seed shifts every phase so two lobbies don't flicker in lockstep. A tube is a `MeshBasicMaterial` whose colour is the neon colour times `0.04 + 0.96 k` times `neonTubeHdr`; the halo is an additive plane with the `glow` texture (a cheap fake bloom that also covers bloom being off).
- *Why* "lean" lights: every point light costs every lit pixel. The default set is 4 point lights (two window lights, one merged blue light per side) instead of 11 (about 24 % GPU), compensated by the `LEAN` gains (`hemiGain`, `blueGain`, `blueDistance`). `?lights=full` in a dev build brings back the full set for comparison (`leanLights`); production always uses lean.
- Blackout: `buildLighting(...).update(t, speedFactor, power)` multiplies neon and whites by `power`, but the hemisphere keeps 35 % (`0.35 + 0.65 * power`). *Why:* the tunnel and the neighbour coaches still glow in; the outage belongs to the player coach only. See [maps.md](maps.md) for how `power` is computed.
- Oncoming train: `ONCOMING` (hashed from clock and lobby seed in `core/motion.ts:oncoming`) sweeps a strobing point light along one side of the coach; in lean mode it borrows the window light of that side. It is light only, with no sound (a whoosh was tried and dropped as too present).

### World, coach and map boundary

- `src/scene/world.ts:World` is one map plus people: it calls `mapDef(id).build(scene, seed)`, then creates `Players` and `Npcs` on the map's seats and spots. *Why* people come after the map: the baked neighbour coaches must not contain them.
- `World.adopt(prev)` carries room state over on a map change (camera mode, train speed profile, blackout setting, zoom, players), and `World.dispose(next)` frees GPU memory except what `next` shares (`src/scene/dispose.ts:disposeExcept`, `collectResources`). *Why* "except": characters, items and many props come from module-level caches that the next world takes again. Freeing something shared is harmless (three.js re-uploads it) but wasteful.
- `src/scene/build.ts` has the shared helpers: `tag` assigns a render `Role` (`struct`, `light`, `player`, `npc`, `prop`, `fx`, `outside`) used by the "Meine Sicht" debug view and by baking; `boxGeo` and `std` cache identical geometry and plain materials (textured ones are never cached).
- `src/scene/coach.ts:buildCoach` builds the static shell, ceiling frame, screens and seats. `Coach.setPower` dims `poweredMaterials` (ceiling frame opacity from `LIGHTS.frameOpacity`, screens). There are deliberately no grab poles: they blocked the view across the circle of seats.

### Tunnel

- `src/scene/tunnel.ts:buildTunnel`: 380 light streaks (`TUNNEL.count`) as two `InstancedMesh` (core and a wide faint glow), one draw call each. The first 96 (`TUNNEL.regular`) are evenly spaced rails along the window line, the rest random debris.
- Position is a pure function of `(seed, index, distance)`; after each wrap a streak re-rolls its x/y from `hash01(seed, i, lap, ...)`. *Why:* peers that agree on the shared distance see the same picture without any network traffic. The same rule holds for blackouts, the oncoming train and the neon flicker.
- `crossedPlanes` (two crossed planes) means a flat streak never vanishes edge-on. `streakMat` is additive with `forceSinglePass: true`. *Why:* additive blending ignores order, and without the flag three.js draws transparent double-sided meshes twice and flags a program check twice per frame.
- Streak length stretches with speed (`SPEED.stretchPerUnit`); `SPEED.visualScale` (0.12) compresses real km/h into motion that is readable at 60 fps instead of a blur. `World.update` computes `distance = trainDistance(train, t) * SPEED.visualScale`.

### Neighbours (endless train)

- `src/scene/neighbours.ts:buildNeighbours` bakes the finished player coach into one mesh per (material, role) with `mergeGeometries` (about 15 draw calls instead of 150) and places copies at multiples of `TRAIN.period` (11.6 m) in both directions, `TRAIN.neighboursPerSide` (2) per side. Fog (`RENDER.fogNear` 4, `fogFar` 40) swallows anything further; a third copy changed 0.01 % of pixels.
- Each copy owns its neon materials and flickers as a whole; copies never black out (powered materials are cloned).
- `Neighbours.cull(camera)` hides a whole side unless its door opening (`DOOR`, matching the bulkhead opening in `coach.ts`) is inside the camera frustum. *Why:* both cameras stay inside the coach, so a copy can only be seen through the door on its side.
- Baking order matters: lighting is built before the bake so the neon tubes are part of every copy, and people are added by `World` afterwards so they are not (`src/maps/hypertrain/index.ts`).

### Crowd geometry

- `src/game/crowd.ts:bakeCrowd` builds a coach of passengers with the real `Person` rig (same looks, props and pose logic as the NPCs), settles them with a few `person.update` calls, then flattens everything into **one** geometry with vertex colours. Textured parts (newspaper, bag print) collapse to their base colour times 0.75, which is all that survives at that distance in fog. Back-face meshes (the mouth cavity) and invisible meshes are dropped.
- Counts come from the local `CROWD` constant: 5..8 seated, up to 2 standing. `TRAIN.crowdVariants` (2) different crowds alternate over the copies; `TRAIN.crowdedPerSide` (2) limits how far out passengers exist. *Why:* far copies vanish in fog and passengers there would only cost triangles.
- `src/game/crowd.ts:crowdMaterial` is a `MeshBasicMaterial` patched via `onBeforeCompile` with hand-made hemisphere shading (`crowdHemi.sky` and `.ground` uniforms). *Why:* the neighbours lie outside the player coach's point lights, and a standard material still paid for lighting on every crowd pixel. `neighbours.ts` copies the scene's `hemi` light into those uniforms each frame, times `CROWD_LAMBERT` (1/PI, the factor that turns light colour into what a standard material would show). It is double-sided because hair caps and torsos are open shells; back faces shade with the flipped normal.
- Each crowd mesh sways as a unit (`rotation.z`): one transform, no per-figure animation.

### Junk and textures

- `src/scene/junk.ts:buildJunk`: two deposit bottles that roll back and forth with the coach sway (rotation = distance / `BOTTLE_R`, so they roll without sliding) and eight wall stickers cut from one atlas of four invented motifs (no brands). Sticker materials are lit like the wall so they never glow at night.
- `src/scene/textures.ts`: every texture is drawn at runtime on a canvas (`canvasTex`), zero image files. *Why:* nothing to license, host or load. `makeCoachTextures` draws grain, floor, wall, vent, frame, glow and line textures with `mulberry32(TEXTURE_SEED)`. *Why* a fixed seed: scratches are decor, not lobby state, so they look the same in every lobby. `tiled` clones a texture to set its own repeat. `HaltDisplay` redraws the halt countdown screen only when the displayed second changes.

### Camera

All of it lives in `src/scene/world.ts:World`, mostly `updateCamera`.

- Modes (`CamMode`): `'wagon'` is the overview camera from `MapScene.overview` (position, look-at, fov); `'pov'` is first person from the local player's head.
- POV position follows the head's `rig.eye`, but the direction is computed from `players.look` (yaw and pitch from the mouse) plus the seat rotation, not from the head bone. *Why:* taking it from the head made the view trail behind the mouse; head smoothing, the lagging torso turn and its lean kept it drifting after the mouse stopped.
- Shake: `amp = shakeOn ? shakeMm / 1000 * map.shake : 0`; `core/motion.ts:shake` gives x/y/roll noise seeded from the clock seed. POV applies 0.6 of it to position and look target plus a small roll. The same `amp` drives NPC sway (`Npcs.update`). `MapScene.shake` is the per-map factor: hypertrain 1, the other rooms small values (0.08 to 0.12, the laundromat varies with its imbalance), `placeholder` 0. `SHAKE.maxMm` is 30, default 5; players whose OS asks for reduced motion start with shake off.
- FOV: POV base is `CAMERA.seatFov` (74); the overview uses the map's `overview.fov` plus a slow breathing term `1.5 * sin(0.4 t)`. Both add `speedFactor * MapScene.speedFov` (`sf = kmh / SPEED.maxKmh`); only the hypertrain sets `speedFov` (6 degrees at full speed), so only moving maps widen.
- Zoom: right mouse in POV sets `world.zoom = 1`, release sets 0 (`src/main.ts`, `mousedown`/`mouseup`; `contextmenu` is suppressed on the stage). `World.update` smooths it into `zoomK` with rate `CAMERA.zoomRate` (10); `World.fovFactor` is `1 - (1 - CAMERA.zoomFovFactor) * zoomK` with `zoomFovFactor` 0.38. *Why:* to read the cards on other players' heads. `fovFactor` multiplies the POV FOV and also the mouse sensitivity (`src/main.ts:mouseK`), so turning speed on screen stays constant when zoomed. Outside POV the zoom target is forced to 0.
- Projection: `PerspectiveCamera(CAMERA.wagonFov, 16/9, 0.05, 120)`, aspect updated on resize in `main.ts`; `updateProjectionMatrix` runs once per frame after the FOV changes.

## Options

| Key | Default | Meaning |
| --- | --- | --- |
| `settings.light` | `nacht` | Light preset, `nacht` or `hell` (`src/ui/store.ts`) |
| `settings.bloom` | on | Bloom pass on/off |
| `settings.bloomStrength` | 1 | Multiplier on `BLOOM.strength`, 0..2 |
| `settings.renderScale` | 1 | Render resolution factor, 0.5..1 |
| `settings.shakeOn` / `shakeMm` | on (off with reduced motion) / 5 | Camera shake, 0..30 mm |
| `RENDER.maxPixelRatio` | 2 | Cap on device pixel ratio |
| `RENDER.msaaSamples` | 4 | MSAA on the HDR target |
| `BLOOM.resolutionScale` | 0.5 | Bloom works at this fraction of render size |
| `CAMERA.zoomFovFactor` / `zoomRate` | 0.38 / 10 | Right-mouse zoom target and smoothing |
| `TUNNEL.count` / `regular` | 380 / 96 | Streak instances, of which evenly spaced rails |
| `TRAIN.neighboursPerSide` | 2 | Baked neighbour coaches per direction |

Settings UI: see [menu-settings.md](menu-settings.md).

## Gotchas

- A new bright thing that should glow must exceed `LIGHTS.bloomThreshold` in linear HDR (use the `neonTubeHdr` convention); a new lit surface must stay below it or it will bloom.
- Anything per-lobby must derive from the shared clock and `clock.seed`, never `Math.random()` or wall time, or peers see different pictures. `crowd.ts`, `tunnel.ts` and `junk.ts` follow this (`textures.ts` uses a fixed seed).
- Materials that baked copies reuse and mutate (the powered ones) must be cloned per copy, as `buildNeighbours` does.

## Related links

- [maps.md](maps.md): per-map scenes, the `MapDef`/`MapScene` contract, power and blackouts.
- [menu-settings.md](menu-settings.md): where the graphics settings live.
- [voice-audio.md](voice-audio.md): the audio listener follows the same camera.
- [../architecture/overview.md](../architecture/overview.md): module map and frame loop.
- [../meta/TERMINOLOGY.md](../meta/TERMINOLOGY.md): vocabulary.
