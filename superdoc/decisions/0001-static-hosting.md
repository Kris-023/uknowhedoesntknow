# 0001 — Static hosting on GitHub Pages, no own server

Date: 2026-10-27 · Status: accepted

## Context

The game is played by friends from different homes. The brief fixed the shape early: a static client, peer-to-peer networking over Trystero, "no own server, no open home IP". Self-hosting the bundle on a home machine would mean an open port and a public home address for a page that needs no server logic at all.

## Decision

- The client is a static bundle. `.github/workflows/pages.yml` builds it on every push to `main` and deploys it to GitHub Pages ([Debug tools, build and deploy](../features/debug-build.md)).
- No game server, no relay of our own, no backend. Rooms meet through public Nostr relays (Trystero signaling); game data, voice and keys travel peer to peer ([Networking](../features/networking.md)).
- A development machine only runs the Vite dev server for local and LAN tests; nothing of the project is exposed from it.

## Consequences

- The page is public; the only access secret is the Raumcode.
- Everything in the repo and the bundle is public too, which is why the built-in decks are sealed ([0002](0002-sealed-decks.md)).
- Joining depends on the public relays (rate limits, ≈ 10 s to join); see open question F8 in [Status](../project/status.md).
- Self-hosting a copy later would be a new decision.
