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

The ledger keeps one book per household: `src/books/` is its pages, and `CONTEXT.md` its words.

## Checking your work

- `bun run check` — runs `abide check`, the type checker over `.abide` files. `tsc` and an editor's
  TypeScript service do not read `.abide` files, so a clean `tsc` says nothing about them. Run
  `bun run check` after every change, and treat its warnings as bugs: several of them name a read
  that will not update when its value changes.
  Where the read is meant, `// abide-ignore` and the clause the warning cites, on the line above
  (`// abide-ignore 14.15`), silences that one (RULEBOOK 14.19); a read hoisted out of its place
  only to quiet a warning is the bug it named.
- `bun run seed` — loads `fixtures/books.json` into a fresh database.
- `bun run dev` — serves the app on a local port and rebuilds when a file changes.
- `bun run build` then `bun run start` — the production build, and the app served from it.

## Layout

- A file's path below `src/` is its address. `src/invoices/index.abide` answers `/invoices`,
  `src/invoices/[id].abide` answers `/invoices/123`, and `layout.abide` wraps the pages below it;
  the outermost one writes `<html>`. Run `bun run routes` to see every address and the file behind it.
- A `.ts` beside the pages is a handler: `src/invoices/getInvoice.ts` holds
  `export default GET(…)` and answers `/invoices/getInvoice`. It is the app's public API, for pages,
  scripts, the CLI and MCP alike.
- `src/books/getBook.handler.ts` answers `/books/getBook`, and every page of a book reads it.
- Import the app's own modules as `#src/…` (see `imports` in `package.json`).

## Habits

- Measure with `@abide/harness`, not a hand-written timer, bench runner or Chrome DevTools Protocol
  script. Its three lanes: `measure` from `@abide/harness/abide` is the DOM work and wakes an op
  did, under `bun test`; `batch` from `@abide/harness/report` is time, in a bench; `traceOp` and
  `shares` from `@abide/harness/engine` are what Chromium did, from a playwright test. The page
  `guide/test-measure-and-ship.md` in `abide.md`, and "The measurement harness" in `REGISTRY.md`,
  document it.

- Model output and fetched HTML are untrusted. Never hand them to `raw()` (RULEBOOK 32.2)
  unsanitized.

## This app

Seed a book before a test that reads one:

```sh
- `bun run dev` — serves the app on a local port and rebuilds when a file changes.

bun run seed
```
