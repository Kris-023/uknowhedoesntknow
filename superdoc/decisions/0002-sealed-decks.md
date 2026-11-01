# 0002 — Built-in decks only sealed in the repo

Date: 2026-10-31 · Status: accepted

## Context

Repo and Pages bundle are public ([0001](0001-static-hosting.md)). The built-in word cards, questions and categories (Normal and NSFW) were plain text in `src/words/`. The owner wants them unreadable both on GitHub and in the deployed game. A hash does not work, because the game has to show the words; anything the game can decrypt without a secret, anyone can decrypt with the browser's developer tools.

## Decision

- Plaintext lives only in the gitignored `private/content/` folder of the maintainer.
- The repo carries only `src/words/vault.json`: AES-256-GCM, key from a password via PBKDF2-SHA256 (600 000 iterations). The seal script reads the password only from a file outside the project, never from arguments or a prompt. Same password → same salt (fresh IV), so remembered keys keep working after a content update.
- In the game, the password is entered once under **Eigene Listen** → **Eingebaute Stapel**. Only the derived key is stored (localStorage); in a room it goes peer to peer to the others (`src/game/roomKey.ts`), never into public game state. Locked: a small public fallback deck (`src/words/fallback.ts`), NSFW unavailable.
- Custom lists (**Eigene Listen**) stay as they were: only in the browser and shared P2P in the room, never on GitHub.
- The old plaintext files were removed from every commit by a history rewrite on 2026-10-31 (owner's decision), followed by a force push and deleting old CI runs and build artifacts.

## Consequences

- Updating content: edit `private/content/`, `npm run seal`, `npm run seal:check`, commit only `vault.json` ([Built-in decks](../features/content-decks.md)).
- Whoever is unlocked has the key in the browser: the protection is against the repo and the bundle, not against fellow players.
- In "Ahnungslos" the host code knows word and roles (independent of this decision).
- Without the password and `private/content/` the decks are lost: keep the password in a password manager.
- Copies from before the rewrite (clones, forks, caches) cannot be recalled.
- A new password means sealing again; everyone unlocks once more.
