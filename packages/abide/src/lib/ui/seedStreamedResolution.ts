import { activeCacheStore } from '../shared/activeCacheStore.ts'
import { cacheEntryFromSnapshot } from '../shared/cacheEntryFromSnapshot.ts'
import type { StreamedResolution } from '../shared/types/StreamedResolution.ts'

/*
Seeds one streamed cache resolution into the active store — the single sink for the
streamed (pending {#await}) cache partition. A full CacheSnapshotEntry warms the entry
so a `cache()` read resolves synchronously (no wire round-trip) and `<template await>`
adopts without a refetch; a `{ key, miss }` marker — a body the server couldn't snapshot
(binary / rejected / evicted) — is a no-op, so that read falls back to a live fetch.

Shared by startClient's boot drain, the live `window.__abideResolve`, and applyResolved,
so no resolved-frame consumer can swap DOM while silently dropping the cache channel —
the asymmetry that made streamed reads cold-miss to the network.
*/
// @documentation plumbing
export function seedStreamedResolution(resolution: StreamedResolution): void {
    if ('miss' in resolution) {
        return
    }
    /* Only seed when nothing live holds the key — or when the existing entry is itself
       an unconsumed hydrated seed (`hydrated === true`, cleared by the first cache()
       read). A live/settled non-hydrated entry is authoritative; clobbering it with a
       stale snapshot would drop a fresher value (e.g. one a live fetch already wrote). */
    const { entries } = activeCacheStore()
    const existing = entries.get(resolution.key)
    if (existing !== undefined && existing.hydrated !== true) {
        return
    }
    entries.set(resolution.key, cacheEntryFromSnapshot(resolution))
}
