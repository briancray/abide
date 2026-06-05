import type { CacheEntry } from '../../shared/types/CacheEntry.ts'
import type { CacheSnapshotEntry } from '../../shared/types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../../shared/types/CacheStore.ts'

/*
Awaits one cache entry and turns it into a wire-safe snapshot, or undefined
when it can't ship. Shared by the inline snapshot path (settled entries,
resolves immediately) and the streaming drain (pending {#await} entries,
resolves whenever the underlying fetch lands). Only GET/DELETE with a textual
Content-Type survive — other methods can't be replayed without the original
request body, and binary bodies don't round-trip through JSON.

Reads the body once and replaces the entry's promise with a string-bodied
Response so later `shareable()` clones operate on a buffered body instead of
teeing the original stream. Returns undefined on a rejected fetch (the client
falls back to a live re-fetch on cache miss) or when the entry was evicted /
replaced between resolution and read (a concurrent invalidate) so the snapshot
never ships a key that no longer matches the live store.
*/
export async function snapshotEntryFromCache(
    store: CacheStore,
    entry: CacheEntry,
): Promise<CacheSnapshotEntry | undefined> {
    /* Producer entries have no wire request to replay — they never snapshot. */
    if (!entry.request) {
        return undefined
    }
    const method = entry.request.method.toUpperCase()
    if (method !== 'GET' && method !== 'DELETE') {
        return undefined
    }
    const response = await readSettled(entry.promise as Promise<Response>)
    if (!response) {
        return undefined
    }
    if (store.entries.get(entry.key) !== entry) {
        return undefined
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    if (!isTextual(contentType)) {
        return undefined
    }
    const body = await response.text()
    entry.promise = Promise.resolve(
        new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        }),
    )
    return {
        key: entry.key,
        url: entry.request.url,
        method,
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()),
        body,
    }
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
