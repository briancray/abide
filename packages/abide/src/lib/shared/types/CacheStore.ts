import type { CacheEntry } from './CacheEntry.ts'
import type { CacheStats } from './CacheStats.ts'

/*
Cache map paired with a reactive per-key subscriber. Calling
`subscribe(key)` from inside a tracking scope (derived / effect) registers
that scope to re-run when the entry is invalidated; called outside tracking
it's a no-op. Subscribers live for the lifetime of the store: the server
uses a fresh store per request (so subscribers die with the response), the
client uses a single module-level store (so subscribers persist for the tab).

`trackLifecycle`/`markLifecycle` are the probes' lifecycle channels, scoped
by selector prefix. `trackLifecycle(prefix)` taps a channel keyed to that
fn selector's entries (see selectorPrefix), so a `pending(fn)` reader
re-derives only when fn's calls change state; `trackLifecycle()` taps the
store-wide channel — bare and scope selectors scan many entries, so they
(deliberately) wake on every event. `markLifecycle(key)` — fired whenever a
call starts, settles, is evicted, or is invalidated — marks the store-wide
channel plus every probed prefix channel owning `key`.
*/
export type CacheStore = {
    entries: Map<string, CacheEntry>
    events: EventTarget
    subscribe: (key: string) => void
    trackLifecycle: (keyPrefix?: string) => void
    markLifecycle: (key?: string) => void
    /*
    Keys dropped by a (policy-less) invalidate, awaiting their next read. The
    drop erases the entry, so the next cache() call is a cold miss with no memory
    it followed an invalidate; this set carries that signal across the gap so the
    replacement entry is flagged a reload (refreshing() true) rather than a
    first-ever load. Consumed when that entry is created; a key invalidated but
    never re-read just lingers (bounded by distinct such keys; the server's
    request-scoped store discards it with the response).
    */
    pendingRefresh: Set<string>
    /* Read tallies for the closing log record + Server-Timing; see CacheStats. */
    stats: CacheStats
}
