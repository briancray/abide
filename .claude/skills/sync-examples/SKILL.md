---
name: sync-examples
description: After a belte API or README change, update every example (and the bundled scaffold template) so they compile, demonstrate the new API, and mirror the README's organisation. Use when the public surface changes (renamed export, moved directory, new helper, new section), when the README's structure shifts, or when example drift is suspected.
---

# Keeping belte examples in sync with the library

`README.md` is the source of truth — **for what the examples demonstrate AND for how they're designed.** Every import path, every directory name, every helper signature, every section title, every term, and the kitchen-sink's page-tree shape comes from the README. If the README and an example disagree, update the example. If the README is wrong, fix it via `write-readme` *first*, then return here.

## Targets

Four trees must all agree with the README:

1. `packages/belte/template/` — what `bunx belte scaffold` ships
2. `examples/scaffold/` — runnable workspace copy of the template (`src/` byte-identical; only `package.json`'s `"belte"` dep differs)
3. `examples/barebones/` — single-page minimum
4. `examples/kitchen-sink/` — feature-rich showcase

## What the README dictates

The README isn't just a list of helpers — it's the design spec for the examples. Specifically:

- **Public surface.** `packages/belte/package.json` `exports` is the authoritative import map; the umbrella entry files (`src/lib/server/index.ts`, `src/lib/browser/index.ts`) list every re-export. Every name in the README must come from there with the exact path shown.
- **Project layout.** The folder tree under the README's "Project layout" section is the layout the examples must use (`src/pages/`, `src/server/rpc/`, `src/server/sockets/`, `$pages` / `$rpc` / `$sockets` / `$lib`, tsconfig extends `belte/tsconfig`).
- **Umbrella structure.** The README's `##` sections per umbrella (`belte/server`, `belte/browser`, future siblings) define the kitchen-sink page-tree shape. The kitchen-sink's URL tree should mirror it — e.g. README's `belte/server → RPC` corresponds to `/server/rpc`, `belte/browser → cache(fn, options?)` to `/browser/cache`.
- **TOC checklist.** The README's TOC table is the kitchen-sink coverage checklist. Every topic listed should have a demonstrating page (or appear inline in the parent umbrella's overview when too small to deserve its own). Reference-only topics (e.g. HTTP cache-control defaults) can live as a table on the umbrella overview rather than a dedicated page.
- **Terminology.** When the README renames something (`belte/route` → `belte/server`, `src/route/` → `src/server/rpc/`, "stream" → "socket"), propagate through imports, file paths, doc-comments inside template/scaffold files (which ship to users as docs), CodeBlock string snippets, h1s, nav links, and any in-page prose.
- **Style choices.** The README's scannability rules — tables for enumerables, short bullets over walls of prose, one minimal example per concept, sentence-case headings, function-shape doc with the declaration — apply to the demo pages too. A kitchen-sink page bloated with a feature the README doesn't mention is drift; trim or upstream it.

## Sync procedure

1. **Re-read the README** — treat its `##` outline + TOC table as the checklist. Note any renames or restructures since the last sync.
2. **Re-derive the public surface** — read `packages/belte/package.json` `exports` and the two umbrella entry files. Anything imported in an example that isn't in this list is stale.
3. **Apply the delta across all four trees** — imports, directory names, type signatures, doc-comments in template/scaffold files (user-facing — keep them current), tsconfig (extends `belte/tsconfig`), package.json scripts.
4. **Reshape the kitchen-sink page tree if needed** — folders + URLs follow the README's umbrella structure. Update `pages/layout.svelte`'s nav, the index page's cards, and the overview pages so a reader can land on a section in the README and navigate straight to a demo.
5. **Template ↔ scaffold parity** — `diff -ruN packages/belte/template/src examples/scaffold/src` should be empty (the generated `.belte/routes.d.ts` excepted; it's gitignored).
6. **Verify** — `bun ../../packages/belte/bin/belte.ts build` exits 0 in each example, the resolver counts match the page tree, `bun --bun tsc --noEmit` is clean in scaffold + kitchen-sink (barebones has no `.ts` files; tsc skips it).

## Style

The repo's `CLAUDE.md` applies; the README's style applies to demo content.

- One export per file, name matches filename.
- `belte/server` for everything declared on the server, `belte/browser` for the html consumer.
- Svelte 5 syntax (`$props`, `$state`, `$derived`, `{@render children()}`).
- Tailwind classes only in kitchen-sink; plain CSS elsewhere.
- Comments in template/scaffold files explain *why* — they're user-facing docs.
- Cross-link demo pages where the README links concepts together (e.g. `subscribe()` mentions the socket primitive — the `/browser/subscribe` page should link to `/server/sockets`).
