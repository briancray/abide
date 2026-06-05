import type { CacheEntry } from '../../shared/types/CacheEntry.ts'
import type { CacheStore } from '../../shared/types/CacheStore.ts'

/*
Cross-request holding area bridging an SSR render to its out-of-band resolution
stream. When a page flushes with pending {#await} reads, renderPage stashes the
request-scoped cache store plus its in-flight entries here under a random token
and ships the token in `__SSR__`. The browser then opens the resolve endpoint,
which TAKES the stash and awaits those SAME promises — so the handlers run once,
not again, even though the resolve stream is a separate request.

The SSR request scope exits as soon as the buffered document is sent, but the
stash holds a reference so the store (and its in-flight promises) survive until
the resolve stream drains them. A TTL evicts stashes whose client never connects
(JS disabled, navigated away before hydration) so they can't leak.
*/
type StashedStream = {
    store: CacheStore
    pending: CacheEntry[]
    timer: ReturnType<typeof setTimeout>
}

const streams = new Map<string, StashedStream>()

const STASH_TTL_MS = 30_000

/*
The TTL bounds how long a stash lives, but not how many can pile up: a burst
of streamed renders whose clients never connect would retain that many request
stores until each times out. Cap the count and evict the oldest (insertion
order on the Map) so peak memory stays bounded regardless of arrival rate.
*/
const MAX_STASHES = 1024

export function stashPendingStream(store: CacheStore, pending: CacheEntry[]): string {
    if (streams.size >= MAX_STASHES) {
        const oldest = streams.keys().next().value
        if (oldest !== undefined) {
            const evicted = streams.get(oldest)
            if (evicted) {
                clearTimeout(evicted.timer)
            }
            streams.delete(oldest)
        }
    }
    const token = crypto.randomUUID()
    const timer = setTimeout(() => streams.delete(token), STASH_TTL_MS)
    timer.unref?.()
    streams.set(token, { store, pending, timer })
    return token
}

/* Single-use: removes the stash so a token can't be drained twice. */
export function takePendingStream(
    token: string,
): { store: CacheStore; pending: CacheEntry[] } | undefined {
    const stashed = streams.get(token)
    if (!stashed) {
        return undefined
    }
    clearTimeout(stashed.timer)
    streams.delete(token)
    return { store: stashed.store, pending: stashed.pending }
}
