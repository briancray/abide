import { createSubscriber } from 'svelte/reactivity'
import { createLifecycleChannel } from './createLifecycleChannel.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheInvalidation } from './types/CacheInvalidation.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
Returns a fresh cache store. On the server, every request gets its own
store via the AsyncLocalStorage RequestStore. On the client, a single
module-level store is created at startup and shared across the tab.

Each key gets a lazily-created Svelte subscriber. Reading a key from a
tracking scope ($derived / $effect) subscribes that scope; invalidating
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
                }
            }
        })
        subscribers.set(key, registered)
        registered()
    }

    /* Store-wide in-flight tap for the probes; semantics live in createLifecycleChannel. */
    const lifecycle = createLifecycleChannel()

    return {
        entries,
        events,
        subscribe,
        trackLifecycle: lifecycle.track,
        markLifecycle: lifecycle.mark,
        pendingRefresh,
    }
}
