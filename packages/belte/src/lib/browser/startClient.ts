import { hydrate } from 'svelte'
import App from '../../App.svelte'
import { createCacheStore } from '../shared/createCacheStore.ts'
import { setCacheStoreResolver } from '../shared/setCacheStoreResolver.ts'
import type { CacheSnapshotEntry } from '../shared/types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../shared/types/CacheStore.ts'
import { bindPage, handlePopstate, navigate, page, renderState } from './page.svelte.ts'
import type { Layouts } from './types/Layouts.ts'
import type { Pages } from './types/Pages.ts'

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
        const headers = new Headers(entry.headers)
        const response = new Response(entry.body, {
            status: entry.status,
            statusText: entry.statusText,
            headers,
        })
        store.entries.set(entry.key, {
            key: entry.key,
            promise: Promise.resolve(response),
            request: new Request(entry.url, { method: entry.method }),
            ttl: undefined,
            expiresAt: undefined,
            value: warmValueFromSnapshot(entry.status, headers, entry.body),
        })
    }
}

/*
Synchronously decodes a snapshot body so the warm entry reads without a
microtask hop on first render. Mirrors decodeResponse for the textual cases
the snapshot ships; non-2xx and 204 yield no warm value and fall back to the
async path, which throws HttpError / returns undefined exactly as a live call
would. Binary/xml bodies also skip the warm path and decode asynchronously.
*/
function warmValueFromSnapshot(status: number, headers: Headers, body: string): unknown {
    if (status === 204 || status < 200 || status >= 300) {
        return undefined
    }
    const contentType = (headers.get('content-type') ?? '').toLowerCase()
    if (contentType.includes('json')) {
        return JSON.parse(body)
    }
    if (contentType.startsWith('text/')) {
        return body
    }
    return undefined
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

    try {
        await bindPage({ pages, layouts, ssr: window.__SSR__ })
        hydrate(App, { target, props: { state: { page, render: renderState } } })
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
