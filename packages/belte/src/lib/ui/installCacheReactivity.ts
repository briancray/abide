import { activeCacheStore } from '../shared/activeCacheStore.ts'
import type { CacheInvalidation } from '../shared/types/CacheInvalidation.ts'
import type { CacheStore } from '../shared/types/CacheStore.ts'
import { createSignalNode } from './runtime/createSignalNode.ts'
import { REACTIVE_BRIDGE } from './runtime/REACTIVE_BRIDGE.ts'
import { track } from './runtime/track.ts'
import { trigger } from './runtime/trigger.ts'
import type { ReactiveNode } from './runtime/types/ReactiveNode.ts'

/* Per-store cache-key → belte-ui signal node, created lazily on first read of a
   key and triggered when that key is invalidated. */
const keySignalsByStore = new WeakMap<CacheStore, Map<string, ReactiveNode>>()
const wiredStores = new WeakSet<CacheStore>()

/* The signal node standing in for a cache key, created on demand. */
function keySignal(store: CacheStore, key: string): ReactiveNode {
    let signals = keySignalsByStore.get(store)
    if (signals === undefined) {
        signals = new Map()
        keySignalsByStore.set(store, signals)
    }
    let node = signals.get(key)
    if (node === undefined) {
        node = createSignalNode(undefined)
        signals.set(key, node)
    }
    return node
}

/* Trigger the matching key signals when the store invalidates (wired once). */
function wire(store: CacheStore): void {
    if (wiredStores.has(store)) {
        return
    }
    wiredStores.add(store)
    store.events.addEventListener('invalidate', (event) => {
        const signals = keySignalsByStore.get(store)
        if (signals === undefined) {
            return
        }
        for (const key of (event as CustomEvent<CacheInvalidation>).detail) {
            const node = signals.get(key)
            if (node !== undefined) {
                trigger(node)
            }
        }
    })
}

/*
Bridges `belte/shared/cache` invalidation into belte-ui reactivity. Once called,
a `cache()` read performed inside a belte-ui effect (e.g. a `<template await>`)
registers the key(s) it touched as belte-ui dependencies, so a later
`cache.invalidate()` of one re-runs that reader — re-fetching and swapping the
resolved branch in place.

Opt-in by design: belte-ui's core never imports the cache (which would pull in
`svelte/reactivity`), so reactive cache invalidation costs nothing until an app
calls this. The keys are captured precisely by recording the store's `subscribe`
calls during the synchronous read — no change to the shared cache contract.
Idempotent.
*/
// @readme plumbing
export function installCacheReactivity(): void {
    REACTIVE_BRIDGE.trackRead = <T>(read: () => T): T => {
        const store = activeCacheStore()
        wire(store)
        /* Record exactly the keys this read subscribes, then track each as a dep. */
        const captured = new Set<string>()
        const original = store.subscribe
        store.subscribe = (key: string) => {
            captured.add(key)
            original.call(store, key)
        }
        let result: T
        try {
            result = read()
        } finally {
            store.subscribe = original
        }
        for (const key of captured) {
            track(keySignal(store, key))
        }
        return result
    }
}
