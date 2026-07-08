import { REACTIVE_CONTEXT } from '../ui/runtime/REACTIVE_CONTEXT.ts'
import { createLifecycleChannel } from './createLifecycleChannel.ts'
import { createSubscriber } from './createSubscriber.ts'
import { keyMatchesPrefix } from './keyMatchesPrefix.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheInvalidation } from './types/CacheInvalidation.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
Returns a fresh cache store. On the server, every request gets its own
store via the AsyncLocalStorage RequestStore. On the client, a single
module-level store is created at startup and shared across the tab.

Each key gets a lazily-created subscriber. Reading a key from a
tracking scope (derived / effect) subscribes that scope; invalidating
the key dispatches an 'invalidate' event whose detail is a Set of affected
keys so each listener's lookup is O(1). The subscriber outlives entry
eviction — invalidating/refetching a key reuses the same subscriber, so
there's no listener churn or duplicate registration as cache values come
and go. It's evicted only when its last reactive reader tears down (the
client store is module-level/tab-scoped, so retaining a thunk per distinct
key would otherwise grow unbounded across a session), identity-guarded so
a concurrent re-subscribe isn't clobbered — mirroring tail.ts.
*/
export function createCacheStore(): CacheStore {
    const entries = new Map<string, CacheEntry>()
    const events = new EventTarget()
    const subscribers = new Map<string, () => void>()
    const pendingRefresh = new Set<string>()

    function subscribe(key: string): void {
        /* An untracked read (an event handler, a setup-time `await getFoo()`, any
           server render) subscribes to nothing: `track` inside createSubscriber no-ops,
           node.subsHead stays empty, and the resource never opens. Skip the bookkeeping
           too — otherwise a bare read would pin an entry in `subscribers` for the tab's
           lifetime, growing the map and leaving hasReader() over-reporting a reader that
           isn't there. Honouring the tracking seam here makes hasReader() mean exactly
           "a live tracking reader exists". */
        if (REACTIVE_CONTEXT.observer === undefined) {
            return
        }
        const existing = subscribers.get(key)
        if (existing) {
            existing()
            return
        }
        const registered = createSubscriber((update) => {
            const onInvalidate = (event: Event) => {
                if ((event as CustomEvent<CacheInvalidation>).detail.has(key)) {
                    update()
                }
            }
            events.addEventListener('invalidate', onInvalidate)
            return () => {
                events.removeEventListener('invalidate', onInvalidate)
                if (subscribers.get(key) === registered) {
                    subscribers.delete(key)
                    /* The reload marker is only ever consumed by the NEXT read of this
                       key (registerEntry). With the last reactive reader gone there is
                       no scope left to show refreshing() for it, and a future remount
                       reads with nothing on screen — a first-ever load, not a reload.
                       Drop the marker so the tab-scoped store can't accrete one per
                       invalidated-but-never-reread key over a session. */
                    pendingRefresh.delete(key)
                }
            }
        })
        subscribers.set(key, registered)
        registered()
    }

    /* Store-wide in-flight tap for the probes; semantics live in createLifecycleChannel. */
    const lifecycle = createLifecycleChannel()
    /*
    Per-prefix channels arm fn-selector probes (pending(fn) / refreshing(fn))
    without waking them on unrelated cache events. Keyed by selector prefix
    (method+url / producer reference id — see selectorPrefix), so the
    population is bounded by probe call sites in code, not by data; a channel
    whose last reader tore down is an inert closure, not a leak.
    */
    const prefixLifecycles = new Map<string, ReturnType<typeof createLifecycleChannel>>()

    function trackLifecycle(keyPrefix?: string): void {
        if (keyPrefix === undefined) {
            lifecycle.track()
            return
        }
        let channel = prefixLifecycles.get(keyPrefix)
        if (channel === undefined) {
            channel = createLifecycleChannel()
            prefixLifecycles.set(keyPrefix, channel)
        }
        channel.track()
    }

    /*
    Marks the store-wide channel always (bare/scope probes scan everything)
    plus any probed prefix channel owning the changed key — a new entry's key
    starts with its fn's prefix, so prefix probes see membership too.
    */
    function markLifecycle(key?: string): void {
        lifecycle.mark()
        if (key === undefined) {
            return
        }
        prefixLifecycles.forEach((channel, prefix) => {
            if (keyMatchesPrefix(key, prefix)) {
                channel.mark()
            }
        })
    }

    return {
        entries,
        events,
        subscribe,
        /* True iff a live tracking scope is reading this key — i.e. someone is holding
           its value on screen right now. An untracked read never registers (subscribe
           gates on the tracking seam), so a bare handler/setup read does not make this
           true. invalidate()/refresh() gate on this: a key with no live reader has
           nothing to reload into, so the next read is a first-ever load, not a refresh. */
        hasReader: (key: string) => subscribers.has(key),
        trackLifecycle,
        markLifecycle,
        pendingRefresh,
        stats: { hits: 0, misses: 0, coalesced: 0 },
    }
}
