import { activeCacheStore } from './activeCacheStore.ts'
import { CACHE_WRAPPED } from './CACHE_WRAPPED.ts'
import { cacheStores } from './cacheStores.ts'
import { decodeResponse } from './decodeResponse.ts'
import { getRemoteMeta } from './getRemoteMeta.ts'
import { globalCacheStore } from './globalCacheStore.ts'
import { invalidateEvent } from './invalidateEvent.ts'
import { invalidateTripwire } from './invalidateTripwire.ts'
import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { log } from './log.ts'
import { producerKey } from './producerKey.ts'
import { REMOTE_FUNCTION } from './REMOTE_FUNCTION.ts'
import { REPLAYABLE_METHODS } from './REPLAYABLE_METHODS.ts'
import { SocketDisconnectedError } from './SocketDisconnectedError.ts'
import { selectorMatcher } from './selectorMatcher.ts'
import { selectorPrefix } from './selectorPrefix.ts'
import { toScopeSet } from './toScopeSet.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheOnContext } from './types/CacheOnContext.ts'
import type { CacheOptions } from './types/CacheOptions.ts'
import type { CacheSelector } from './types/CacheSelector.ts'
import type { CacheStore } from './types/CacheStore.ts'
import type { RawRemoteFunction } from './types/RawRemoteFunction.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'
import type { Subscribable } from './types/Subscribable.ts'

type AnyRemote<Args, Return> = RemoteFunction<Args, Return> | RawRemoteFunction<Args>
type Producer<Args, Return> = (args?: Args) => Promise<Return>

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

SSR: how you consume the call decides inline vs streaming, per Svelte's
documented {#await} rule (only the pending branch renders during SSR):

  const post = await cache(getPost)({ id })   // blocks render → baked into
                                              // the initial SSR HTML
  {#await cache(getPost)({ id })}             // renders pending → shell flushes
                                              // now, value streams in on the
                                              // same response when it resolves

The two don't mix within one component. A top-level `await` flips Svelte's
async render into await-everything mode and sweeps in every promise created
in that same component instance — so a sibling {#await} (or a
<svelte:boundary pending>) gets awaited and inlined too, buffering the whole
response to the slowest read. The markup form doesn't change this: a boundary
renders its pending branch but render() still blocks. To get both on one page,
isolate each blocking (top-level await) read in its own child component and
keep streaming reads in a parent that never top-level awaits — the
await-everything mode is per component instance, so a child's await blocks only
the child.
*/
export function cache<Args, Return>(
    fn: RemoteFunction<Args, Return>,
    options?: CacheOptions,
): (args?: Args) => Promise<Return> | Return
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
): (args?: Args) => Promise<Return | Response> | Return {
    /*
    Re-wrapping loses the remote's identity (no url/method on the wrapper), so
    the inner remote would silently become an anonymous producer — no shared
    key, no SSR snapshot, no write-method guards. Throw where the mistake is.
    */
    if (CACHE_WRAPPED in fn) {
        throw new Error(
            '[belte] cache(): fn is already a cache() wrapper — wrap the original function once',
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
    const read = (args?: Args): Promise<Return | Response> | Return => {
        const store = options?.global ? globalCacheStore() : activeCacheStore()
        if (!isRemote) {
            return invokeProducer(store, fn as Producer<Args, Return>, args, options)
        }
        const remote = rawFn as RawRemoteFunction<Args>
        const key = keyForRemoteCall(remote.method, remote.url, args)
        store.subscribe(key)
        const existing = store.entries.get(key)
        if (existing) {
            tagScope(existing, options?.scope)
            attachPolicy(existing, options, () => remote(args as Args))
            adoptTtl(store, existing, options)
        }
        /*
        Snapshot warm path: hydration pre-decoded the SSR body onto the
        entry, so the decoded variant returns it synchronously — the first
        {#await} render resolves without a microtask suspension and matches
        the SSR DOM. Raw callers always take the Response path. After an
        invalidate the replacement entry carries no value and falls through
        to the async fetch as before.

        The decoded overload is typed `Promise<Return> | Return` so the warm
        sync return is honest at the type level: a non-thenable is the only
        thing {#await} can render synchronously, and surfacing the union turns
        chaining `.then`/`.catch`/`.finally` on a read into a compile error
        rather than a runtime throw on warm hits. Consume cache via
        `await`/`{#await}` (both accept the union); in the await form handle
        errors with `try/catch`, never `.catch`. Raw and producer callers stay
        `Promise<…>` — they never take this sync path.

        Each warm read returns its own clone of the stored value: the entry's
        value is decoded once at hydration and would otherwise be handed by
        reference to every component reading the key, so one reader mutating
        it would corrupt the others and the hydrated state. A live fetch hands
        each reader a freshly-decoded object, so cloning keeps warm reads
        consistent with that. The clone is synchronous, preserving the
        {#await}-renders-without-suspension property.
        */
        if (!isRaw && existing?.value !== undefined) {
            return structuredClone(existing.value) as Return
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
Guards impossible option combinations at wrap time, where the call site is on
the stack. A policy declares "this call is safe to re-run unprompted", so a
non-replayable remote method (a write) must never carry one — replaying a write
through the invalidation grammar would be a state change disguised as a
refresh. Producers are opaque (no method to check); the same contract is on
the caller there. ttl: 0 retains nothing, so there is nothing for a policy to
revalidate; and the two coalescing strategies are exclusive by construction.
*/
function validatePolicy(options: CacheOptions | undefined, method: string | undefined): void {
    const policy = options?.invalidate
    if (!policy || (policy.throttle === undefined && policy.debounce === undefined)) {
        return
    }
    if (policy.throttle !== undefined && policy.debounce !== undefined) {
        throw new Error('[belte] cache(): set invalidate.throttle or invalidate.debounce, not both')
    }
    if (options?.ttl === 0) {
        throw new Error(
            '[belte] cache(): an invalidate policy requires retention — ttl: 0 keeps nothing to revalidate',
        )
    }
    if (method !== undefined && !REPLAYABLE_METHODS.has(method.toUpperCase())) {
        throw new Error(
            `[belte] cache(): an invalidate policy re-runs the call unprompted — ${method.toUpperCase()} is a write and must not be replayed`,
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
    log.warn(
        'cache() received an anonymous function — each call mints a fresh identity, so it never coalesces and pending()/refreshing() never match it. Hoist it to a named binding, or add a scope tag to probe it from elsewhere.',
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
    if (existing) {
        tagScope(existing, options?.scope)
        attachPolicy(existing, options, () => producer(args))
        return existing.promise as Promise<Return>
    }
    const promise = producer(args)
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
    const promise = rawFn(args as Args)
    const request = getRemoteMeta(promise)
    if (!request) {
        throw new Error(
            '[belte] cache() received a function whose call did not record metadata — was it produced by a verb helper?',
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
    /* Capture the refetch thunk + policy only when an invalidate window was asked for. */
    const policy = options?.invalidate
    const invalidation =
        policy?.throttle !== undefined || policy?.debounce !== undefined
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
        scope: options?.scope === undefined ? undefined : toScopeSet(options.scope),
        refreshing,
        invalidation,
    }
    store.entries.set(key, entry)
    markLifecycle(store, key)
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
    promise.then(() => {
        /*
        Mark settled so SSR snapshot serialization can tell awaited entries
        (resolved by the time render() returns → inline) from {#await} ones
        (still pending → stream). Set before the ttl branches below since a
        ttl=0 server entry stays in the store for the snapshot.
        */
        entry.settled = true
        /* The reload finished — this entry now holds fresh data, no longer refreshing. */
        entry.refreshing = false
        markLifecycle(store, key)
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
        markLifecycle(store, entry.key)
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
Mirrors tagScope/attachPolicy for retention: a hydrated snapshot entry ships
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
with an invalidate throttle/debounce policy is kept and its refetch coalesced (stale served
until it resolves); every other match is dropped so the next read refetches —
its key recorded in pendingRefresh so that read reports as a reload (refreshing())
rather than a first-ever load. An empty or unmatched selector is a no-op on the
cache; the lifecycle ping still fires but recomputes pending() to the same value.
*/
function invalidate<Args, Return>(arg?: CacheSelector<Args, Return>, args?: Args): void {
    const matches = selectorMatcher(arg, args)
    invalidateTripwire(selectorLabel(arg, args))
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
            markLifecycle(store, entry.key)
        }
        emit(store, affected)
        markLifecycle(store)
    }
}

/*
Human-readable selector identity for the tripwire and cache.on coverage: the
key prefix for fn selectors — the exact key when args narrow it — falling
back to the function's name for a producer never cached, the tag list for
scopes, `*` for the bare form.
*/
function selectorLabel<Args, Return>(arg?: CacheSelector<Args, Return>, args?: Args): string {
    if (arg === undefined) {
        return '*'
    }
    if (typeof arg === 'function') {
        return selectorPrefix(arg, args) ?? (arg.name || 'anonymous producer')
    }
    return `scope: ${[...toScopeSet(arg.scope ?? [])].join(', ')}`
}

cache.invalidate = invalidate

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
                log.error(error)
                return
            }
            if (controller.signal.aborted || next.done === true) {
                return
            }
            try {
                await handler(next.value, context)
            } catch (error) {
                log.error(error)
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
Schedules a coalesced refetch per the entry's invalidate policy. debounce: (re)arm
a timer that fires after N ms of quiet. throttle: fire on the leading edge when a
full window has elapsed since the last fire, else arm a single trailing timer for
the remainder — so a continuous invalidation stream refetches at most once per window.
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
state. A rejected refetch keeps the stale entry (no notify).
*/
function fireRefetch(store: CacheStore, entry: CacheEntry): void {
    const policy = entry.invalidation
    if (!policy || entry.refreshing) {
        return
    }
    entry.refreshing = true
    policy.lastFiredAt = Date.now()
    /* Ping lifecycle so refreshing() re-derives when revalidation begins; the settle handlers ping again when it ends. */
    markLifecycle(store, entry.key)
    const inflight = policy.refetch()
    inflight.then(
        () => {
            entry.refreshing = false
            /* Dropped or replaced while in flight — discard this result. */
            if (store.entries.get(entry.key) !== entry) {
                return
            }
            entry.promise = inflight
            entry.value = undefined
            entry.settled = true
            markLifecycle(store, entry.key)
            emit(store, [entry.key])
        },
        () => {
            entry.refreshing = false
            markLifecycle(store, entry.key)
        },
    )
}

/* Signals pending() / refreshing() readers that in-flight membership changed; `key` routes the mark to fn-selector probes whose prefix owns it. */
function markLifecycle(store: CacheStore, key?: string): void {
    store.markLifecycle(key)
}

/* Folds new tags into an entry's existing set without duplicating them. */
function mergeScopes(existing: Set<string> | undefined, incoming: string | string[]): Set<string> {
    return new Set([...(existing ?? []), ...toScopeSet(incoming)])
}

/*
Tags an existing entry with a read's scope so a later cache.invalidate({ scope })
reaches entries hydrated from the SSR snapshot (which carry a value but no scope)
without a refetch. Merges rather than replaces so a read tagging one group can't
drop tags another read site already added; a no-op when the read passes no scope.
*/
function tagScope(entry: CacheEntry, scope: CacheOptions['scope']): void {
    if (scope !== undefined) {
        entry.scope = mergeScopes(entry.scope, scope)
    }
}

/*
Mirrors tagScope for invalidate policies: a read declaring a policy arms an
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
    const policy = options?.invalidate
    if (
        entry.invalidation ||
        !policy ||
        (policy.throttle === undefined && policy.debounce === undefined)
    ) {
        return
    }
    entry.invalidation = { refetch, throttle: policy.throttle, debounce: policy.debounce }
}

function emit(store: ReturnType<typeof activeCacheStore>, keys: string[]): void {
    if (keys.length === 0) {
        return
    }
    store.events.dispatchEvent(invalidateEvent(keys))
}
