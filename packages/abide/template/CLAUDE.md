# Project guide for Claude

This app is built with **abide** — a type-safe isomorphic framework on Bun.

**Before working with any abide API, read the complete surface map:**
`node_modules/@abide/abide/AGENTS.md` — every export (with import path + signature),
the file-based conventions, the CLI, env vars, and the `.abide` component grammar.
Open the source under `node_modules/@abide/abide/src/lib/` for depth; the README is
at `node_modules/@abide/abide/README.md`.

> Tip: to keep that map permanently in context instead of reading it on demand,
> replace the line above with an import: `@node_modules/@abide/abide/AGENTS.md`

## Conventions (see AGENTS.md for the full list)

- One export per file, named after the file. No barrels — import each name by its
  own path (`@abide/abide/server/GET`, `@abide/abide/shared/cache`, …).
- RPC verbs live in `src/server/rpc/<name>.ts`; sockets in `src/server/sockets/`;
  pages are `**/page.abide`, layouts `**/layout.abide`.
- Generated types land in `src/.abide/` — do not hand-edit them; run `abide dev`/
  `abide check` to regenerate.
- Prefer Bun and web-standard APIs over Node APIs.
