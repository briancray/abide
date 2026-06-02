import type { RawRemoteFunction } from '../server/rpc/types/RawRemoteFunction.ts'
import type { RemoteFunction } from '../server/rpc/types/RemoteFunction.ts'
import { activeCacheStore } from '../shared/activeCacheStore.ts'
import { canonicalJson } from '../shared/canonicalJson.ts'
import { decodeResponse } from '../shared/decodeResponse.ts'
import { getRemoteMeta } from '../shared/getRemoteMeta.ts'
import { keyForRemoteCall } from '../shared/keyForRemoteCall.ts'
import type { CacheEntry } from '../shared/types/CacheEntry.ts'
import type { CacheOptions } from '../shared/types/CacheOptions.ts'

type AnyRemote<Args, Return> = RemoteFunction<Args, Return> | RawRemoteFunction<Args>

/*
Curries a remote-function call against the request-scoped cache store.
`cache(fn, options?)` returns an invoker; calling that invoker with args
checks the store for a prior entry (keyed by fn.method + fn.url + args) and
returns a shared promise on hit, or invokes the underlying raw call once
and stores the resulting Response promise on miss. Splitting configuration
(the outer call) from invocation (the inner call) keeps options anchored
in a fixed position so they can't collide with arg shapes. TTL = undefined
→ forever; ttl = 0 → dedupe only; ttl > 0 → entry expires `ttl` ms after
the promise resolves.

The invoker's return type mirrors the function you passed:

  cache(getPost)({ id })       // → Promise<Post>      (decoded body)
  cache(getPost.raw)({ id })   // → Promise<Response>  (raw escape hatch)

Both share one stored entry — the cache only ever holds the underlying
Response promise; the decoded view is derived on the way out for callers
of the non-raw variant.

Reactivity is implicit: the invoker calls `store.subscribe(key)`, which
registers the surrounding $derived / $effect scope. Invalidating the key
then re-runs that scope, which calls cache() again and gets a fresh entry.
Outside a tracking scope subscribe() is a no-op, so cache() works the same
in server code and plain client code.
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
    fn: AnyRemote<Args, Return>,
    options?: CacheOptions,
): (args?: Args) => Promise<Return | Response> | Return {
    /*
    The "raw" variant lacks its own `.raw` sibling; only the decoded
    callable carries one. Tell them apart by that presence and dispatch the
    decode step accordingly.
    */
    const isRaw = !('raw' in fn)
    const rawFn = isRaw ? (fn as RawRemoteFunction<Args>) : (fn as RemoteFunction<Args, Return>).raw
    return (args) => {
        const store = activeCacheStore()
        const key = resolveKey(rawFn, args, options?.key)
        store.subscribe(key)
        const existing = store.entries.get(key)
        /*
        Tag an existing entry with this call's scope so a later
        cache.invalidate({ scope }) reaches entries hydrated from the SSR
        snapshot (which carry a value but no scope) without a refetch. Merge
        rather than replace so a read tagging one group can't drop tags a
        different read site already added.
        */
        if (existing && options?.scope !== undefined) {
            existing.scope = mergeScopes(existing.scope, options.scope)
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
        */
        if (!isRaw && existing?.value !== undefined) {
            return existing.value as Return
        }
        const responsePromise = invokeWithCache(store, key, existing, rawFn, args, options)
        return isRaw ? responsePromise : (responsePromise.then(decodeResponse) as Promise<Return>)
    }
}

function invokeWithCache<Args>(
    store: ReturnType<typeof activeCacheStore>,
    key: string,
    existing: CacheEntry | undefined,
    rawFn: RawRemoteFunction<Args>,
    args: Args | undefined,
    options: CacheOptions | undefined,
): Promise<Response> {
    if (existing) {
        return shareable(existing.promise)
    }
    const promise = rawFn(args as Args)
    const request = getRemoteMeta(promise)
    if (!request) {
        throw new Error(
            '[belte] cache() received a function whose call did not record metadata — was it produced by a verb helper?',
        )
    }
    const ttl = options?.ttl
    const entry = {
        key,
        promise,
        request,
        ttl,
        expiresAt: undefined as number | undefined,
        scope: options?.scope === undefined ? undefined : toScopeSet(options.scope),
    }
    store.entries.set(key, entry)
    function deleteIfCurrent() {
        if (store.entries.get(key) === entry) {
            store.entries.delete(key)
        }
    }
    promise.then(() => {
        /*
            On the server the cache store is request-scoped and gets GC'd
            with the response; skip ttl=0 eviction so the SSR snapshot can
            still pick the entry up. In the browser ttl=0 stays "dedupe
            in-flight only" — evict the moment the promise settles.
            */
        if (ttl === 0) {
            if (typeof window !== 'undefined') {
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
    return shareable(promise)
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
Three call shapes:
  invalidate()                  → drop everything
  invalidate(fn)                → drop one function's calls (method+url prefix)
  invalidate({ key?, scope? })  → drop one entry by key and/or tagged groups
A selector with both fields drops the union; an empty or unmatched selector
is a no-op. `key` accepts the same string/array/object the cache() `key`
option does and is canonicalised the same way. `scope` accepts one tag or an
array; an entry is dropped when its tag set shares any tag with the request.
*/
function invalidate<Args, Return>(
    arg?: AnyRemote<Args, Return> | Pick<CacheOptions, 'key' | 'scope'>,
): void {
    const store = activeCacheStore()
    if (arg === undefined) {
        const keys = Array.from(store.entries.keys())
        store.entries.clear()
        emit(store, keys)
        return
    }
    if (typeof arg === 'function') {
        /*
        `arg.url` is the route template; per-call args appear as `?...`
        (GET/DELETE) or after a space (canonical-json body) — see
        keyForRemoteCall. Passing either `fn` or `fn.raw` invalidates the
        same set because they share method+url.
        */
        const prefix = `${arg.method} ${arg.url}`
        const affected = Array.from(store.entries.keys()).filter(
            (key) => key === prefix || key.startsWith(`${prefix}?`) || key.startsWith(`${prefix} `),
        )
        affected.forEach((key) => store.entries.delete(key))
        emit(store, affected)
        return
    }
    const target = arg.key !== undefined ? canonicalKey(arg.key) : undefined
    const byKey = target !== undefined && store.entries.has(target) ? [target] : []
    const requestedScopes = arg.scope === undefined ? undefined : toScopeSet(arg.scope)
    const byScope =
        requestedScopes === undefined
            ? []
            : Array.from(store.entries.values())
                  .filter(
                      (entry) =>
                          entry.scope !== undefined && intersects(entry.scope, requestedScopes),
                  )
                  .map((entry) => entry.key)
    /* emit() dedupes via a Set, so a key matching both criteria is harmless. */
    const affected = [...byKey, ...byScope]
    affected.forEach((key) => store.entries.delete(key))
    emit(store, affected)
}

cache.invalidate = invalidate

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

/* True when an entry's tags and the requested tags overlap on any tag. */
function intersects(entryScopes: Set<string>, requestedScopes: Set<string>): boolean {
    return Array.from(requestedScopes).some((scope) => entryScopes.has(scope))
}

/*
Detail is a Set so each subscriber's `has(key)` check is O(1) regardless of
how many keys a single invalidate touches.
*/
function emit(store: ReturnType<typeof activeCacheStore>, keys: string[]): void {
    if (keys.length === 0) {
        return
    }
    store.events.dispatchEvent(new CustomEvent('invalidate', { detail: new Set(keys) }))
}
