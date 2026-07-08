# ADR-0020: Cache policy belongs to the endpoint; namespace the rpc opts

**Status:** accepted (2026-07-08). Not yet implemented. Shares no machinery with
[ADR-0019](0019-async-computeds-and-rpc-auto-reads.md) but the same design
instinct (one source of truth, fail-closed, high-visibility); the two ship
combined.

## Context

All cache/retention policy is **call-site** today — the smart bare call takes a
second options argument (`fn(args, opts)`), and the rpc *definition* carries none
of it. `RpcBaseOpts` / `MutatingRpcOpts` (`server/rpc/types/RpcHelper.ts:69-88`)
and `defineRpc`'s opts (`server/rpc/defineRpc.ts:52-71`) hold only
schemas / `clients` / `crossOrigin` / `maxBodySize` / `timeout` / `outbox` — no
`ttl`, `tags`, `swr`, `throttle`, `debounce`, `shared`, `n`. The only
endpoint-level policy that exists is **method-derived**, computed in `cache.ts`
`readThrough` (`REPLAYABLE_METHODS` = GET only, `cache.ts:12`; the `ttl:0`
defaults, `cache.ts:217-223`).

Three problems with call-site policy:

1. **The cache key excludes the options.** `keyForRemoteCall` is `method+url+args`
   (`keyForRemoteCall.ts:15-30`); `CacheOptions` states *"the key is always
   auto-derived."* So two call sites calling the same rpc with the same args but
   different `ttl`/`tags`/`shared` hit **one shared entry with conflicting
   policy**, resolved piecemeal via `adoptTtl` / `tagEntry`. That is a latent
   correctness bug, not a preference.
2. **`shared` as a per-call flag is a security footgun** — the process store is
   keyed by method+url+args, *never by user*, so a per-call `shared: true` on
   per-user data serves it to other users. Whether an endpoint's data is
   cross-request-shareable is a property of the *endpoint*, not the call.
3. **The opts bag is a flat grab-bag** mixing transport/validation
   (`timeout`, schemas) with (proposed) cache concerns, and — since options only
   apply to certain rpc kinds — nothing stops `n` on a non-streaming rpc or
   `debounce` on a write.

Two option families, by nature:
- **Endpoint-intrinsic** — `ttl`, `tags`, `shared` (data policy); `throttle` /
  `debounce` (the *background refetch clock*, a property of data volatility and
  backend load tolerance — **not** input debounce, which is a UI concern on the
  state feeding `args`); `n` (stream replay depth, pairs with server `tail`).
- **`swr`** — abide already runs SWR unconditionally for replayable reads; there
  is no reason to keep it a toggle.

## Decision

### D1 — All cache/stream policy is endpoint-declared; the call is only `fn(args)`

Every retention/refetch/stream option moves to the rpc **definition**. The smart
bare call loses its options argument entirely: `fn(args)` is the whole call.
`SmartReadOptions` / `CacheOptions` as *call-site* types are deleted; `.raw(args,
init)` keeps transport options (`RpcOptions` — `signal`/`keepalive`/… — unchanged).

- **`swr` is removed — SWR is always on** for replayable reads. This deletes the
  `boolean | { throttle; debounce }` union *and* the wrap-time guards
  (swr+window conflict, swr-on-`ttl:0`, swr-on-non-replayable). Pure subtraction.
- **`tags` accepts a function:** `string[] | (args) => string[]` — static resource
  tags or arg-derived (`(args) => [\`rates:${args.base}\`]`), declared once on the
  endpoint. There is no call-additive tag form (no call options exist); the
  `(args) =>` form covers arg-derived grouping.
- **Kind-scoped** (see D2): `cache` policy exists only on cacheable reads; `stream`
  only on streaming rpcs; a write carries neither (coalesce-only is the method
  default, so the `{ttl:0}` mutation idiom is gone).

The `readThrough` merge simplifies from **`method-default → call-override`** to
**`method-default → endpoint-policy`** — there is no call layer. One policy per
endpoint, so the shared-entry conflict (Context #1) cannot arise.

### D2 — Namespace the rpc opts under cohesive keys

Follow the existing `clients` key: group each cohesive multi-field concern under
its own namespace; leave scalar behavioral flags top-level.

```ts
// before (flat)                          // after (namespaced)
GET(handler, {                            GET(handler, {
  inputSchema, outputSchema, filesSchema,   schemas: { input, output, files },
  clients,                                   clients,
  timeout, maxBodySize, crossOrigin,         cache: { ttl, tags, throttle, debounce, shared },
  // (cache was call-site)                    timeout, maxBodySize, crossOrigin,
})                                        })

sse(handler, { stream: { n } })           // streaming kind
POST(handler)                             // write: no `cache`, no `stream`
```

**The grouping rule:** a cohesive *multi-field* concern → a namespaced key
(`schemas`, `cache`, `stream`, `clients`); a single scalar behavioral flag stays
top-level (`timeout`, `maxBodySize`, `crossOrigin`, `outbox`).

- **`schemas: { input?, output?, files? }`** replaces the flat
  `inputSchema`/`outputSchema`/`filesSchema` (and their schema-bearing overloads,
  `RpcHelper.ts:144-152`). Type inference now reads `opts.schemas.input` to type
  the handler's args — a nested-key conditional-type read instead of a top-level
  one; more generics but mechanical.
- **`cache: { ttl?, tags?, throttle?, debounce?, shared? }`** — the D1 policy, on
  cacheable-read kinds only.
- **`stream: { n? }`** — streaming replay depth, on `jsonl`/`sse` kinds only.
- **`clients`** — unchanged (already a key).

Kind-scoping is enforced by the *type*: a `POST` opts type has no `cache`; a
non-streaming opts type has no `stream`; so a meaningless option is a compile
error, not a silent no-op. This is the concrete answer to "these options don't
belong in one flat bag."

### Option homes (final)

| option | home | notes |
|---|---|---|
| `ttl` | `cache` (definition) | default ∞ — retained for the store's lifetime (request/tab); a write coalesces (0) |
| `tags` | `cache` (definition) | `string[] \| (args) => string[]` |
| `shared` | `cache` (definition) | never per-call — closes the per-user leak |
| `throttle` / `debounce` | `cache` (definition) | the *refetch clock*, not input debounce |
| `n` | `stream` (definition) | replay depth; endpoint-fixed |
| `swr` | — removed | always on for replayable reads |
| transport (`signal`, `headers`, …) | `.raw(args, init)` | unchanged |

### `ttl` defaults to ∞ (retain for the store's lifetime); the store's lifetime is what ends a read

`ttl` defaults to **Infinity** on both sides: an entry is retained for as long as its
**store** lives. The store's lifetime — not `ttl` — is what ends a read, and the atomic
unit differs by side: **the request on the server, the tab on the client** (implemented in
`cache.ts` `readThrough`, the `coalesceOnly`/store branch).

- **Server.** A non-shared read lives in the request-scoped store, which is discarded at
  request end — so it **dies with the request regardless of `ttl`**. `ttl` is not what makes
  it ephemeral; the request-scoped store is. An explicit `ttl: N` is a hard expiry, but only
  bites where the store outlives the read — the `shared` (process) store; on the request
  store it is dead config (a warning fires).
- **Client.** A replayable read lives in the single tab store: default ∞ = retain until
  invalidate/refresh. `ttl: N` is a soft *staleness deadline* (SWR) — the value goes stale
  after N ms and the next access kicks a background revalidation while **the stale value
  stays visible** (`refreshing()` true, never dropped).

**`shared` is the orthogonal survival property — not a store-selector that retains nothing.**
It moves the entry to the process store, which outlives every request; with the default ∞
`ttl`, `shared` alone **memoises across requests**, and an explicit `ttl: N` bounds that
memoisation to N ms. (The prior model made `shared` inert unless paired with an explicit
`ttl`; now `shared: true` is sufficient to memoise.) The process store is keyed by
method+url+args, never by user — so `shared` on per-user data leaks it across users; the
fail-closed default is not-shared.

**The one exception — writes coalesce only.** A non-replayable rpc (POST/PUT/…) with no
stated `ttl` defaults to `0` (dropped on settle) so a re-submit of the same body isn't
blocked by a retained entry — the mutation idiom. A read made *outside* any request scope
(a background job) also falls back to the process store and coalesces only, so a scopeless
read can't leak forever.

This is more semantically honest than the prior "server default `ttl: 0`", which conflated
retention-duration with cross-request survival — survival is really governed by *which store
holds the entry*, i.e. by `shared`.

## Consequences

- **The call site loses its entire options surface** — `fn(args)` everywhere,
  forever. No `{ttl:0}` mutation idiom, no per-call policy, no ambiguity.
- **Correctness:** one policy per endpoint eliminates the shared-entry conflict.
- **Security:** `shared` can no longer be a per-call mistake.
- **Simplification:** `swr`-always-on deletes a union + three wrap-time guards;
  `readThrough` drops the call-override layer; `SmartReadOptions` / call-site
  `CacheOptions` are deleted.
- **Definition threading (new):** `cache`/`stream` policy must ride onto the
  `RemoteFunction` and `RpcRegistryEntry` (`RpcRegistryEntry.ts:23-35` gains the
  fields) and be read by `readThrough` (`cache.ts:181-223`) as the bottom layer.
  Policy ships to the client on the `RemoteFunction` (it governs client cache
  behavior) — harmless (`ttl`/`tags`/`throttle`/`debounce` are behavior not
  secrets; `shared` is a client no-op) but a small bundle addition.
- **Breaking changes (both loud, mechanical):**
  1. Every call site drops its second cache arg; policy moves to the definition.
  2. `inputSchema`/`outputSchema`/`filesSchema` → `schemas: { … }`;
     `ttl`/`tags`/… (call-site) → `cache: { … }` on the definition.
  Both surface at compile time (removed fields / removed call arg), and
  `readmeSurfaces.ts` + AGENTS.md regenerate from the new `exports` shapes.

## Accepted trade-offs (were open, now decided)

- **No call-additive tags.** A call site cannot add a contextual tag; the
  endpoint's `tags` (incl. `(args) =>`) is the sole source. Accepted — arg-derived
  grouping covers the real cases, and per-call tags on a shared entry were part of
  the ambiguity D1 removes.
- **`n` is endpoint-fixed.** A late-joiner cannot request deeper replay than a
  fresh view; the endpoint sets replay depth (consistent with server-side `tail`
  retention being an endpoint capability).
- **Kind-scoping is read-vs-write, not finer.** D2 says `cache` on "cacheable reads"
  and `stream` on "jsonl/sse kinds". But there are no `jsonl`/`sse` rpc *helpers* —
  streaming is a `GET`/`POST` whose handler returns `jsonl()`/`sse()`, detected
  syntactically by the bundler, so streaming-vs-non-streaming is not knowable from the
  helper type. So both `cache` and `stream` live on the **read helpers** (`GET`/`HEAD`)
  and neither on the **mutating helpers** (`POST`/`PUT`/`PATCH`/`DELETE`), which are
  compile-error targets for `cache`/`stream` — this delivers D2's headline win ("a `POST`
  has no `cache`"). A streaming `GET` carrying `cache`, or a non-streaming `GET` carrying
  `stream`, is allowed-but-inert rather than compile-rejected; finer gating would require
  conditioning the opts type on the handler's inferred return type, exploding the generics
  for marginal benefit. Accepted.
- **The client-shipped `cache`/`stream` policy must be self-contained** (mirrors
  the build-time `outbox`-must-be-a-literal constraint). Policy ships to the
  client on the `RemoteFunction`: the bundler lifts the verbatim source text of
  the `cache:` / `stream:` property out of the rpc definition and splices it into
  a fresh client proxy stub that has **none** of the source module's imports. So
  the policy expression may reference only literals and self-contained arrow
  functions — e.g. `tags: (args) => ['rates:' + args.base]` — never a
  server-module-scope identifier or import (which would be undefined in the stub).
  Arg-derived tags are expressed through the `(args) =>` form, so this covers the
  real cases; it is the same "the bundle reads it statically" discipline `outbox`
  already imposes.

## Resolved

- **Transport stays top-level.** `timeout` / `maxBodySize` / `crossOrigin` remain
  scalar top-level flags (the D2 rule); no `transport:` key for now.
- **`shared` stays opt-in — no auto-default, no magic.** Auto-defaulting a GET to
  `shared: true` would require *soundly* detecting identity-dependence (response
  varies by user/session/cookie), and the failure mode is **fail-open** (serve one
  user's cached response to another). No sound detector exists: static analysis is
  imprecise, and runtime taint over the framework's session/user/cookie accessors
  is bypassable via raw `request.headers` reads. So `shared` is a plain, explicit,
  greppable, reviewable declaration and nothing more — no tripwire, no detection,
  no runtime magic. The default (not shared) fails *closed*; sharing across users
  is always a deliberate line in the endpoint definition.
