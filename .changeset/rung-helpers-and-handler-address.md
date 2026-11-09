---
"@abide/abide": patch
---

Rung helpers, `resultsOf` and a handler's address, from updating an app to 0.125 — 16.86, 16.88, 44.51

- `resultsOf` takes any handler, whatever its args (it refused every handler with a parameter).
- A rung list a helper builds (`middleware: rungs()`, `[...rungs()]`) carries its `Middleware`s' named refusals onto the `Rpc`, as an inline list does.
- A generic rung helper takes its `Args` from the handler it is listed on again.
- A handler file's `rpc.address` is its route as soon as the file loads, so a `bun test` importing it matches it with no app booted.

MIGRATION from 0.124: a rung's `next` is typed `(ctx?: RpcContext<Args>) => Promise<…>`, so a rung written for any handler whose `next` takes a ctx with `args: () => unknown` no longer fits a handler with typed args — it could hand that handler args of the wrong shape. Type the helper over the handler's `Args` (`<Args>(…) => ((next: (ctx?: { request: Request; args: () => Args }) => Promise<unknown>, ctx: { request: Request; args: () => Args }) => unknown)[]`), or write the rung as a `Middleware`. A mismatch is now reported against `middleware` rather than as the handler not being assignable to `never`.
