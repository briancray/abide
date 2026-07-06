import { cacheStoreSlot } from '../shared/cacheStoreSlot.ts'
import { createCacheStore } from '../shared/createCacheStore.ts'
import { globalCacheStoreSlot } from '../shared/globalCacheStoreSlot.ts'
import { pageSlot } from '../shared/pageSlot.ts'
import type { SsrPayload } from '../shared/types/SsrPayload.ts'
import type { StreamedResolution } from '../shared/types/StreamedResolution.ts'
import { probeNavigation } from './probeNavigation.ts'
import { seedBootState } from './seedBootState.ts'

/* Build-time flag the production client defines false (see build.ts `define`) so the dev-only
   hot bridge — and the entire DOM runtime it statically pulls in for re-builds — is dead-code-
   eliminated, not even emitted as a chunk. Dev defines it true; the test preload sets it on
   globalThis so the bare reference resolves there. */
declare const __ABIDE_DEV__: boolean

import { router } from './router.ts'
import { clientPage } from './runtime/clientPage.ts'
import type { RouteLoader } from './runtime/types/RouteLoader.ts'
import { seedResolved } from './seedResolved.ts'

/*
The official abide-ui client entry. Reads the server's `window.__SSR__` payload,
seeds a tab-scoped cache store from the inline snapshot (so a warm `cache()` read
resolves synchronously and the matching `{#await}` adopts the SSR DOM with
no re-fetch), installs the mount base, seeds the per-page __SSR__ stamps (app
name, health, RPC timeout), and starts the router — which imports the
current route's chunk, adopts the server-rendered `#app`, then drives SPA
navigation — importing each further page's chunk on first visit and probing the
destination through the server's app.handle so auth/redirect gating still applies.
Returns a disposer. `target` defaults to `#app`; pass one explicitly in tests.
*/
// @documentation plumbing
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
    /* Dev only: the live-reload script sets `__abideDev` before this module runs, so the
       runtime bridge is in place before any component mounts and records its instances
       (mountChild) for hot replacement. Lazy-imported and `__ABIDE_DEV__`-gated so the
       bridge (and the DOM runtime it drags in) is fully dead-code-eliminated in production
       rather than shipped behind a runtime flag the minifier can't prove false. */
    if (__ABIDE_DEV__ && (globalThis as { __abideDev?: boolean }).__abideDev) {
        import('./installHotBridge.ts').then((module) => module.installHotBridge())
    }
    /* Inspector only: the server injects `__abideInspect` when ABIDE_ENABLE_INSPECTOR is on,
       so the scope/router bridge arms before the router builds any scope. Inspector can be
       enabled in production, so this stays a lazy chunk (not `__ABIDE_DEV__`-gated) — emitted
       but fetched only when the flag is set, never weighing down the default client load. */
    if ((globalThis as { __abideInspect?: boolean }).__abideInspect) {
        import('./installInspectorBridge.ts').then((module) => module.installInspectorBridge())
    }
    const ssr = (globalThis as { __SSR__?: Partial<SsrPayload> }).__SSR__ ?? {}
    /* Seed the per-page __SSR__ stamps into their shared slots before mount: the mount
       base, app name (default log channel), health payload (so health()'s first probe is
       warm), and the env-configured RPC timeout (ABIDE_CLIENT_TIMEOUT, shipped per
       request). Driven by the exhaustive `seedBootState` map so a new boot field can't be
       stamped server-side and silently dropped here. Without seeding: no mount base,
       channel 'app', a cold first health probe, and unbounded RPC fetches. */
    seedBootState(ssr)
    /* The `page` proxy reads route/params/url off the router-updated snapshot. */
    pageSlot.resolver = () => clientPage.value

    const store = createCacheStore()
    cacheStoreSlot.resolver = () => store
    /* One tab store: cache(fn, { global: true }) shares it, so global is a no-op here. */
    globalCacheStoreSlot.resolver = () => store
    /* Seed both SSR cache partitions through the one streamed-resolution sink: `ssr.cache`
       (inline — reads settled at render-return, in __SSR__) and `__abideResumeCache` (pending
       {#await} reads whose `__abideResolve(...)` chunks the stream pushed during parse, before
       this deferred bundle ran). A warm entry lets a `cache()` read resolve synchronously so
       `{#await}` adopts without a refetch; a miss marker re-fetches live. */
    const streamed =
        (globalThis as { __abideResumeCache?: StreamedResolution[] }).__abideResumeCache ?? []
    for (const resolution of [...(ssr.cache ?? []), ...streamed]) {
        seedResolved({ kind: 'cache', resolution })
    }
    /* Keep the cache channel live past boot: replace the head's buffering collector with
       the store-connected sink so a post-load resolution — streaming SPA navigation or a
       socket-delivered SSR frame, both routed through applyResolved — seeds the store
       directly instead of pushing to a buffer nothing drains again. The inline doc-stream
       script only ever hands this a cache `StreamedResolution`, so wrap it as a cache frame
       through the one intake seam. */
    ;(globalThis as { __abideResolve?: (resolution: StreamedResolution) => void }).__abideResolve =
        (resolution) => seedResolved({ kind: 'cache', resolution })

    return router(target, routes, layoutRoutes, probeNavigation)
}
