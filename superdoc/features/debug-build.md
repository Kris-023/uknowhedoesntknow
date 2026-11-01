# Debug tools, build and deploy — URL flags, benchmark, npm scripts, Pages

How to inspect the running game (debug panel, URL parameters, benchmark with frame and mouse recorders) and how the project is developed, built, tested and published.

## How it works

### URL parameters

All parsed once at the top of `src/main.ts` (`params`, `seedParam`, `debug`).

| Parameter | Effect | Available |
| --- | --- | --- |
| `?debug` | shows the debug panel (toggle with ^ or backtick) | always; the panel is also on in the Vite dev server (`import.meta.env.DEV`) |
| `?seed=N` | skips the menu and launches a deterministic solo scene straight away: `SharedClock(+seedParam \| 0, …)`, no session, camera `wagon` | always, also in production |
| `?voteS=N` | stretches "Wer bin ich?" votes to N seconds (`devVoteS`, passed to `WhoamiGame`) | dev server only; `?debug` does not enable it |

*Why:* `?seed` exists for screenshots and reproducible bug reports, because the whole world (tunnel, flicker, fake passengers) is generated from one seed that a normal joiner only learns from the host's welcome. `?voteS` exists so slow test browsers (several tabs on one machine) do not run out of vote time; it is deliberately not reachable in production, where the host's `voteS` room option (`src/config.ts:ROOM`) rules.

### Debug panel

- `src/debug/panel.ts:DebugPanel` is a floating overlay. It is always constructed (it holds `state`: train speed, "Meine Sicht" flag, camera mode) but only attached to the page when its `enabled` argument (the `debug` flag) is true, and starts hidden. The keydown listener for `^`, backtick or `Backquote` toggles it.
- Contents, top to bottom: camera (`Wagen` / `POV`), `Ich bin` (switch which seat you control), view (`Bild` / `Meine Sicht`) with a colour legend, train speed (`Tempo`), two toggles `Weniger Bewegung` and `Leuchten` (standard/aus; they edit the same `settings` values as the Esc menu through `updateSettings`/`onSettings`), `Ausfall testen` (forces a blackout), head test tools (`Kopf` slider, `Seitenblick`, `Alle reden`), accessories for the local player including the dice buttons, render stats (draw calls, triangles, fps, clock, halt countdown, power), and the scene tree.
- **"Meine Sicht"** (`src/debug/sight.ts:setSightMode`): swaps the material of every mesh whose `userData.role` is set for a wireframe in a role colour (`struct`, `light`, `player`, `npc`, `prop`, `outside`; `fx` is invisible) and changes background and fog colour. The original material is cached in `userData.orig` and restored when turned off. It shows the scene as structure rather than picture. `main.ts` also switches bloom off while it is on (`applyRender`) and re-applies the mode to the new scene on a map swap. Meshes need a role tag from `src/scene/build.ts` to take part.
- **Scene tree** (`src/debug/sceneTree.ts:sceneTree`): text tree two levels deep with mesh and triangle counts per node; numbered siblings (`seat_1` … `seat_16`) collapse into one line so the list stays readable with NPCs and players present. `main.ts` hands it to the panel as `tree`.

### Benchmark mode and its recorders

- Entry: main menu `Einstellungen` -> `Grafik` -> `Benchmark starten` (a `bench` `LobbyChoice`, built by `MainMenu.settingsExtra`). It launches the solo scene with simulated passengers (`launch(..., bench = true)`) and adds `src/ui/benchPanel.ts:BenchPanel` as a side panel. There is no pause menu in this mode: the panel is the menu (`Beenden` returns to the start screen).
- `BenchPanel` shows live stats (`FPS jetzt`, `Ø 5 s`, `1 % Low`, `Min 5 s`, `Verworfen 5 s`, draw calls, GPU ms, render resolution) from a rolling 5 s window (`FrameStats`), and embeds a `SettingsView` limited to `gfx` and `input`, so each setting's cost shows immediately. The report header lists the graphics settings in effect: `Leuchten`, `Renderhelligkeit`, `Vignette`, resolution.
- **Mundbewegung testen** (toggle in `BenchPanel`, only when the voice engine exists; logic `src/main.ts:setMicBots`): your own mic level, run through `gateStep` with your `Schwelle` and the 450 ms hang, drives the mouths of all bots (`Players.botLevel`, solo only; `Voice.micLevel(true)` is the raw level). It starts the mic if needed and stops it only if the toggle started it. If the mic is denied the toggle snaps back to `Aus` with a hint. `Beenden` reloads the page, so nothing needs undoing. *Why:* to check the mouth animation (and the `Nur Mundbewegung` level path) alone, without a second player.
- **Frame trace** (`src/debug/frameTrace.ts:FrameTrace`): `Ruckler aufzeichnen (60 s)`. Per frame it stores frame duration, main-thread work inside the frame callback, draw calls, scene tags (blackout, oncoming train, announcement, `GC` …) and a GPU cell. `report` builds a German plain-text report to paste into a chat: fps, 1 % and 0.1 % low (`lowFps`), dropped frames (`droppedFrames`), spike list, per-second table, and for each tag the spike rate with versus without it. *Why:* frame time against work time tells stutters apart. A long frame with little work happened outside our loop (GPU, compositor, browser); a long frame full of work is our own code or garbage collection.
- **Mouse trace** (`src/debug/mouseTrace.ts:MouseTrace`): `Maus aufzeichnen (15 s)`. Records the whole path mouse -> look target -> smoothed head -> camera: `mousemove` (with coalesced-event sums), `pointerrawupdate`, and per-frame yaw values; `report` compares the channels in 100 ms slices. Timestamps come from `performance.now()` in the handler, not `event.timeStamp`. *Why:* Zen/Firefox returned unusable stamps (first report was all -9.2e15). `MouseTrace.lockMode` is a static string set by `main.ts:lockMouse` and printed in the header. The mouse input side is in [menu-settings.md](menu-settings.md).
- **GPU timer** (`src/debug/gpuTimer.ts:GpuTimer`): `EXT_disjoint_timer_query_webgl2` queries wrapped around the frame render (`begin`/`end`, results arrive a few frames later and fill a `GpuCell`; `poll` collects them and drops everything on a disjoint event). `GpuTimer.create` returns `null` where the extension is missing (Firefox, Safari), and the panel then shows `n. v.`. Only created in benchmark mode.
- **Heap watch** (`src/debug/gpuTimer.ts:HeapWatch`, same file): derives a "GC" tag from drops of `performance.memory.usedJSHeapSize`. Normal Chrome rounds that counter and refreshes it rarely, so the tag only means something when the browser runs with `--enable-precise-memory-info`; `precise` tells the report which case it is.
- Both recorders use `BenchPanel.recorder`: record for N seconds, then show the report in a read-only textarea with a copy button.

### Build, scripts and tests

| Script | What |
| --- | --- |
| `npm run dev` | Vite dev server on port 5190 (`strictPort: false`, so it moves up if taken) |
| `npm run dev:lan` | `vite --host --mode lan`: reachable on the LAN, over HTTPS with a throwaway self-signed certificate |
| `npm run build` | `tsc --noEmit && vite build` into `dist/` |
| `npm run preview` | serve the built `dist/` |
| `npm test` | `vitest run` (tests in `tests/`, including `seal-script.test.mjs`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seal` | seal `private/content/` into `src/words/vault.json` (see below) |
| `npm run seal:check` | verify that the committed vault opens with the local password |

- **`dev:lan` is HTTPS on purpose.** `vite.config.ts` adds `@vitejs/plugin-basic-ssl` only when `mode === 'lan'`. *Why:* Trystero needs WebCrypto, which browsers expose only in secure contexts (https or `localhost`), not on `http://<LAN-IP>`. Without it, a second machine could load the page but could not create or join a room (the menu says so, see [menu-settings.md](menu-settings.md)). The browser warns once about the self-signed certificate. Vite rejects unknown `Host` headers as a DNS-rebinding guard, so a LAN host name used to reach the dev server has to be allowed explicitly: `server.allowedHosts` in `vite.config.ts` comes from the environment variable `UKHDK_ALLOWED_HOSTS` (comma-separated host names, read through Vite's `loadEnv`, so a shell variable or a git-ignored `.env.local` both work; unset means Vite's default host check). Usage: `UKHDK_ALLOWED_HOSTS=<your-host-name> npm run dev:lan`. *Why:* the host name is machine-specific and must not be committed to a public repo.
- **`base: './'`.** *Why:* a relative base lets the same bundle work under any GitHub Pages path (`/<repo>/`) with no per-repo configuration.
- **TypeScript:** `tsconfig.json` is strict with `noUnusedLocals`/`noUnusedParameters`, target ES2022, `moduleResolution: bundler`, `noEmit` (Vite builds, `tsc` only checks), includes `src` and `tests`. The build target is `es2022`.
- **Chunk split** (`build.rolldownOptions.output.codeSplitting.groups` in `vite.config.ts`): `three` (everything under `node_modules/three`), and `vendor` (all other `node_modules` except `@sapphi-red`). *Why:* libraries change far less often than game code, so separate chunks stay cached across deploys; the noise suppressor is loaded on demand and is kept out of the eager vendor chunk. `chunkSizeWarningLimit` is 600 kB because three alone is about 570 kB minified and cannot be split further.
- **Test config:** `vite.config.ts` sets `test.exclude` to Vitest's defaults plus a tooling folder, so only this project's own tests run. *Gotcha:* a checkout (git worktree) that itself lives inside that excluded folder finds no tests with plain `vitest run`, because every file path matches the exclude. Run vitest there with a throwaway config file that sets an absolute `root` (the checkout's directory) and the same `test` settings without the exclude.

### Sealed content check

- `scripts/seal-content.mjs` encrypts the plaintext deck files in `private/content/` (git-ignored) into `src/words/vault.json` with AES-256-GCM, key from PBKDF2-SHA256 (600 000 iterations) over a password. The password is read only from a file (`$UKHDK_DECK_PASS_FILE`, else a default file in the user's config directory), never from argv or stdin, and never printed. *Why:* argv shows up in process lists and shell history.
- `npm run seal:check` (`--check`) decrypts the committed vault with the local password and prints counts only. Use it before committing a changed vault. `--content <dir>` and `--out <file>` let tests run the script on fixtures.
- Neither CI nor `npm test` needs the password; CI never runs `seal:check`. Changing the password makes every player unlock once more, since browsers keep the derived key. Deck behaviour in the UI: [custom-lists.md](custom-lists.md).

### CI and deploy

- `.github/workflows/pages.yml` ("Pages") runs on every push to `main` and on manual dispatch. Job `build`: checkout, Node 22 with npm cache, `npm ci`, `npm test`, `npm run build`, then `actions/configure-pages` and `actions/upload-pages-artifact` with path `dist`. Job `deploy` (needs `build`, environment `github-pages`) runs `actions/deploy-pages`. Concurrency group `pages` cancels older runs. Permissions: `contents: read`, `pages: write`, `id-token: write`.
- A failing test or type error stops the deploy, because `build` runs tests first and `npm run build` type-checks first.
- One-time repo setting: Settings -> Pages -> Source: GitHub Actions.
- The deployed site is public; a room is protected only by its code (see [menu-settings.md](menu-settings.md) for the invite link and [../architecture/overview.md](../architecture/overview.md)).

## Using it

1. Develop: `npm install`, `npm run dev`, open `http://localhost:5190`.
2. Test with other machines: `npm run dev:lan`, open `https://<LAN-IP>:5190`, confirm the certificate warning once.
3. Look at the scene: add `?debug` (or use the dev server) and press ^. Reproduce a scene: `?seed=1234`.
4. Tune performance: `Einstellungen` -> `Grafik` -> `Benchmark starten`, change settings live, record a 60 s `Ruckler` report (play through a blackout, an oncoming train and an announcement) or a 15 s `Maus-Diagnose` report (move slowly, then normally, then in jerks) and paste it where it is needed. In the benchmark, T picks the minigame and G starts a test round against bots (`KEYS` in `src/game/lobby.ts`).
5. Before pushing: `npm test` and `npm run build`. Push to `main` deploys.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `server.port` | 5190 | dev server port; `strictPort: false` allows fallback |
| `base` | `./` | relative asset base for any Pages path |
| `build.target` | `es2022` | matches `tsconfig` target |
| `build.chunkSizeWarningLimit` | 600 | kB; three is about 570 kB |
| `UKHDK_DECK_PASS_FILE` | unset | password file for `seal` / `seal:check` |
| `UKHDK_ALLOWED_HOSTS` | unset | comma-separated host names the dev server accepts (`server.allowedHosts`); unset = Vite default |

## Related links

- [menu-settings.md](menu-settings.md) — mouse lock, settings view, benchmark entry
- [rendering-scene.md](rendering-scene.md) — scene roles and render pipeline the panel inspects
- [custom-lists.md](custom-lists.md) — sealed decks in the UI
- [../architecture/overview.md](../architecture/overview.md)
- [../meta/TERMINOLOGY.md](../meta/TERMINOLOGY.md)
