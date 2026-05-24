import type { Component } from 'svelte'
import { hydrate } from 'svelte'
import App from '../../App.svelte'
import { setCacheStoreResolver } from '../shared/activeCacheStore.ts'
import { createCacheStore } from '../shared/createCacheStore.ts'
import { nearestLayoutPrefix } from '../shared/nearestLayoutPrefix.ts'
import type { CacheSnapshotEntry } from '../types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../types/CacheStore.ts'
import type { Layouts } from '../types/Layouts.ts'
import type { Pages } from '../types/Pages.ts'
import type { RemoteResponse } from '../types/RemoteResponse.ts'
import { nav } from './nav.svelte.ts'

declare global {
    interface Window {
        __SSR__: {
            route: string
            params: Record<string, string>
            cache?: CacheSnapshotEntry[]
        }
    }
}

/*
Pre-populates the client cache store with response entries captured during
SSR. Each entry becomes an already-resolved Response so the first hydration
pass finds the data via cache() without issuing a network round-trip.
*/
function hydrateCacheFromSnapshot(store: CacheStore, snapshot: CacheSnapshotEntry[]): void {
    for (const entry of snapshot) {
        const response = new Response(entry.body, {
            status: entry.status,
            statusText: entry.statusText,
            headers: new Headers(entry.headers),
        }) as RemoteResponse<unknown>
        store.entries.set(entry.key, {
            key: entry.key,
            promise: Promise.resolve(response),
            request: new Request(entry.url, { method: entry.method }),
            ttl: undefined,
            expiresAt: undefined,
        })
    }
}

type ResolveResponse = { route: string; params: Record<string, string> }

type FetchOutcome =
    | { kind: 'ok'; response: Response }
    | { kind: 'network-error' }
    | { kind: 'not-found' }
    | { kind: 'http-error'; status: number }

async function safeResolveFetch(target: string): Promise<FetchOutcome> {
    let response: Response
    try {
        response = await fetch(target, { headers: { Accept: 'application/json' } })
    } catch {
        return { kind: 'network-error' }
    }
    if (response.status === 404) {
        return { kind: 'not-found' }
    }
    if (!response.ok) {
        return { kind: 'http-error', status: response.status }
    }
    return { kind: 'ok', response }
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
Hydrates the SSR'd document against the SSR payload on `window.__SSR__`, then
intercepts internal link clicks and popstate events to perform client-side
navigations. Each navigation fetches a JSON envelope (route + params) and
swaps the active page + layout component; pages call cache(...) themselves to
fetch their data via the remote-function proxy.
*/
export async function startClient({
    pages,
    layouts,
}: {
    pages: Pages
    layouts?: Layouts
}): Promise<void> {
    const target = document.getElementById('app')
    if (!target) {
        throw new Error('[belte] missing #app target')
    }

    const cacheStore = createCacheStore()
    setCacheStoreResolver(() => cacheStore)
    if (window.__SSR__.cache) {
        hydrateCacheFromSnapshot(cacheStore, window.__SSR__.cache)
    }

    const layoutPrefixes = layouts ? Object.keys(layouts) : []

    async function loadView(
        route: string,
    ): Promise<{ Page: Component; Layout: Component | undefined }> {
        const pageLoader = pages[route]
        if (!pageLoader) {
            throw new Error(`[belte] unknown route: ${route}`)
        }
        const layoutPrefix = nearestLayoutPrefix(route, layoutPrefixes)
        const [pageMod, layoutMod] = await Promise.all([
            pageLoader(),
            layoutPrefix && layouts ? layouts[layoutPrefix]() : Promise.resolve(undefined),
        ])
        return { Page: pageMod.default, Layout: layoutMod?.default }
    }

    try {
        const { route, params } = window.__SSR__
        const { Page, Layout } = await loadView(route)
        nav.Page = Page
        nav.layout = Layout
        nav.params = params
        hydrate(App, { target, props: { state: nav } })
    } catch (err) {
        console.error('[belte] initial hydration failed', err)
    }

    /*
    `target` is path + search + hash (or just path); the JSON resolve fetch
    keeps the search so server-side routing can branch on query. `resetScroll`
    is true for fresh navigations and false for popstate so the browser's
    built-in history scroll restoration wins for back/forward.
    */
    async function navigate(target: string, resetScroll: boolean): Promise<void> {
        const outcome = await safeResolveFetch(target)
        if (outcome.kind !== 'ok') {
            window.location.href = target
            return
        }
        const result = (await outcome.response.json()) as ResolveResponse
        try {
            const { Page, Layout } = await loadView(result.route)
            nav.Page = Page
            nav.layout = Layout
            nav.params = result.params
            if (resetScroll) {
                window.scrollTo(0, 0)
            }
        } catch (err) {
            console.error('[belte] navigation failed', err)
            window.location.href = target
        }
    }

    document.addEventListener('click', (event) => {
        const anchor = isInternalLinkEvent(event)
        if (!anchor) {
            return
        }
        const url = new URL(anchor.href, window.location.href)
        event.preventDefault()
        if (url.pathname === window.location.pathname && url.search === window.location.search) {
            if (url.hash !== window.location.hash) {
                window.location.hash = url.hash
            }
            return
        }
        const target = url.pathname + url.search + url.hash
        history.pushState(undefined, '', target)
        void navigate(target, true)
    })

    window.addEventListener('popstate', () => {
        const target = window.location.pathname + window.location.search + window.location.hash
        void navigate(target, false)
    })
}
