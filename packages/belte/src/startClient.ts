import { hydrate } from 'svelte'
import App from './App.svelte'
import type { Layouts } from './Layouts.ts'
import { nav } from './nav.svelte.js'
import type { Routes } from './Routes.ts'
import { layoutPrefixesFor } from './routePrefixes.ts'

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

    async function loadPage(route: string): Promise<any> {
        const loader = routes[route]
        if (!loader) {
            throw new Error(`[belte] unknown route key: ${route}`)
        }
        const mod = await loader()
        return mod.default
    }

    async function loadLayouts(route: string): Promise<Array<{ key: string; Component: any }>> {
        const prefixes = layoutPrefixesFor(route, layouts, 'view')
        return Promise.all(
            prefixes.map(async (p) => ({
                key: p,
                Component: (await (layouts as Layouts)[p].view!()).default,
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
        hydrate(App, { target, props: { state: nav } })
    } catch (err) {
        console.error('[belte] initial hydration failed', err)
    }

    async function navigate(pathname: string): Promise<void> {
        let res: Response
        try {
            res = await fetch(`/__belte/resolve?p=${encodeURIComponent(pathname)}`)
        } catch (err) {
            console.error('[belte] resolve failed', err)
            window.location.href = pathname
            return
        }
        if (res.status === 404) {
            window.location.href = pathname
            return
        }
        if (!res.ok) {
            console.error('[belte] resolve returned', res.status)
            window.location.href = pathname
            return
        }
        const result = (await res.json()) as ResolveResponse
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

    document.addEventListener('click', (e) => {
        const a = isInternalLinkEvent(e)
        if (!a) {
            return
        }
        const url = new URL(a.href, window.location.href)
        e.preventDefault()
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

function isInternalLinkEvent(e: MouseEvent): HTMLAnchorElement | undefined {
    if (e.defaultPrevented) {
        return undefined
    }
    if (e.button !== 0) {
        return undefined
    }
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
        return undefined
    }
    const a = (e.target as HTMLElement | null)?.closest?.('a')
    if (!a) {
        return undefined
    }
    if (a.target && a.target !== '_self') {
        return undefined
    }
    if (a.hasAttribute('download')) {
        return undefined
    }
    if (a.getAttribute('rel')?.includes('external')) {
        return undefined
    }
    const href = a.getAttribute('href')
    if (!href || href.startsWith('#')) {
        return undefined
    }
    const url = new URL(href, window.location.href)
    if (url.origin !== window.location.origin) {
        return undefined
    }
    return a
}
