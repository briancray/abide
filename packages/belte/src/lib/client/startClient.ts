import type { Component } from 'svelte'
import { hydrate } from 'svelte'
import App from '../../App.svelte'
import { layoutLoadersFor } from '../shared/layoutLoadersFor.ts'
import type { Layouts } from '../types/Layouts.ts'
import type { Routes } from '../types/Routes.ts'
import { nav } from './nav.svelte.ts'

declare global {
    interface Window {
        __SSR__: {
            route: string
            params: Record<string, string>
            data: Record<string, unknown>
        }
    }
}

type ResolveResponse =
    | {
          route: string
          params: Record<string, string>
          data?: Record<string, unknown>
      }
    | { redirect: string }

type FetchOutcome =
    | { kind: 'ok'; response: Response }
    | { kind: 'network-error' }
    | { kind: 'not-found' }
    | { kind: 'http-error'; status: number }

/*
Wraps a JSON-accepting fetch in a tagged-union outcome so callers can branch
on network errors, 404s, and other HTTP failures without try/catch noise.
*/
async function safeResolveFetch(pathname: string): Promise<FetchOutcome> {
    let response: Response
    try {
        response = await fetch(pathname, { headers: { Accept: 'application/json' } })
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

/*
Returns the anchor element a click event should hijack for client-side navigation,
or undefined when the event should fall through to the browser (modifier keys,
external origin, download/target attributes, hash-only, non-left buttons, etc.).
*/
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
navigations by fetching the same routes as JSON.
*/
export async function startClient({
    routes,
    layouts,
}: {
    routes: Routes
    layouts?: Layouts
}): Promise<void> {
    const target = document.getElementById('app')
    if (!target) {
        throw new Error('[belte] missing #app target')
    }

    async function loadPage(route: string): Promise<Component> {
        const loader = routes[route]
        if (!loader) {
            throw new Error(`[belte] unknown route key: ${route}`)
        }
        const mod = await loader()
        return mod.default
    }

    async function loadLayouts(
        route: string,
    ): Promise<Array<{ key: string; Component: Component }>> {
        const loaders = layoutLoadersFor(route, layouts, 'view')
        return Promise.all(
            loaders.map(async ({ prefix, load }) => ({
                key: prefix,
                Component: (await load()).default,
            })),
        )
    }

    try {
        const { route, params, data } = window.__SSR__
        const [Page, layoutChain] = await Promise.all([loadPage(route), loadLayouts(route)])
        nav.layouts = layoutChain
        nav.Page = Page
        nav.params = params
        nav.data = data
        // hydrate mounts to DOM — impure boundary
        hydrate(App, { target, props: { state: nav } })
    } catch (err) {
        console.error('[belte] initial hydration failed', err)
    }

    /*
    Performs a client-side navigation to `pathname`. Fetches the resolve
    envelope as JSON, follows a redirect by replacing history and recursing,
    swaps the active layouts/page/data, and resets scroll. Any network or
    handler failure falls back to a full page load so the user is never stuck.
    */
    async function navigate(pathname: string): Promise<void> {
        const outcome = await safeResolveFetch(pathname)
        if (outcome.kind === 'network-error') {
            console.error('[belte] resolve failed')
            window.location.href = pathname
            return
        }
        if (outcome.kind === 'not-found') {
            window.location.href = pathname
            return
        }
        if (outcome.kind === 'http-error') {
            console.error('[belte] resolve returned', outcome.status)
            window.location.href = pathname
            return
        }
        const result = (await outcome.response.json()) as ResolveResponse
        if ('redirect' in result) {
            history.replaceState(undefined, '', result.redirect)
            void navigate(result.redirect)
            return
        }
        try {
            const [Page, layoutChain] = await Promise.all([
                loadPage(result.route),
                loadLayouts(result.route),
            ])
            nav.layouts = layoutChain
            nav.Page = Page
            nav.params = result.params
            nav.data = result.data ?? {}
            window.scrollTo(0, 0)
        } catch (err) {
            console.error('[belte] navigation failed', err)
            window.location.href = pathname
        }
    }

    // DOM event registration is the impure boundary for client navigation
    document.addEventListener('click', (event) => {
        const anchor = isInternalLinkEvent(event)
        if (!anchor) {
            return
        }
        const url = new URL(anchor.href, window.location.href)
        event.preventDefault()
        // Same path+search but different hash: let the browser handle the in-page jump
        // and history entry; don't refetch the route.
        if (url.pathname === window.location.pathname && url.search === window.location.search) {
            if (url.hash !== window.location.hash) {
                window.location.hash = url.hash
            }
            return
        }
        history.pushState(undefined, '', url.pathname + url.search + url.hash)
        void navigate(url.pathname)
    })

    window.addEventListener('popstate', () => {
        void navigate(window.location.pathname)
    })
}
