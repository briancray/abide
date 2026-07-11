import { activeCacheStore } from '../shared/activeCacheStore.ts'
import { cacheEntryFromSnapshot } from '../shared/cacheEntryFromSnapshot.ts'
import { decodeRefJson } from '../shared/decodeRefJson.ts'
import type { StreamedResolution } from '../shared/types/StreamedResolution.ts'
import { receiveStreamedCell } from './runtime/STREAMED_CELLS.ts'

/*
Seeds one streamed cache resolution into the active store — the single sink for the
streamed (pending {#await}) cache partition. A full CacheSnapshotEntry warms the entry
so a `cache()` read resolves synchronously (no wire round-trip) and `<template await>`
adopts without a refetch; a `{ key, miss }` marker — a body the server couldn't snapshot
(binary / rejected / evicted) — is a no-op, so that read falls back to a live fetch.

Shared by startClient's boot drain and the live `window.__abideResolve`, so no
resolved-frame consumer can swap DOM while silently dropping the cache channel — the
asymmetry that made streamed reads cold-miss to the network.
*/
// @documentation plumbing
export function seedStreamedResolution(resolution: StreamedResolution): void {
    /* ADR-0035: a streaming CELL's server-resolved value, keyed by render-path id. Route it to the
       mounted cell (or buffer until it registers) — decoded through the same ref-json codec the
       server encoded it with, so a Set/Map/Date/bigint/cyclic value survives. */
    if ('cellKey' in resolution) {
        receiveStreamedCell(resolution.cellKey, decodeRefJson(resolution.value))
        return
    }
    if ('miss' in resolution) {
        return
    }
    /* Only seed when nothing live holds the key — or when the existing entry is itself
       an unconsumed hydrated seed (`hydrated === true`, cleared by the first cache()
       read). A live/settled non-hydrated entry is authoritative; clobbering it with a
       stale snapshot would drop a fresher value (e.g. one a live fetch already wrote). */
    const store = activeCacheStore()
    const existing = store.entries.get(resolution.key)
    if (existing !== undefined && existing.hydrated !== true) {
        return
    }
    store.entries.set(resolution.key, cacheEntryFromSnapshot(resolution))
    /* Wake any reader subscribed to this key's lifecycle channel. Seeding used to rely on
       seed-before-mount ordering (valid for the await path, whose subscription reads the
       resume manifest, not the cache); an auto-streamed BARE read (ADR-0024) has already
       mounted and its throwing-peek subscribed the key, so without an explicit dispatch the
       peek that read `undefined` never re-runs on the streamed value. markLifecycle re-derives
       the peek scope — the same wake materializeRetained relies on for a late-landing value. */
    store.markLifecycle(resolution.key)
}
