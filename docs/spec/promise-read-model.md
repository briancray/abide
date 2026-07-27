# Design — the Promise-read model (RPC/memo read semantics)

> **STATUS: IMPLEMENTED.** The bare memo/RPC call now returns `Promise<T>` (subscribing coalesced
> load); `fn.peek(args): T | undefined` is the reactive snapshot; `.load` is retained as a `@deprecated`
> non-subscribing alias (migration only). **The open crux below is SOLVED:** the bare call does a
> tracked `slot.signal()` read before returning the load promise, so the interpolation/await effect
> re-runs and re-awaits on invalidate. Seed-primed synchronous hydration claim is preserved via a
> runtime-only settled-value hint on the promise (`shared/internal/settledRead.ts`) — the public type
> stays a clean `Promise<T>`. Refs: `shared/memo.ts`, `server/internal/makeRpc.ts`,
> `ui/internal/clientProxy.ts`, `server/internal/pages.ts`, `ui/internal/runtime.ts` (`claimAwait`,
> `interpolate`, `awaitText` — the two text paths consume the hint to write the warm value
> synchronously and to correct a diverged claim on the hydrate pass; see decision 9 in
> `attach-hydration-design.md`).
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
rpc.refresh/invalidate/publish(…): …      // cache verbs (unchanged)
// rpc.load — REMOVED (=== the bare call now); deprecated alias during migration only
```

**The interpolation runtime auto-awaits.** A bare `{rpc()}` renders the AWAITED value, not
`[object Promise]`: the server awaits every interpolation (`emitServer.ts`, the `interp` chunk) and the
client's `interpolate` detects a thenable, clears the text node and fills it when the promise settles
(`ui/internal/runtime.ts`). What is still loud is the TYPE: `{rpc().field}` is a **TS error** caught by
the #11 checker (`Property 'field' does not exist on Promise<T>`) — bind through `{#await}` or use
`.peek()`.

> The clear-then-fill is exactly why an ARGLESS SYNCHRONOUS `memo`'s bare call returns `T` rather than
> `Promise<T>` (ADR 0024 §3): a promise-returning derived read would blank the server-rendered text and
> refill it a microtask later — a visible flash on every derived value.

### The four template contexts

| Template | Type | Semantics |
| --- | --- | --- |
| `{rpc.peek()}` / `{rpc.peek()?.foo}` | `T \| undefined` | non-blocking, reactive |
| `{rpc()}` (bare) | `Promise<T>` → the awaited value | **REJECTED by the checker** (see below); would render blocking, value-in-HTML |
| `{await rpc()}` | `T` | blocking (SSR value-in-HTML) |
| `{#await rpc()}{:then v}` | `v: T` | reactive await block |

**Bare and `{await}` differ in TYPE, not in timing.** `emitServer` auto-awaits every interpolation — the
`interp` and `await` chunks emit the same guarded settle (`isThenable($v) ? await $v : $v`), which for a
promise-returning read is an await either way — so both land the value in the initial HTML,
and on the client neither blocks (there is no blocking on the client: both write a text node and fill
it when the read settles). The only runtime difference is the leaf anchor form. What the `await`
keyword buys is the `T` binding: `{rpc().field}` is a checker error, `{await rpc()}` is not. Anyone
reading this table for a "make bare non-blocking" change should note that would be a **semantic
change to `emitServer`**, not a documentation clarification.

### AMENDED: the bare form is a checker error

Leaving both forms legal made the read two-ways-to-spell, and the bare one is strictly worse: same
timing, no `T`. `emitCheck` now routes a TEXT interpolation through a sink that rejects a definite
thenable (`__text` / `__AbideNoPromise` in `HEADER`), so `{rpc()}` fails `abide check` with the remedy
in the message. The considered-and-rejected alternative was making the runtime render `[object Promise]`
— i.e. dropping the auto-await from `interp`. That was rejected because the auto-await is NOT an
interpolation special case: every expression slot in `emitServer` awaits (attrs `:144`, dirs `:149`–`:155`,
spread `:158`, props `:194`, `{#if}` `:281`, `{#for}` head `:329`, `interp` `:249`). Dropping it from
`interp` alone would ADD the only non-awaiting slot; dropping it everywhere breaks `<Foo v={rpc()}/>`
and `{#for await x of rpc()}` (an RPC read is `Promise<AsyncIterable<C>>`, which `for await` cannot
iterate — `emitCheck.ts:372`). A silent `[object Promise]` in shipped HTML also inverts the project's
loud-failure posture. So: the TYPE gets stricter, the runtime stays forgiving.

The conditional DISTRIBUTES, so `T | Promise<T>` is deliberately still legal — a value that is only
sometimes a promise is the passthrough case the auto-await exists for. `any` passes too (it collapses
the conditional to `unknown`), so this never false-positives on an untyped import.

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

## The one crux — await-interpolation reactivity (SOLVED, kept for the reasoning)

Today `{fn()}` (peek) re-renders on `invalidate`/`publish` because the peek subscribes. Under this model
the reactive form `{rpc.peek()}` still subscribes ✓, but the blocking form `{await rpc()}` must ALSO
re-await when the underlying memo invalidates — otherwise a blocking read goes stale after a mutation.
So the await-interpolation has to subscribe-and-re-await. This was the hardest design point; it SHIPPED
(the await leaf subscribes to the slot and re-awaits on a change), and the section is retained for the
reasoning rather than as open work. (`{rpc.peek()}` reactivity is free; `{await rpc()}` reactivity was
new behavior.)

One consequence worth carrying here, because it is what the reactivity actually means: the re-await
fires on a change, and an identity-equal re-fill is NOT a change (`rpc-core` §7.4). A `refresh` that
recomputes the same value re-runs the handler and wakes nobody — correct, and invisible, which is why a
demo of this form needs a handler whose output genuinely moves.

## Migration

- Every bare `{fn()}` used as a display *peek* → `{fn.peek()}`. Mechanical and **checker-guided** (the
  #11 checker flags each `{fn().field}` / `{#await fn()}{:then v}{v.field}` mismatch).
- `{#await fn(args)}` → `{#await fn(args)}` unchanged once the bare call is `Promise<T>` (interim it is
  `{#await fn.load(args)}` — see below).
- CLAUDE.md contract flips: "`{fn(args)}` = non-blocking peek" → "`{fn.peek(args)}` = non-blocking
  peek; `{fn(args)}` / `{await fn(args)}` = the read (promise)."
- Seed/SSR/hydration: smaller than other B-variants (memo internals barely move — only which method the
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
- **`Promise<T>` + client SUSPENSE on bare `{rpc()}`**: rejected — a bare render that suspends the
  surrounding region is magic the author never asked for; `{#await}` is the explicit form for that.
  NB: the auto-AWAIT half was NOT rejected and did ship (see the header) — the runtime unwraps a
  thenable interpolation, so a bare `{rpc()}` renders the awaited value rather than the
  `[object Promise]` this entry originally projected. Only suspension was turned down.
- **Type-only `PromiseLike` fudge** (type says awaitable, runtime stays sync peek): unsound —
  `await fn()` would resolve to the peek, crashing typed-safe code.

## Deferred / parked

Per-route `[name]` `Params` typing (#11); narrowing sugar `{#if x as v}`. (The await-interpolation
reactivity mechanism was the crux above and has SHIPPED — it is no longer parked.)
