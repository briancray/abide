# abide

An isomorphic, type-safe framework for async interfaces — for humans and for machines —
built on Bun and web standards.

Same callable, same name, same *intent* on both sides. A state is read and written BY NAME
inside a `.abide` file, and the explicit `x()` / `x.set(v)` spelling keeps compiling: the sugar
is over it, never instead of it.

Status: **shell**. The workspace, seams, checks and measurement lanes are in place; the
framework itself is not written yet. `docs/SPEC.md` is the surface being built toward.

## Layout

    packages/abide      the framework
    packages/harness    the three measurement lanes everything is tested and measured with
    packages/dogfood    the documentation app, and the app abide is dogfooded on

`abide` is split by seam — `#shared`, `#ui`, `#server` — and those seams are what
framework-internal code imports through. An app resolves `abide`, `abide/runtime` and
`abide/server` instead.

`harness` is split by DEPENDENCY, and that is why it is a package rather than a folder:
`harness/measure` has no abide in its graph at all, which is what lets the hand-written arm
of a ratio be timed by the same clock and the same batch sizing as the abide arm.

| lane | answers | substrate |
| --- | --- | --- |
| `harness/measure` | DOM calls, from inside the page | bun **and** browser |
| `harness/engine`  | what Blink did — style, layout, paint, per-layer shares | chromium, over CDP |
| `harness/server`  | bytes, microtask turns, allocations | bun |

## Checks

    bun run typecheck     tsgo over all three packages
    bun run test          abide build, then bun test --parallel
    bun run test:serial   the same, unparallelised — re-run a TIMING failure here before believing it
    bun run test:changed  only what a change reaches
    bun run lint          unused locals, imports and parameters
    bun run e2e           playwright, two projects over the one app
    bun run knip          exports and files nothing resolves through
    bun run verify        lint, typecheck, test

`verify` is green now. `e2e` is configured but not yet live: it comes online with the
first page the dogfood app serves, since `abide start` has nothing to serve until then.

Run everything from the REPO ROOT: `bunfig.toml`'s DOM preload is resolved relative to it,
and the suites measure a different code path while still passing if it is not found.

## Conventions

`CLAUDE.md` is the working agreement — seams, hot paths, reactive invariants, and how a
performance claim is made. It is worth reading before the first change; in particular, a
performance claim is a RATIO against hand-written code in the same substrate, and a gate is
verified by reverting the fix and watching it fail.
