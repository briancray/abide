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
in `RULEBOOK 23.16.` names a clause in that file. The scaffold's `AGENTS.md` points a coding agent
at all three, and `bun run check` runs `abide check`, the type checker over `.abide` files — `tsc`
does not read them.

## Layout

    packages/abide      the framework
    packages/harness    the three measurement lanes everything is tested and measured with
    packages/dogfood    the documentation app, and the app abide is dogfooded on
    packages/bridge     abide-bridge, the CLI that connects Claude Code to an abide site

`abide` is split by seam — `#shared`, `#ui`, `#server` — and those seams are what
framework-internal code imports through. An app resolves `@abide/abide`, `@abide/abide/runtime` and
`@abide/abide/server` instead.

`harness` is split by DEPENDENCY, and that is why it is a package rather than a folder:
`harness/measure` has no abide in its graph at all, which is what lets the hand-written arm
of a ratio be timed by the same clock and the same batch sizing as the abide arm.

| lane | answers | substrate |
| --- | --- | --- |
| `harness/measure` | DOM calls, from inside the page | bun **and** browser |
| `harness/engine`  | what Blink did — style, layout, paint, per-layer shares | chromium, over CDP |
| `harness/server`  | bytes, microtask turns, allocations | bun |

## Brand

`docs/BRAND.md` is to the marketing surface what `docs/REGISTRY.md` is to the code: the claims
that may be made, what each one rests on, the words that name things, and the ones that are
off limits until something is measured. A claim whose supporting row changes is a claim that
goes.

## Documentation

THE DOCS ARE AN ABIDE APP, written the way an app author writes one: `packages/dogfood` is served by
`abide dev`, built by `abide build`, and has nothing generated in its source tree.

    bun run dev           abide dev on :3131
    bun run build         abide build

- A page is a hand-written `index.abide` at its route — `src/values/show-a-value-that-changes/index.abide`
  is `/values/show-a-value-that-changes` — wrapped in `<Doc>`, with its headings as `<Section>`s,
  its code as `<Code>` and `<Snippet>`, and its live examples as `<Example>` cards. Those components
  are the docs app's own, in `src/lib/`.
- `src/lib/SITE.ts` is the site map: every page in reading order, with its title, nav label,
  intent, opening paragraph, the app its examples are drawn from and the REGISTRY names it
  `covers`. The nav, a page's header and a section overview's `<Lead>`s all read it.
- An EXAMPLE is ONE `.abide` in the `lib/` beside the page that embeds it — its `<script server>`
  handlers, hooks and data, its `<script>` and its markup in one file (RULEBOOK 40.34) — and the card's Files
  tab shows that file, imported as text (`with { type: 'text' }`, 34.21). A card's `id` is what its
  hand-written arm under `packages/harness/arms/` is paired by (44.19).
- Every page is also served as markdown at its address with `.md` on the end, and `/abide.md` is
  every page in reading order — derived from the rendered page by `src/lib/downloads.ts`,
  so the words have one home (40.35).

`bun test` gates the docs against the REGISTRY and against RULEBOOK 40 and BRAND —
`packages/dogfood/tests/coverage.test.ts`, `markdown.test.ts`, `voice.test.ts`, `fences.test.ts` —
reading `SITE.ts`, each `index.abide`, and the pages and markdown the built app serves.

## Checks

    bun run typecheck     TypeScript 7 over all four packages
    bun run test          abide build, then bun test --parallel
    bun run test:serial   the same, unparallelized — rerun a TIMING failure here before believing it
    bun run test:changed  only what a change reaches
    bun run lint          unused locals, imports and parameters
    bun run e2e           playwright: the docs app at the root and under a sub-path, and the
                          harness's browser specs in chromium and webkit
    bun run knip          exports and files nothing resolves through
    bun run verify        lint, typecheck, test

Run everything from the REPO ROOT: `bunfig.toml`'s DOM preload is resolved relative to it,
and the suites measure a different code path while still passing if it is not found.

## Conventions

`CLAUDE.md` is the working agreement — seams, hot paths, reactive invariants, and how a
performance claim is made. It is worth reading before the first change; in particular, a
performance claim is a RATIO against hand-written code in the same substrate, and a gate is
verified by reverting the fix and watching it fail.
