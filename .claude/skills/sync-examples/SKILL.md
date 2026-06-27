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
- **Grammar coverage (constructs → examples).** The `.abide` *template grammar* —
  the control-flow blocks (`{#if}`/`{:elseif}`/`{:else}`, `{#for}` + `{#for await}`,
  `{#await}` incl. `{:finally}`, `{#switch}`, `{#try}`) and the binding/directive
  attributes (`{expr}`, `html`-branded interpolation, `name=`, `on*`, all `bind:`
  forms + `bind:value={{get,set}}`, `class:`, `style:`, `attach`, `{...spread}`) —
  is part of the public surface (AGENTS.md tabulates it, CLAUDE.md mandates the
  section) but it is **not an export**, so the slug→export checklist above cannot
  catch a missing construct. Treat it as its own coverage axis: **every construct
  in AGENTS.md's bindings + control-flow tables must appear in at least one
  kitchen-sink `.abide` file** (those tables are themselves re-derived from
  `parseTemplate.ts` `readAttributes` / `isControlFlow.ts` — the single source).
  `components/page.abide` is the grammar showcase and the home for any construct
  with no natural feature-page (e.g. `{:elseif}`, `class:`); demo it there.

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
README headings. **How many pages a slug spreads across is decided by its band**
— the `[weight N BAND → shape]` annotation `readmeSurfaces.ts` prints beside each
slug (model in `scripts/surfaceWeight.ts`):

- **LIGHT** (`→ share`) — the slug is a section on a shared group page, not its own folder.
- **MEDIUM** (`→ page`) — its own single `<slug>/page.abide`.
- **HEAVY** (`→ section: …`) — a multi-page section: a `<slug>/layout.abide` masthead
  + pill-nav with one subpage per emitted seam. The seams are the buckets after
  `section:` (e.g. `templating → control-flow, bindings, snippets`); a heavy slug
  with no grammar buckets (e.g. `rpc`) uses author-chosen coherent sub-topics.

The band sizes a slug; it does NOT re-home it across nav groups. A slug whose demos
legitimately nest under a sibling section (e.g. `response` under `rpc/`) satisfies
"multi-page" via that section's subpages. `rpc/` is the worked example of this
general rule (its index plus `consume` / `errors` / `respond` / `streaming` /
`request-scope`), whose section title, intro paragraph, and subpage pill-nav live in
one nested `<section>/layout.abide` (e.g. `pages/rpc/layout.abide`), whose `<slot/>`
renders the active subpage below a masthead byte-identical across the section.

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
   delete folders whose slug no longer exists. Read each slug's band from the
   `readmeSurfaces.ts` annotation and make its folder shape match (LIGHT → shared
   section, MEDIUM → `page.abide`, HEAVY → `layout.abide` + a subpage per emitted
   seam). A slug that has crossed into a new band since the last sync is the
   signal to split or merge — e.g. a page that now reads HEAVY must become a
   section.
4. **Rebuild each demo page from the live code, not from its own old text.**
   For every page (and template/scaffold doc-comments), open the
   implementation in `packages/abide/src` and write snippets and prose to
   current behaviour. Trace every runtime claim (modes, defaults, env vars,
   status states, option rows) to the function that implements it.
5. **Run the coverage checklist** from step 1: every non-`plumbing`
   `@documentation` slug has a kitchen-sink demo, and every README option row /
   warning (the three primitives) has one too; flag and delete every demo that
   traces to no current `exports` key. **Then run the grammar-coverage check**
   (below) — the slug checklist does not cover template constructs.
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

   - **Grammar coverage**: every template construct appears in at least one
     kitchen-sink `.abide` file (keep this token list in sync with AGENTS.md's
     bindings + control-flow tables — the parser is the single source). Anything
     `MISSING` is a gap; demo it (orphan constructs go in `components/page.abide`):

     ```sh
     for t in '{#if' '{:elseif' '{:else}' '{/if}' '{#for ' '{#for await' '{/for}' \
       '{#await' '{:then' '{:catch' '{:finally' '{#switch' '{:case' '{:default' \
       '{#try' '{/try}' 'bind:value' 'bind:checked' 'bind:group' 'get, set' \
       'class:' 'style:' 'attach=' '{...' 'scope().state' 'scope().computed' \
       'scope().linked' 'scope().effect' 'html`' '<template name' '<slot'; do
       grep -rqF -- "$t" examples/kitchen-sink --include="*.abide" \
         || echo "MISSING from kitchen-sink: $t"
     done
     ```

     The `scope().*` tokens are also satisfied by the destructure idiom
     (`const { state, computed } = scope()` + bare calls) — treat as covered if
     that form is present.

   - **Band conformance**: every HEAVY slug is a multi-page section (a
     `layout.abide` with subpages), every MEDIUM slug a single `page.abide`. Drift
     = a band that no longer matches the folder shape:

     ```sh
     bun run packages/abide/scripts/readmeSurfaces.ts 2>/dev/null \
       | grep -oE "^  [a-z-]+:.*(MEDIUM|HEAVY) → [a-z]+" \
       | while read -r line; do
           slug=$(echo "$line" | sed -E 's/^ *([a-z-]+):.*/\1/')
           band=$(echo "$line" | grep -oE "MEDIUM|HEAVY")
           dir="examples/kitchen-sink/src/ui/pages/$slug"
           if [ "$band" = "HEAVY" ] && [ ! -f "$dir/layout.abide" ]; then
             echo "BAND DRIFT: $slug is HEAVY but has no $dir/layout.abide (should be a section)"
           fi
           if [ "$band" = "MEDIUM" ] && [ ! -f "$dir/page.abide" ]; then
             echo "BAND DRIFT: $slug is MEDIUM but has no $dir/page.abide"
           fi
         done
     ```

     (A slug nested under a sibling section, e.g. `response` under `rpc/`, is
     exempt — confirm those by eye against the nav grouping.)

   - **Line backstop**: no `page.abide` exceeds 250 lines (`LINE_BACKSTOP`) unless
     it is itself a heavy section's subpage; over-budget = split or trim:

     ```sh
     find examples/kitchen-sink -name "page.abide" -exec wc -l {} \; \
       | awk '$1 > 250 { print "OVER 250 LINES:", $2, "("$1")" }'
     ```

   - Behavioural smoke where one exists (`bun test` in examples with a
     `test/` dir).
