// SHARED cross-request cache store — rpc-core §2 ("Shared server cache contract").
//
// A process-global `Map` that opt-in `shared` memos (server only) store their slots in, so
// identical `(callSiteId, serialize(args))` reads coalesce ACROSS requests. Keyed exactly like a
// per-request slot — nothing ambient (no cookies/identity/request) — which is why shared is only
// safe for functions pure over their args; that purity is enforced fail-closed in `memo.ts`.
//
// Optional bounding: a global byte ceiling `ABIDE_MAX_SHARED_CACHE_SIZE` with LRU eviction.
// Default = NO LIMIT (unbounded) — a consciously accepted memory-exhaustion tradeoff; the env var
// is the operator mitigation. Byte measure = the settled value's JSON length, recorded on settle.
// Recency = touch-on-read. The same ceiling also bounds the persistent server default-context
// cache (the `abide run`/cron/worker path); `memo.ts` passes that store to these same helpers.

import { positiveEnvBytes } from './positiveEnvBytes.ts'

// The one process-global shared store. Holds memo slots keyed by `prefix + canonicalKey(args)`.
const sharedCache = new Map<string, unknown>()

// Per-store byte accounting, keyed by the store Map itself so the shared store and the default
// context share one LRU implementation. Values are per-key JSON byte sizes recorded on settle.
const sizeSidecars = new WeakMap<Map<string, unknown>, Map<string, number>>()

// Keys currently PINNED against eviction — an OPEN streaming slot (replayable-streams.md §4): its
// transcript is still growing and ref-counted, so it must never be LRU-evicted mid-flight. Memory
// safety for an open stream is its per-stream buffer cap, not the LRU. Unpinned when the stream closes.
const pinnedSidecars = new WeakMap<Map<string, unknown>, Set<string>>()

export function sharedStore(): Map<string, unknown> {
    return sharedCache
}

function sizesFor(store: Map<string, unknown>): Map<string, number> {
    let sizes = sizeSidecars.get(store)
    if (sizes === undefined) {
        sizes = new Map<string, number>()
        sizeSidecars.set(store, sizes)
    }
    return sizes
}

function pinnedFor(store: Map<string, unknown>): Set<string> {
    let pinned = pinnedSidecars.get(store)
    if (pinned === undefined) {
        pinned = new Set<string>()
        pinnedSidecars.set(store, pinned)
    }
    return pinned
}

// Pin/unpin a key against LRU eviction (an open streaming slot). The pinned set holds only currently-
// open streams, so it stays small and is cleared as each stream closes.
export function sharedCachePin(store: Map<string, unknown>, key: string): void {
    pinnedFor(store).add(key)
}
export function sharedCacheUnpin(store: Map<string, unknown>, key: string): void {
    pinnedFor(store).delete(key)
}

// The active byte ceiling, or Infinity when unset/invalid (the unbounded default). Read fresh each
// call so operators (and tests) can change it at runtime.
function readLimit(): number {
    return positiveEnvBytes('ABIDE_MAX_SHARED_CACHE_SIZE')
}

// Is the byte ceiling active? Both `sharedCacheRecordSize` and `sharedCacheEvictIfNeeded` are no-ops
// when it is not, so a caller that must do real WORK to produce a size (serializing a stream chunk) can
// skip producing it at all. Exported rather than re-read from the env at the call site, so the var name
// and the "unset means unbounded" rule stay in one place.
export function sharedCacheBounded(): boolean {
    return readLimit() !== Infinity
}

// Move a key to the most-recently-used end (delete + re-set) so LRU eviction drops the
// least-recently-touched first. No-op (and no reordering) when the cache is unbounded.
export function sharedCacheTouch(store: Map<string, unknown>, key: string): void {
    if (readLimit() === Infinity) return
    if (!store.has(key)) return
    const entry = store.get(key)
    store.delete(key)
    store.set(key, entry)
}

// Record a slot's settled JSON byte size for ceiling accounting. No-op when unbounded, so the
// sidecar never grows in the default (unlimited) configuration.
function sharedCacheRecordSize(store: Map<string, unknown>, key: string, bytes: number): void {
    if (readLimit() === Infinity) return
    sizesFor(store).set(key, bytes)
}

// Evict least-recently-touched entries until the total settled bytes are within the ceiling.
// Totals are computed only over keys still present in the store, so stale sidecar entries never
// distort the count. No-op when unbounded.
function sharedCacheEvictIfNeeded(store: Map<string, unknown>): void {
    const limit = readLimit()
    if (limit === Infinity) return
    const sizes = sizesFor(store)
    const pinned = pinnedFor(store)
    let total = 0
    for (const key of store.keys()) total += sizes.get(key) ?? 0
    if (total <= limit) return
    for (const key of store.keys()) {
        if (total <= limit) break
        if (pinned.has(key)) continue // open stream — not evictable; stays counted (may exceed the limit)
        total -= sizes.get(key) ?? 0
        store.delete(key)
        sizes.delete(key)
    }
}

// ---------------------------------------------------------------------------
// The two TRANSITIONS, named
// ---------------------------------------------------------------------------
//
// The verbs above are the mechanism; these are the two moments a caller actually has. They exist
// because `memo.ts` drove the raw verbs by hand and the ORDER and COMPLETENESS of each sequence lived
// at the call sites — `recordSize` + `evictIfNeeded` at four of them, and `unpin` + `recordSize` +
// `evictIfNeeded` at two more, each behind its own `if (store !== undefined)`.
//
// Both omissions fail silently and neither is visible in a value:
//   • skip `evictIfNeeded` → the store grows past `ABIDE_MAX_SHARED_CACHE_SIZE` and nothing says so.
//   • skip `unpin` on a closed stream → the key stays pinned, so it is never evictable again. A
//     permanent leak, and `evictIfNeeded` deliberately keeps counting pinned bytes, so it also drags
//     the ceiling down for everything else.
//
// The `store === undefined` guard is folded in (a non-crossRequest memo has no shared store), so a
// caller states the transition rather than the branch.

// A value settled, or an OPEN stream grew: its size is now known and the store may need trimming.
// Does NOT unpin — an open stream must stay pinned, which is what keeps a replay-in-progress alive.
export function sharedCacheAccount(
    store: Map<string, unknown> | undefined,
    key: string,
    bytes: number,
): void {
    if (store === undefined) return
    sharedCacheRecordSize(store, key, bytes)
    sharedCacheEvictIfNeeded(store)
}

// A stream CLOSED: its transcript is a plain sized value now, so it stops being pinned and becomes
// LRU-evictable like any other entry.
export function sharedCacheSettleStream(
    store: Map<string, unknown> | undefined,
    key: string,
    bytes: number,
): void {
    if (store === undefined) return
    sharedCacheUnpin(store, key)
    sharedCacheAccount(store, key, bytes)
}
