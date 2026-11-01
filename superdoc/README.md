# uknowhedoesntknow — Documentation

A browser party game for up to four players in a 3D night-train coach (and five other places), German UI, peer-to-peer rooms. Start with [architecture/overview.md](architecture/overview.md).

## architecture/ — how the code fits together

- [Overview](architecture/overview.md) — module map, data flow, "where to look for X". **Start here.**

## features/ — what the project does

- [Networking](features/networking.md) — peer-to-peer rooms, room code, host authority, rejoin.
- [Shared clock and determinism](features/shared-clock-determinism.md) — same ambient world on every peer without traffic.
- [Rendering and scene](features/rendering-scene.md) — post-processed night-train look, camera, coach scene.
- [Maps](features/maps.md) — the six places, the map contract, how to add one.
- [Characters](features/characters.md) — procedural people, editor and 3D preview.
- [Voice and audio](features/voice-audio.md) — positional voice chat, synthetic ambience, the Schaffner.
- [Menu, settings and input](features/menu-settings.md) — start screen, Esc menu, persisted settings, mouse look.
- [Minigame framework](features/minigame-framework.md) — the contract every game plugs into.
- [Wer bin ich? / Sag's anders / Gleich gedacht](features/minigames-whoami-sags-gleich.md) — three word-and-guess games.
- [Zeig drauf / Ahnungslos / Stadt, Land, Fluss](features/minigames-zeig-ahnungslos-slf.md) — gaze-pick games and the category game.
- [Built-in decks](features/content-decks.md) — sealed vault, unlocking, sealing.
- [Custom lists](features/custom-lists.md) — Eigene Listen: own words, questions, categories.
- [Debug tools, build and deploy](features/debug-build.md) — URL flags, benchmark, npm scripts, Pages.

## ui/

- [Styling guide](ui/STYLING-GUIDE.md) — theme tokens, component classes, rules.

## claude-instructions/ — mandatory rules for agents

- [Working with the Docs](claude-instructions/documentation.md) — read before you touch, update after you change, record the why.
- [Documentation version policy](claude-instructions/documentation-version-policy.md) — date-based, no version numbers.
- [Public repo hygiene](claude-instructions/public-repo-hygiene.md) — what must never appear in this public repo.

## meta/

- [Terminology](meta/TERMINOLOGY.md) — project vocabulary and the rule to ask about undefined terms.
