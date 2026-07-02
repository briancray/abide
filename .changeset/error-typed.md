---
"@abide/abide": minor
---

Add `error.typed(name, status, schema?)` — declare a single, reusable typed-error constructor. Returning it from a handler IS the error (it serializes a `{ $abideError, data }` body at `status`), and the rpc reads the constructor's branded return type to expose the error on the client's `rpc.isError(caught, 'name')` (narrowing `.kind` and typed `.data`). Compose by returning whichever constructors you want — no set, no registration:

```ts
const outOfStock = error.typed('outOfStock', 409, z.object({ sku: z.string() }))
export const buy = POST(({ sku }) => (inStock(sku) ? json(place(sku)) : outOfStock({ sku })))
// buy.isError(e, 'outOfStock') → e.data: { sku: string }, inferred from the body
```

The rpc's typed-error surface is now **inferred from the handler's return type** — the errors a handler returns are the errors it can raise — so there is no `errors:` rpc option and no `ctx.errors` handler param. A typed error you only ever `throw` (rather than `return`) narrows kind-only, like a plain `error()`.

BREAKING: removes the rpc `errors:` option and the handler's `{ errors }` second argument. Replace `POST((args, { errors }) => error(errors.x(data)), { inputSchema, errors: { x: { status, data } } })` with a module-scope `const x = error.typed('x', status, schema)` constructor returned from the handler: `POST((args) => x(data), { inputSchema })`.
