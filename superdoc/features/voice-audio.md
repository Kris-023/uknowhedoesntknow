# Voice and audio: positional voice chat and synthetic ambience

Players talk to each other over a peer-to-peer WebRTC audio mesh, and every voice is placed in 3D at its player's head. On top of that, each map plays synthetic ambience (no audio files) through three separately adjustable channels. Everything audible ends up on one Web Audio bus owned by the voice engine.

## How it works

### Voice mesh and signal path

- `src/audio/voice.ts:Voice` is a singleton created on the first user gesture that needs it (`getVoice(true)`, from the menu click; browsers only start audio after a gesture, `Voice.resume`). It owns the `AudioContext`, the `bus` (everything audible: voices, train sounds, test tone) and `master` (voice volume, `settings.voiceVolume`). `bus` goes straight to `ctx.destination`.
- *Why* straight to the speakers: routing through a `MediaStream` and an `<audio>` element was tried so Chrome's echo canceller could see the output, but Chrome only cancels real WebRTC peer audio played that way, and the detour crackled under load. Firefox cancels Web Audio output anyway. In Chromium browsers `echoNeedsHeadphones` is true and the look-around hint in `src/main.ts` adds `Kopfhörer empfohlen: ohne hören die anderen sich selbst als Echo`.
- Transport: `Voice.bind(net)` attaches to the `Transport` interface (`src/net/transport.ts`: `addStream`, `onStream`, `onJoin`, `onLeave`); the real implementation is `src/net/trystero.ts:trysteroTransport`. Our outgoing stream is added for everyone now and for every later joiner (`onJoin`); incoming streams become peers (`addPeer`). Mesh, not a server: every player sends to every other, which is fine for 4 players.
- The mouth levels of the characters come from the audio itself (own mic analyser, one analyser per received stream: `Voice.micLevel`, `Voice.peerLevel`, `rmsToLevel`), so lip movement needs no network messages, with one exception: a player in `Nur Mundbewegung` mode sends no audio, only a level message (see Voice modes). `rmsToLevel` maps dB between `VOICE.gateDb` (-50, mouth shut) and `VOICE.fullDb` (-18, wide open).
- `Voice.setRoomVoice(on)` is the host's room-wide switch: off means no mic, nothing sent, nothing played, while the player's own `micOn` setting is kept for the next room.
- A disabled `MediaStreamTrack` sends silence while the connection stays up, so mute, push-to-talk and the gate just flip `track.enabled` (`applyTransmit`). *Why:* unmuting is instant, with no renegotiation.

### Outgoing chain (microphone)

`startMic` builds: mic -> highpass (`VOICE.highpassHz` 80) -> optional RNNoise -> gain (`settings.micGain`) -> analyser, and gain -> limiter -> delay -> outgoing stream. It is never played back locally (no self-echo). In `Nur Mundbewegung` mode the chain still runs (the analyser and the gate need it) but the outgoing stream is not offered to anyone.

- The gain sits before the analyser, so the settings test meter shows what the others get.
- The limiter (`VOICE.limiterDb` -6) only catches shouts before clipping. *Why:* it starts above the Schaffner's level so it does not hide shouting from him. Bitrate is `VOICE.bitrate` 64 kbit/s: Opus starts around 32 in browsers, 64 is clearly fuller and cheap for a 4-way mesh.
- The delay node carries only the sent audio (`VOICE.vadLookaheadS` 50 ms, only in Automatisch mode, `applyLookahead`); the analyser sees the signal live. *Why:* the gate needs to open before the first syllable leaves.

### Noise filter, echo and auto gain

- Settings `micFilter`: `'ki'` (default, neural RNNoise), `'browser'` (the browser's own noise suppression), `'off'`. `Voice.micFilter` reports what actually runs, because the neural one can fail to load; then `startMic` falls back to `'browser'`.
- *Why* never both: two suppressors in a row make voices sound underwater, so `noiseSuppression` is set only when `filter === 'browser'`.
- `src/audio/denoise.ts:createDenoiser` loads `@sapphi-red/web-noise-suppressor` with a dynamic `import()` plus about 150 kB of wasm (`rnnoise.wasm`, `rnnoise_simd.wasm`) and the worklet file (`rnnoiseWorklet.js`), all via Vite `?url` imports. Nothing is fetched until someone actually uses the filter. *Why:* the library's classes extend `AudioWorkletNode` at import time, which does not exist outside a browser (tests, SSR) and would crash a static import.
- `vite.config.ts` `build.rolldownOptions.output.codeSplitting.groups`: a `three` chunk, and a `vendor` chunk matching `node_modules` **except** `@sapphi-red`. *Why:* the suppressor is excluded from the eager vendor chunk so it stays a lazy chunk; libraries also change less often than game code, so separate chunks stay cached across deploys. If you add another lazy library, exclude it from `vendor` the same way.
- The wasm binary is loaded once and kept in a module variable (reset on failure so a retry works); `addModule` runs once per context (`loaded` WeakSet).
- RNNoise needs 48 kHz, so it runs in its own `micCtx` (`AudioContext({ sampleRate: 48000, sinkId: { type: 'none' } })`, no output device). *Why:* if the filter ever stalls, only the outgoing voice hiccups, not everything you hear. Firefox cannot connect a 44.1 kHz mic to the 48 kHz context; `startMic` catches that in `createMediaStreamSource` and falls back to the browser filter on the main context.
- The filter loads before the mic is opened, so a failure can switch to the browser filter before the `getUserMedia` constraints are chosen.
- `echoCancel` and `autoGain` (both default on) are plain `getUserMedia` constraints. A remembered `micDevice` that is gone (unplugged headset) triggers a retry on the default device after `OverconstrainedError`. Changing device, filter, echo or auto gain restarts the mic (`onSettings` chain check).
- Chrome often parks the permission prompt as an address-bar chip and rejects the first request; a `permissions.query` `change` listener restarts the mic once the user grants it later.

### Voice modes

Setting `voiceMode` (`'mouth' | 'open' | 'auto' | 'ptt'`, UI labels Nur Mundbewegung / Offen / Automatisch / Push-to-talk; default `mouth`, a saved choice is kept):

| Mode | Transmits when |
| --- | --- |
| `mouth` ("Nur Mundbewegung") | never audio; only the mouth level (below) goes out while the gate is open |
| `open` ("Offen") | always (unless muted) |
| `auto` ("Automatisch") | the gate is open: level at or above `settings.vadLevel` (default `VOICE.vadDefault` 0.5, range 0.05..0.95) |
| `ptt` ("Push-to-talk") | the key `VOICE.pttKey` (`KeyV`) is held |

- `Voice.transmitting` is the single truth for *audio* (`sendsAudio`, pure and tested): needs a mic, not muted, then per mode; always false in `mouth` mode. Mute toggles on `VOICE.muteKey` (`KeyM`). Both keys are wired in `src/main.ts` (ignored while typing in an input; `blur` releases push-to-talk so the key cannot stay stuck when it is released in another window).
- `gateStep` is the pure gate: opens at once on a loud level, stays open for `VOICE.vadHangMs` (450 ms) after the last loud moment so word endings are not cut (covered by `tests/voice.test.ts`). It is polled by its own `setInterval` (`VOICE.vadPollMs` 15), not the render loop. *Why:* the gate must keep working in a background tab, where `requestAnimationFrame` stops.

**Nur Mundbewegung** (`mouth`, the default):

- Mic and the voice-activation gate run locally. The level is measured after `micGain` and before the limiter, exactly where a received stream is measured, so everyone's scale is the same; the gate is `gateStep` with `settings.vadLevel` ("Schwelle") and the 450 ms hang.
- No audio goes out. `Voice.applyStream` adds or removes the mic stream (`addStream` / `removeStream`) whenever the mode, mic or room voice changes, and `onJoin` only offers it to a newcomer while it is wanted (`streaming`).
- Instead the level travels as the message `lvl` (`src/net/protocol.ts:encodeLevel` / `parseLevel`): one integer byte 0..255, at most `VOICE.mouthHz` (12) times a second, sent only while the byte is above 0 plus one closing 0 (`mouthByte`: level while the gate is open, else 0; muted sends 0). `parseLevel` rejects everything that is not an integer byte in range. Quiet therefore costs no traffic.
- Receiving (`Voice.bind`, `net.on('lvl')`, only while room voice is on): `setMouthLevel(from, level)` stores the level with a timestamp. `mouthLevel(id)` returns 0 once it is older than `VOICE.mouthStaleMs` (500 ms): a lost packet, a left peer or a mode switch counts as silence.
- `Voice.peerLevel(id)` is the louder of the audio level and the mouth level, and `Voice.hasVoice(id)` (formerly `hasPeer`) is true for an audio peer *or* a peer that sent a level. Character mouths, name tags and the Schaffner's loudness check all go through those two, so nothing else had to learn about the mode. The own mouth and the own Schaffner level use `micLevel()`, which also reports a level while `Voice.mouthing` (mouth mode, gate open, not muted). The mic HUD shows `Nur Mundbewegung` with the raw level bar (greyed while the gate is closed).
- `Voice.setMouthLevel(id, level)` is also used by the benchmark ("Mundbewegung testen", see [debug-build.md](debug-build.md)); `Players.botLevel` feeds solo bots.
- *Why* (the maintainer's reason): groups often talk over another voice app. The mouths should still move, and the Schaffner must still work, without a second audio path through the game.

### Positional audio

- `Voice.update(listener, posOf)` runs per frame in `src/main.ts` (listener = the camera, i.e. your head in POV; `posOf(id)` = that player's head). It sets the `AudioListener` position, forward and up with `setTargetAtTime` (20 ms smoothing, with the old `setPosition`/`setOrientation` fallback). A player with no known position stays at the listener, i.e. unpositioned.
- Per peer: stream -> volume gain (the per-player slider in the pause menu, `setVolume`/`volumeOf`) -> lowpass -> HRTF `PannerNode` (`inverse` distance model, `VOICE.refDistance` 1.2, `rolloff` 1) -> `master`; plus a reverb send from the panner. *Why* refDistance 1.2: seats are 0.9 to 2.4 m apart, so everyone in the coach is at nearly full volume.
- `distanceMix(d)` (pure, tested): beyond `VOICE.nearM` (3 m) a voice gets duller (lowpass sweeps `lowpassNearHz` 16000 to `lowpassFarHz` 900 exponentially) and wetter (reverb send `wetNear` 0.06 to `wetFar` 0.65), fully at `farM` (10 m), smoothstepped. *Why:* someone who walks or flies away audibly "disappears" instead of just getting quieter.
- The reverb impulse (`impulse`, `VOICE.reverbS` 1.6 s, `reverbDecay` 3.2) is generated decaying stereo noise: no audio file, and a tiled tunnel rather than a cathedral. The Ambience speaker reuses it.
- `addPeer` also creates a muted `<audio>` element and calls `play()`. *Why:* Chrome only feeds a remote WebRTC stream into Web Audio while a media element consumes it.

### Mic HUD

`src/ui/micHud.ts:MicHud` is the bottom-left status while playing, driven from `src/main.ts` (`micHud.update`; hidden while the pause menu is open or, offline, while the mic is not on). States, German strings verbatim:

| Situation | Text |
| --- | --- |
| host disabled voice | `Sprachchat im Raum aus` |
| mic off | `Mikro aus` |
| starting | `Mikro wird gestartet …` |
| permission denied | `Mikro blockiert · im Browser erlauben` (warning) |
| no device | `Kein Mikro gefunden` (warning) |
| other error | `Mikro-Fehler` (warning) |
| muted | `Stumm · M` (warning) |
| push-to-talk, key up | `V halten zum Sprechen` |
| Automatisch, gate closed | `Mikro · Automatisch` (bar shown greyed, `gated`, with the raw level) |
| otherwise | `Mikro` with a live level bar |

The bar uses `micLevel()` (zero when not transmitting) except in the closed-gate case, where `micLevel(true)` shows the raw level so the player can see why it does not open.

### Ambience: channels and map sound kits

`src/audio/ambience.ts:Ambience` is created per map (`new Ambience(voice, seed, mapDef)`; on a map change the old one is disposed and a new one starts held, then released when frames are stable). It implements the `SoundKit` interface (`src/maps/types.ts`) that each map's `MapDef.sound(kit, seed)` receives and returns a `MapSound` (`update(t, power, kmh)`).

Three channels, each with its own gain on the way to a shared `level` node and then `voice.bus`:

| Channel | Node | Gain | Holds |
| --- | --- | --- | --- |
| Ambience | `out` -> `bed` | `settings.ambientVolume` (0.7) | `out`: one-off noises (bell, knock, relay clunk); `bed`: steady layers (rumble, hum, rain, fryer). `quietAmbience` ("Ruhige Umgebung") scales only `bed` to `AMBIENCE.quietBed` (0.2) |
| Music | `music` | `settings.musicVolume` (0.7) | jukebox, the party next door. There is no on/off switch: the slider at 0 is off (the music keeps running silently) |
| Announcements | `announceOut` (stops, calls) and `callOut` (Schaffner) | `settings.announceVolume` (0.8); the Schaffner path never below `SCHAFFNER.minVolume` (0.4) via `announceGain` | gong through a band-limited "ceiling speaker" chain plus room echo (`AMBIENCE.gong`); one chain per path |

- `announce(text, important)` plays the gong, then speaks 1.7 s later through the browser's `speechSynthesis` (`de-DE`, rate 0.95, pitch 0.85, first German voice found). *Why* browser TTS: it is a placeholder, it cannot be routed through Web Audio, so it bypasses the speaker filter and the bus; its volume is `min(1, (announceVolume / 1.5)^2 * 1.5)`, squared because browser speech starts at full loudness and sits on top of everything. Some engines ignore it.
- Suppression in `speak`: the volume is `announceGain(announceVolume, important)`, the slider except for the Schaffner (`important`), who never goes below `SCHAFFNER.minVolume`. Nothing is spoken at volume 0 (ambient announcements are then off) or if `speechSynthesis` does not exist. A map change between gong and speech cancels the line (`disposed`). *Why* the floor: the `Durchsagen` hint says the Schaffner always speaks; at 0 % he would be silent and the Punktabzug would happen unexplained. 0.25 was tried and was inaudible through the speech volume curve above, so the floor is 0.4.
- Hypertrain halt announcements (`src/maps/hypertrain/index.ts`) fire `AMBIENCE.announceAt` (12 s) before the countdown reaches zero, every `announceEveryHalts` (2nd) halt. *Why:* every halt was too chatty over a long evening.
- `Ambience.update` adds a relay clunk (`clunk`) when `power` drops below 0.5 (at most one per 3 s: one clunk per outage, not one per flicker of the stuttering start) and a quieter one once power has stayed above 0.5 for 0.8 s.
- `startedDuring` wraps the map's `sound()` call and records every Web Audio source started meanwhile, by temporarily patching `start` on the node prototypes. *Why:* maps start their endless layers during build and keep no handle; this way `dispose()` can stop all of them on a map change without each map listing its nodes. Only the build is watched, not the per-frame update, since patching prototypes every frame would cost more than it saves, and later sources carry their own stop time.
- `dispose()` fades `level` to 0 in 80 ms (no click), stops the loops and unplugs. Voices share the bus and keep playing through a map change.
- Startup hold: `Voice.holdOutput` mutes the bus while the world builds and shaders compile; `releaseOutput` fades in once `AMBIENCE.stableFrames` (40) consecutive frames came in under `stableFrameMs` (40 ms), or after `maxHoldS` (8 s) (`src/main.ts`, `releases`). *Why:* sound started while the main thread is blocked stutters.
- Per-map kits: each map has its own `sound.ts` (`src/maps/hypertrain/index.ts:sound`, `waschSound`, `hallSound`, `spaetiSound`, `wgSound`, `dinerSound`). All are synthesized from the shared 2 s noise buffer (`kit.noise`, `kit.burst`) and oscillators, quiet by design because they play under voice chat, and timed from the shared clock so one-off events land for everyone at once. Details per map: [maps.md](maps.md).

## Using it

- Settings (see [menu-settings.md](menu-settings.md)): microphone on/off and device, mode (Nur Mundbewegung / Offen / Automatisch / Push-to-talk), threshold (mouth and Automatisch only), mic volume, noise filter (KI / Browser / Aus), echo cancellation, auto gain, voice volume, ambience volume, quiet ambience, music volume, announcement volume (0 = off, except the Schaffner), a test tone (`Voice.testTone`, a two-tone chime at voice volume) and a mic test meter.
- In game: `V` push-to-talk, `M` mute, the bottom-left HUD shows state and level, per-player volume sliders are in the pause menu.

## Options

| Key | Default | Meaning |
| --- | --- | --- |
| `VOICE.gateDb` / `fullDb` | -50 / -18 | Mouth level window |
| `VOICE.refDistance` / `rolloff` | 1.2 / 1 | Panner falloff |
| `VOICE.nearM` / `farM` | 3 / 10 | Distance range for lowpass and reverb |
| `VOICE.vadDefault` / `vadHangMs` / `vadLookaheadS` | 0.5 / 450 / 0.05 | Automatisch and Nur Mundbewegung gate |
| `VOICE.mouthHz` / `mouthStaleMs` | 12 / 500 | `lvl` message rate cap, age after which a received level counts as silence |
| `SCHAFFNER.minVolume` | 0.4 | Lowest announcement volume for the Schaffner's gong and speech |
| `VOICE.highpassHz` / `limiterDb` / `bitrate` | 80 / -6 / 64000 | Outgoing voice |
| `VOICE.pttKey` / `muteKey` | `KeyV` / `KeyM` | Keys |
| `AMBIENCE.quietBed` | 0.2 | Bed share with "Ruhige Umgebung" |
| `AMBIENCE.announceAt` / `announceEveryHalts` | 12 / 2 | Announcement timing |
| `AMBIENCE.stableFrames` / `stableFrameMs` / `maxHoldS` | 40 / 40 / 8 | Startup sound hold |
| `settings.voiceMode`, `micFilter`, `echoCancel`, `autoGain`, `musicVolume`, `announceVolume`, ... | see `src/ui/store.ts` | Player settings, clamped on load |

## Gotchas

- Only create audio nodes in a user-gesture context; a new `AudioContext` made earlier stays suspended.
- A new map sound must start its endless sources inside `sound()` (so `startedDuring` catches them) and route them to `kit.bed`, `kit.music` or `kit.out`, never directly to the bus.
- A new lazy library must be excluded from the `vendor` chunk in `vite.config.ts` or it ends up in the eager bundle.

## Related links

- [maps.md](maps.md): which map plays what.
- [menu-settings.md](menu-settings.md): the audio and microphone settings UI.
- [rendering-scene.md](rendering-scene.md): the listener rides on the camera described there.
- [../architecture/overview.md](../architecture/overview.md): module map, networking.
- [../meta/TERMINOLOGY.md](../meta/TERMINOLOGY.md): vocabulary.
