import { activeCacheStore } from '../shared/activeCacheStore.ts'
import { cacheKeyOf } from '../shared/cacheKeyOf.ts'
import { snapshotShippable } from '../shared/snapshotShippable.ts'
import type { DeferMarker, ResumeEntry } from './runtime/RESUME.ts'

/*
The resume-manifest entry for a blocking `{#await expr then value}`. When the awaited value
is a shippable cache-backed read, DEFER it: flag the store entry so its SSR snapshot seeds
lazily (the body is decoded on first read, not at hydration) and return a `{ defer, key }`
marker in place of the value. Hydration then adopts the server branch inert and decodes
neither copy — the blocking form's contract: "render it on the server, keep the page, refetch
only when I read or invalidate it." A non-cache value (a plain promise, a computation) or a
cache read whose entry can't ship inlines its value as before. Server-only in practice — the
client codegen never calls it. */
// @documentation plumbing
export function deferResume(promise: unknown, value: unknown): ResumeEntry | DeferMarker {
    const isPromise =
        promise !== null && typeof (promise as { then?: unknown })?.then === 'function'
    const key = isPromise ? cacheKeyOf(promise as Promise<unknown>) : undefined
    if (key === undefined) {
        return { ok: true, value }
    }
    const entry = activeCacheStore().entries.get(key)
    if (entry === undefined || !snapshotShippable(entry)) {
        return { ok: true, value }
    }
    entry.deferred = true
    return { defer: true, key }
}
