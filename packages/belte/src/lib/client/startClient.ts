import { hydrate } from 'svelte'
import App from '../../App.svelte'
import { setCacheStoreResolver } from '../shared/activeCacheStore.ts'
import { createCacheStore } from '../shared/createCacheStore.ts'
import type { CacheSnapshotEntry } from '../types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../types/CacheStore.ts'
import type { Layouts } from '../types/Layouts.ts'
import type { Pages } from '../types/Pages.ts'
import type { RemoteResponse } from '../types/RemoteResponse.ts'
import { bindNav, handlePopstate, nav, navigate } from './nav.svelte.ts'

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
then intercepts internal link clicks (delegating to nav.navigate) and
popstate events. The nav module owns the route/Page/Layout state and the
URL-resolution logic; this entry just wires the cache store, runs the
initial bind, and attaches the global listeners.
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
        await bindNav({ pages, layouts, ssr: window.__SSR__ })
        hydrate(App, { target, props: { state: nav } })
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
        through navigate() — it pushes history, refreshes nav state, and
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
