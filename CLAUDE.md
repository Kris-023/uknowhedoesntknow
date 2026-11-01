# uknowhedoesntknow

Browser party game for up to four players in a 3D night-train coach, German UI, peer-to-peer rooms (Trystero/WebRTC, no game server). Stack: Vite, TypeScript, three.js. The repo is public.

<!-- superdoc:start v2 -->
## Docs: read before you touch, update after you change

Full discipline — what to read, when to update, how to record the *why* — lives in the
always-loaded `superdoc/claude-instructions/documentation.md` below; this is a pointer, not
a restatement.

Reference docs — plain links, read the one relevant to your task on demand:

- **`superdoc/architecture/overview.md`** — codebase navigation map (module map, data flow,
  "where to look for X"). **Start here to navigate the code.**
- Per-feature behaviour — `superdoc/features/`
- Styling rules — `superdoc/ui/STYLING-GUIDE.md`
- Status, backlog, open questions — `superdoc/project/status.md`; decisions — `superdoc/decisions/`;
  changelog — `superdoc/CHANGELOG.md` (add a few dated lines after each work session)
- `superdoc/README.md` — the docs table of contents

## Always in context (force-loaded, mandatory)

`@` is reserved for the must-always-know set. Everything above is a plain link: an
optional, on-demand read.

- **Terminology** — @superdoc/meta/TERMINOLOGY.md — project vocabulary; use these meanings,
  ask before acting on an undefined term, and keep it current.
- **Documentation discipline** — @superdoc/claude-instructions/documentation.md — read
  before you touch, update after you change, record design rationale (the *why*).
- **Version policy** — @superdoc/claude-instructions/documentation-version-policy.md — date-based,
  no version numbers.
- **Public repo hygiene** — @superdoc/claude-instructions/public-repo-hygiene.md — never put
  personal, system or secret information into docs, code, commits or PR text.

Path base: `CLAUDE.md` uses repo-root-relative paths (`@superdoc/...`, `` `superdoc/...` ``);
links *inside* docs are docs-relative. Precedence: `CLAUDE.md` is authoritative for
rules, docs are the reference — reconcile to `CLAUDE.md` on conflict. `@`-budget:
force-load a file only if its absence would let the agent do the wrong thing on *any*
task.
<!-- superdoc:end -->
