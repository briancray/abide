import type { CacheSnapshotEntry } from '../types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../types/CacheStore.ts'

/*
Drains the request-scoped cache store and returns a wire-safe snapshot of
its entries. Only GET/DELETE entries with text/json bodies are included —
POST/PUT/PATCH bodies can't be reconstructed on the client without also
shipping the original request body, and binary bodies don't survive a JSON
round-trip. Pending promises are awaited so the snapshot is fully resolved
by the time SSR writes the document.
*/
export async function serializeCacheSnapshot(store: CacheStore): Promise<CacheSnapshotEntry[]> {
    const entries = Array.from(store.entries.values())
    await Promise.allSettled(entries.map((entry) => entry.promise))

    const snapshot: CacheSnapshotEntry[] = []
    for (const entry of entries) {
        const method = entry.request.method.toUpperCase()
        if (method !== 'GET' && method !== 'DELETE') {
            continue
        }
        /*
        Between the awaitAll above and this read, a handler that calls
        cache.invalidate() (or evicts via ttl=0) may have replaced this
        entry. Skip the stale one — the live snapshot already reflects the
        replacement, and including this entry would mismatch the active key.
        */
        const settled = store.entries.get(entry.key)
        if (!settled || settled !== entry) {
            continue
        }
        const response = await readSettled(entry.promise)
        if (!response) {
            continue
        }
        const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
        if (!isTextual(contentType)) {
            continue
        }
        const body = await response.clone().text()
        snapshot.push({
            key: entry.key,
            url: entry.request.url,
            method,
            status: response.status,
            statusText: response.statusText,
            headers: Array.from(response.headers.entries()),
            body,
        })
    }
    return snapshot
}

async function readSettled(promise: Promise<Response>): Promise<Response | undefined> {
    try {
        return await promise
    } catch {
        return undefined
    }
}

function isTextual(contentType: string): boolean {
    if (contentType.startsWith('text/')) {
        return true
    }
    if (contentType.includes('json')) {
        return true
    }
    if (contentType.includes('xml')) {
        return true
    }
    return false
}
