import { activeCacheStore } from './activeCacheStore.ts'
import { canonicalJson } from './canonicalJson.ts'
import { decodeResponse } from './decodeResponse.ts'
import { getRemoteMeta } from './getRemoteMeta.ts'
import { globalCacheStore } from './globalCacheStore.ts'
import { invalidateEvent } from './invalidateEvent.ts'
import { keyForRemoteCall } from './keyForRemoteCall.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheOptions } from './types/CacheOptions.ts'
import type { CacheStore } from './types/CacheStore.ts'
import type { RawRemoteFunction } from './types/RawRemoteFunction.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'

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

`fn` is either a remote function (a GET/POST/... helper) or a plain producer
returning a Promise:

  cache(getPost)({ id })       // → Promise<Post>      (decoded body)
  cache(getPost.raw)({ id })   // → Promise<Response>  (raw escape hatch)
  cache(fetchRates)()          // → Promise<Rates>     (plain producer)

Remote calls key on fn.method + fn.url + args and store the underlying Response
(the decoded view is derived on the way out for the non-raw variant; both share
one entry). Producers have no wire identity, so they key on the producer's
reference + args — pass a hoisted/stable function (an inline arrow is a new
reference every call and never dedupes) or an explicit `options.key`, and the
promise is stored and handed back as-is (no Response, no decode, no SSR
snapshot).

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
): (args?: Args) => Promise<Return | Response> | Return {
    /*
    A remote function carries `url`/`method`; a plain producer carries neither —
    that's the discriminator. Among remotes, the "raw" variant lacks its own
    `.raw` sibling (only the decoded callable carries one), which selects whether
    the decode step runs on the way out.
    */
    const isRemote = 'url' in fn
    const isRaw = isRemote && !('raw' in fn)
    const rawFn = !isRemote
        ? undefined
        : isRaw
          ? (fn as RawRemoteFunction<Args>)
          : (fn as RemoteFunction<Args, Return>).raw
    return (args) => {
        const store = options?.global ? globalCacheStore() : activeCacheStore()
        if (!isRemote) {
            return invokeProducer(store, fn as Producer<Args, Return>, args, options)
        }
        const key = resolveKey(rawFn as RawRemoteFunction<Args>, args, options?.key)
        store.subscribe(key)
        const existing = store.entries.get(key)
        if (existing) {
            tagScope(existing, options?.scope)
        }
        /*
        Snapshot warm path: hydration pre-decoded the SSR body onto the
        entry, so the decoded variant returns it synchronously — the first
        {#await} render resolves without a microtask suspension and matches
        the SSR DOM. Raw callers always take the Response path. After an
        invalidate the replacement entry carries no value and falls through
        to the async fetch as before.

        The public overload stays typed Promise<Return> on purpose: a
        non-thenable is the only thing {#await} can render synchronously, so
        the sync return is left as an internal optimization rather than
        widened to `Return | Promise<Return>` (which would leak it into every
        caller's types). The one cost is that `.then`/`.catch`/`.finally`
        directly on a warm result throws — consume cache via `await`/`{#await}`,
        never `.then`. Don't "fix" the type; see memory cache-warm-sync-tradeoff.

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
}

/*
Producer path: key on the producer's reference + args (or an explicit override),
share the in-flight/retained promise on hit, and store the value promise as-is
on miss — no Response, no decode, no SSR request metadata.
*/
function invokeProducer<Args, Return>(
    store: CacheStore,
    producer: Producer<Args, Return>,
    args: Args | undefined,
    options: CacheOptions | undefined,
): Promise<Return> {
    const key = options?.key !== undefined ? canonicalKey(options.key) : producerKey(producer, args)
    store.subscribe(key)
    const existing = store.entries.get(key)
    if (existing) {
        tagScope(existing, options?.scope)
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
    const entry: CacheEntry = {
        key,
        promise,
        request,
        ttl,
        expiresAt: undefined,
        scope: options?.scope === undefined ? undefined : toScopeSet(options.scope),
        invalidation,
    }
    store.entries.set(key, entry)
    markLifecycle(store)
    /*
    A ttl=0 remote entry in the request-scoped server store is kept until the
    response is GC'd so the post-render SSR snapshot can still pick it up. That
    exception never applies on the client (window defined), to producer entries
    (never snapshotted), or to the process-level `global` store (not request-
    scoped — keeping it would leak forever) — those evict the moment they settle.
    */
    const keepZeroTtlForSnapshot =
        request !== undefined && !options?.global && typeof window === 'undefined'
    function deleteIfCurrent() {
        if (store.entries.get(key) === entry) {
            store.entries.delete(key)
            markLifecycle(store)
        }
    }
    promise.then(() => {
        /*
        Mark settled so SSR snapshot serialization can tell awaited entries
        (resolved by the time render() returns → inline) from {#await} ones
        (still pending → stream). Set before the ttl branches below since a
        ttl=0 server entry stays in the store for the snapshot.
        */
        entry.settled = true
        markLifecycle(store)
        if (ttl === 0) {
            if (!keepZeroTtlForSnapshot) {
                deleteIfCurrent()
            }
            return
        }
        if (ttl !== undefined) {
            entry.expiresAt = Date.now() + ttl
            setTimeout(() => {
                if ((entry.expiresAt ?? 0) <= Date.now()) {
                    deleteIfCurrent()
                }
            }, ttl).unref?.()
        }
    }, deleteIfCurrent)
    return entry
}

/*
Returns a promise that resolves to a fresh clone of the underlying Response.
Multiple readers can each consume the body independently — the stored
promise's Response is never consumed directly, so clones always succeed.
*/
function shareable(promise: Promise<Response>): Promise<Response> {
    return promise.then((response) => response.clone())
}

type Selector<Args, Return> =
    | AnyRemote<Args, Return>
    | Producer<Args, Return>
    | Pick<CacheOptions, 'key' | 'scope'>

/*
Compiles a selector into an entry predicate shared by invalidate() and
pending() so both interpret the call shapes identically:
  undefined            → every entry
  remote fn            → that function's calls (method+url prefix). `arg.url` is
                         the route template; per-call args appear as `?...`
                         (GET/DELETE) or after a space (canonical-json body) —
                         see keyForRemoteCall. `fn` and `fn.raw` match the same
                         set since they share method+url.
  producer fn          → that producer's calls (reference id prefix). Matches
                         only if the producer was cached at least once (else it
                         has no id and nothing matches).
  { key?, scope? }     → the named entry and/or any entry sharing a scope tag;
                         both fields present → the union. `key` is canonicalised
                         like the cache() option. An empty selector matches
                         nothing.
*/
function selectorMatcher<Args, Return>(
    arg?: Selector<Args, Return>,
): (entry: CacheEntry) => boolean {
    if (arg === undefined) {
        return () => true
    }
    if (typeof arg === 'function') {
        /* Remote fns carry url/method; a producer keys on its reference id. */
        const prefix = 'url' in arg ? `${arg.method} ${arg.url}` : existingProducerId(arg)
        if (prefix === undefined) {
            return () => false
        }
        return (entry) =>
            entry.key === prefix ||
            entry.key.startsWith(`${prefix}?`) ||
            entry.key.startsWith(`${prefix} `)
    }
    const target = arg.key !== undefined ? canonicalKey(arg.key) : undefined
    const requestedScopes = arg.scope === undefined ? undefined : toScopeSet(arg.scope)
    return (entry) =>
        (target !== undefined && entry.key === target) ||
        (requestedScopes !== undefined &&
            entry.scope !== undefined &&
            intersects(entry.scope, requestedScopes))
}

/* Active + process-level stores, deduped (one tab store on the client). */
function cacheStores(): CacheStore[] {
    const active = activeCacheStore()
    const global = globalCacheStore()
    return active === global ? [active] : [active, global]
}

/*
Invalidates every entry matching the selector (see selectorMatcher) across both
the request/tab store and the process-level store, and notifies readers. An entry
with an invalidate throttle/debounce policy is kept and its refetch coalesced (stale served
until it resolves); every other match is dropped so the next read refetches. An
empty or unmatched selector is a no-op on the cache; the lifecycle ping still
fires but recomputes pending() to the same value.
*/
function invalidate<Args, Return>(arg?: Selector<Args, Return>): void {
    const matches = selectorMatcher(arg)
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
                affected.push(entry.key)
            }
        }
        emit(store, affected)
        markLifecycle(store)
    }
}

cache.invalidate = invalidate

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
    if (!policy || policy.refreshing) {
        return
    }
    policy.refreshing = true
    policy.lastFiredAt = Date.now()
    const inflight = policy.refetch()
    inflight.then(
        () => {
            policy.refreshing = false
            /* Dropped or replaced while in flight — discard this result. */
            if (store.entries.get(entry.key) !== entry) {
                return
            }
            entry.promise = inflight
            entry.value = undefined
            entry.settled = true
            markLifecycle(store)
            emit(store, [entry.key])
        },
        () => {
            policy.refreshing = false
            markLifecycle(store)
        },
    )
}

/*
Reactive in-flight probe sharing invalidate's selector grammar:
  pending()                  → any rpc in flight (global progress bar)
  pending(fn)                → that function's calls (per-route spinner)
  pending({ key?, scope? })  → a named entry and/or tagged group
Returns true while any matching entry's promise is unsettled across the
request/tab and process-level stores. The read taps each store's lifecycle
channel (track both before checking, so neither is skipped by short-circuit), so
a $derived re-runs when a matching call starts or settles. Outside a tracking
scope (plain client code, SSR) the tap is a no-op and it returns the current
value — SSR loading state is driven by {#await}, not this.
*/
function pending<Args, Return>(arg?: Selector<Args, Return>): boolean {
    const matches = selectorMatcher(arg)
    const stores = cacheStores()
    stores.forEach((store) => {
        store.trackLifecycle()
    })
    return stores.some((store) =>
        store.entries.values().some((entry) => entry.settled !== true && matches(entry)),
    )
}

cache.pending = pending

/* Signals cache.pending readers that in-flight membership changed. */
function markLifecycle(store: CacheStore): void {
    store.events.dispatchEvent(new Event('lifecycle'))
}

function resolveKey<Args>(
    rawFn: RawRemoteFunction<Args>,
    args: Args | undefined,
    override: CacheOptions['key'],
): string {
    if (override !== undefined) {
        return canonicalKey(override)
    }
    return keyForRemoteCall(rawFn.method, rawFn.url, args)
}

/*
Producers have no wire identity, so each is assigned a stable id on first use,
kept in a WeakMap so it's collected with the function. The cache key is that id
plus the canonicalised args — a hoisted producer dedupes across calls; an inline
arrow gets a fresh id every call and never does.
*/
const producerIds = new WeakMap<object, string>()
let producerCounter = 0
function producerKey(producer: object, args: unknown): string {
    let id = producerIds.get(producer)
    if (id === undefined) {
        id = `@producer:${++producerCounter}`
        producerIds.set(producer, id)
    }
    return args === undefined ? id : `${id} ${canonicalJson(args)}`
}

/* The producer's id without assigning one — for selectors matching prior entries. */
function existingProducerId(producer: object): string | undefined {
    return producerIds.get(producer)
}

function canonicalKey(value: CacheOptions['key']): string {
    if (typeof value === 'string') {
        return value
    }
    return canonicalJson(value)
}

/* Normalizes a scope option (one tag or many) to a Set for O(1) membership. */
function toScopeSet(scope: string | string[]): Set<string> {
    return new Set(typeof scope === 'string' ? [scope] : scope)
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

/* True when an entry's tags and the requested tags overlap on any tag. */
function intersects(entryScopes: Set<string>, requestedScopes: Set<string>): boolean {
    return Array.from(requestedScopes).some((scope) => entryScopes.has(scope))
}

function emit(store: ReturnType<typeof activeCacheStore>, keys: string[]): void {
    if (keys.length === 0) {
        return
    }
    store.events.dispatchEvent(invalidateEvent(keys))
}
