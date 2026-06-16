import type { CacheStore } from '../shared/types/CacheStore.ts'
import type { StreamingPlaceholder } from '../shared/types/StreamingPlaceholder.ts'
import { withBaseUrl } from '../shared/withBaseUrl.ts'
import type { StreamingDeferred } from './types/StreamingDeferred.ts'

/*
Re-homes a server-built absolute Request URL under the client mount base so the
{#await} refetch routes through the proxy. The server renders at root, so the
shipped url is base-less; the client owns the prefix via the shared withBaseUrl
rule (the same base remoteProxy / openResolveStream apply to their paths).
*/
function withMountBase(absoluteUrl: string): string {
    return withBaseUrl(new URL(absoluteUrl)).href
}

/*
Pre-creates a deferred cache entry per pending key before hydration. cache()
finds the placeholder (a pending promise, no warm value) and returns it instead
of firing a fetch, so the {#await} awaits the resolution stream rather than
racing it with a duplicate request. Returns the registry the resolver settles.
*/
export function installStreamingPlaceholders(
    store: CacheStore,
    placeholders: StreamingPlaceholder[],
): Map<string, StreamingDeferred> {
    const deferreds = new Map<string, StreamingDeferred>()
    for (const placeholder of placeholders) {
        const request = new Request(withMountBase(placeholder.url), { method: placeholder.method })
        let resolve!: StreamingDeferred['resolve']
        const promise = new Promise<Response>((settle) => {
            resolve = settle
        })
        store.entries.set(placeholder.key, {
            key: placeholder.key,
            promise,
            request,
            ttl: undefined,
            expiresAt: undefined,
        })
        deferreds.set(placeholder.key, { resolve, request })
    }
    return deferreds
}
