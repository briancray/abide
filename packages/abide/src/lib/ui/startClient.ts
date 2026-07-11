import { cacheStoreSlot } from '../shared/cacheStoreSlot.ts'
import { createCacheStore } from '../shared/createCacheStore.ts'
import { pageSlot } from '../shared/pageSlot.ts'
import { sharedCacheStoreSlot } from '../shared/sharedCacheStoreSlot.ts'
import type { SsrPayload } from '../shared/types/SsrPayload.ts'
import type { StreamedResolution } from '../shared/types/StreamedResolution.ts'
import { probeNavigation } from './probeNavigation.ts'
import { router } from './router.ts'
import { CELL_SEED } from './runtime/CELL_SEED.ts'
import { clientPage } from './runtime/clientPage.ts'
import type { RouteLoader } from './runtime/types/RouteLoader.ts'
import { seedBootState } from './seedBootState.ts'
import { seedStreamedResolution } from './seedStreamedResolution.ts'

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
    /* One tab store: cache(fn, { shared: true }) shares it, so shared is a no-op here. */
    sharedCacheStoreSlot.resolver = () => store
    /* Seed both SSR cache partitions through the one streamed-resolution sink: `ssr.cache`
       (inline — reads settled at render-return, in __SSR__) and `__abideResumeCache` (pending
       {#await} reads whose `__abideResolve(...)` chunks the stream pushed during parse, before
       this deferred bundle ran). A warm entry lets a `cache()` read resolve synchronously so
       `{#await}` adopts without a refetch; a miss marker re-fetches live. */
    const streamed =
        (globalThis as { __abideResumeCache?: StreamedResolution[] }).__abideResumeCache ?? []
    for (const resolution of [...(ssr.cache ?? []), ...streamed]) {
        seedStreamedResolution(resolution)
    }
    /* Seed the async-cell warm partition into `CELL_SEED` before mount: a hydrating
       `createAsyncCell` reads its render-path key here to adopt the SSR-resolved value warm
       instead of re-running its seed cold (Object.assign so an inline pre-bundle script that
       already populated `__abideCells` isn't clobbered). */
    if (ssr.cells !== undefined) {
        Object.assign(CELL_SEED, ssr.cells)
    }
    /* Keep the cache channel live past boot: replace the head's buffering collector with
       the store-connected sink so a post-boot resolution — the inline doc-stream cache
       script — seeds the store through `seedStreamedResolution` directly instead of pushing
       to a buffer nothing drains again. The inline doc-stream script only ever hands this a
       cache `StreamedResolution`. */
    ;(globalThis as { __abideResolve?: (resolution: StreamedResolution) => void }).__abideResolve =
        seedStreamedResolution

    return router(target, routes, layoutRoutes, probeNavigation)
}
