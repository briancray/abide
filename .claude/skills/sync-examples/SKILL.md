---
name: sync-examples
description: After a belte API or README change, update every example (and the bundled scaffold template) so they compile, demonstrate the new API, and mirror the README's organisation. Use when the public surface changes (renamed export, moved directory, new helper, new section), when the README's structure shifts, or when example drift is suspected.
---

# Keeping belte examples in sync with the library

## READ FIRST

* **Rebuild, don't patch.** Regenerate each example's content from the current source of truth instead of diffing against what's there and editing only the parts you think changed. Delta-patching is how drift survives: prose and tables describing old behaviour go untouched because nothing flagged them. Treat the existing example content as disposable — re-derive it, then overwrite. This is the same discipline `write-readme` uses ("don't use the current README, rebuild completely").
* **Two sources of truth, two jobs.**
  * `README.md` governs **structure and scope** — every import path, directory name, helper signature, section title, term, and the kitchen-sink's page-tree shape. If the README and an example disagree on shape, the example is wrong. If the README itself is wrong, fix it via `write-readme` *first*, then return here.
  * `packages/belte/src` governs **behaviour** — every explanatory table, prose claim, and code snippet in a demo page must describe what the code actually does *now*, read fresh from the source, not copied forward from the old page. (The bundle "Launch modes" table drifted precisely because it was carried over instead of re-derived from `controlServerWorker.ts`.)

## Targets

Four trees must all agree with the README:

1. `packages/belte/template/` — what `bunx belte scaffold` ships
2. `examples/scaffold/` — runnable workspace copy of the template (`src/` byte-identical; only `package.json`'s `"belte"` dep differs)
3. `examples/barebones/` — single-page minimum
4. `examples/kitchen-sink/` — feature-rich showcase

## What the README dictates

The README isn't just a list of helpers — it's the design spec for the examples. Specifically:

- **Public surface.** `packages/belte/package.json` `exports` is the authoritative import map. Every public name has its own path — `belte/server/<name>` and `belte/browser/<name>`. No barrels: never `import { X, Y } from 'belte/server'`, always `import { X } from 'belte/server/X'`. The files under `src/lib/server/*.ts` and `src/lib/browser/*.ts` enumerate the public names.
- **Project layout.** The folder tree under the README's "Project layout" section is the layout the examples must use (`src/pages/`, `src/server/rpc/`, `src/server/sockets/`, `$pages` / `$rpc` / `$sockets` / `$lib`, tsconfig extends `belte/tsconfig`).
- **Umbrella structure.** The README's `##` sections per umbrella (`belte/server`, `belte/browser`, future siblings) define the kitchen-sink page-tree shape. The kitchen-sink's URL tree should mirror it — e.g. README's `belte/server → RPC` corresponds to `/server/rpc`, `belte/browser → cache(fn, options?)` to `/browser/cache`.
- **TOC checklist.** The README's TOC table is the kitchen-sink coverage checklist. Every topic listed should have a demonstrating page (or appear inline in the parent umbrella's overview when too small to deserve its own). Reference-only topics (e.g. HTTP cache-control defaults) can live as a table on the umbrella overview rather than a dedicated page.
- **Terminology.** When the README renames something (`belte/route` → `belte/server`, `src/route/` → `src/server/rpc/`, "stream" → "socket"), propagate through imports, file paths, doc-comments inside template/scaffold files (which ship to users as docs), CodeBlock string snippets, h1s, nav links, and any in-page prose.
- **Style choices.** The README's scannability rules — tables for enumerables, short bullets over walls of prose, one minimal example per concept, sentence-case headings, function-shape doc with the declaration — apply to the demo pages too. A kitchen-sink page bloated with a feature the README doesn't mention is drift; trim or upstream it.

## Sync procedure

1. **Re-read the README** — treat its `##` outline + TOC table as the checklist. Note any renames or restructures since the last sync.
2. **Re-derive the public surface** — read `packages/belte/package.json` `exports` and the two umbrella entry files. Anything imported in an example that isn't in this list is stale.
3. **Reshape the kitchen-sink page tree to the README** — folders + URLs follow the README's umbrella structure. Update `pages/layout.svelte`'s nav, the index page's cards, and the overview pages so a reader can land on a section in the README and navigate straight to a demo.
4. **Rebuild each demo page's content from the live code, not from itself.** For every kitchen-sink page (and the doc-comments in template/scaffold files — they ship to users as docs), open the actual implementation in `packages/belte/src` for the feature it demonstrates and write the page's snippets, tables, and prose to match that code's current behaviour. Do not trust the existing page text. Where a page describes runtime behaviour (modes, defaults, env vars, status states), trace it to the function that implements it and confirm every row still holds. Carry the same renames through imports, file paths, CodeBlock strings, h1s, nav links, and in-page prose.
5. **Apply the structural delta to all four trees** — imports, directory names, type signatures, tsconfig (extends `belte/tsconfig`), package.json scripts must match the re-derived public surface across template, scaffold, barebones, and kitchen-sink.
6. **Template ↔ scaffold parity** — `diff -ruN packages/belte/template/src examples/scaffold/src` should be empty (the generated `.belte/routes.d.ts` excepted; it's gitignored).
7. **Verify** — `bun ../../packages/belte/bin/belte.ts build` exits 0 in each example, the resolver counts match the page tree, `bun --bun tsc --noEmit` is clean in scaffold + kitchen-sink (barebones has no `.ts` files; tsc skips it).

## Style

The repo's `CLAUDE.md` applies; the README's style applies to demo content.

- One export per file, name matches filename.
- One import path per name: `belte/server/<name>`, `belte/browser/<name>`. Never the bare namespace.
- Svelte 5 syntax (`$props`, `$state`, `$derived`, `{@render children()}`).
- Tailwind classes only in kitchen-sink; plain CSS elsewhere.
- Comments in template/scaffold files explain *why* — they're user-facing docs.
- Cross-link demo pages where the README links concepts together (e.g. `subscribe()` mentions the socket primitive — the `/browser/subscribe` page should link to `/server/sockets`).
