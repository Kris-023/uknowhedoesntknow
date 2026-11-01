# Changelog

What changed, day by day, newest first (date-based, see the [version policy](claude-instructions/documentation-version-policy.md)). Add a few lines to today's block after each work session; the details belong in the feature pages and in the commits.

## 2026-11-01

- Host transfer ("Host übergeben") from the Esc menu; host epochs decide between two hosts, a host guard asks everyone and survives sleep.
- Recovery after reconnects: missing data is requested again with retries; private per-tab game state in `sessionStorage` (`src/game/tabStore.ts`); every game keeps drafts, votes and cards across a reload.
- Table order counter-clockwise around the table in all games; the first two players face each other on every map.
- Settings v2/v3: regrouped, graphics (glow levels, render brightness, vignette, blur behind menus), comfort (less motion, less flicker, soften blackouts), "Nur Mundbewegung"; card size setting removed.
- Deck editor `npm run listen` (`tools/listen/`, Rust): edits the built-in decks right in the sealed vault (password file or prompt, nothing in plaintext on disk), seals compatible with the browser, and pushes only the vault with a three-way merge against what others pushed meanwhile ([Built-in decks](features/content-decks.md)).
- Docs moved into this public `superdoc/`: project status, decisions 0001/0002 and this changelog replace the former private notes. Public repo hygiene rule added.
- "Stadt, Land, Fluss": new step "Kategorien" before every round (no timer, letter drawn only at the start): reroll, replace from the pool or free text, remove, add, presets "Klassisch" and "Zufall"; the host edits directly, everyone else proposes and the host accepts or rejects (3 open per player, duplicates dropped); "Für nächste Runden behalten"; typed categories can go into an own list. Stadt, Land, Fluss are no longer forced: "Klassisch" is the default while the decks are locked, unlocked rooms start with a random draw. Zug zurück works inside the step but never leads back into it from the writing ([SLF](features/minigames-zeig-ahnungslos-slf.md)).

## 2026-10-31

- Rejoin rebuilt: roster carries hashed tab token and browser id, every peer remembers who left for 30 min, name as fallback, seats held, two hosts after a split agree. Absent players stay in the round; bar "X ist getrennt" with "Ohne X weiterspielen". Checked end to end with three headless browsers over real WebRTC.
- Announcements quieter and rarer, speech follows the slider, 0 = silent. Character editor no longer spins; hair styles Glatze and Mittelscheitel (later reworked as 90s curtains).
- New minigames "Gleich gedacht" (commit/reveal), "Zeig drauf" and "Ahnungslos" (gaze picking, `src/game/gaze.ts`), "Stadt, Land, Fluss" (text or pictures, rating). Game registry in `src/main.ts`.
- Map change inside a running room, scores kept.
- "Eigene Listen": several named lists per kind, shared in the room. Host undo ("Zug zurück") in all six games.
- Built-in decks sealed ([0002](decisions/0002-sealed-decks.md)); old plaintext removed from history. Sealing keeps the salt for the same password.

## 2026-10-29

- Room settings (Schaffner, vote time, blackouts) for the host, also live from the Esc menu.
- Published: public repo and GitHub Pages. Bundle split into three/vendor/game.
- Open questions answered (F4–F10, see [Status](project/status.md)); "Kopfhörer empfohlen" hint in Chromium.
- Minigame "Sag's anders" with teams or free-for-all, challenges, Normal/NSFW/own word decks.
- Maps as modules (`src/maps/`), five new maps: Waschsalon, Bürgeramt, Späti, WG, Diner. Wider seat spacing.
- Sound split into ambience, music and announcement channels; "Ruhige Umgebung". Settings with sub-tabs.

## 2026-10-28

- M2–M7: characters (faces, beards, hair shells, builds, 30+ accessories, outfits), Trystero lobby with host and clock sync, voice mesh with proximity, voice activation, AI noise filter, NPCs and ambience, "Wer bin ich?" with cards over the heads, Schaffner, rejoin, performance work (merged meshes, lean light set), menu and onboarding.
- Mouse: raw pointer lock input, mouse and frame diagnostics in the benchmark.

## 2026-10-27

- Project started. M1: Vite + TypeScript + three.js, coach, neon, deterministic tunnel and shake from the shared clock, debug panel, Pages workflow.
