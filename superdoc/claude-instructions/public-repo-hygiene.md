# Public repo hygiene

**Mandatory rule for any agent writing docs, code comments, commit messages or PR text in this repo.** The repo is public: everything you write is published.

## Never include

- **Absolute paths or home directories.** Use repo-relative paths (`src/net/roomCode.ts`).
- **Personal identity.** No usernames, real names, email addresses, git author identities.
- **Machine or network details.** No host names, LAN addresses, or local domains. Example: the dev server's allowed hosts come from an environment variable. Describe the variable and what it does; never write a value.
- **Secrets.** No deck password, room keys, tokens, or environment values.
- **Sealed deck content.** The plaintext of the built-in decks lives only in the gitignored `private/` folder. Never quote, paraphrase at length, or list it anywhere else. Only the sealed `src/words/vault.json` is committed.
- **Local tooling.** Nothing about the AI/agent tooling used on this project, or about the developer's machine setup.

## Rules

- Describe things generically: "an environment variable", "your password", `<your-token>`.
- If a source you read contains such a value, describe it generically; do not copy it.
- When unsure whether something is personal, leave it out and ask.

## Self-check before committing docs

Run this from the repo root; it must print nothing (read any hit, drop false positives such as example placeholders):

```sh
grep -rnE '/home/|/Users/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|\.fr[i]tz\.box|[A-Za-z0-9-]+\.(local|lan)([[:space:]/:]|$)' superdoc/ CLAUDE.md
```

Also read your commit message and PR text once with the same eyes.
