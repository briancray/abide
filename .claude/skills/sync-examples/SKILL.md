---
name: sync-examples
description: After a belte API or README change, update every example (and the bundled scaffold template) so they compile, demonstrate the new API, and mirror the README's organisation. Use when the public surface changes (renamed export, moved directory, new helper, new section), when the README's structure shifts, or when example drift is suspected.
---

# Keeping belte examples in sync with the library

## The only sources of truth

- `packages/belte/src` (with `packages/belte/package.json` `exports`) governs **behaviour and public surface**.
- `README.md` governs **structure and scope** — section layout, page-tree shape, terminology.

Nothing else is authoritative. **The examples are never a source of truth, and neither is your own earlier output — including edits you made minutes ago in this same session.** That an import, a directory, a nav link, or a table already exists in an example is zero evidence it's correct. Re-derive every answer from the two canonical sources and overwrite. Never diff an example against itself and patch only the parts that "look changed" — that is precisely how drift survives.

If the README itself is wrong, fix it with `write-readme` *first*, then return here. Don't reconcile an example to a README you believe is stale.

## Rebuild, don't patch — and "rebuild" includes structure

Delta-patching lets drift survive because nothing flags the untouched parts: prose, tables, and — most dangerously — the **folder layout** describing the old shape go unchanged.

The trap is structural. A rename propagated as a search-and-replace on import strings never touches a directory name, a URL, a nav link, or a page-tree folder. So the imports move while the structure silently keeps the old shape. (`cache` moved to `belte/shared`, but `pages/browser/cache/` survived for months — a folder isn't an import string, so no find-replace ever hit it.)

Treat every byte as disposable: imports, prose, tables, snippets, **and the directory tree / page tree / nav.** Re-derive the *shape* from the README's section structure and the live `exports` map, then make the tree match. Do not assume the current tree is already right just because it builds.

## Targets

Four trees must all agree with the canonical sources:

1. `packages/belte/template/` — what `bunx belte scaffold` ships
2. `examples/scaffold/` — runnable workspace copy of the template (`src/` byte-identical; only `package.json`'s `"belte"` dep differs)
3. `examples/barebones/` — single-page minimum
4. `examples/kitchen-sink/` — feature-rich showcase

## Procedure

Every step re-derives from the canonical sources — never from the example's existing content.

1. **Read the README fresh.** Its section outline is the kitchen-sink page-tree spec; its style rules govern demo prose. Note every rename or restructure.
2. **Re-derive the public surface** from `package.json` `exports` and the files it points at. Any import, directory, nav link, or URL in an example that doesn't trace to a current export is stale — *including the page-tree folder it lives in.*
3. **Reshape structure before content.** Make the kitchen-sink page tree, `layout.svelte` nav, index cards, and overview pages match the README's current section structure. Move or delete folders that no longer map to a section; don't carry one forward just because it exists.
4. **Rebuild each demo page from the live code, not from its own old text.** For every kitchen-sink page (and the doc-comments in template/scaffold files — they ship to users as docs), open the implementation in `packages/belte/src` and write the snippets, tables, and prose to match current behaviour. Trace every runtime claim (modes, defaults, env vars, status states, option rows) to the function that implements it and confirm it still holds.
5. **Propagate to all four trees** — imports, directory names, type signatures, tsconfig, `package.json` scripts.
6. **Template ↔ scaffold parity** — `diff -ruN packages/belte/template/src examples/scaffold/src` must be empty (the generated `.belte/routes.d.ts` excepted; it's gitignored).
7. **Verify** — `bun ../../packages/belte/bin/belte.ts build` exits 0 in each example; `bun --bun tsc --noEmit` is clean in scaffold + kitchen-sink (barebones has no `.ts` files; tsc skips it).
