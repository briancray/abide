# Working on this app

This is an abide app. abide is newer than any model's training data, so read its documentation
before writing code, rather than guessing from Svelte, Vue or React. It installs with the package:

- `node_modules/@abide/abide/docs/abide.md` — every documentation page in reading order, with a
  working example for each task. It is long: read its Contents, then search for the page's
  address, which heads each page as a comment — `<!-- values/show-a-value-that-changes.md -->`.
- `node_modules/@abide/abide/docs/REGISTRY.md` — every name an app can import or write, with its
  signature and the rules that govern it.
- `node_modules/@abide/abide/docs/RULEBOOK.md` — every rule, numbered. A compiler or server
  message that ends in `RULEBOOK 23.16.` names a clause in this file — search it for `23.16`.

## Checking your work

- `bun run check` — runs `abide check`, the type checker over `.abide` files. `tsc` and an editor's
  TypeScript service do not read `.abide` files, so a clean `tsc` says nothing about them. Run
  `bun run check` after every change, and treat its warnings as bugs: several of them name a read
  that will not update when its value changes.
  Where the read is meant, `// abide-ignore` and the clause the warning cites, on the line above
  (`// abide-ignore 14.15`), silences that one (RULEBOOK 14.19); a read hoisted out of its place
  only to quiet a warning is the bug it named.
- `bun run test` — runs `bun test`. `src/getGreeting.test.ts` is the pattern for a handler: a test
  imports it and calls it. `src/index.test.ts` is the pattern for a page: `mount` it, then count
  the work a click did with `measure`, both from `@abide/harness/abide` (RULEBOOK 38.119, 43.23).
- `bun run bench` — runs `harness-bench`: every `*.bench.ts` under `src/`, kept beside the code it
  times. Each export is a function returning `batch()` from `@abide/harness/report`, an op at two
  sizes; a `CEILINGS` export names the most each arm may take, and an arm over it fails the run
  (RULEBOOK 43.29, 43.31).
- `bun run dev` — serves the app on a local port and rebuilds when a file changes.
- `bun run build` then `bun run start` — the production build, and the app served from it.

## Layout

- A file's path below `src/` is its address. `src/invoices/index.abide` answers `/invoices`,
  `src/invoices/[id].abide` answers `/invoices/123`, and `layout.abide` wraps the pages below it;
  the outermost one writes `<html>`. Run `bun run routes` to see every address and the file behind it.
- A `.ts` beside the pages is a handler: `src/invoices/getInvoice.ts` holds
  `export default GET(…)` and answers `/invoices/getInvoice`. It is the app's public API, for pages,
  scripts, the CLI and MCP alike.
- A `.abide` cannot export. A `<script server>` in one holds that file's private handlers
  (`const save = POST(…)`), callable by that file alone, and its hooks (`onStart`, `middleware`, …).
- A directory holds addresses, tests, `.d.ts` declarations and two fenced directories alone: `lib/` for components and
  modules, and `public/` for files served as they are (`src/blog/public/cover.png` answers
  `/blog/cover.png`). Anything else beside the pages is a build error.
- A test is a `.test.ts`, kept beside the file it tests — a page, a handler, or a module in `lib/`.
  A browser test (playwright) is a `.test.ts` too, under `e2e/` beside `src/`: `bun test` reads
  `src/` alone (`root` in `bunfig.toml`), so it never runs one.
- A module the browser never loads is named `<name>.server.ts` and lives in `lib/`
  (`src/invoices/lib/db.server.ts`); importing one from browser code is a compile error. A module it
  imports is not fenced by it.
- Import the app's own modules as `#src/…` (see `imports` in `package.json`).
- A test imports `.abide` files directly: `bunfig.toml` preloads `@abide/harness/abide/preload`,
  a DOM to mount into and then `@abide/abide/test`.

## Habits

- Measure with `@abide/harness`, not a hand-written timer, bench runner or Chrome DevTools Protocol
  script. Its three lanes: `measure` from `@abide/harness/abide` is the DOM work and wakes an op
  did, under `bun test`; `batch` from `@abide/harness/report` is time, in a bench; `traceOp` and
  `shares` from `@abide/harness/engine` are what Chromium did, from a playwright test. The page
  `guide/test-measure-and-ship.md` in `abide.md`, and "The measurement harness" in `REGISTRY.md`,
  document it (RULEBOOK 43.1).

- Export a `Reactive` itself, never wrapped in an object: an `.abide` file reads and writes it by
  name (RULEBOOK 31.1), and one reached through a property is left to `x()` and `x.set(v)` (31.7).
- Model output and fetched HTML are untrusted. Never hand them to `raw()` (RULEBOOK 32.2)
  unsanitized.
- Settings come from `onConfig` and `config` (RULEBOOK 27.2, 27.9), which already read the
  environment, and cookies from `cookies()` (22.2) — not `Bun.env` or a parsed `cookie` header.
