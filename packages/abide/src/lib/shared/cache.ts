import { abideLog } from './abideLog.ts'
import { activeCacheStore } from './activeCacheStore.ts'
import { CACHE_WRAPPED } from './CACHE_WRAPPED.ts'
import { cacheStores } from './cacheStores.ts'
import { decodeResponse } from './decodeResponse.ts'
import { getRemoteMeta } from './getRemoteMeta.ts'
import { globalCacheStore } from './globalCacheStore.ts'
import { HttpError } from './HttpError.ts'
import { invalidateEvent } from './invalidateEvent.ts'
import { invalidateTripwire } from './invalidateTripwire.ts'
import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { producerKey } from './producerKey.ts'
import { REMOTE_FUNCTION } from './REMOTE_FUNCTION.ts'
import { REPLAYABLE_METHODS } from './REPLAYABLE_METHODS.ts'
import { SocketDisconnectedError } from './SocketDisconnectedError.ts'
import { selectorMatcher } from './selectorMatcher.ts'
import { selectorPrefix } from './selectorPrefix.ts'
import { toTagSet } from './toTagSet.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheOnContext } from './types/CacheOnContext.ts'
import type { CacheOptions } from './types/CacheOptions.ts'
import type { CacheSelector } from './types/CacheSelector.ts'
import type { CacheStore } from './types/CacheStore.ts'
import type { RawRemoteFunction } from './types/RawRemoteFunction.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'
import type { Subscribable } from './types/Subscribable.ts'
import { withCacheManaged } from './withCacheManaged.ts'

type AnyRemote<Args, Return> = RemoteFunction<Args, Return> | RawRemoteFunction<Args>
type Producer<Args, Return> = (args?: Args) => Promise<Return>

/* Per-read lifecycle diagnostics, opt-in via DEBUG=abide:cache (browser: the abide-debug localStorage key). */
const cacheLog = abideLog.channel('abide:cache')

/*
Tallies one read and narrates it on the diagnostics channel. The sink is the
request/tab store even when the data store is the process-level global one —
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
Curries a call against a cache store. `cache(fn, options?)` returns an invoker;
calling that invoker with args checks the store for a prior entry and returns a
shared promise on hit, or invokes `fn` once and stores its promise on miss.
Splitting configuration (the outer call) from invocation (the inner call) keeps
options anchored in a fixed position so they can't collide with arg shapes. TTL
= undefined → forever; ttl = 0 → dedupe only; ttl > 0 → entry expires `ttl` ms
after the promise resolves.

Coalescing is always on: identical in-flight calls share one flight, so
`cache(createPost, { ttl: 0 })` is the mutation idiom — double-submit
coalescing and pending() visibility with nothing retained beyond the store's
atomic unit (the whole request on the server: one render, one effect; the
in-flight window in the tab). Caching is the retention `ttl` adds on top.

`fn` is either a remote function (a GET/POST/... helper) or a plain producer
returning a Promise:

  cache(getPost)({ id })       // → Promise<Post>      (decoded body)
  cache(getPost.raw)({ id })   // → Promise<Response>  (raw escape hatch)
  cache(fetchRates)()          // → Promise<Rates>     (plain producer)

Remote calls key on fn.method + fn.url + args and store the underlying Response
(the decoded view is derived on the way out for the non-raw variant; both share
one entry). Producers have no wire identity, so they key on the producer's
reference + args — pass a hoisted/stable function to dedupe (an inline arrow is a
new reference every call and never does; a warning fires once per such call
site), and the promise is stored and handed back as-is (no Response, no decode,
no SSR snapshot).

`options.global` puts the entry in the process-level store instead of the
request-scoped one, so a value computed in one request is reused by later
requests — the memoise-an-external-endpoint case. Default (omitted) is
request-scoped on the server, which keeps per-user data from leaking across
requests; on the client there is one tab store either way, so it is a no-op.

Reactivity is implicit: the invoker calls `store.subscribe(key)`, which
registers the surrounding $derived / $effect scope. Invalidating the key
then re-runs that scope, which calls cache() again and gets a fresh entry.
Outside a tracking scope subscribe() is a no-op, so cache() works the same
in server code and plain client code.

SSR: how you consume the call decides inline vs streaming (during SSR only the
pending branch of a `<template await>` renders):

  const post = await cache(getPost)({ id })   // blocks render → baked into
                                              // the initial SSR HTML
  <template await={cache(getPost)({ id })}>   // renders pending → shell flushes
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
export function cache<Args, Return>(
    fn: RemoteFunction<Args, Return>,
    options?: CacheOptions,
): (args?: Args) => Promise<Return>
export function cache<Args>(
    fn: RawRemoteFunction<Args>,
    options?: CacheOptions,
): (args?: Args) => Promise<Response>
export function cache<Args, Return>(
    fn: Producer<Args, Return>,
    options?: CacheOptions,
): (args?: Args) => Promise<Return>
export function cache<Args, Return>(
    fn: AnyRemote<Args, Return> | Producer<Args, Return>,
    options?: CacheOptions,
): (args?: Args) => Promise<Return | Response> {
    /*
    Re-wrapping loses the remote's identity (no url/method on the wrapper), so
    the inner remote would silently become an anonymous producer — no shared
    key, no SSR snapshot, no write-method guards. Throw where the mistake is.
    */
    if (CACHE_WRAPPED in fn) {
        throw new Error(
            '[abide] cache(): fn is already a cache() wrapper — wrap the original function once',
        )
    }
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
    validatePolicy(options, isRemote ? (rawFn as RawRemoteFunction<Args>).method : undefined)
    if (!isRemote) {
        warnAnonymousProducer(fn as Producer<Args, Return>)
    }
    const read = (args?: Args): Promise<Return | Response> => {
        const store = options?.global ? globalCacheStore() : activeCacheStore()
        if (!isRemote) {
            return invokeProducer(store, fn as Producer<Args, Return>, args, options)
        }
        const remote = rawFn as RawRemoteFunction<Args>
        const key = keyForRemoteCall(remote.method, remote.url, args)
        store.subscribe(key)
        const existing = store.entries.get(key)
        recordRead(options?.global ? activeCacheStore() : store, key, existing)
        if (existing) {
            tagEntry(existing, options?.tags)
            attachPolicy(existing, options, () => remote(args as Args))
            adoptTtl(store, existing, options)
        }
        /*
        Warm path: a value pre-decoded onto the entry — by the SSR cache
        snapshot the client seeds its store from, or by a cache.on().patch
        broadcast — is served without a network round-trip. It resolves on a
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
        if (!isRaw && existing?.value !== undefined) {
            return Promise.resolve(structuredClone(existing.value)) as Promise<Return>
        }
        const responsePromise = invokeRemote(
            store,
            key,
            existing,
            rawFn as RawRemoteFunction<Args>,
            args,
            options,
        )
        return isRaw ? responsePromise : (responsePromise.then(decodeResponse) as Promise<Return>)
    }
    /* Non-enumerable brand; selectorMatcher and the re-wrap guard read it. */
    Object.defineProperty(read, CACHE_WRAPPED, { value: fn })
    return read
}

/*
Normalises the `swr` option to its window, or undefined when off. `true` (or
`{}`) is stale-while-revalidate with no window — refetch immediately on every
invalidate; an object carries the throttle/debounce window. `false`/omitted is
off. Collapsing the boolean here lets every downstream site treat "is SWR on"
as a single defined/undefined check.
*/
function swrWindow(
    options: CacheOptions | undefined,
): { throttle?: number; debounce?: number } | undefined {
    const swr = options?.swr
    if (swr === undefined || swr === false) {
        return undefined
    }
    return swr === true ? {} : swr
}

/*
Guards impossible option combinations at wrap time, where the call site is on
the stack. `swr` declares "this call is safe to re-run unprompted", so a
non-replayable remote method (a write) must never carry it — replaying a write
through the invalidation grammar would be a state change disguised as a
refresh. Producers are opaque (no method to check); the same contract is on
the caller there. ttl: 0 retains nothing, so there is nothing to revalidate;
and the two coalescing windows are exclusive by construction.
*/
function validatePolicy(options: CacheOptions | undefined, method: string | undefined): void {
    const policy = swrWindow(options)
    if (!policy) {
        return
    }
    if (policy.throttle !== undefined && policy.debounce !== undefined) {
        throw new Error('[abide] cache(): set swr.throttle or swr.debounce, not both')
    }
    if (options?.ttl === 0) {
        throw new Error(
            '[abide] cache(): swr requires retention — ttl: 0 keeps nothing to revalidate',
        )
    }
    if (method !== undefined && !REPLAYABLE_METHODS.has(method.toUpperCase())) {
        throw new Error(
            `[abide] cache(): swr re-runs the call unprompted — ${method.toUpperCase()} is a write and must not be replayed`,
        )
    }
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
    recordRead(options?.global ? activeCacheStore() : store, key, existing)
    if (existing) {
        tagEntry(existing, options?.tags)
        attachPolicy(existing, options, () => producer(args))
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
    registerEntry(store, key, promise, options, undefined, () => producer(args))
    return promise
}

function invokeRemote<Args>(
    store: CacheStore,
    key: string,
    existing: CacheEntry | undefined,
    rawFn: RawRemoteFunction<Args>,
    args: Args | undefined,
    options: CacheOptions | undefined,
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
    registerEntry(store, key, promise, options, request, () => rawFn(args as Args))
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
): CacheEntry {
    const ttl = options?.ttl
    /* Capture the refetch thunk + window only when swr was asked for. */
    const policy = swrWindow(options)
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
    entries (no request), or to the process-level `global` store (not
    request-scoped — keeping it would leak forever).
    */
    const keepZeroTtlForRequest =
        request !== undefined && !options?.global && typeof window === 'undefined'
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
    setTimeout(() => {
        if ((entry.expiresAt ?? 0) <= Date.now()) {
            evictIfCurrent(store, entry)
        }
    }, ttl).unref?.()
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
function adoptTtl(store: CacheStore, entry: CacheEntry, options: CacheOptions | undefined): void {
    if (entry.hydrated !== true) {
        return
    }
    entry.hydrated = false
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
with an swr policy is kept and its refetch coalesced (stale served
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
    for (const store of cacheStores()) {
        const affected: string[] = []
        /* Deleting the current entry mid-iteration is spec-safe on a Map; no snapshot needed. */
        for (const entry of store.entries.values()) {
            if (!matches(entry)) {
                continue
            }
            if (entry.invalidation) {
                scheduleInvalidationRefetch(store, entry)
            } else {
                store.entries.delete(entry.key)
                /* Mark so the next read of this key reports as a reload via refreshing(). */
                store.pendingRefresh.add(entry.key)
                affected.push(entry.key)
            }
            store.markLifecycle(entry.key)
        }
        emit(store, affected)
        store.markLifecycle()
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

type EntryWrite = { store: CacheStore; entry: CacheEntry; prior: unknown; next: unknown }

/*
Core value-fold shared by the authoritative (cache.on context.patch) and
optimistic (cache.patch) write paths. Folds `updater` into every decoded remote
entry matching the selector, writing the result to entry.value so the warm-sync
read path serves it and emitting the keys so readers re-run (ADR-0007). Only
entry.value is written; entry.promise is left untouched so raw readers of the
same key keep reading the wire Response. Producer entries (no request) are
skipped — patching is a decoded-value operation. The current value is entry.value
when warm (hydrated or already patched), else the entry's settled Response decoded
— hence async; the first fold of a live-fetched entry hops a decode, subsequent
ones are synchronous. Returns the keys touched (the cache.on context registers
them for reconnect resync) and a `restore` that reverts each write iff it still
stands — the optimistic path runs it on a rejected call, the authoritative path
discards it (a broadcast is truth, never undone).
*/
async function foldEntries<Args, Return>(
    arg: CacheSelector<Args, Return>,
    updater: (current: Return) => Return,
    args: Args | undefined,
    prefix: string | undefined,
): Promise<{ touched: string[]; restore: () => void }> {
    const matches = selectorMatcher(arg, args, prefix ?? selectorPrefix(arg, args))
    const touched: string[] = []
    const writes: EntryWrite[] = []
    for (const store of cacheStores()) {
        const affected: string[] = []
        for (const entry of store.entries.values()) {
            if (!matches(entry) || entry.request === undefined) {
                continue
            }
            const prior = entry.value
            const current = (prior ??
                (await decodeResponse(
                    await shareable(entry.promise as Promise<Response>),
                ))) as Return
            const next = structuredClone(updater(current))
            entry.value = next
            entry.settled = true
            entry.refreshing = false
            store.markLifecycle(entry.key)
            affected.push(entry.key)
            writes.push({ store, entry, prior, next })
        }
        emit(store, affected)
        store.markLifecycle()
        touched.push(...affected)
    }
    return { touched, restore: () => revertWrites(writes) }
}

/*
Reverts each optimistic write iff entry.value still holds it — a refetch or a
later write that already replaced it is the newer truth and is left intact — then
notifies readers of the reverted keys per store.
*/
function revertWrites(writes: EntryWrite[]): void {
    const reverted = new Map<CacheStore, string[]>()
    for (const { store, entry, prior, next } of writes) {
        if (store.entries.get(entry.key) !== entry || entry.value !== next) {
            continue
        }
        entry.value = prior
        store.markLifecycle(entry.key)
        reverted.set(store, [...(reverted.get(store) ?? []), entry.key])
    }
    for (const [store, keys] of reverted) {
        emit(store, keys)
        store.markLifecycle()
    }
}

/*
The authoritative-broadcast fold: a cache.on frame is the truth, so foldEntries'
write stands (no rollback) and only the touched keys are returned for coverage.
*/
async function patchEntries<Args, Return>(
    arg: CacheSelector<Args, Return>,
    updater: (current: Return) => Return,
    args?: Args,
    /* The caller (on().patch) resolves the prefix for its coverage label; reuse it so selectorPrefix runs once per fold. */
    prefix?: string,
): Promise<string[]> {
    const { touched } = await foldEntries(arg, updater, args, prefix)
    return touched
}

/*
Event-driven cache maintenance: subscribes to a Subscribable (socket or rpc
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
    source: Subscribable<T>,
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
        /*
        Register the selector (not the delta) for reconnect: a discarded delta
        can't be replayed, so a transport gap resyncs the patched keys by full
        invalidate — reusing the same coverage machinery as invalidate above.
        */
        patch<Args, Return>(
            arg: CacheSelector<Args, Return>,
            updater: (current: Return) => Return,
            args?: Args,
        ): Promise<string[]> {
            /* Resolve the prefix once; the coverage label and patchEntries both consume it. */
            const prefix = selectorPrefix(arg, args)
            coverage.set(selectorLabel(arg, args, prefix), () => invalidate(arg, args))
            return patchEntries(arg, updater, args, prefix)
        },
        signal: controller.signal,
    }
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
                    coverage.forEach((replay) => {
                        replay()
                    })
                    iterator = source[Symbol.asyncIterator]()
                    continue
                }
                abideLog.error(error)
                return
            }
            if (controller.signal.aborted || next.done === true) {
                return
            }
            try {
                await handler(next.value, context)
            } catch (error) {
                abideLog.error(error)
            }
        }
    })()
    return () => {
        controller.abort()
        iterator.return?.(undefined)?.catch(() => undefined)
    }
}

cache.on = on

/*
Optimistic write: applies `updater` as a prediction now — the reactive read
shows it immediately — runs `call`, then reconciles. On resolve the server is
the truth: the prediction is dropped and the selector invalidated, so the value
refetches authoritatively, coalesced per the read's own swr window
(cache(fn, { swr: { throttle } }) bounds an optimistic-write storm with no
extra knob here; without swr it is a plain drop-and-refetch). On reject the
prediction rolls back. The returned promise is transparent over `call` —
resolves to `call`'s value (the mutation result, e.g. a created id), rejects
with its error, settling only after the cache reflects the reconciled state: an
explicit await reads truth, an ignored call is fire-and-forget (a pre-attached
catch keeps an un-awaited rejection from surfacing as unhandled, while the await
still receives it). `call` is required — a global authoritative write with no
reconciling op would let a caller author cache values, breaking the
producer-is-the-source invariant (ADR-0001); that path stays cache.on's
context.patch. Single-flight per key: rollback restores by snapshot, so keep one
mutation per key in flight (disable the trigger while pending) — concurrent
same-key optimism wants a layered entry value, deferred (ADR-0009). The reactive
read holds the value; the return carries the mutation result — separate by
design (ADR-0009).
*/
function patch<Args, Return, Result>(
    arg: CacheSelector<Args, Return>,
    updater: (current: Return) => Return,
    call: Promise<Result>,
    args?: Args,
): Promise<Result> {
    const prefix = selectorPrefix(arg, args)
    const folded = foldEntries(arg, updater, args, prefix)
    const settled = (async () => {
        try {
            const result = await call
            /* Wait for the prediction to land before reconciling to server truth. */
            await folded
            invalidate(arg, args)
            return result
        } catch (error) {
            const { restore } = await folded
            restore()
            throw error
        }
    })()
    /* Ignore-safe: an un-awaited rejection must not report unhandled; an explicit
       await still receives it (this no-op handler and the await both fire). */
    settled.catch(() => undefined)
    return settled
}

cache.patch = patch

/*
Schedules a coalesced refetch per the entry's swr policy. No window (swr: true):
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
    /* Ping lifecycle so refreshing() re-derives when revalidation begins; the settle handlers ping again when it ends. */
    store.markLifecycle(entry.key)
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
            /* Restart the freshness clock from the revalidation — without this the
               entry keeps its original expiresAt and is evicted at the old deadline
               despite holding fresh data. Mirrors registerEntry's settle path. */
            if (entry.ttl !== undefined && entry.ttl !== 0) {
                armTtlExpiry(store, entry, entry.ttl)
            }
            store.markLifecycle(entry.key)
            emit(store, [entry.key])
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
        store.pendingRefresh.add(entry.key)
        emit(store, [entry.key])
        return
    }
    store.markLifecycle(entry.key)
}

/* Folds new tags into an entry's existing set without duplicating them. */
function mergeTags(existing: Set<string> | undefined, incoming: string | string[]): Set<string> {
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
): void {
    const policy = swrWindow(options)
    if (entry.invalidation || !policy) {
        return
    }
    entry.invalidation = { refetch, throttle: policy.throttle, debounce: policy.debounce }
}

function emit(store: CacheStore, keys: string[]): void {
    if (keys.length === 0) {
        return
    }
    store.events.dispatchEvent(invalidateEvent(keys))
}
