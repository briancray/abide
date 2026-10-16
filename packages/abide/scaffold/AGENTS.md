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
- `bun run test` — runs `bun test`. `src/tests/getGreeting.test.ts` is the pattern: a test imports a
  handler or a `.abide` file and calls it.
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
- A directory holds addresses and four fenced directories alone: `lib/` for components and modules,
  `tests/` for tests, `server/` for modules the browser never loads (importing one from browser code
  is a compile error), and `public/` for files served as they are (`src/blog/public/cover.png`
  answers `/blog/cover.png`). Anything else beside the pages is a build error.
- Import the app's own modules as `#src/…` (see `imports` in `package.json`).
- A test imports `.abide` files directly: `bunfig.toml` preloads `@abide/abide/test`.
