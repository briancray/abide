# Working on this app

This is an abide app. Before writing code, read `node_modules/@abide/abide/ABIDE.md`: how an abide
app is laid out, checked and tested, and what this file is for.

The ledger keeps one book per household: `src/books/` is its pages, and `CONTEXT.md` its words.

## Checking your work

- `bun run seed` — loads `fixtures/books.json` into a fresh database.

## Layout

- `src/books/getBook.server.ts` answers `/books/getBook`, and every page of a book reads it.

## This app

Seed a book before a test that reads one:

```sh
- `bun run dev` — serves the app on a local port and rebuilds when a file changes.

bun run seed
```
