import type { CacheEntry } from './CacheEntry.ts'
import type { CacheSnapshotEntry } from './CacheSnapshotEntry.ts'

/*
The SSR partition of a request's cache, read after `render()` returns.
`inline` are entries settled by then (consumed via `await`, so render blocked
on them) — they ship in the first chunk's `__SSR__` blob. `pending` are
GET/DELETE entries still in flight (consumed via `{#await}`, which render emits
as a pending branch without blocking) — the streamer awaits each and pushes a
`__abideResolve` chunk as it lands. Non-GET/DELETE pending entries are dropped:
they can't be snapshotted, so the client re-fetches them live on cache miss.
*/
export type CacheSnapshot = {
    inline: CacheSnapshotEntry[]
    pending: CacheEntry[]
}
