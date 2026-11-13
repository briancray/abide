# abide

An isomorphic, type-safe framework for reactive async interfaces — for humans and for machines —
built on Bun and web standards.

Same callable, same name, same *intent* on both sides. A reactive value is read and written BY NAME
inside a `.abide` file, and the explicit `x()` / `x.set(v)` spelling keeps compiling: the sugar
is over it, never instead of it.

Status: **pre-1.0**. `@abide/abide` is published and its surface still changes between minor
versions. `docs/REGISTRY.md` is every name an app writes, and `docs/RULEBOOK.md` is every rule
those names are held to.

## Start an app

    bunx @abide/abide scaffold my-app
    cd my-app && bun install && bun run dev

The installed package carries its own documentation in `node_modules/@abide/abide/docs/`:
`abide.md` (every docs page, in reading order), `REGISTRY.md` and `RULEBOOK.md`. A message ending
in `RULEBOOK 23.16.` names a clause in that file. The scaffold's `CLAUDE.md` imports
`node_modules/@abide/abide/ABIDE.md`, its `AGENTS.md` points any other coding agent at the same file,
and `ABIDE.md` points at all three. `bun run check` runs `abide check`, the type checker over `.abide` files — `tsc`
does not read them.

## Layout

    packages/abide      the framework
    packages/harness    @abide/harness: the measurement lanes everything is tested and measured with
    packages/dogfood    the documentation app, and the app abide is dogfooded on
    packages/bridge     @abide/bridge: abide-bridge, the CLI that connects Claude Code to an abide site

`abide` is split by seam — `#shared`, `#ui`, `#server` — and those seams are what
framework-internal code imports through. An app resolves `@abide/abide`, `@abide/abide/server` and
`@abide/abide/test` instead, and `@abide/abide/runtime` is what its compiled bundles import.

`@abide/harness` measures anything, abide included: nothing it ships reaches abide, which is what
lets the hand-written arm of a ratio be timed by the same clock and the same batch sizing as the
abide arm, and what lets an app measure itself with it. What measures abide lives with abide, in
`packages/abide/bench` and `packages/abide/e2e`. The harness is split by DEPENDENCY:

| lane | answers | substrate |
| --- | --- | --- |
| `@abide/harness/measure` | DOM calls, from inside the page | bun **and** browser |
| `@abide/harness/engine`  | what Blink did — style, layout, paint, per-layer shares | chromium, over CDP |
| `@abide/harness/server`  | bytes, microtask turns, allocations | bun |

## Brand

`docs/BRAND.md` is to the marketing surface what `docs/REGISTRY.md` is to the code: the claims
that may be made, what each one rests on, the words that name things, and the ones that are
off limits until something is measured. A claim whose supporting row changes is a claim that
goes.

## Documentation

THE DOCS ARE AN ABIDE APP, written the way an app author writes one: `packages/dogfood` (the
`abide-docs` package) is served by `abide dev` and built by `abide build`.

    bun run dev           abide dev, on PORT or :3000
    bun run build         abide build
    bun run --filter abide-docs bundle    the docs as a native app (macOS)

- The docs are a REFERENCE: one page per primitive, at `/<group>/<primitive>`, grouped by what it is
  for. `src/lib/SITE.ts` is the site map: every group, and every page's title, nav label, one-line
  description and the REGISTRY section whose rows it carries (40.11, 40.42). The home page lists
  every group with each page's description.
- Each page is a hand-written `index.abide` wrapped in `<Doc>`, with its headings as `<Section>`s,
  its code as `<Code>` and `<Snippet>`, its live examples as `<Example>` cards, and its REGISTRY
  rows last, read from `docs/REGISTRY.md` as it renders (`<Registry />`, 40.30, 40.47).
- Every card is drawn from ONE EXAMPLE APP, a CRM at `packages/dogfood/examples/crm`, which
  `/examples/crm.tar.gz` serves as a download (40.41). A card renders a component from the CRM's
  `lib/` and shows its files, its tests and its bench; a test or bench tab renders what that file
  last reported (40.39), kept by `bun run examples:results`. The docs app mounts each of the CRM's
  feature directories at the address the CRM serves it at, so a card's requests reach the CRM's own
  handlers (40.37).
- THE PROMPT AT THE TOP asks the visitor's own Claude Code, paired through `@abide/bridge` (and
  paired already in the native app), with the docs as its only tools — `src/ask/tools/*` search the
  pages, REGISTRY and RULEBOOK, read a page, a clause or a CRM file, and list the cards (40.44). Its
  answer streams through `src/ask/answer.handler.ts`, which renders the markdown block by block, and
  a `<show …/>` line in it renders live: a running example card, a CRM file, a signature, a clause,
  measured results, a link to a page, or the page under the answer opened (40.46, 40.48).
- Every page is also served as markdown at its address with `.md` on the end, and `/abide.md` is
  every page in reading order — derived from the rendered page by `src/lib/serveDownloads.ts`,
  so the words have one home (40.33).

`bun test` gates the docs against the REGISTRY and against RULEBOOK 40 and BRAND —
`packages/dogfood/tests/coverage.test.ts`, `markdown.test.ts`, `voice.test.ts`, `fences.test.ts` —
reading `SITE.ts`, each `index.abide`, and the pages and markdown the built app serves.

## Checks

    bun run typecheck     TypeScript 7 over all four packages, unused locals and parameters included
    bun run test          abide build, then bun test --parallel
    bun run test:serial   the same, unparallelized — rerun a TIMING failure here before believing it
    bun run test:changed  only what a change reaches
    bun run format        abide format over every .abide, then bun fmt over the rest
    bun run format:check  the same, writing nothing — fails where a file would change
    bun run e2e           playwright: abide's and the harness's browser specs in chromium and
                          webkit, the CRM's own specs against the docs' mount of
                          it, and the docs app at the root and under a sub-path
    bun run knip          exports and files nothing resolves through
    bun run verify        typecheck, format:check, test

Run everything from the REPO ROOT: `bunfig.toml`'s DOM preload is resolved relative to it,
and the suites measure a different code path while still passing if it is not found.

## Conventions

`CLAUDE.md` is the working agreement — seams, hot paths, reactive invariants, and how a
performance claim is made. It is worth reading before the first change; in particular, a
performance claim is a RATIO against hand-written code in the same substrate, and a gate is
verified by reverting the fix and watching it fail.
