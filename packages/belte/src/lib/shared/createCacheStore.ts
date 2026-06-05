import { createSubscriber } from 'svelte/reactivity'
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
a concurrent re-subscribe isn't clobbered — mirroring subscribe.ts.
*/
export function createCacheStore(): CacheStore {
    const entries = new Map<string, CacheEntry>()
    const events = new EventTarget()
    const subscribers = new Map<string, () => void>()

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

    /*
    Store-wide tap for in-flight lifecycle. cache.pending selectors match many
    entries (or all), so they re-derive by scanning `entries` and only need a
    single "something changed" signal rather than per-key granularity. One
    lazily-created subscriber for the whole store, evicted when its last reader
    tears down — mirroring subscribe(key) and subscribe.ts.
    */
    let lifecycle: (() => void) | undefined
    function trackLifecycle(): void {
        if (!lifecycle) {
            lifecycle = createSubscriber((update) => {
                const onLifecycle = () => update()
                events.addEventListener('lifecycle', onLifecycle)
                return () => {
                    events.removeEventListener('lifecycle', onLifecycle)
                    lifecycle = undefined
                }
            })
        }
        lifecycle()
    }

    return { entries, events, subscribe, trackLifecycle }
}
