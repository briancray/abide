import { hydrate } from 'svelte'
import App from '../../App.svelte'
import { createCacheStore } from '../shared/createCacheStore.ts'
import { createTraceContext } from '../shared/createTraceContext.ts'
import { healthSeedSlot } from '../shared/healthSeedSlot.ts'
import { rpcTimeoutSlot } from '../shared/rpcTimeoutSlot.ts'
import { setAppName } from '../shared/setAppName.ts'
import { setBaseResolver } from '../shared/setBaseResolver.ts'
import { setCacheStoreResolver } from '../shared/setCacheStoreResolver.ts'
import { setGlobalCacheStoreResolver } from '../shared/setGlobalCacheStoreResolver.ts'
import { setPageResolver } from '../shared/setPageResolver.ts'
import { setRequestScopeResolver } from '../shared/setRequestScopeResolver.ts'
import type { CacheSnapshotEntry } from '../shared/types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../shared/types/CacheStore.ts'
import type { StreamingPlaceholder } from '../shared/types/StreamingPlaceholder.ts'
import { cacheEntryFromSnapshot } from './cacheEntryFromSnapshot.ts'
import { installStreamingPlaceholders } from './installStreamingPlaceholders.ts'
import { navigate } from './navigate.ts'
import { openResolveStream } from './openResolveStream.ts'
import {
    bindPage,
    clientPageState,
    handlePopstate,
    handleRenderError,
    page,
    renderState,
} from './page.svelte.ts'
import type { Errors } from './types/Errors.ts'
import type { Layouts } from './types/Layouts.ts'
import type { Pages } from './types/Pages.ts'

declare global {
    interface Window {
        __SSR__: {
            route: string
            params: Record<string, string>
            cache?: CacheSnapshotEntry[]
            /* Pending {#await} keys the client pre-creates placeholders for. */
            streaming?: StreamingPlaceholder[]
            /* Single-use token for the out-of-band resolution stream. */
            streamToken?: string
            /* A server-rendered error.svelte page — static, nothing to hydrate. */
            error?: boolean
            /* APP_URL mount base (e.g. /v2); absent at root mount. */
            base?: string
            /* traceparent of the request that rendered this page; the client continues it. */
            trace?: string
            /* The app's name — the default log channel client lines speak on. */
            app?: string
            /* Health payload seed for a page that read health() during SSR. */
            health?: Record<string, unknown>
            /* BELTE_CLIENT_TIMEOUT (ms) for RPC fetches; absent = unbounded. */
            clientTimeout?: number
        }
    }
}

/*
Pre-populates the client cache store with response entries captured during SSR.
Each becomes an already-resolved Response so the first hydration pass finds the
data via cache() without a network round-trip.
*/
function hydrateCacheFromSnapshot(store: CacheStore, snapshot: CacheSnapshotEntry[]): void {
    for (const entry of snapshot) {
        store.entries.set(entry.key, cacheEntryFromSnapshot(entry))
    }
}

function isInternalLinkEvent(event: MouseEvent): HTMLAnchorElement | undefined {
    if (event.defaultPrevented) {
        return undefined
    }
    if (event.button !== 0) {
        return undefined
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return undefined
    }
    const anchor = (event.target as HTMLElement | null)?.closest?.('a')
    if (!anchor) {
        return undefined
    }
    if (anchor.target && anchor.target !== '_self') {
        return undefined
    }
    if (anchor.hasAttribute('download')) {
        return undefined
    }
    if (anchor.getAttribute('rel')?.includes('external')) {
        return undefined
    }
    const href = anchor.getAttribute('href')
    if (!href || href.startsWith('#')) {
        return undefined
    }
    const url = new URL(href, window.location.href)
    if (url.origin !== window.location.origin) {
        return undefined
    }
    return anchor
}

/*
Hydrates the SSR'd document against the SSR payload on `window.__SSR__`,
then intercepts internal link clicks (delegating to navigate) and popstate
events. The page module owns the route/Page/Layout state and the
URL-resolution logic; this entry just wires the cache store, runs the
initial bind, and attaches the global listeners. App.svelte receives the
public `page` proxy plus the internal renderState so the same reactive
objects update across navigations.
*/
export async function startClient({
    pages,
    layouts,
    errors,
}: {
    pages: Pages
    layouts?: Layouts
    errors?: Errors
}): Promise<void> {
    const target = document.getElementById('app')
    if (!target) {
        throw new Error('[belte] missing #app target')
    }

    /*
    A server-rendered error.svelte (404 / page-render failure) ships static HTML
    with no route to hydrate against — leave the markup as-is and wire nothing.
    */
    if (window.__SSR__.error) {
        return
    }

    /* Install the mount base before anything reads url() so client-generated links carry it. */
    const base = window.__SSR__.base ?? ''
    setBaseResolver(() => base)

    /* The server's BELTE_CLIENT_TIMEOUT, so RPC fetches bound themselves; absent = unbounded. */
    rpcTimeoutSlot.ms = window.__SSR__.clientTimeout

    /*
    Continue the SSR request's trace (or mint a fresh one if the stamp is
    missing) and publish the browser's request scope: trace() and log line
    prefixes resolve through it. elapsedMs is navigation-relative — exactly
    what performance.now() measures — and the path tracks client navigations
    because the resolver reads location per call.
    */
    setAppName(window.__SSR__.app)
    const traceContext = createTraceContext(window.__SSR__.trace)
    setRequestScopeResolver(() => ({
        trace: traceContext,
        elapsedMs: performance.now(),
        method: 'GET',
        path: window.location.pathname,
    }))

    const cacheStore = createCacheStore()
    setCacheStoreResolver(() => cacheStore)
    /* One tab store: cache(fn, { global: true }) shares it, so global is a no-op here. */
    setGlobalCacheStoreResolver(() => cacheStore)
    /* One document: the `page` proxy resolves to this $state singleton, mutated by navigate(). */
    setPageResolver(() => clientPageState)
    if (window.__SSR__.cache) {
        hydrateCacheFromSnapshot(cacheStore, window.__SSR__.cache)
    }

    /*
    Park the health seed before hydrate: the first health() subscriber —
    typically connected during hydration — consumes it, seeding the fields
    without the immediate first probe (the document's arrival just proved
    the server reachable; the poll interval owns the next check).
    */
    healthSeedSlot.payload = window.__SSR__.health

    /*
    Install placeholders for pending {#await} keys before hydrate(), so cache()
    reads hit a placeholder on first evaluation instead of firing their own
    fetch, then open the out-of-band resolution stream to settle them. The fetch
    runs in the background — hydration doesn't wait on it.
    */
    const deferreds = installStreamingPlaceholders(cacheStore, window.__SSR__.streaming ?? [])
    if (window.__SSR__.streamToken && deferreds.size > 0) {
        void openResolveStream(window.__SSR__.streamToken, cacheStore, deferreds)
    }

    try {
        await bindPage({ pages, layouts, errors, ssr: window.__SSR__ })
        hydrate(App, {
            target,
            props: { state: { page, render: renderState, onRenderError: handleRenderError } },
        })
    } catch (err) {
        console.error('[belte] initial hydration failed', err)
    }

    document.addEventListener('click', (event) => {
        const anchor = isInternalLinkEvent(event)
        if (!anchor) {
            return
        }
        const url = new URL(anchor.href, window.location.href)
        /*
        Hash-only same-page navigations fall through to the browser so the
        native scroll-into-view for `#anchor` targets keeps working.
        Anything else (pathname, search, or pathname+hash combo) goes
        through navigate() — it pushes history, refreshes page state, and
        short-circuits the JSON resolve when only search/hash differ.
        */
        if (url.pathname === window.location.pathname && url.search === window.location.search) {
            return
        }
        event.preventDefault()
        void navigate(`${url.pathname}${url.search}${url.hash}`)
    })

    window.addEventListener('popstate', handlePopstate)
}
