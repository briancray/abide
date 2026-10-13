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
- `bun run dev` — serves the app on a local port and rebuilds when a file changes.
- `bun run build` then `bun run start` — the production build, and the app served from it.

## Layout

- Every directory under `src/` is an address: `src/invoices/page.abide` answers `/invoices`.
  `layout.abide` wraps the pages below it, and the outermost one writes `<html>`.
- A module under a `server` directory runs on the server only, and importing one from browser
  code is a compile error. A file under a `public` directory is served as it is:
  `src/blog/public/cover.png` answers `/blog/cover.png`.
- Handlers and hooks go in a `<script server>` block of a `.abide` file.
- Import the app's own modules as `#src/…` (see `imports` in `package.json`).
