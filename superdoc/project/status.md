# Project status — goal, milestones, backlog, open questions

Where the project stands and what is still undecided. History of what was done, day by day: [CHANGELOG](../CHANGELOG.md). Decisions with their reasoning: [decisions/](../decisions/README.md).

## Goal

A multiplayer 3D party game in the browser for 2–4 friends, first in a futuristic night-train coach ("Hypertrain"), now in six places. Live head turning, proximity voice chat and minigames. PC and browser only, private rooms by Raumcode only.

Explicitly not: matchmaking, accounts, an own server, mobile.

**Why this shape:**
- Web first (TypeScript, Vite, three.js): friends only open a link.
- Peer to peer over Trystero, deployed on GitHub Pages: no server and no open home address ([0001](../decisions/0001-static-hosting.md)).
- Shared clock + seed: all ambience is deterministic and needs no network traffic ([Shared clock](../features/shared-clock-determinism.md)).

Fixed choices from the brief: three.js, Trystero, host authority, WebRTC mesh voice, Web Audio, no asset files (everything procedural).

## Status

M1–M7 are done and live. The game has six minigames on six maps. A play test with friends is still to come; game rules (F4) are tuned after it.

## Milestones

| Phase | Content | Status |
| --- | --- | --- |
| M1 | Skeleton: Vite/TS, coach, tunnel, neon, shake, debug panel, Pages workflow | done |
| M2 | Characters ("Mensch" style), rig root > torso > head, arm poses, hair, accessories, POV, fake peers | done (the prototype's six other styles dropped, see F6) |
| M3 | Trystero lobby, Raumcode, host, clock sync, live head pose, look sync | done |
| M4 | Voice, proximity with lowpass and reverb, mouth from level | done |
| M5 | NPCs, rolling bottles, stickers, announcements, synthetic sound | done |
| M6 | "Wer bin ich?": cards, secrecy, majority vote, Schaffner, points | done; play test pending |
| M7 | Performance, reconnect, error cases, README | done |

## Backlog (wishes)

| No | Wish | State |
| --- | --- | --- |
| B1 | Cards over the heads easy to read (sharp, framed, readable with zoom) | done: HTML cards over the head instead of a 3D mesh (no bloom, always sharp, frame in seat colour, grows with zoom) |
| B2 | A brighter light preset without losing bloom | done, later replaced by the graphics settings ([Menu and settings](../features/menu-settings.md)) |
| B3 | Loading screen | done |
| B4 | Name and character in the main menu, settings tab, Esc menu, onboarding | done |
| B5 | "Sag's anders" with teams/FFA, challenges, Normal/NSFW/own word lists | done; play test pending |
| B6 | Five more maps: Waschsalon, Bürgeramt, Späti, WG, Diner | done; play test pending |
| B7 | Shared improvements for maps: walking animation; sitting pose for low seats (feet up to 8 cm in the floor on bean bag and sofa); lying pose; hook to freeze NPCs or give them a gaze target (Späti drinker, Waschsalon sleeper do not react); NPC offset instead of lookup by name `npc_N` (Bürgeramt queue); debug trigger for map events (`forcedEventAt`); XXL pokes through the Diner table | open, postponed on purpose |

Known gaps after the reconnect work are listed in [Architecture overview](../architecture/overview.md) ("Remaining reconnect gaps").

## Open questions

Open:

| No | Question | Current answer |
| --- | --- | --- |
| F4 | Rules and points of "Wer bin ich?" (and the other games) | Rules stay until the first play test, then adjust. |
| F8 | Public Nostr relays are partly rate-limited, joining takes ≈ 10 s. Own relay list or other signaling? | Watch; change only if it becomes a problem. |
| F9 | Voice when someone walks away or gets thrown out: needs positions that only moving characters have. | Postponed until a minigame with movement exists. |

Answered (kept for the reasoning):

| No | Question | Answer |
| --- | --- | --- |
| F1 | Folder name not kebab-case | Renamed to `uknowhedoesntknow` (= game name); Hypertrain is the first map. |
| F2 | Repo name and visibility | Public repo, Pages live. |
| F3 | Tunnel distance per client from the speed slider? | Host sends speed changes with a timestamp; distance is the integral (`trainDistance`). |
| F5 | Voices for Schaffner and announcements | Browser TTS stays, without the loudspeaker filter (TTS cannot be routed through Web Audio). |
| F6 | Add the prototype's six other character styles? | No, "Mensch" is enough. |
| F7 | Reconnect after a dropped connection | Tab token and browser id hashes in the roster, every peer remembers who left for 30 min, unique name as fallback (other browser), two hosts after a split agree. Since then extended by host epochs and recovery ([Networking](../features/networking.md)). |
| F10 | Chrome echo cancellation without headphones (play Web Audio over a WebRTC loopback?) | No loopback (more latency and effort); Chromium shows "Kopfhörer empfohlen" when a room has voice chat. |

## Content rules (owner's decisions)

- No real brands, logos or protected characters. *Why:* the repo and the game are public. Examples: the word game avoids a well-known trademarked name; a requested cartoon restaurant was replaced by an own fast-food diner; the Späti has a convenience-store feel without name or logo. One station name that is also a brand is there on purpose (owner's wish).
- "Sag's anders" challenges only by key, no speech recognition. *Why:* it must work in Firefox.
- Map constants live in the map folder instead of `src/config.ts`. *Why:* maps were built in parallel; a deliberate exception to "constants in `src/config.ts`".
