---
name: sync-examples
description: After a abide API change, update every example (and the bundled scaffold template) so they compile, demonstrate the current API, and mirror the `@documentation` slug grouping for the kitchen-sink nav (with the README's terminology for the three primitives). Use when the public surface changes (renamed export, moved directory, new helper), when the slug grouping shifts, or when example drift is suspected.
---

# Keeping abide examples in sync with the library

## The only sources of truth

- `packages/abide/src` (with `packages/abide/package.json` `exports`) governs
  **behaviour and public surface**.
- **The `@documentation <slug>` markers** (one above each `exports` target,
  grouped by `bun run packages/abide/scripts/readmeSurfaces.ts`) govern **the
  kitchen-sink page-tree structure and demo coverage**. The slug is a surface's
  documentation section; the script's `sections by group` output is the
  kitchen-sink nav (groups → nav sections, slugs → sections/pages) and the
  coverage checklist (every non-`plumbing` slug has a demo). `AGENTS.md` is the
  same surface set as readable prose (grouped by namespace) — a reference for
  *what each export does*, not the nav spec.
- `packages/abide/README.md` (the npm-shipped README; the repo-root `README.md`
  is a separate, longer file) governs **the three-primitive story and its
  terminology**. It is a *curated human intro*, not an inventory: it documents
  only RPCs, sockets, and components, so it spec's the headline narrative and
  the words used for those three primitives — **not** which surfaces the
  examples must cover. A surface the README omits is not undocumented; it lives
  in the `@documentation` markers / AGENTS.md.

Nothing else is authoritative. **The examples are never a source of truth,
and neither is your own earlier output — including edits you made minutes ago
in this same session.** That an import, a directory, a nav link, a demo page,
or a table already exists in an example is zero evidence it's correct.
Re-derive every answer from the two canonical sources and overwrite. Never
diff an example against itself and patch only the parts that "look changed" —
that is precisely how drift survives.

If the markers / AGENTS.md or the README contradict `packages/abide/src`, the
doc is stale — regenerate it *first* (`bun run packages/abide/scripts/
readmeSurfaces.ts` re-derives the slug grouping and reflows AGENTS.md;
`write-readme` rebuilds the README), then return here. Never reconcile an
example to a doc you believe is wrong, and never reconcile a doc to an example.

## The faithfulness contract — both directions

The docs are terse by design; the examples are where their claims become
running code. Sync means this invariant holds:

- **Coverage (slugs → examples).** Every non-`plumbing` `@documentation` slug
  has a kitchen-sink section, and every export under it has a living demo —
  that is the showcase's job, and the script's `sections by group` output is
  the checklist. The three README primitives (RPCs, sockets, components)
  additionally carry the README's option-table and `>`-warning detail (e.g.
  `ttl: 0`, the `z.coerce` rule); walk those rows and check each off against a
  demo. Slugs the README omits (cache, navigate, mcp, agent, bundle, …) still
  get a kitchen-sink page — keyed off the marker, not the README.
- **No orphans (examples → slugs).** Every example page, nav link, import, and
  demo must trace to a current `exports` key and the `@documentation` slug it
  carries. A demo of something no longer in the surface set is drift — delete
  it; don't keep it because it still builds. **A demo is not an orphan merely
  because the README omits it** — the README covers only three primitives.
  Terminology for the three primitives is the README's, verbatim (if the README
  says `tail`, no example says `subscribe`); terminology for every other
  surface is AGENTS.md's / the source's.

Example pages may use *more words* than the docs (they're teaching material),
but they must never make a claim the source doesn't back, and every runtime
claim still traces to the implementing function in `packages/abide/src`.

## Rebuild, don't patch — and "rebuild" includes structure

Delta-patching lets drift survive because nothing flags the untouched parts:
prose, tables, and — most dangerously — the **folder layout** describing the
old shape go unchanged. A rename propagated as a search-and-replace on import
strings never touches a directory name, a URL, a nav link, or a page-tree
folder. (`cache` moved to `abide/shared`, but `pages/browser/cache/` survived
for months — a folder isn't an import string, so no find-replace ever hit
it.)

Treat every byte as disposable: imports, prose, tables, snippets, **and the
directory tree / page tree / nav.** Re-derive the *shape* from the current
`@documentation` slug grouping (`readmeSurfaces.ts` output) and the live
`exports` map, then make the tree match. Do not assume the current tree is
right just because it builds.

## Multi-page sections share one nested layout

The kitchen-sink page tree maps to the `@documentation` slug groups, not to
README headings (the README has only three) — it *groups* related slugs under
one nav section. When such a section has
subpages (today only `rpc/`: its index plus `consume` / `errors` / `respond`
/ `streaming` / `request-scope`), the section title, intro paragraph, and the
subpage pill-nav live in one nested `<section>/layout.abide`
(e.g. `pages/rpc/layout.abide`), whose `<slot/>` renders the active subpage
below a masthead that is byte-identical across the section.

- **A nested layout, never a per-page component.** abide nests the full layout
  chain — every ancestor `layout.abide` wraps the page outermost-first
  (`shared/layoutChainForRoute.ts`), so a section layout composes *inside* the
  root layout, it does not replace its chrome. This is also the only live demo
  of layout chaining (a `page`-surface guarantee in AGENTS.md), so a sync must
  keep it — don't collapse it back into a component rendered per subpage.
- Pills read active state from `page.url.pathname` (overview = exact match;
  subpages are distinct paths). The layout renders the masthead; each subpage's
  own page title sits in the slot, below the pills.
- **Re-derive the pill list from the `@documentation` slugs that map into the
  section** — same rule as everything else here: the layout's existing array is
  not evidence. Add / rename / drop a pill when the slug set shifts.

One multi-page section deliberately **does not** use this pattern — a sync must
not regularise it into a masthead:

- `pages/` subpages (`boundary`, `product/[id]`) demonstrate page-tree routing
  and dynamic segments themselves, not facets of one concept — no shared subnav.

## Targets

Four trees must all agree with the canonical sources:

1. `packages/abide/template/` — what `bunx abide scaffold` ships (its
   doc-comments ship to users as docs; hold them to the README's terminology)
2. `examples/scaffold/` — runnable workspace copy of the template (`src/`
   byte-identical; only `package.json`'s abide dep differs)
3. `examples/barebones/` — single-page minimum
4. `examples/kitchen-sink/` — feature-rich showcase; its page tree mirrors
   the `@documentation` slug grouping (not the README's three primitives)

## Procedure

Every step re-derives from the canonical sources — never from the example's
existing content.

1. **Run `bun run packages/abide/scripts/readmeSurfaces.ts` fresh** — its
   `sections by group` output (the `@documentation` slug grouping) is the
   kitchen-sink page-tree spec and the demo coverage checklist; consult
   AGENTS.md for what each export does. Then read `packages/abide/README.md` for
   the three primitives' terminology and their option-table rows / `>` warnings
   (the extra detail those three demos carry).
2. **Re-derive the public surface** from `package.json` `exports` and the
   files it points at. Any import, directory, nav link, or URL in an example
   that doesn't trace to a current export is stale — *including the page-tree
   folder it lives in.*
3. **Reshape structure before content.** Make the kitchen-sink page tree,
   `layout.abide` nav, index cards, overview pages, and any nested
   `<section>/layout.abide` masthead/pill-nav (see *Multi-page sections share
   one nested layout*) match the `@documentation` slug grouping. Move or
   delete folders whose slug no longer exists.
4. **Rebuild each demo page from the live code, not from its own old text.**
   For every page (and template/scaffold doc-comments), open the
   implementation in `packages/abide/src` and write snippets and prose to
   current behaviour. Trace every runtime claim (modes, defaults, env vars,
   status states, option rows) to the function that implements it.
5. **Run the coverage checklist** from step 1: every non-`plumbing`
   `@documentation` slug has a kitchen-sink demo, and every README option row /
   warning (the three primitives) has one too; flag and delete every demo that
   traces to no current `exports` key.
6. **Propagate to all four trees** — imports, directory names, type
   signatures, tsconfig, `package.json` scripts.
7. **Template ↔ scaffold parity** — `diff -ruN packages/abide/template/src
   examples/scaffold/src` must be empty (the generated `.abide/routes.d.ts`
   excepted; it's gitignored).
8. **Verify.**
   - `bun ../../packages/abide/bin/abide.ts build` exits 0 in each example;
     `bun --bun tsc --noEmit` clean in scaffold + kitchen-sink (barebones has
     no `.ts` files).
   - Import audit: every `abide/...` (or aliased abide import) across
     the four trees resolves to a current `exports` key:

     ```sh
     grep -rhoE "@abide/abide/[a-zA-Z/-]+" examples packages/abide/template --include="*.ts" --include="*.abide" | sort -u
     ```

   - Behavioural smoke where one exists (`bun test` in examples with a
     `test/` dir).
