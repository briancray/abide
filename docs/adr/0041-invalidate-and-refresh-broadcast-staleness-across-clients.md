# ADR-0041: `invalidate` and `refresh` are isomorphic staleness verbs that broadcast across clients from the server

**Status:** accepted (2026-07-12)

## Context

`abide/shared/refresh` is today the only public isomorphic staleness verb. It
delegates to the internal `cache.refresh` (retain-and-refetch). The drop verb —
`cache.invalidate` (`cache.ts:758`) — exists only internally; it was public
once, dropped-on-call, then folded into `refresh` (the fold is documented at
`RemoteFunction.ts:70`). We want to reintroduce `invalidate` as the distinct
**drop** verb and give both verbs a server→client reach, so a server mutation can
tell every connected browser that a cached read is stale.

Two facts force a redesign rather than a copy of `refresh.ts`:

1. **The server has no persistent per-client cache and no live UI.**
   `activeCacheStore()` on the server is a fresh per-request store
   (`runWithRequestScope.ts:33`) that dies with the response; SMART reads never
   retain server-side (`retain` requires `typeof window !== 'undefined'`,
   `cache.ts:224`). Calling `cache.invalidate`/`cache.refresh` on the server today
   only mutates a throwaway store and reaches zero browsers. A server→client
   staleness signal **must** go over the wire.

2. **`shared/*` modules are textually identical on both sides.** There is no
   plugin rewrite or alias for a library name; per-side behaviour in a shared
   module is achieved by the resolver-slot pattern (`createResolverSlot.ts`),
   exactly as the flagship `cache` verb swaps its store via `cacheStoreSlot`
   (installed at `serverEntry.ts:80` on the server, `startClient.ts:49` on the
   client). The resolver *plugin* only rewrites user files under
   `src/server/{rpc,sockets}` — it is the wrong tool for a library name.

The verbs, same name + same intent on both sides:

- **`invalidate(selector)`** — *these reads are stale, drop them (lazy reload).*
  Client: `cache.invalidate` hard-drops the entry; a mounted **retained** reader
  revalidates stale-in-place, a background/non-retained entry drops and refetches
  only if re-read. Server: broadcast; each client applies the local drop.
- **`refresh(selector)`** — *these reads are stale, refetch now (stale-visible).*
  Client: `cache.refresh` refetches, keeping the stale value painted. Server:
  broadcast; each client refetches eagerly.

The `CacheSelector` grammar (remote fn / fn+args / `{ tags }`) is already
wire-stable for the fn and tag forms — a remote fn's identity is `method+url`
(`keyPrefixForRemote`/`keyForRemoteCall`), stable across clients — so the
**exact-call case needs no tags**. Tags remain the cross-function-group escape
hatch. Producer/closure selectors mint a per-process ref id (`selectorPrefix.ts`)
and are **not** cross-client serializable.

## Decision

**1. Reintroduce `invalidate` as the drop verb.** Add `shared/invalidate.ts`
mirroring `shared/refresh.ts` (async-cell short-circuit, then delegate), a
`"./shared/invalidate"` exports key with `// @documentation cache`,
`fn.invalidate(args?)` in `attachRpcSelectorMethods.ts` beside `refresh`, the
`invalidate(args?): void` signature on the base `RemoteFunction` intersection
(with `refresh`, not the `patch`/streaming-omit branch), and reverse the
`RemoteFunction:70` fold doc. Regenerate `AGENTS.md`
(`scripts/readmeSurfaces.ts`); add a changeset.

**2. One side-swap seam.** Add
`shared/cacheStalenessSlot.ts = createResolverSlot<(op: 'invalidate' | 'refresh', selector, args?) => void>(localApply)`.
Both free functions route through it after the async-cell branch, so
`shared/invalidate.ts` and `shared/refresh.ts` stay **byte-identical on both
sides**. The fallback applies the local op (unbooted unit tests keep today's
behaviour). The **client entry** installs local-apply; the **server entry**
installs a broadcaster imported *only* from `serverEntry.ts`. This is the
`cacheStoreSlot` precedent exactly.

That import discipline — not any build guard — is what keeps the broadcaster out
of the client bundle. The ADR-0022 DCE reachability guard polices the *app's own*
`src/server` edge and the public `abide/server/` specifier; it does **not** see
abide's internal `lib/server/*` modules, so it would not catch a leak from a
client-reachable lib module importing the broadcaster. The guarantee is that
`cacheStalenessSlot.ts` imports only the local-apply path and the broadcaster is
reached solely through the server-installed resolver — a discipline enforced by
review, which is why the broadcaster module carries a do-not-import warning.

**3. One reserved internal topic.** The server broadcaster serializes the
selector to a monomorphic envelope and publishes to a framework-minted socket
`__abide/cache`, reusing `defineSocket`'s subscriber-gated fan-out + tail/ttl
buffer verbatim. The `__abide/*` socket namespace is reserved, enforced at two
points: `createServer`'s boot scan rejects any user socket *file* declaring a
reserved name, and `registerSocket` (the chokepoint every socket flows through)
refuses to register a reserved name with `clientPublish` enabled. So the topic is
**server-publish-only** and can never be turned client-publishable — a browser can
never forge a staleness frame.

**4. Every client subscribes at boot.** After cache seeding, `startClient`
opens `__abide/cache` in a reconnect loop; each frame rebuilds the predicate with
`matcherFromEnvelope` and calls the local `cache.invalidate`/`cache.refresh`. One
topic, one `op` discriminator, both verbs.

**5. Delivery is best-effort, online-only.** Subscriptions are live-only and the
reserved topic keeps no tail; a client offline when a frame is published misses
it and falls back to SWR staleness (the durable outbox was deleted 2026-07-10 —
this is deliberate).

### Wire format

A single monomorphic JSON envelope (all fields always present, JIT-friendly),
carried as the `message` of a standard socket frame on the reserved topic:

```ts
interface CacheStalenessFrame {
  op: 'invalidate' | 'refresh'
  mode: 'key' | 'prefix' | 'tags'
  match: string   // exact key, key prefix, or '' for tags
  tags: string[]  // [] unless mode === 'tags'
}
```

Encoding (server, via existing pure fns): fn+args →
`{ mode: 'key', match: keyForRemoteCall(method, url, args) }`; fn →
`{ mode: 'prefix', match: keyPrefixForRemote(method, url) }`; `{ tags }` →
`{ mode: 'tags', tags }`. Producer selectors are **rejected at encode time**.
Bare/undefined (match-all) is **not expressible over the wire** — it would nuke
every client's whole cache. Decoding is `selectorMatcher`'s three branches with
the `args !== undefined` discriminant replaced by explicit `mode`; the decoded
predicate drives the **same** store loop as a local apply — the loop body is
factored into one apply-by-matcher internal so wire-driven and local-driven
applies cannot diverge. No ref-json codec crosses the wire: args are already the
canonical string the read path keyed with, so they re-match by equality.

### Ordering and delivery — live-only, never replay

Applies are **idempotent** — dropping or refetching a read twice is wasteful,
never wrong — so correctness has *no* dependency on frame ordering, which
dissolves the multi-instance/load-balancer ambiguity. There is **no `seq`, no
watermark, and no replay at all**. Every subscription — boot *and* reconnect — is
**live-only**: a client applies only the frames published while it is connected.
This is the flash-*safe* choice (replaying pre-hydration frames is the only thing
that could drop freshly-hydrated data), and it is the simplest: the reserved
topic carries no retention tail (`tail: 0`, a pure live pipe). A client that was
offline when a frame was published simply misses it and falls back to SWR
staleness — the read revalidates on its own ttl. Best-effort, online-only, by
design (the durable outbox was deleted 2026-07-10).

## Consequences

- `invalidate` and `refresh` join `cache` as isomorphic verbs whose *runtime* is
  entry-swapped, not their source. No broadcast code reaches the client bundle
  because the broadcaster is imported only through the server-installed slot
  resolver — a review-enforced discipline, not something the DCE guard verifies
  (that guard does not police abide's own `lib/server/*` modules).
- **`refresh`'s server behaviour changes** from a local (throwaway, client-inert)
  refetch to a broadcast. Intended — but a semantic change to an existing public
  verb, so: minor bump + explicit changeset note.
- The client-observable difference between `invalidate` and `refresh` is real
  only for non-retained entries (explicit `cache()`, producers, reader-less
  background entries); a mounted smart/replayable read carries a
  retain+invalidation policy and revalidates stale-in-place under `invalidate`
  too (`cache.ts:776`). Docs say *"invalidate drops background/non-retained
  reads; a mounted retained reader revalidates stale-in-place,"* not "a pending
  flash."
- Server-side `invalidate`/`refresh` do **not** touch the request cache store;
  within-SSR-render consistency is unaffected (server smart reads are
  coalesce-only/non-retained and re-fetch regardless).
- The wire codec is the single authoring site for the on-wire selector, reusing
  `selectorPrefix`/`keyForRemoteCall`/`keyMatchesPrefix`/`toTagSet` so it cannot
  drift from `selectorMatcher`.
- `invalidate(asyncCell)` aliases `cell.refresh()` (an async cell has no
  retained entry to drop; its staleness is re-running its seed), matching
  `refresh(cell)`.
- **Isomorphism contract, pending ratification.** `CLAUDE.md` states `shared/*`
  is "same behaviour both sides." `invalidate`/`refresh` become *same intent,
  side-swapped runtime* — exactly what `cache` already is. This wording must be
  ratified explicitly, not slipped in.

## Reserved defaults

`__abide/cache`: `tail: 0` (pure live pipe, no retention). There is no offline
catch-up window — that is what SWR staleness is for.
