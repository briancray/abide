// SHARED cross-request cache store — rpc-core §2 ("Shared server cache contract").
//
// A process-global `Map` that opt-in `shared` cells (server only) store their slots in, so
// identical `(callSiteId, serialize(args))` reads coalesce ACROSS requests. Keyed exactly like a
// per-request slot — nothing ambient (no cookies/identity/request) — which is why shared is only
// safe for functions pure over their args; that purity is enforced fail-closed in `cell.ts`.
//
// Optional bounding: a global byte ceiling `ABIDE_MAX_SHARED_CACHE_SIZE` with LRU eviction.
// Default = NO LIMIT (unbounded) — a consciously accepted memory-exhaustion tradeoff; the env var
// is the operator mitigation. Byte measure = the settled value's JSON length, recorded on settle.
// Recency = touch-on-read. The same ceiling also bounds the persistent server default-context
// cache (the `abide run`/cron/worker path); `cell.ts` passes that store to these same helpers.

import { positiveEnvBytes } from './positiveEnvBytes.ts'

// The one process-global shared store. Holds cell slots keyed by `prefix + canonicalKey(args)`.
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
export function sharedCacheRecordSize(
    store: Map<string, unknown>,
    key: string,
    bytes: number,
): void {
    if (readLimit() === Infinity) return
    sizesFor(store).set(key, bytes)
}

// Evict least-recently-touched entries until the total settled bytes are within the ceiling.
// Totals are computed only over keys still present in the store, so stale sidecar entries never
// distort the count. No-op when unbounded.
export function sharedCacheEvictIfNeeded(store: Map<string, unknown>): void {
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
