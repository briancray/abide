import { abideLog } from './abideLog.ts'
import { activeCacheStore } from './activeCacheStore.ts'
import { cacheStores } from './cacheStores.ts'
import { decodeResponse } from './decodeResponse.ts'
import { getRemoteMeta } from './getRemoteMeta.ts'
import { HttpError } from './HttpError.ts'
import { hydratingSlot } from './hydratingSlot.ts'
import { invalidateEvent } from './invalidateEvent.ts'
import { invalidateTripwire } from './invalidateTripwire.ts'
import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { producerKey } from './producerKey.ts'
import { REMOTE_FUNCTION } from './REMOTE_FUNCTION.ts'
import { REPLAYABLE_METHODS } from './REPLAYABLE_METHODS.ts'
import { rpcErrorRegistry } from './rpcErrorRegistry.ts'
import { SocketDisconnectedError } from './SocketDisconnectedError.ts'
import { selectorMatcher } from './selectorMatcher.ts'
import { selectorPrefix } from './selectorPrefix.ts'
import { sharedCacheStore } from './sharedCacheStore.ts'
import { openStreamProbe } from './subscribableProbes.ts'
import { toTagSet } from './toTagSet.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheOnContext } from './types/CacheOnContext.ts'
import type { CacheOptions } from './types/CacheOptions.ts'
import type { CachePolicy } from './types/CachePolicy.ts'
import type { CacheSelector } from './types/CacheSelector.ts'
import type { CacheStore } from './types/CacheStore.ts'
import type { NamedAsyncIterable } from './types/NamedAsyncIterable.ts'
import type { RawRemoteFunction } from './types/RawRemoteFunction.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'
import { withCacheManaged } from './withCacheManaged.ts'

type AnyRemote<Args, Return> = RemoteFunction<Args, Return> | RawRemoteFunction<Args>
type Producer<Args, Return> = (args?: Args) => Promise<Return>

/* Per-read lifecycle diagnostics, opt-in via DEBUG=abide:cache (browser: the abide-debug localStorage key). */
const cacheLog = abideLog.channel('abide:cache')

/*
Tallies one read and narrates it on the diagnostics channel. The sink is the
request/tab store even when the data store is the process-level shared one —
attribution follows the asker, so a request's closing record reflects every
read it made. A settled retained entry (including the warm SSR sync path) is
a hit; an unsettled entry is a coalesced join of an in-flight call; no entry
is a miss that invokes the producer/remote.
*/
function recordRead(sink: CacheStore, key: string, existing: CacheEntry | undefined): void {
    if (!existing) {
        sink.stats.misses += 1
        cacheLog(`miss ${key}`)
        return
    }
    if (existing.settled === true) {
        sink.stats.hits += 1
        cacheLog(`hit ${key}`)
        return
    }
    sink.stats.coalesced += 1
    cacheLog(`coalesced ${key}`)
}

/*
Reads a call through a cache store. `cache(fn, args?)` checks the store for a
prior entry and returns a shared promise on hit, or invokes `fn` once and stores
its promise on miss — a direct read-through call, not a curried invoker. Args
lead (the common refinement).

A REMOTE rpc carries no call-site options (ADR-0020): its cache policy lives on
the endpoint definition (`GET(fn, { cache: {...} })`) and readThrough reads it as
the bottom layer. A plain PRODUCER has no endpoint, so it keeps a trailing
`options?: CacheOptions` (ttl/tags/throttle/debounce/shared) — its only policy
home. ttl = 0 → dedupe only; ttl > 0 → entry expires `ttl` ms after the promise
resolves. Omitted ttl → retained for the store's lifetime: a producer or a remote
READ is kept as long as its store lives (the request on the server, the tab on the
client), while a remote WRITE coalesces only (ttl 0 — the mutation idiom). A remote
read made outside any request scope falls back to the process store and coalesces
only too, so a scopeless read can't leak forever. See CachePolicy.

Coalescing is always on: identical in-flight calls share one flight — double-
submit coalescing and pending() visibility with nothing retained beyond the
store's atomic unit (the whole request on the server: one render, one effect; the
in-flight window in the tab). Caching is the retention `ttl` adds on top.

`fn` is either a remote function (a GET/POST/... helper) or a plain producer
returning a Promise:

  cache(getPost, { id })          // → Promise<Post>      (decoded body; policy on the endpoint)
  cache(getPost.raw, { id })      // → Promise<Response>  (raw escape hatch)
  cache(fetchRates)               // → Promise<Rates>     (plain producer, no args)
  cache(computeReport, input, { ttl: 60_000 })  // producer options trail

Remote calls key on fn.method + fn.url + args and store the underlying Response
(the decoded view is derived on the way out for the non-raw variant; both share
one entry). Producers have no wire identity, so they key on the producer's
reference + args — pass a hoisted/stable function to dedupe (an inline arrow is a
new reference every call and never does; a warning fires once per such call
site), and the promise is stored and handed back as-is (no Response, no decode,
no SSR snapshot).

`options.shared` (producer) / `cache.shared` (endpoint) puts the entry in the
process-level store instead of the request-scoped one, so a value computed in one
request is reused by later requests — the memoise-an-external-endpoint case.
Default (omitted) is request-scoped on the server, which keeps per-user data from
leaking across requests; on the client there is one tab store either way, so it is
a no-op.

Reactivity is implicit: the read calls `store.subscribe(key)`, which registers
the surrounding state.computed() / effect() scope. Invalidating the key then
re-runs that scope, which calls cache() again and gets a fresh entry. Outside a
tracking scope subscribe() is a no-op, so cache() works the same in server code
and plain client code.

SSR: how you consume the call decides inline vs streaming (during SSR only the
pending branch of a `<template await>` renders):

  const post = await cache(getPost, { id })   // blocks render → baked into
                                              // the initial SSR HTML
  <template await={cache(getPost, { id })}>   // renders pending → shell flushes
                                              // now, value streams in on the
                                              // same response when it resolves

The two don't mix within one component. A top-level `await` flips the async
render into await-everything mode and sweeps in every promise created
in that same component instance — so a sibling `<template await>` gets awaited
and inlined too, buffering the whole response to the slowest read. The markup
form doesn't change this: an await block renders its pending branch but render()
still blocks. To get both on one page,
isolate each blocking (top-level await) read in its own child component and
keep streaming reads in a parent that never top-level awaits — the
await-everything mode is per component instance, so a child's await blocks only
the child.
*/
// @documentation cache
/**
 * @deprecated Streaming rpcs (jsonl/sse) aren't cacheable — a stream has no single
 * value to retain. Consume it with `state(fn(args))` (reactive) or `for await (… of
 * fn(args))` (imperative). This overload is selected first for a streaming rpc so the
 * mistake is a red squiggle at the keyboard; the `decodeResponse` guard also throws.
 */
export function cache<Args>(
    fn: RemoteFunction<Args, AsyncIterable<unknown>>,
    ...rest: never[]
): never
export function cache<Args, Return>(fn: RemoteFunction<Args, Return>, args?: Args): Promise<Return>
export function cache<Args>(fn: RawRemoteFunction<Args>, args?: Args): Promise<Response>
export function cache<Args, Return>(
    fn: Producer<Args, Return>,
    args?: Args,
    options?: CacheOptions,
): Promise<Return>
export function cache<Args, Return>(
    fn: AnyRemote<Args, Return> | Producer<Args, Return>,
    args?: Args,
    options?: CacheOptions,
): Promise<Return | Response> {
    return readThrough(fn, args, options, false)
}

/*
The smart bare rpc call routes here (createRemoteFunction.callable → cache.read):
identical to cache() except a replayable read gets unconditional SWR retention —
its value is kept for display regardless of ttl, and ttl marks a staleness
deadline (the next read past it revalidates in the background) instead of driving
eviction. No call-site options (ADR-0020): all policy is read off the endpoint
(fn.cache). Always a decoded RemoteFunction read (the callable carries .raw), so
it returns Promise<Return>.
*/
function smartRead<Args, Return>(fn: RemoteFunction<Args, Return>, args?: Args): Promise<Return> {
    return readThrough(fn, args, undefined, true) as Promise<Return>
}
cache.read = smartRead

/*
The shared read-through core. `smart` marks the smart bare call, which enables
unconditional SWR retention for a replayable read — but only on the client (see
smartRead / entry.retain and the `retain` computation below); the public cache()
passes false, keeping its explicit drop-on-ttl / drop-on-invalidate old surface.
A remote's policy is read off the endpoint (fn.cache — ADR-0020); a producer's
policy is its explicit cache() `options`.
*/
function readThrough<Args, Return>(
    fn: AnyRemote<Args, Return> | Producer<Args, Return>,
    args: Args | undefined,
    options: CacheOptions | undefined,
    smart: boolean,
): Promise<Return | Response> {
    /*
    A remote function carries the REMOTE_FUNCTION brand (set by
    createRemoteFunction on both variants); a plain producer never does — exact,
    unlike a `url` property check a user function could satisfy by accident.
    Among remotes, the "raw" variant lacks its own `.raw` sibling (only the
    decoded callable carries one), which selects whether the decode step runs
    on the way out.
    */
    const isRemote = REMOTE_FUNCTION in fn
    const isRaw = isRemote && !('raw' in fn)
    const rawFn = !isRemote
        ? undefined
        : isRaw
          ? (fn as RawRemoteFunction<Args>)
          : (fn as RemoteFunction<Args, Return>).raw
    const method = isRemote ? (rawFn as RawRemoteFunction<Args>).method : undefined
    const replayable = method !== undefined && REPLAYABLE_METHODS.has(method.toUpperCase())
    /* Remote policy is endpoint-declared — the bottom (and only) layer; a producer has no
       endpoint, so its explicit cache() options stand in. */
    const policy = isRemote
        ? resolveEndpointCache(fn as AnyRemote<Args, Return>, args)
        : options
    /* SWR retention is a client concern (the tab store lives; revalidation is
       visible). On the server there is no live UI to hold stale, so a smart read
       never retains — it coalesces only. Unconditional for a replayable read now
       (no swr toggle to opt out of). */
    const retain = smart && replayable && typeof window !== 'undefined'
    /*
    ttl defaults to Infinity — an entry is retained for as long as its STORE lives, and
    the store's lifetime (not ttl) is what ends a read: the request-scoped store on the
    server (so a non-shared read dies with the request regardless of ttl), the tab store
    on the client (until invalidate/refresh). `shared` selects the process store, where
    the default Infinity memoises across requests and an explicit ttl bounds it — so
    `shared` alone is "memoise", not a store-selector that retains nothing.
    */
    const store = policy?.shared ? sharedCacheStore() : activeCacheStore()
    /*
    Two cases force coalesce-only (ttl 0) when the caller stated no ttl — nothing retained
    beyond the in-flight window:
    - a write (non-replayable remote): dropped on settle so a re-submit of the same body
      isn't blocked by a retained entry (the mutation idiom);
    - a read that resolved to the process store WITHOUT `shared` — a server read outside any
      request scope, where activeCacheStore() falls back to the shared store. Nothing bounds
      its lifetime there, so retaining it would leak forever.
    Both apply on either side and however the call is made.
    */
    const coalesceOnly =
        isRemote &&
        policy?.ttl === undefined &&
        (!replayable ||
            (!policy?.shared && typeof window === 'undefined' && store === sharedCacheStore()))
    const effectiveOptions = coalesceOnly ? { ...policy, ttl: 0 } : policy
    if (!isRemote) {
        warnAnonymousProducer(fn as Producer<Args, Return>)
    }
    if (!isRemote) {
        return invokeProducer(store, fn as Producer<Args, Return>, args, effectiveOptions)
    }
    const remote = rawFn as RawRemoteFunction<Args>
    const key = keyForRemoteCall(remote.method, remote.url, args)
    if (
        !effectiveOptions?.shared &&
        effectiveOptions?.ttl !== undefined &&
        effectiveOptions.ttl > 0 &&
        store !== sharedCacheStore()
    ) {
        warnEphemeralTtl(key)
    }
    store.subscribe(key)
    const existing = store.entries.get(key)
    recordRead(effectiveOptions?.shared ? activeCacheStore() : store, key, existing)
    if (existing) {
        tagEntry(existing, effectiveOptions?.tags)
        attachPolicy(existing, effectiveOptions, () => remote(args as Args), retain)
        adoptTtl(store, existing, effectiveOptions, retain)
        /* Access-triggered staleness: reading a retained entry past its ttl deadline
           kicks a background revalidation now (stale value stays visible below,
           refreshing() true). Guarded on `!refreshing` so a read while one is already
           in flight doesn't queue a redundant refetch. This is the whole staleness
           mechanism — no timer polls an untouched entry. */
        if (
            existing.retain === true &&
            existing.refreshing !== true &&
            existing.expiresAt !== undefined &&
            existing.expiresAt <= Date.now()
        ) {
            scheduleInvalidationRefetch(store, existing)
        }
    }
    /*
        Warm path: a value pre-decoded onto the entry — by the SSR cache
        snapshot the client seeds its store from — is served without a network
        round-trip. It resolves on a
        microtask (a settled Promise), not synchronously, so every cache() read
        is uniformly `Promise<Return>` and `.then`/`.catch`/`.finally` chain
        cleanly. Raw callers take the Response path; after an invalidate the
        replacement entry carries no value and falls through to a live fetch.

        abide-ui hydration is seamless regardless: a `<template await>` adopts
        the server-rendered DOM from the streamed resume manifest (it never calls
        cache() on the first pass), so a microtask warm read costs no flash — the
        snapshot's job is keeping post-hydration reads (reactivity, invalidation,
        navigation) warm, not driving the initial paint.

        Each warm read resolves to its own clone of the stored value: it is
        decoded once and would otherwise be shared by reference across every
        reader of the key, so one mutating it would corrupt the others. A live
        fetch hands each reader a fresh object; cloning keeps warm reads the same.
        */
    if (!isRaw && existing !== undefined && existing.value !== undefined) {
        return Promise.resolve(cloneWarmValue(existing.value)) as Promise<Return>
    }
    const responsePromise = invokeRemote(
        store,
        key,
        existing,
        rawFn as RawRemoteFunction<Args>,
        args,
        effectiveOptions,
        retain,
    )
    if (isRaw) {
        return responsePromise
    }
    return responsePromise.then(decodeResponse) as Promise<Return>
}

/*
Deep-copies a warm value so each reader gets its own mutable object — the
no-shared-mutation invariant the warm path turns on (a live fetch hands every
reader a fresh object; a warm read must match). A warm value only ever comes
from the json or text body kinds (bodyValueForKind): json yields JSON.parse
output and text yields a string, so the whole population is JSON-round-trippable
by construction — no Date/Map/Blob/cycle a structuredClone would be needed for.
A primitive (string/number/boolean from a text or scalar-json body) is immutable,
so it is returned as-is with no copy. An object/array goes through a JSON
round-trip, ~2x faster than structuredClone for this exact shape (measured:
773µs→516µs on a 149KB list, 3.4ms→1.7ms on 474KB) while producing the same
fresh, mutable, isomorphic-with-a-cold-read copy.
*/
function cloneWarmValue(value: unknown): unknown {
    if (typeof value !== 'object' || value === null) {
        return value
    }
    return JSON.parse(JSON.stringify(value))
}

/*
Resolves an rpc endpoint's declared cache policy (ADR-0020) into a plain
CacheOptions for the read-through machinery, evaluating the `tags` function form
against this call's args. Both remote variants (decoded + raw) carry `.cache`, so
either can be passed. Undefined when the endpoint declared no policy (method
defaults still apply below).
*/
function resolveEndpointCache<Args, Return>(
    fn: AnyRemote<Args, Return>,
    args: Args | undefined,
): CacheOptions | undefined {
    const policy = (fn as { cache?: CachePolicy<Args> }).cache
    if (policy === undefined) {
        return undefined
    }
    const tags = typeof policy.tags === 'function' ? policy.tags(args as Args) : policy.tags
    return {
        ttl: policy.ttl,
        tags,
        shared: policy.shared,
        throttle: policy.throttle,
        debounce: policy.debounce,
    }
}

/*
The keep-stale-and-revalidate refetch window, or undefined when the entry should
hard-drop on invalidate instead. Present when the smart bare call retains a
replayable read (`defaultOn`, SWR unconditional — the window is just the endpoint's
throttle/debounce, or `{}` = fire immediately) OR when a policy explicitly declares
a throttle/debounce window (producer options / endpoint cache). Collapsing this here
lets every downstream site treat "is a refetch window armed" as a single
defined/undefined check.
*/
function refetchWindow(
    options: CacheOptions | undefined,
    defaultOn: boolean,
): { throttle?: number; debounce?: number } | undefined {
    const hasWindow = options?.throttle !== undefined || options?.debounce !== undefined
    if (defaultOn || hasWindow) {
        return { throttle: options?.throttle, debounce: options?.debounce }
    }
    return undefined
}

/*
An anonymous producer mints a fresh identity per wrap, so it never coalesces
and probes never match it — silently. Warn once per distinct source text (the
function object itself is fresh each time, so reference identity can't dedupe
the warning).
*/
const warnedAnonymousProducers = new Set<string>()
function warnAnonymousProducer(producer: (args?: never) => unknown): void {
    if (producer.name !== '') {
        return
    }
    const source = producer.toString()
    if (warnedAnonymousProducers.has(source)) {
        return
    }
    warnedAnonymousProducers.add(source)
    abideLog.warn(
        'cache() received an anonymous function — each call mints a fresh identity, so it never coalesces and pending()/refreshing() never match it. Hoist it to a named binding, or add a tag to probe it from elsewhere.',
    )
}

/* Warn once per key when a ttl>0 read lands in an ephemeral (request-scoped)
   store — the ttl expires with the request. `shared` (the process store) or a
   client tab store are the retention homes; a request-scoped ttl is dead config. */
const warnedEphemeralTtl = new Set<string>()
function warnEphemeralTtl(key: string): void {
    if (warnedEphemeralTtl.has(key)) {
        return
    }
    warnedEphemeralTtl.add(key)
    abideLog.warn(
        `cache(): a request-scoped ttl expires with the request — add \`shared\` to cache "${key}" across requests, or drop the ttl.`,
    )
}

/*
Producer path: key on the producer's reference + args, share the
in-flight/retained promise on hit, and store the value promise as-is on miss — no
Response, no decode, no SSR request metadata.
*/
function invokeProducer<Args, Return>(
    store: CacheStore,
    producer: Producer<Args, Return>,
    args: Args | undefined,
    options: CacheOptions | undefined,
): Promise<Return> {
    const key = producerKey(producer, args)
    store.subscribe(key)
    const existing = store.entries.get(key)
    recordRead(options?.shared ? activeCacheStore() : store, key, existing)
    if (existing) {
        tagEntry(existing, options?.tags)
        attachPolicy(existing, options, () => producer(args), false)
        const shared = existing.promise as Promise<Return>
        /* A coalesced join waits on the in-flight producer — time the block so the
           waterfall shows it; a settled hit returns immediately, so no span. */
        return existing.settled === true
            ? shared
            : cacheLog.trace<Return>(`cache wait ${key}`, () => shared)
    }
    /* Miss: time the producer run — where a request's time actually goes (an
       external fetch, a computation). Producer path only; the remote path must
       keep its own promise so getRemoteMeta can read the recorded Request. The
       producer runs cache-managed so a bare RPC inside it isn't scope-bound — the
       cache coalesces and owns this flight. */
    const promise = cacheLog.trace<Return>(`cache ${key}`, () =>
        withCacheManaged(() => producer(args)),
    )
    registerEntry(store, key, promise, options, undefined, () => producer(args), false)
    return promise
}

function invokeRemote<Args>(
    store: CacheStore,
    key: string,
    existing: CacheEntry | undefined,
    rawFn: RawRemoteFunction<Args>,
    args: Args | undefined,
    options: CacheOptions | undefined,
    retain: boolean,
): Promise<Response> {
    if (existing) {
        return shareable(existing.promise as Promise<Response>)
    }
    /* Cache-managed: the shared flight isn't bound to the reader that triggered the
       miss, so its scope disposing can't abort a request other readers still join. */
    const promise = withCacheManaged(() => rawFn(args as Args))
    const request = getRemoteMeta(promise)
    if (!request) {
        throw new Error(
            '[abide] cache() received a function whose call did not record metadata — was it produced by a rpc helper?',
        )
    }
    registerEntry(store, key, promise, options, request, () => rawFn(args as Args), retain)
    return shareable(promise)
}

/*
Stores a fresh entry and wires its settle / ttl / eviction lifecycle. Shared by
the remote and producer paths; `request` is set for remote entries (drives the
SSR snapshot) and undefined for producers.
*/
function registerEntry(
    store: CacheStore,
    key: string,
    promise: Promise<unknown>,
    options: CacheOptions | undefined,
    request: Request | undefined,
    refetch: () => Promise<unknown>,
    retain: boolean,
): CacheEntry {
    const ttl = options?.ttl
    /* Capture the refetch thunk + window when a smart retained read (SWR unconditional)
       or an explicit throttle/debounce window is present. */
    const policy = refetchWindow(options, retain)
    const invalidation = policy
        ? { refetch, throttle: policy.throttle, debounce: policy.debounce }
        : undefined
    /*
    A prior entry for this key was dropped by invalidate() and is awaiting its
    next read — consume the marker so this replacement read reports as a reload
    (refreshing()) until it settles, not as a first-ever load.
    */
    const refreshing = store.pendingRefresh.delete(key) || undefined
    const entry: CacheEntry = {
        key,
        promise,
        request,
        ttl,
        expiresAt: undefined,
        tags: options?.tags === undefined ? undefined : toTagSet(options.tags),
        refreshing,
        invalidation,
        retain: retain || undefined,
    }
    store.entries.set(key, entry)
    store.markLifecycle(key)
    /*
    A ttl=0 remote entry in the request-scoped server store is kept until the
    store dies with the response. The request is the server's atomic unit, so
    a ttl=0 entry retains nothing beyond it but coalesces everything within
    it: identical calls during one render — any method — share one effect
    deterministically, regardless of settle timing, and the post-render SSR
    snapshot can still pick up replayable entries (the snapshot applies its
    own method filter; writes never ship). The keep never applies on the
    client (the tab store outlives any unit — a kept write would block every
    future re-submit, so entries evict the moment they settle), to producer
    entries (no request), or when the resolved store is the process-level
    `shared` store — including a non-shared read made outside an inbound
    request, where the resolver falls back to `sharedCacheStore()` (Decision
    1): that store is never request-scoped, so keeping it would leak forever.
    The `store !== sharedCacheStore()` check is what tells a genuinely
    request-scoped store apart from that fallback.
    */
    const keepZeroTtlForRequest =
        request !== undefined &&
        !options?.shared &&
        typeof window === 'undefined' &&
        store !== sharedCacheStore()
    function deleteIfCurrent() {
        evictIfCurrent(store, entry)
    }
    promise.then((result) => {
        /*
        Mark settled so SSR snapshot serialization can tell awaited entries
        (resolved by the time render() returns → inline) from {#await} ones
        (still pending → stream). Set before the ttl branches below since a
        ttl=0 server entry stays in the store for the snapshot.
        */
        entry.settled = true
        /* The reload finished — this entry now holds fresh data, no longer refreshing. */
        entry.refreshing = false
        store.markLifecycle(key)
        /*
        An error-status Response is a failed load, not a value to retain: fetch
        resolves (it only rejects on a network fault) on a 4xx/5xx, so without
        this the entry would be served as a hit for the whole ttl, even after the
        backend recovers. Evict it so the next read retries — mirroring fireRefetch,
        which already guards revalidation results with the same `!result.ok` check.
        */
        if (result instanceof Response && !result.ok) {
            deleteIfCurrent()
            return
        }
        /*
        A post-invalidate reload registers with refreshing=true; an invalidation
        firing while it was in flight parked its refetch on policy.pending
        (fireRefetch bails when refreshing). This settle path — not fireRefetch —
        cleared the flag, so drain the parked refetch here or it's lost and the
        entry keeps data that predates the invalidation.
        */
        if (entry.invalidation?.pending) {
            reschedulePendingRefetch(store, entry, entry.invalidation)
        }
        /*
        Smart retained read: the display value is kept unconditionally — never
        hard-evicted on settle. ttl marks a staleness deadline (the next read past
        it revalidates in the background, stale stays visible, refreshing() true)
        instead of eviction; ttl 0/undefined retain with no staleness clock.
        */
        if (entry.retain) {
            materializeRetained(store, entry, result)
            if (ttl !== undefined && ttl > 0) {
                stampStaleDeadline(entry, ttl)
            }
            return
        }
        if (ttl === 0) {
            if (!keepZeroTtlForRequest) {
                deleteIfCurrent()
            }
            return
        }
        if (ttl !== undefined) {
            armTtlExpiry(store, entry, ttl)
        }
    }, deleteIfCurrent)
    return entry
}

/*
Evicts `entry` unless a newer entry already owns the key (a concurrent
invalidate-and-reread must not lose its replacement). Disarms any policy timer
first — an armed timer would otherwise refetch a key that no longer exists.
*/
function evictIfCurrent(store: CacheStore, entry: CacheEntry): void {
    if (store.entries.get(entry.key) === entry) {
        clearTimeout(entry.invalidation?.timer)
        store.entries.delete(entry.key)
        store.markLifecycle(entry.key)
    }
}

/* Arms the ttl > 0 expiry sweep; `expiresAt` re-checks at fire time so a refreshed deadline survives. */
function armTtlExpiry(store: CacheStore, entry: CacheEntry, ttl: number): void {
    entry.expiresAt = Date.now() + ttl
    scheduleTtlSweep(store, entry)
}

/* setTimeout clamps a delay beyond 2^31-1 ms (~24.8 days) to ~1ms, which would
   fire the sweep instantly, find the deadline unexpired, and never re-arm —
   the entry would live forever. Chain capped hops until the deadline is in
   reach; each hop bails once a newer entry owns the key. */
const MAX_TIMEOUT_DELAY = 2147483647

function scheduleTtlSweep(store: CacheStore, entry: CacheEntry): void {
    if (store.entries.get(entry.key) !== entry) {
        return
    }
    const remaining = (entry.expiresAt ?? 0) - Date.now()
    if (remaining > MAX_TIMEOUT_DELAY) {
        setTimeout(() => scheduleTtlSweep(store, entry), MAX_TIMEOUT_DELAY).unref?.()
        return
    }
    setTimeout(() => {
        if ((entry.expiresAt ?? 0) <= Date.now()) {
            evictIfCurrent(store, entry)
        }
    }, remaining).unref?.()
}

/*
Stamps the smart-read staleness deadline. Revalidation is access-triggered, NOT
timer-driven: once `expiresAt` has passed, the NEXT read of the entry (see the
staleness branch in readThrough) schedules a background revalidation — the stale
value stays visible, refreshing() flips true, and fireRefetch re-stamps a fresh
deadline on success. No `setTimeout`, so an entry no reader touches never refetches
on its own — no background polling accretes across a session.
*/
function stampStaleDeadline(entry: CacheEntry, ttl: number): void {
    entry.expiresAt = Date.now() + ttl
}

/*
Decodes a retained read's Response onto entry.value so peek() can read the current
value synchronously, and reads take the warm (cloned) path. Client-only: on the
server the SSR snapshot serializer owns value materialization (from the response
body it inlines), so leaving entry.value untouched there keeps the snapshot path
unchanged. Async decode (a microtask); markLifecycle re-runs a peek() scope once
the value lands. A non-Response (a producer retain — not currently reachable) is
stored as-is.
*/
function materializeRetained(store: CacheStore, entry: CacheEntry, result: unknown): void {
    if (typeof window === 'undefined') {
        return
    }
    if (result instanceof Response) {
        decodeResponse(result.clone()).then(
            (value) => {
                /* Only if this entry still owns the key and hasn't been re-mutated meanwhile. */
                if (store.entries.get(entry.key) === entry) {
                    entry.value = value
                    store.markLifecycle(entry.key)
                }
            },
            () => undefined,
        )
        return
    }
    entry.value = result
    store.markLifecycle(entry.key)
}

/*
Mirrors tagEntry/attachPolicy for retention: a hydrated snapshot entry ships
without its wrap options (they live at call sites, not on the wire), so the
first read adopts its call site's ttl declaration. Omitted = forever, exactly
as shipped; ttl > 0 = the expiry clock starts at this read; ttl = 0 = the warm
value exists only to complete the hydration render — the SSR request's atomic
unit ends here — so eviction is deferred one macrotask (every reader in the
same hydration pass still gets the warm value, no invalidate event fires, and
the already-painted DOM stays put) and the next read fetches live. The first
reader consumes the flag, so its declaration wins; live entries never carry
the flag and keep the ttl they registered with.
*/
function adoptTtl(
    store: CacheStore,
    entry: CacheEntry,
    options: CacheOptions | undefined,
    retain: boolean,
): void {
    if (entry.hydrated !== true) {
        return
    }
    entry.hydrated = false
    /* A smart read adopting a hydrated entry retains it and stamps the staleness
       deadline, mirroring registerEntry's retain branch — never the hard-evict path. */
    if (retain) {
        entry.retain = true
        const ttl = options?.ttl
        entry.ttl = ttl
        if (ttl !== undefined && ttl > 0) {
            stampStaleDeadline(entry, ttl)
        }
        return
    }
    const ttl = options?.ttl
    if (ttl === undefined) {
        return
    }
    entry.ttl = ttl
    if (ttl === 0) {
        setTimeout(() => evictIfCurrent(store, entry), 0).unref?.()
        return
    }
    armTtlExpiry(store, entry, ttl)
}

/*
Returns a promise that resolves to a fresh clone of the underlying Response.
Multiple readers can each consume the body independently — the stored
promise's Response is never consumed directly, so clones always succeed.
*/
function shareable(promise: Promise<Response>): Promise<Response> {
    return promise.then((response) => response.clone())
}

/*
Invalidates every entry matching the selector (see selectorMatcher) across both
the request/tab store and the process-level store, and notifies readers.
`args` narrows a fn selector to exactly that call's entry — derived through
the same encoders the read path uses, so other args variants stay warm. An entry
with a refetch policy is kept and its refetch coalesced (stale served
until it resolves); every other match is dropped so the next read refetches —
its key recorded in pendingRefresh so that read reports as a reload (refreshing())
rather than a first-ever load. An empty or unmatched selector is a no-op on the
cache; the lifecycle ping still fires but recomputes pending() to the same value.
*/
function invalidate<Args, Return>(arg?: CacheSelector<Args, Return>, args?: Args): void {
    /* Resolve the fn-selector prefix once; the matcher and the label both consume it. */
    const prefix = selectorPrefix(arg, args)
    const matches = selectorMatcher(arg, args, prefix)
    invalidateTripwire(selectorLabel(arg, args, prefix))
    /* Reset any recorded rpc errors for this selector too (independent of cache entries — a
       bare call that errored never became one). Only fn selectors resolve a prefix. */
    if (prefix !== undefined) {
        rpcErrorRegistry.clearMatching(prefix)
    }
    for (const store of cacheStores()) {
        const matched: string[] = []
        const affected: string[] = []
        /* Deleting the current entry mid-iteration is spec-safe on a Map; no snapshot needed. */
        for (const entry of store.entries.values()) {
            if (!matches(entry)) {
                continue
            }
            matched.push(entry.key)
            if (entry.invalidation) {
                scheduleInvalidationRefetch(store, entry)
            } else {
                store.entries.delete(entry.key)
                /* Flag the next read a reload (refreshing()) — but only if a reader is
                   holding the value now; with none on screen the next read is a first
                   load, and an ungated add would linger forever on the tab store. */
                if (store.hasReader(entry.key)) {
                    store.pendingRefresh.add(entry.key)
                }
                affected.push(entry.key)
            }
        }
        /* Every match changed state (probes re-derive); only the dropped subset
           changed its visible value (readers re-read) — swr matches stay put. */
        notify(store, matched, affected)
    }
}

/*
Human-readable selector identity for the tripwire and cache.on coverage: the
key prefix for fn selectors — the exact key when args narrow it — falling
back to the function's name for a producer never cached, the tag list for
a `{ tags }` selector, `*` for the bare form.
*/
function selectorLabel<Args, Return>(
    arg?: CacheSelector<Args, Return>,
    args?: Args,
    prefix?: string,
): string {
    if (arg === undefined) {
        return '*'
    }
    if (typeof arg === 'function') {
        return prefix ?? selectorPrefix(arg, args) ?? (arg.name || 'anonymous producer')
    }
    return `tags: ${[...toTagSet(arg.tags ?? [])].join(', ')}`
}

cache.invalidate = invalidate

/*
The smart-call refetch: refetches every entry matching the selector, keeping the
stale value visible (refreshing() true) until the fresh value swaps in — never
blanks. This is the old invalidate reborn as *refetch*: because SWR retains the
value, there is no "invalidate that drops to pending" for the smart call. Follows
invalidate's exact selector grammar (fn / fn+args / { tags } / bare = all).

Only a match with a live reader refetches: refresh keeps the stale value visible
until the fresh one swaps in, and with no reader on screen there is nothing to
swap into — so a match whose reactive scope has torn down ("no longer has
listeners") drops instead of firing a wasted network refetch, and the next read
reloads it fresh.

A smart-read match already carries an invalidation policy, so it routes straight
through scheduleInvalidationRefetch (throttle/debounce-honouring). A policy-less
remote match (an explicit cache() entry, or a hydrated one) gets a refetch armed
on the fly by replaying its stored Request. A policy-less producer match has no
way to re-run, so it drops (the next read reloads) — the invalidate fallback.
*/
function refresh<Args, Return>(arg?: CacheSelector<Args, Return>, args?: Args): void {
    const prefix = selectorPrefix(arg, args)
    const matches = selectorMatcher(arg, args, prefix)
    invalidateTripwire(selectorLabel(arg, args, prefix))
    if (prefix !== undefined) {
        rpcErrorRegistry.clearMatching(prefix)
    }
    for (const store of cacheStores()) {
        const matched: string[] = []
        const affected: string[] = []
        for (const entry of store.entries.values()) {
            if (!matches(entry)) {
                continue
            }
            matched.push(entry.key)
            /* No live reader is holding this key — its reactive scope has torn down (or
               it was never read reactively and already dropped). A refresh has no
               on-screen value to keep-stale-and-swap, so firing the network now is
               wasted work that may be stale again before anything shows it. Drop the
               entry so the next read reloads fresh instead — the same lazy path a
               reader-less invalidate() takes. */
            if (!store.hasReader(entry.key)) {
                store.entries.delete(entry.key)
                continue
            }
            /* Arm a refetch on the fly for a policy-less remote entry by replaying its
               stored Request — so a refresh always refetches-and-swaps, never blanks. */
            if (entry.invalidation === undefined && entry.request !== undefined) {
                const request = entry.request
                entry.invalidation = { refetch: () => fetch(request.clone()) }
            }
            if (entry.invalidation !== undefined) {
                scheduleInvalidationRefetch(store, entry)
            } else {
                /* No policy, no request (a producer never cached with a refetch window): drop so the
                   next read reloads. A reader is holding it (checked above), so flag the
                   next read a reload (refreshing()). */
                store.entries.delete(entry.key)
                store.pendingRefresh.add(entry.key)
                affected.push(entry.key)
            }
        }
        /* Mark the whole match set (probes re-derive); emit only the dropped subset — the
           refetched entries emit when their fresh value lands (fireRefetch). */
        notify(store, matched, affected)
    }
}

cache.refresh = refresh

/*
Local value mutation: replaces the retained value of every entry matching the
selector via `updater(current)`, re-renders readers, and fires NO network — the
optimistic-update / real-time primitive (feed a socket frame straight into a
cached list). The next value is stored onto `entry.value`, which the read path
serves warm (cloned per read), so it persists across reads until a refresh /
invalidate replaces the entry. `current` comes from `entry.value` when already
materialized, else decoded from the settled/in-flight promise (async — readers
re-render when the patch lands). Follows the selector grammar, but only fn / args
/ tags select a value to mutate; a not-yet-read key has nothing to patch.
*/
function patch<Args, Return>(
    arg: CacheSelector<Args, Return>,
    args: Args | undefined,
    updater: (current: Return) => Return,
): void {
    const prefix = selectorPrefix(arg, args)
    const matches = selectorMatcher(arg, args, prefix)
    for (const store of cacheStores()) {
        for (const entry of store.entries.values()) {
            if (matches(entry)) {
                applyPatch(store, entry, updater as (current: unknown) => unknown)
            }
        }
    }
}

cache.patch = patch

/*
Synchronous, non-triggering value probe: returns the currently-retained value for
a call, or undefined when nothing is retained (no entry, or not yet settled). Never
invokes — reading it opens no fetch. Reactive: it subscribes the key AND taps the
key's lifecycle channel (the exact key is a one-entry prefix, same as
pending(fn, args)) so a state.computed / on / template scope re-runs both when the
value changes (invalidate, patch) and when a retained value lands —
materializeRetained's async decode signals only markLifecycle, no invalidate event,
so without the lifecycle tap a scope that read undefined would never see the value
arrive. Outside a tracking scope it is a one-shot snapshot. Returns a clone (like
the warm read path) so a caller mutating it can't corrupt the retained value.
`peek(sub)` for a subscribable is wired on the socket side.
*/
function peek<Args, Return>(
    fn: RemoteFunction<Args, Return> | RawRemoteFunction<Args> | Producer<Args, Return>,
    args?: Args,
): Return | undefined {
    const isRemote = REMOTE_FUNCTION in fn
    const rawFn = !isRemote
        ? undefined
        : 'raw' in fn
          ? (fn as RemoteFunction<Args, Return>).raw
          : (fn as RawRemoteFunction<Args>)
    const key = isRemote
        ? keyForRemoteCall(rawFn!.method, rawFn!.url, args)
        : producerKey(fn as Producer<Args, Return>, args)
    const active = activeCacheStore()
    active.subscribe(key)
    active.trackLifecycle(key)
    let entry = active.entries.get(key)
    if (entry === undefined) {
        const shared = sharedCacheStore()
        shared.subscribe(key)
        shared.trackLifecycle(key)
        entry = shared.entries.get(key)
    }
    if (entry === undefined || entry.settled !== true || entry.value === undefined) {
        return undefined
    }
    /* SSR congruence: the server materializes no cache value, so server-side peek is
       uniformly undefined and the SSR render shows the fallback. Returning a snapshot-
       seeded warm value here — mid-hydration — would diverge from that server text and
       corrupt the claimed text node. Withhold it until the pass ends; the trackLifecycle
       tap above lets wakeHydrationPeeks re-run this scope on the congruent value. */
    if (hydratingSlot.active) {
        return undefined
    }
    return cloneWarmValue(entry.value) as Return
}

cache.peek = peek

/*
Applies one entry's patch: materialize the current decoded value (warm value if
present, else decode the promise — a Response for a remote entry, cloned so the
readers' own clones still succeed), run the updater, store it warm, and emit so
readers re-read. Fire-and-forget on the async branch: patch() stays sync-return.
*/
function applyPatch(
    store: CacheStore,
    entry: CacheEntry,
    updater: (current: unknown) => unknown,
): void {
    function apply(current: unknown): void {
        entry.value = updater(current)
        notify(store, [entry.key], [entry.key])
    }
    if (entry.value !== undefined) {
        apply(entry.value)
        return
    }
    const currentValue =
        entry.request !== undefined
            ? (entry.promise as Promise<Response>).then((response) =>
                  decodeResponse(response.clone()),
              )
            : (entry.promise as Promise<unknown>)
    currentValue.then(apply, () => undefined)
}

/*
Event-driven cache maintenance: subscribes to a NamedAsyncIterable (socket or rpc
stream) and runs `handler` once per frame — the declarative home for "this
socket event stales that cached data", replacing the hand-rolled $effect +
tail() + edge-detection pattern. Bare iteration means live frames only
(ADR-0004): no replay seed, a frame is an event, nothing is retained.

Delivery is sequential: frame N+1 is not pulled until N's handler (sync or
async) settles, so ordering holds and before/after work sits naturally
between frames; a slow handler queues frames rather than racing itself.
The context's `invalidate` is this binding's scoped copy — same grammar and
effect as cache.invalidate, but each call is recorded in the binding's
coverage set (attribution by function identity, so it survives awaits).

On a transport loss (the typed SocketDisconnectedError) frames may have been
missed, and a missed frame is a missed invalidation — silently stale data. The
binding can't know what it missed, so it conservatively re-invalidates its
whole coverage set, then reopens the source (the channel's backoff owns retry
timing); over-invalidating costs a refetch, never correctness. A handler
throw is logged and the binding lives on — one bad frame must not detach
freshness; a server error frame or clean end is terminal, mirroring tail.

No-op on the server (inert dispose): SSR can't hold a stream across the
request boundary — bindings attach client-side, where the snapshot has
already seeded the cache. Dispose aborts `signal`, stops delivery, and
closes the subscription.
*/
function on<T>(
    source: NamedAsyncIterable<T>,
    handler: (frame: T, context: CacheOnContext) => void | Promise<void>,
): () => void {
    if (typeof window === 'undefined') {
        return () => undefined
    }
    const controller = new AbortController()
    /* Coverage replays on reconnect; keyed by selector identity so repeats dedupe. */
    const coverage = new Map<string, () => void>()
    const context: CacheOnContext = {
        invalidate<Args, Return>(arg?: CacheSelector<Args, Return>, args?: Args): void {
            coverage.set(selectorLabel(arg, args), () => invalidate(arg, args))
            invalidate(arg, args)
        },
        signal: controller.signal,
    }
    /* Register-on-consume: consuming a named subscribable populates the probe registry so
       pending()/refreshing()/error()/done()(source) work — the stream-side analog of a call
       populating the cache store. Driven by this one loop, so watch(socket) / for-await all
       register through here. An unnamed source (rare) skips probe tracking. */
    const probe = source.name ? openStreamProbe(source.name) : undefined
    /* `let`: the reconnect path swaps in a fresh iterator; dispose closes the current one. */
    let iterator = source[Symbol.asyncIterator]()
    ;(async () => {
        while (!controller.signal.aborted) {
            let next: IteratorResult<T>
            try {
                next = await iterator.next()
            } catch (error) {
                if (controller.signal.aborted) {
                    return
                }
                if (error instanceof SocketDisconnectedError) {
                    probe?.reconnecting()
                    coverage.forEach((replay) => {
                        replay()
                    })
                    iterator = source[Symbol.asyncIterator]()
                    continue
                }
                probe?.errored(error instanceof Error ? error : new Error(String(error)))
                abideLog.error(error)
                return
            }
            if (controller.signal.aborted) {
                return
            }
            if (next.done === true) {
                probe?.done()
                return
            }
            probe?.frame()
            try {
                await handler(next.value, context)
            } catch (error) {
                abideLog.error(error)
            }
        }
    })()
    return () => {
        controller.abort()
        probe?.close()
        iterator.return?.(undefined)?.catch(() => undefined)
    }
}

cache.on = on

/*
Schedules a coalesced refetch per the entry's refetch policy. No window:
fire immediately (throttle defaults to 0, so the leading-edge branch always
takes). debounce: (re)arm a timer that fires after N ms of quiet. throttle: fire
on the leading edge when a full window has elapsed since the last fire, else arm
a single trailing timer for the remainder — so a continuous invalidation stream
refetches at most once per window.
*/
function scheduleInvalidationRefetch(store: CacheStore, entry: CacheEntry): void {
    const policy = entry.invalidation
    if (!policy) {
        return
    }
    if (policy.debounce !== undefined) {
        clearTimeout(policy.timer)
        policy.timer = armTimer(store, entry, policy.debounce)
        return
    }
    const throttleMs = policy.throttle ?? 0
    const elapsed = Date.now() - (policy.lastFiredAt ?? Number.NEGATIVE_INFINITY)
    if (elapsed >= throttleMs) {
        fireRefetch(store, entry)
        return
    }
    if (policy.timer === undefined) {
        policy.timer = armTimer(store, entry, throttleMs - elapsed)
    }
}

function armTimer(store: CacheStore, entry: CacheEntry, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
        if (entry.invalidation) {
            entry.invalidation.timer = undefined
        }
        fireRefetch(store, entry)
    }, ms)
    timer.unref?.()
    return timer
}

/*
Runs the captured refetch once, keeping the stale value visible until it
resolves, then swaps the fresh result in and notifies readers. A refetch already
in flight is left to finish — the key is stable, so it already fetches the latest
state. Failure arrives on either settle path: a remote refetch resolves with the
Response even on an error status (fetch rejects only on network loss), a producer
rejects. Both route to settleRefetchFailure — stale kept, except a 404 evicts.
*/
function fireRefetch(store: CacheStore, entry: CacheEntry): void {
    const policy = entry.invalidation
    if (!policy) {
        return
    }
    /* A refetch is already running: record the request so it re-fires on settle
       (the in-flight one may predate this newer invalidation) instead of dropping it. */
    if (entry.refreshing) {
        policy.pending = true
        return
    }
    entry.refreshing = true
    policy.lastFiredAt = Date.now()
    /* Mark, don't emit: refreshing() re-derives when revalidation begins, but the
       stale value is still on screen — the settle handlers emit once it lands. */
    notify(store, [entry.key], [])
    const inflight = policy.refetch()
    inflight.then(
        (result) => {
            entry.refreshing = false
            reschedulePendingRefetch(store, entry, policy)
            /* Dropped or replaced while in flight — discard this result. */
            if (store.entries.get(entry.key) !== entry) {
                return
            }
            if (result instanceof Response && !result.ok) {
                settleRefetchFailure(store, entry, result.status)
                return
            }
            entry.promise = inflight
            entry.value = undefined
            entry.settled = true
            /* Re-materialize the retained value from the fresh Response so peek() stays
               current after a background revalidation. */
            if (entry.retain) {
                materializeRetained(store, entry, result)
            }
            /* Restart the freshness clock from the revalidation — without this the
               entry keeps its original expiresAt and would read as stale (or be evicted
               at the old deadline) despite holding fresh data. Mirrors registerEntry's
               settle path: a retained smart read re-stamps the staleness deadline (the
               next read past it revalidates), a windowed producer entry re-arms the eviction
               clock. */
            if (entry.ttl !== undefined && entry.ttl !== 0) {
                if (entry.retain) {
                    stampStaleDeadline(entry, entry.ttl)
                } else {
                    armTtlExpiry(store, entry, entry.ttl)
                }
            }
            /* Fresh value landed — mark and emit so readers re-read. */
            notify(store, [entry.key], [entry.key])
        },
        (error) => {
            entry.refreshing = false
            reschedulePendingRefetch(store, entry, policy)
            if (store.entries.get(entry.key) !== entry) {
                return
            }
            settleRefetchFailure(
                store,
                entry,
                error instanceof HttpError ? error.status : undefined,
            )
        },
    )
}

/*
Re-schedules a refetch requested while one was already in flight (fireRefetch
recorded it on policy.pending). Runs after the in-flight refetch settles so the
newer invalidation isn't lost; honours the throttle/debounce window since
lastFiredAt was just stamped. No-op if the entry was dropped or replaced.
*/
function reschedulePendingRefetch(
    store: CacheStore,
    entry: CacheEntry,
    policy: NonNullable<CacheEntry['invalidation']>,
): void {
    if (!policy.pending) {
        return
    }
    policy.pending = false
    if (store.entries.get(entry.key) === entry) {
        scheduleInvalidationRefetch(store, entry)
    }
}

/*
A failed revalidation keeps the stale entry — blanking data a reader is showing
over a transient error would make every background refresh a risk. 404 is the
exception: the resource is gone, so the retained value is a ghost an invalidation
stream would refetch forever. Evict it exactly as invalidate() drops a policy-less
entry (pendingRefresh marks the next read a reload; the notify re-runs readers),
so a live read replaces it and surfaces the proper error once.
*/
function settleRefetchFailure(store: CacheStore, entry: CacheEntry, status?: number): void {
    if (status === 404) {
        evictIfCurrent(store, entry)
        /* Same reader-gating as invalidate: only flag a reload if one is on screen. */
        if (store.hasReader(entry.key)) {
            store.pendingRefresh.add(entry.key)
        }
        /* Value gone — mark and emit so the next read replaces it. */
        notify(store, [entry.key], [entry.key])
        return
    }
    /* Mark, don't emit: stale value kept, only the refreshing flag cleared. */
    notify(store, [entry.key], [])
}

/* Folds new tags into an entry's existing set without duplicating them. */
function mergeTags(existing: Set<string> | undefined, incoming: string[]): Set<string> {
    return new Set([...(existing ?? []), ...toTagSet(incoming)])
}

/*
Tags an existing entry with a read's tags so a later cache.invalidate({ tags })
reaches entries hydrated from the SSR snapshot (which carry a value but no tags)
without a refetch. Merges rather than replaces so a read tagging one group can't
drop tags another read site already added; a no-op when the read passes no tags.
*/
function tagEntry(entry: CacheEntry, tags: CacheOptions['tags']): void {
    if (tags !== undefined) {
        entry.tags = mergeTags(entry.tags, tags)
    }
}

/*
Mirrors tagEntry for invalidate policies: a read declaring a policy arms an
existing entry that lacks one. Hydrated snapshot entries carry a value but no
refetch thunk — without this, the first invalidate after hydration would hard-
drop the entry (a pending flash) instead of revalidating stale-in-place, and a
policy-less first read would permanently win over a later read that declared
one. An entry that already has a policy keeps it (first policy wins; the key
is the same call, so the thunks are interchangeable).
*/
function attachPolicy(
    entry: CacheEntry,
    options: CacheOptions | undefined,
    refetch: () => Promise<unknown>,
    defaultOn: boolean,
): void {
    /* A smart read hitting a bare existing entry (e.g. one an explicit cache()
       created first) adopts unconditional retention too. */
    if (defaultOn) {
        entry.retain = true
    }
    const policy = refetchWindow(options, defaultOn)
    if (entry.invalidation || !policy) {
        return
    }
    entry.invalidation = { refetch, throttle: policy.throttle, debounce: policy.debounce }
}

/*
The single notification seam, holding the cache's freshness invariant in one
place instead of by hand at every mutation site. Two reader audiences, two
channels: every key in `marked` had its state change, so the lifecycle channels
fire and the pending()/refreshing() probes re-derive; only the keys in `emitted`
had their VISIBLE value change, so the 'invalidate' event fires and the reading
scope re-reads. The two sets diverge by design — a refetch start marks but does
not emit (the stale value is still on screen), an invalidate-drop does both, an
a keep-stale (refetch-policy) invalidate marks the whole match set while emitting only the dropped subset.
The trailing store-wide mark fires even when nothing matched, so a bare probe
still re-derives (to the same value); marks coalesce per microtask, so a key in
both lists is not double work.
*/
function notify(store: CacheStore, marked: string[], emitted: string[]): void {
    marked.forEach((key) => {
        store.markLifecycle(key)
    })
    if (emitted.length > 0) {
        emit(store, emitted)
    }
    store.markLifecycle()
}

function emit(store: CacheStore, keys: string[]): void {
    if (keys.length === 0) {
        return
    }
    store.events.dispatchEvent(invalidateEvent(keys))
}
