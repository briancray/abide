# Implementation plan — TODO #4: server SHARED cross-request cache + §8 broadcast

Companion to `rpc-core.md` (§2 cache scope, §8 broadcast) and `sockets.md` (S3–S5). `file:line` are
anchors in the current tree. Per-PR gates: `bun test` (739/0) green + `bunx tsc --noEmit` clean.
**Decided (channel-join auth):** a client may subscribe to a `(rpc,args)` invalidation channel iff it
passes the SAME gate that authorizes reading `(rpc,args)` — reuse that RPC's own middleware chain.

## 0. Orienting facts
- The cell is the only cache primitive, isomorphic (`shared/cell.ts`); every slot lives in
  `getContext().cache` (`cell.ts:114`) = per-request Map on server (`scope.ts:75`). No cross-request
  store today; `cache.shared`/`cache.tags` parsed but IGNORED (`makeRpc.ts:83`).
- Verbs exist locally: `refresh`/`invalidate` over `selectSlots` (`cell.ts:219-236`, superset match
  `matchesSelector` `:96-105`), `amend` value/updater (`:238-246`) — none broadcast.
- Mux complete for named user sockets: `wsSubscribe` looks up `config.sockets` (`router.ts:158`);
  upgrade carries NO identity (`Bun.ServerWebSocket<undefined>`, `:370`); `resolveIdentity`
  (`auth.ts:40`) runs only in HTTP `fetch` (`:387`).
- RPC read dispatch runs `route.load(args)` inside `compose([...global, ...rpc.middleware], dispatch)`
  (`router.ts:396`); a short-circuit is any returned `Response`.
- Request-scope accessors already FAIL CLOSED with no scope: `identity()`/`cookies()`/`request()`
  throw (`identity.ts:14`, `request.ts:7`) — the lever for §2.3 shared purity.
- `RouteKind` already has `socket-connect|subscribe|publish` (`scope.ts:16`). `ABIDE_MAX_SHARED_
  CACHE_SIZE` unused in src yet.

## Two spec tensions (resolve in the touching PR)
1. **Per-subscribe re-auth vs sockets S4.4** ("WS runs middleware only at connect"). The DECIDED note
   + rpc-core §8.4 OVERRIDE this for `@rpc:` cache channels specifically: joining `profile:B` re-runs
   `profile`'s chain for `{id:B}`. Stance: user-socket subscribe stays connect-authed; the new `@rpc:`
   join path is the explicit exception, re-runs per subscribe. Record in sockets.md S4.4.
2. **`amend` updater on a shared slot.** A closure can't cross the wire → on a shared slot the updater
   runs against the durable value server-side, then broadcasts the RESULT as a value-form frame; a
   server per-request slot updater-form errors. Value-form always broadcasts. Record in docs.

## 1. Ordered PRs (each keeps `bun test` green)
- **PR1 — Shared storage + fail-closed purity** (no transport). `shared/internal/sharedCache.ts`:
  process-global `Map` + `sharedStore()` + `sharedCacheEvictIfNeeded()` (LRU by
  `ABIDE_MAX_SHARED_CACHE_SIZE`, JSON-byte measure). `CellOptions.shared?`; `ensureSlot`/`selectSlots`
  route through `slotCache()`. Fail-closed = two checkpoints (§2.1). LRU lands here. Risk: LOW-MED.
- **PR2 — Broadcast substrate** (server→server). `server/internal/cacheChannels.ts`:
  `Map<channel, SocketHub<CacheFrame>>` + `cacheChannelName(rpc,args)` + `publishCacheFrame`. Cell gets
  an injectable `notify?(verb,args,value?)` sink (stays transport-free); `createApp` binds each shared
  read route's `notify`. Risk: LOW.
- **PR3 — Channel-join AUTH (SECURITY-CRITICAL, isolate + hard-test).** WS data → `{request,
  identity}` resolved at upgrade; `wsSubscribe` branches on `@rpc:` prefix → `authorizeChannelJoin`
  re-runs the target RPC's `compose(global, rpc.middleware)` with a no-op terminal; pass ⇒ join, any
  short-circuit Response ⇒ silent deny. Risk: HIGH.
- **PR4 — Tags.** `CellOptions.tags`; global `invalidate/refresh({tags})` broadcast on `@tag:<t>`.
  Risk: MED.
- **PR5 — Client auto-subscribe + apply.** Browser cell reading a `shared` RPC joins its channel
  (lazy one-WS-per-tab mux) and applies inbound frames via its own `invalidate/refresh/amend`. Risk:
  MED.
- **PR6 — Docs.** Flip rpc-core §2/§8 status, sockets S4.4 exception, remove `cell.ts:14` TODO, TODO
  #4 → DONE.

## 2. Design highlights
### 2.1 Storage + fail-closed
Store keyed exactly as today (`prefix + canonicalKey(args)`, nothing ambient). `slotCache() = shared ?
sharedStore() : getContext().cache`. Fail-closed = TWO complementary checkpoints:
1. **Handler isolation** — a shared slot's `startLoad` runs `fn(args)` OUTSIDE any request scope (new
   `runOutsideScope` via `scopeStorage.exit`) so `identity()`/`cookies()`/`request()` THROW → a shared
   handler touching request scope rejects, value NEVER cached, in dev AND prod (accessors throw
   unconditionally). This is §2.3.
2. **Ambient-entry guard** — a shared READ with `currentScope() === undefined` throws "shared cell
   read requires an active request scope" (bare script/cron has no gate + no client to serve). Scoped
   to shared cells only; the default-context LRU ceiling still applies to ordinary ambient reads.
The caller must be authorized (in a request); the handler must be blind to it (purity). Same call,
opposite ends.

### 2.2 Broadcast channels
`cacheChannelName(rpc,args) = "@rpc:" + rpc + ":" + canonicalKey(args)` (reserved `@` namespace; user
sockets are bare names, no `:`). Reuse `SocketHub` (`socketHub.ts:70`) verbatim. `CacheFrame = {verb:
"invalidate"|"refresh"|"amend", value?}`. Route-name seam: `createApp` binds each shared read's cell
`notify` to `publishCacheFrame(cacheChannelName(name, args), …)` (only `createApp` knows both name +
registry; cell/makeRpc stay transport-free).

### 2.3 Channel-join AUTH (the crux)
Identity resolved ONCE at upgrade (cookie/bearer via `resolveIdentity`), stored on the connection
(`SocketConnectionData = {request, identity}`; touches every `ServerWebSocket<undefined>` annotation).
Per-SUBSCRIBE re-check: `authorizeChannelJoin(channel, connData, config)` parses `{rpcName, key}`,
synthesizes an `rpc`-kind scope with the connection's identity, runs `compose([...global,
...rpc.middleware], () => AUTHORIZED_SENTINEL)` via `runInScope`; `res === sentinel` ⇒ pass, any other
Response ⇒ deny (silent, matching today's ignore contract). Re-checked per subscribe because
middleware enforces per-args row-level authz.

**Args-spoof hole (the single most important adversarial test):** `canonicalKey` is opaque/lossy — the
channel name can't reconstruct `args` for the middleware run. So the client's subscribe frame carries
RAW args: `{t:"sub", name:"@rpc:profile:<key>", args:{id:"B"}}`, and the server VERIFIES
`cacheChannelName(rpcName, args) === name` before authorizing (prevents claiming channel X with args
for Y). The auth run uses the verified args.

### 2.4 Tags / 2.5 Client
Tags: `@tag:<t>` channels; global `invalidate/refresh({tags})` broadcasts per tag. Client: one lazy
mux WS/tab; `shared` flag flows from `__rpc.options.cache.shared` into `makeClientImports` specs;
first read auto-subscribes `{t:"sub", name, args}`; inbound frame → the SAME local cell verb
(`invalidate`→lazy reload, `refresh`→eager, value-`amend`→`amend(args,value)`). No new client cache
logic. Auto-subscribe (reading in a tracking context is the trigger); dispose unsubscribes.

## 3. Security test strategy (PR3, `channelAuth.test.ts`)
Build on `createTestApp` + `.as(identity)` + the WS `socketClient` (extend `subscribe` to send `args`).
`profile` = shared GET read with middleware that `error(403)`s unless `identity().id === args.id`.
1. `.as({id:A})` reads `profile({id:A})` → 200 baseline. 2. A subscribes `@rpc:profile:<key(B)>` args
`{id:B}` → broadcast to B, A's stream TIMES OUT (denied = silent, no fanout). 3. Positive: A subscribes
own channel → a server `profile.amend({id:A}, v)` delivers exactly `{verb:"amend", value:v}`. 4.
**Args-spoof:** subscribe name for A but args `{id:B}` → rejected on channel-name mismatch. 5.
**Per-subscribe:** one connection joins allowed then attempts forbidden → first joins, second denied.
6. **Anonymous WS:** no identity → forbidden channels denied, only public (middleware-less) shared
channels join. 7. **Fanout isolation:** A and B each join own channel; whole-callable
`profile.invalidate()` → each gets only its own frame.
Fail-closed (PR1, `sharedCache.test.ts`): cross-request memoization; shared handler calling
`identity()` rejects + NOT cached (assert under NODE_ENV unset AND production); bare shared read
throws; LRU eviction.

## 4. Deferred / parked
Horizontal-scaling backplane (single-process only, sockets S3.3 — the channel-hub registry is the
Redis-adapter seam); `canSubscribe` predicate (sockets S4); rich-value byte-measuring (§2.4 PARKED,
RPC values JSON-measured); client bare-tag-channel subscription; explicit subscribe opt-out;
updater-form-over-the-wire (closures can't serialize).

## Critical files
`shared/cell.ts` · `server/internal/router.ts` · `server/internal/makeRpc.ts` · `scope.ts` ·
`server/internal/auth.ts`.
