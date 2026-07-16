import { amendBroadcastSlot } from '../shared/amendBroadcastSlot.ts'
import { applyAmendLocally } from '../shared/applyAmendLocally.ts'
import { applyCacheStalenessLocally } from '../shared/applyCacheStalenessLocally.ts'
import { cacheReaderSocketSlot } from '../shared/cacheReaderSocketSlot.ts'
import { cacheStalenessSlot } from '../shared/cacheStalenessSlot.ts'
import { cacheStoreSlot } from '../shared/cacheStoreSlot.ts'
import { createCacheStore } from '../shared/createCacheStore.ts'
import { pageSlot } from '../shared/pageSlot.ts'
import { SOCKET_SEED } from '../shared/SOCKET_SEED.ts'
import { SSR_SCRIPT_ID } from '../shared/SSR_SCRIPT_ID.ts'
import { sharedCacheStoreSlot } from '../shared/sharedCacheStoreSlot.ts'
import type { SsrPayload } from '../shared/types/SsrPayload.ts'
import type { StreamedResolution } from '../shared/types/StreamedResolution.ts'
import { createAmendReaderHook } from './amendReaderHook.ts'
import { probeNavigation } from './probeNavigation.ts'
import { router } from './router.ts'
import { CELL_SEED } from './runtime/CELL_SEED.ts'
import { clientPage } from './runtime/clientPage.ts'
import { DOC_SEED } from './runtime/DOC_SEED.ts'
import type { RouteLoader } from './runtime/types/RouteLoader.ts'
import { seedBootState } from './seedBootState.ts'
import { seedStreamedResolution } from './seedStreamedResolution.ts'
import { subscribeCacheStaleness } from './subscribeCacheStaleness.ts'

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
/*
Reads the server's SSR payload. Production ships it as an inert `<script
type="application/json">` (ADR-0051) parsed once here in the deferred bundle — off the
critical path, and through the fast JSON grammar rather than a compiled multi-MB JS object
literal. A pre-set `globalThis.__SSR__` wins first: the uiStartClient tests stamp it
directly, and it preserves any pre-bundle inline stamp. The parsed payload is republished
onto `globalThis.__SSR__` for devtools / inspector visibility.
*/
function readSsrPayload(): Partial<SsrPayload> {
    const globalScope = globalThis as { __SSR__?: Partial<SsrPayload> }
    const preset = globalScope.__SSR__
    if (preset !== undefined) {
        return preset
    }
    const element = typeof document !== 'undefined' ? document.getElementById(SSR_SCRIPT_ID) : null
    const text = element?.textContent
    if (!text) {
        return {}
    }
    const parsed = JSON.parse(text) as Partial<SsrPayload>
    globalScope.__SSR__ = parsed
    return parsed
}

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
    const ssr = readSsrPayload()
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
    /* invalidate()/refresh() apply to THIS tab's cache (the server entry installs a
       broadcaster instead — the ADR-0041 side-swap). Same function as the slot fallback so
       the local-apply path can't diverge. */
    cacheStalenessSlot.resolver = () => applyCacheStalenessLocally
    /* amend(args, value) applies to THIS tab's cache too — the server entry broadcasts instead
       (the ADR-0043 side-swap). Same function as the slot fallback for the same reason. */
    amendBroadcastSlot.resolver = () => applyAmendLocally
    /* Open/close a per-call amend value subscription as reactive readers of a key come and go
       (ADR-0043), so a server amend(args, value) push lands on keys this tab is reading. */
    const amendReader = createAmendReaderHook()
    cacheReaderSocketSlot.resolver = () => amendReader.hook
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
    /* Seed the doc-state warm partition into DOC_SEED before mount: a hydrating `createScope` reads
       its render-path key to adopt the SSR doc snapshot, so a plain `state(initial)` keeps the server
       value (the consume-once swap in `scope.replace`) instead of re-running a divergent init. */
    if (ssr.docs !== undefined) {
        Object.assign(DOC_SEED, ssr.docs)
    }
    /* Seed the socket warm partition into SOCKET_SEED before mount: a hydrating `socketProxy` reads
       its name key to seed `lastFrame`, so `peek(socket)` returns the server's retained frame instead
       of undefined on the not-yet-connected client — congruent with the SSR HTML. */
    if (ssr.sockets !== undefined) {
        Object.assign(SOCKET_SEED, ssr.sockets)
    }
    /* Keep the cache channel live past boot: replace the head's buffering collector with
       the store-connected sink so a post-boot resolution — the inline doc-stream cache
       script — seeds the store through `seedStreamedResolution` directly instead of pushing
       to a buffer nothing drains again. The inline doc-stream script only ever hands this a
       cache `StreamedResolution`. */
    ;(globalThis as { __abideResolve?: (resolution: StreamedResolution) => void }).__abideResolve =
        seedStreamedResolution

    /* Subscribe to the reserved cache-staleness pipe (ADR-0041) AFTER seeding, so a server
       broadcast drops/refetches this tab's freshly-hydrated cache — live-only, never replay. */
    const disposeStaleness = subscribeCacheStaleness()
    const disposeRouter = router(target, routes, layoutRoutes, probeNavigation)
    return () => {
        disposeStaleness()
        amendReader.dispose()
        /* Clear the reader hook so a post-teardown cache read doesn't re-open amend subscriptions
           — unlike the staleness/store slots (whose leaked resolver stays benign), a live hook on
           the read path must not outlive the client it belongs to. */
        cacheReaderSocketSlot.resolver = undefined
        disposeRouter()
    }
}
