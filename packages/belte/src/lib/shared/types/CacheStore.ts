import type { CacheEntry } from './CacheEntry.ts'

/*
Cache map paired with a Svelte-aware per-key subscriber. Calling
`subscribe(key)` from inside a tracking scope ($derived / $effect) registers
that scope to re-run when the entry is invalidated; called outside tracking
it's a no-op. Subscribers live for the lifetime of the store: the server
uses a fresh store per request (so subscribers die with the response), the
client uses a single module-level store (so subscribers persist for the tab).

`trackLifecycle`/`markLifecycle` are the store-wide lifecycle channel used by
the pending() / refreshing() probes: unlike a keyed read they match many
entries (or all), so they re-derive by scanning entries and only need one
"in-flight membership changed" signal. Reading trackLifecycle in a tracking
scope re-runs that scope on every markLifecycle — fired whenever any call
starts, settles, or is evicted.
*/
export type CacheStore = {
    entries: Map<string, CacheEntry>
    events: EventTarget
    subscribe: (key: string) => void
    trackLifecycle: () => void
    markLifecycle: () => void
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
}
