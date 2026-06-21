import { cacheManagedSlot } from './cacheManagedSlot.ts'

/*
Runs `invoke` with cacheManagedSlot flagged, so any RPC fired synchronously inside
it (the cache's underlying remote/producer call) skips reactive scope-binding — the
cache, not the calling reader, owns the shared flight's lifetime. Save/restore keeps
it correct under nesting (a producer that itself reads cache). The fetch is fired
synchronously and the flag clears before the await, so it never spans the network.
*/
export function withCacheManaged<T>(invoke: () => T): T {
    const previous = cacheManagedSlot.active
    cacheManagedSlot.active = true
    try {
        return invoke()
    } finally {
        cacheManagedSlot.active = previous
    }
}
