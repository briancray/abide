import { sharedCacheStore } from '../../shared/sharedCacheStore.ts'
import type { CacheEntry } from '../../shared/types/CacheEntry.ts'
import type { InspectorCacheEntry } from './types/InspectorCacheEntry.ts'
import type { InspectorCacheSnapshot } from './types/InspectorCacheSnapshot.ts'

const PREVIEW_LIMIT = 200

/* A short JSON peek at a warm value, degrading non-serializable values to String. */
function preview(value: unknown): string | undefined {
    if (value === undefined) {
        return undefined
    }
    try {
        const json = JSON.stringify(value)
        return json.length > PREVIEW_LIMIT ? `${json.slice(0, PREVIEW_LIMIT)}…` : json
    } catch {
        return String(value)
    }
}

/* The entry's armed swr policy as a label, if it declared one. A bare `swr: true`
   has no window, so it labels as plain `swr`. */
function policyLabel(entry: CacheEntry): string | undefined {
    const policy = entry.invalidation
    if (!policy) {
        return undefined
    }
    if (policy.debounce !== undefined) {
        return `swr debounce ${policy.debounce}ms`
    }
    if (policy.throttle !== undefined) {
        return `swr throttle ${policy.throttle}ms`
    }
    return 'swr'
}

function projectEntry(entry: CacheEntry, now: number): InspectorCacheEntry {
    return {
        key: entry.key,
        status: entry.refreshing ? 'refreshing' : entry.settled ? 'settled' : 'in-flight',
        remote: entry.request !== undefined,
        ttl: entry.ttl,
        expiresInMs: entry.expiresAt !== undefined ? entry.expiresAt - now : undefined,
        tags: entry.tags ? [...entry.tags] : [],
        value: preview(entry.value),
        policy: policyLabel(entry),
    }
}

/*
Snapshots the process-level cache store (the persistent one `cache(fn, { shared:
true, ttl: Infinity })` writes to) for the inspector. Read at call time, so it
reflects the store as it stands; request-scoped stores are deliberately
excluded — they're ephemeral and already visible as per-request cache tallies.
*/
export function buildCacheSnapshot(): InspectorCacheSnapshot {
    const now = Date.now()
    const entries = Array.from(sharedCacheStore().entries.values(), (entry) =>
        projectEntry(entry, now),
    )
    return { entries }
}
