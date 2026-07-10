// AsyncLocalStorage is canonical via node:async_hooks — Bun has no separate API
import { AsyncLocalStorage } from 'node:async_hooks'

/*
The server's dedicated render-path store (ADR-0033 D1). Backs `CURRENT_PATH.current` during an
SSR pass with the COMPOSED path as the store value, pushed by `.run(compose(base, segment), build)`
at each nesting site (route → layout → row → branch → child ordinal). Unlike a mutable slot restored
in `finally`, `run`'s value is inherited by every async continuation spawned inside it — so a render
body resuming after an `await` still reads ITS OWN path, and sibling rows/children (continuations of
the enclosing render body) read the enclosing render's path. Per-request isolation falls out for free
(each route render is its own `run` tree), which is why this subsumes the path half of the request
store. Reads outside any `run` fail open to `''` (a detached scope then takes the counter fallback).
Server-only, kept out of `lib/ui` so the browser bundle never drags in `node:async_hooks`.
*/
export const pathStore = new AsyncLocalStorage<string>()
