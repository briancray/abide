/*
A name a block introduces into a body's scope, carried on its Plan and classified
ONCE as the single source of truth both back-ends read. `name` is the author param
as written (a plain identifier or a destructuring pattern — `item`, `i`, `_error`,
`{ a, b }`); its leaf names are derived where it is registered (`withBindings`),
never re-derived in a back-end. `classification` decides how each back-end RENDERS
the binding — the only per-back-end choice left:

- `reactive` — an `await` `then` value, an `each` item / index. The client binds a
  `.value` cell the runtime can update in place (read as a deref via `reactiveBinding`);
  SSR has no cells, so it renders it as a plain shadow.
- `plain` — a `catch` error, `snippet` args. A real JS local on both back-ends, read
  as the bare identifier.

A binding that mis-lowers to the enclosing component signal is the `block-binding-shadow`
bug this model designs out: there is one name set and one classification per block, and
one registration loop (`withBindings`).
*/
export type Binding = {
    /* The author param as written — a plain identifier or a destructuring pattern. */
    name: string
    /* How each back-end renders it: a reactive `.value` cell (client) vs a plain local. */
    classification: 'reactive' | 'plain'
}
