import { cache } from './cache.ts'
import type { CacheSelector } from './types/CacheSelector.ts'

/*
Applies a staleness verb to THIS side's cache store(s) — the local half of the
isomorphic invalidate/refresh (ADR-0041). Both the cacheStalenessSlot fallback and
the client entry's resolver point at this one function so the local-apply path can't
diverge between "unbooted unit test" and "booted client tab". The server entry
replaces the resolver with a broadcaster instead (the side-swap seam), so this never
runs on the server's throwaway request store.
*/
export function applyCacheStalenessLocally<Args, Return>(
    op: 'invalidate' | 'refresh',
    selector: CacheSelector<Args, Return>,
    args?: Args,
): void {
    cache[op](selector, args)
}
