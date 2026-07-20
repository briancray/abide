# Design — the Promise-read model (RPC/cell read semantics)

> **STATUS: IMPLEMENTED.** The bare cell/RPC call now returns `Promise<T>` (subscribing coalesced
> load); `fn.peek(args): T | undefined` is the reactive snapshot; `.load` is retained as a `@deprecated`
> non-subscribing alias (migration only). **The open crux below is SOLVED:** the bare call does a
> tracked `slot.signal()` read before returning the load promise, so the interpolation/await effect
> re-runs and re-awaits on invalidate. Seed-primed synchronous hydration claim is preserved via a
> runtime-only settled-value hint on the promise (`shared/internal/settledRead.ts`) — the public type
> stays a clean `Promise<T>`. Refs: `shared/cell.ts`, `server/internal/makeRpc.ts`,
> `ui/internal/clientProxy.ts`, `server/internal/pages.ts`, `ui/internal/runtime.ts` (`claimAwait`).
> Note: the runtime AUTO-AWAITS a thenable interpolation, so a bare `{fn()}` renders the awaited value
> (better than the projected `[object Promise]`); `{fn().field}` is still a checker type error.
>
> **Inline await shorthand (added):** `{#await fn() then v}…{/await}` / `{#await fn() catch e}…{/await}`
> fold the branch binding into the opener — the body IS that branch with no pending region, i.e. the
> compact BLOCKING form (renders nothing until the read settles, then the value). Parser-level desugar
> to a normal `AwaitBlock` (empty pending + a then/catch clause), so plan/emit/check are unchanged and
> the binding types as `T` for free. A trailing `{:catch}` may still follow the inline `then`. Ref:
> `ui/internal/parse.ts` (`parseAwaitBlock`).

Decision record from the design grill that grew out of TODO #11's docs-clean gate. The gate surfaced
that abide's RPC read-surface TYPE (`(args): T | undefined`, a sync peek) does not cleanly model the
documented template usage (`{#await rpc()}{:then v}{v.foo}` expects `v: T`). This doc captures the
chosen end-state read model and its one open crux. It is a **public-API + core-primitive** change,
sequenced AFTER #11's checker lands; #11 lands on the honest `T | undefined` with interim guards.

## The model

The bare read call becomes the (coalesced) load promise; the non-blocking peek becomes explicit.

```ts
rpc(args): Promise<T>          // the read — awaitable; coalesced + cached
rpc.peek(args): T | undefined  // reactive sync snapshot (was today's bare call)
rpc.pending/error/refreshing(args): …   // probes (unchanged)
rpc.refresh/invalidate/amend(…): …      // cache verbs (unchanged)
// rpc.load — REMOVED (=== the bare call now); deprecated alias during migration only
```

**No render magic.** The interpolation runtime is unchanged: `{X}` renders `String(X)` for any `X`.
A bare `{rpc()}` therefore renders `[object Promise]` — a deliberate, loud "you rendered a promise"
signal, and `{rpc().field}` is a **TS error** caught by the #11 checker (`Property 'field' does not
exist on Promise<T>`). Misuse fails at both the type layer and the screen; never silently.

### The four template contexts

| Template | Type | Semantics |
| --- | --- | --- |
| `{rpc.peek()}` / `{rpc.peek()?.foo}` | `T \| undefined` | non-blocking, reactive |
| `{rpc()}` (bare) | `Promise<T>` → `[object Promise]` | discouraged; loud failure |
| `{await rpc()}` | `T` | blocking (SSR value-in-HTML) |
| `{#await rpc()}{:then v}` | `v: T` | reactive await block |

The checker (`emitCheck`) needs **no** operand detection and **no** special types — every row falls
out of `Promise<T>` + `.peek(): T | undefined` with the existing lowering. This is the most
checker-friendly of the models considered (vs the `Read<T> = PromiseLike<T> & Partial<T>` hybrid and a
`Promise<T>`+auto-await-suspense variant — see "Rejected alternatives").

### Narrowing: bind-then-use (a hard TS fact)

TS does **not** narrow across separate calls: `{#if rpc.peek()}{rpc.peek().foo}{/if}` fails — a
call-expression result is not a narrowable reference. Field access after a guard must bind:

- blocking: `{#await rpc()}{:then v}{v.foo}` — `v` binds `T` (the canonical, type-safe path), or
- non-blocking: `<script>const v = rpc.peek(args)</script> {#if v}{v.foo}{/if}`, or `{rpc.peek()?.foo}`.

The blessed blocking form (`{#await}{:then v}`) *is* the bind-and-narrow shape, so the ergonomic path
and the type-safe path coincide. Optional future sugar: `{#if rpc.peek() as v}` binding-in-condition.

## The one open crux — await-interpolation reactivity

Today `{fn()}` (peek) re-renders on `invalidate`/`amend` because the peek subscribes. Under this model
the reactive form `{rpc.peek()}` still subscribes ✓, but the blocking form `{await rpc()}` must ALSO
re-await when the underlying cell invalidates — otherwise a blocking read goes stale after a mutation.
So the await-interpolation has to subscribe-and-re-await. **This is the hardest design point and the
thing to nail before implementing.** (`{rpc.peek()}` reactivity is free; `{await rpc()}` reactivity is
new behavior.)

## Migration

- Every bare `{fn()}` used as a display *peek* → `{fn.peek()}`. Mechanical and **checker-guided** (the
  #11 checker flags each `{fn().field}` / `{#await fn()}{:then v}{v.field}` mismatch).
- `{#await fn(args)}` → `{#await fn(args)}` unchanged once the bare call is `Promise<T>` (interim it is
  `{#await fn.load(args)}` — see below).
- CLAUDE.md contract flips: "`{fn(args)}` = non-blocking peek" → "`{fn.peek(args)}` = non-blocking
  peek; `{fn(args)}` / `{await fn(args)}` = the read (promise)."
- Seed/SSR/hydration: smaller than other B-variants (cell internals barely move — only which method the
  bare call forwards to). Re-prove `snapshot`/`seed` under `{await rpc()}`-driven SSR resolution.

## Interim (what #11 ships on, before this model)

#11's checker lands on the honest CURRENT type `(args): T | undefined`. To make `abide check
packages/docs` clean under that type, the docs get honest guards that are LARGELY forward-compatible
with this model:
- bare `{fn().foo}` → `{fn()?.foo}` (the `?.` stays; later `fn()` → `fn.peek()`).
- `{#await fn(args)}{:then v}{v.foo}` → `{#await fn.load(args)}{:then v}` (`v: T`); later `.load()`
  drops back to the bare call.
- `.error()` is `unknown` → guard/`?.`.
When this model lands, the guards are simplified/renamed and the checker proves the whole thing.

## Rejected alternatives

- **`Read<T> = PromiseLike<T> & Partial<T>`** (thenable hybrid): zero doc churn, but an ugly
  intersection type, a runtime unwrap-to-peek on render, and `{#if rpc()}` is always-truthy (footgun).
- **`Promise<T>` + auto-await/suspense on bare `{rpc()}`**: bare render becomes magic (suspends);
  rejected in favor of the loud `[object Promise]` no-magic behavior.
- **Type-only `PromiseLike` fudge** (type says awaitable, runtime stays sync peek): unsound —
  `await fn()` would resolve to the peek, crashing typed-safe code.

## Deferred / parked

The await-interpolation reactivity mechanism (the crux above); per-route `[name]` `Params` typing
(#11); narrowing sugar `{#if x as v}`.
