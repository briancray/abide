import { cacheEntryFromSnapshot } from '../shared/cacheEntryFromSnapshot.ts'
import { createCacheStore } from '../shared/createCacheStore.ts'
import { setBaseResolver } from '../shared/setBaseResolver.ts'
import { setCacheStoreResolver } from '../shared/setCacheStoreResolver.ts'
import { setGlobalCacheStoreResolver } from '../shared/setGlobalCacheStoreResolver.ts'
import { setPageResolver } from '../shared/setPageResolver.ts'
import type { CacheSnapshotEntry } from '../shared/types/CacheSnapshotEntry.ts'
import { installHotBridge } from './installHotBridge.ts'
import { probeNavigation } from './probeNavigation.ts'
import { router } from './router.ts'
import { clientPage } from './runtime/clientPage.ts'
import type { RouteLoader } from './runtime/types/RouteLoader.ts'

/* The server's __SSR__ payload this entry consumes. */
type SsrPayload = { cache?: CacheSnapshotEntry[]; base?: string }

/*
The official abide-ui client entry. Reads the server's `window.__SSR__` payload,
seeds a tab-scoped cache store from the inline snapshot (so a warm `cache()` read
resolves synchronously and the matching `<template await>` adopts the SSR DOM with
no re-fetch), installs the mount base, and starts the router — which imports the
current route's chunk, adopts the server-rendered `#app`, then drives SPA
navigation — importing each further page's chunk on first visit and probing the
destination through the server's app.handle so auth/redirect gating still applies.
Returns a disposer. `target` defaults to `#app`; pass one explicitly in tests.
*/
// @readme plumbing
export function startClient(
    routes: Record<string, RouteLoader>,
    layoutRoutes: Record<string, RouteLoader> = {},
    target: Element | null = typeof document !== 'undefined'
        ? document.getElementById('app')
        : null,
): () => void {
    if (target === null) {
        throw new Error('[abide] startClient: missing #app target')
    }
    /* Dev only: the live-reload script sets `__abideDev` before this module runs,
       so the runtime bridge is in place before any component mounts and records
       its instances (mountChild) for hot replacement. */
    if ((globalThis as { __abideDev?: boolean }).__abideDev) {
        installHotBridge()
    }
    const ssr = (globalThis as { __SSR__?: SsrPayload }).__SSR__ ?? {}
    setBaseResolver(() => ssr.base ?? '')
    /* The `page` proxy reads route/params/url off the router-updated snapshot. */
    setPageResolver(() => clientPage.value)

    const store = createCacheStore()
    setCacheStoreResolver(() => store)
    /* One tab store: cache(fn, { global: true }) shares it, so global is a no-op here. */
    setGlobalCacheStoreResolver(() => store)
    for (const entry of ssr.cache ?? []) {
        store.entries.set(entry.key, cacheEntryFromSnapshot(entry))
    }

    return router(target, routes, layoutRoutes, probeNavigation)
}
