import type { Component } from 'svelte'
import {
    type NormalizedLayoutPrefix,
    nearestLayoutPrefix,
    normalizeLayoutPrefixes,
} from '../shared/nearestLayoutPrefix.ts'
import type { Layouts } from './types/Layouts.ts'
import type { Pages } from './types/Pages.ts'

/*
Augmentable route table. The codegen step emits a `declare module 'belte/browser/page'`
block that fills this interface with `routePath: paramShape` pairs derived
from the project's `src/browser/pages/**` tree. A bare belte install has no routes,
so the fallback arm below keeps the union inhabited before the generated
d.ts lands.

Declared as an `interface` (not a `type` alias) because the generated d.ts
augments it via `declare module … { interface Routes { … } }`, and module
augmentation only merges into interfaces.
*/
// biome-ignore lint/suspicious/noEmptyInterface: augmented by the generated routes.d.ts
export interface Routes {}

type RouteKey = keyof Routes extends never ? string : keyof Routes
type ParamsFor<R extends RouteKey> = R extends keyof Routes ? Routes[R] : Record<string, string>

type PageStateFor<R extends RouteKey> = {
    route: R
    params: ParamsFor<R>
    url: URL
}

/*
Discriminated union keyed on `route`, so consumers that narrow on `page.route`
get the matching `page.params` shape automatically. `url` is the live
WHATWG URL for the currently-displayed location; navigation reassigns the
reference so $derived subscribers re-run on every nav (not just on the
fields they happen to touch).
*/
export type Page = keyof Routes extends never
    ? PageStateFor<string>
    : { [R in keyof Routes]: PageStateFor<R> }[keyof Routes]

// biome-ignore lint/suspicious/noExplicitAny: discriminated-union init needs a single arm
export const page: Page = $state<any>({
    route: '',
    params: {},
    url: new URL('http://localhost/'),
})

/*
Internal renderer state — the Layout/Page components App.svelte mounts.
Kept on a separate $state object so it doesn't leak into the public `page`
shape; users only ever see route/params/url.
*/
export const renderState = $state<{
    Layout: Component | undefined
    Page: Component | undefined
}>({
    Layout: undefined,
    Page: undefined,
})

let boundPages: Pages | undefined
let boundLayouts: Layouts | undefined
let layoutPrefixes: NormalizedLayoutPrefix[] = []

type SsrPayload = { route: string; params: Record<string, string> }

/*
Wires the route + layout tables produced by the bundler's virtual manifests
and seeds page state from the SSR payload. Called once from startClient
before `hydrate(App)` so the first render sees Page/Layout/params already
populated. Subsequent `navigate()` calls reuse `boundPages` / `boundLayouts`.
*/
export async function bindPage({
    pages,
    layouts,
    ssr,
}: {
    pages: Pages
    layouts?: Layouts
    ssr: SsrPayload
}): Promise<void> {
    boundPages = pages
    boundLayouts = layouts
    layoutPrefixes = layouts ? normalizeLayoutPrefixes(Object.keys(layouts)) : []
    const { Page, Layout } = await loadView(ssr.route)
    applyState(ssr.route, ssr.params, Page, Layout)
}

async function loadView(
    route: string,
): Promise<{ Page: Component; Layout: Component | undefined }> {
    if (!boundPages) {
        throw new Error('[belte] page is not initialized — call bindPage first')
    }
    const pageLoader = boundPages[route]
    if (!pageLoader) {
        throw new Error(`[belte] unknown route: ${route}`)
    }
    const layoutPrefix = nearestLayoutPrefix(route, layoutPrefixes)
    const [pageMod, layoutMod] = await Promise.all([
        pageLoader(),
        layoutPrefix && boundLayouts ? boundLayouts[layoutPrefix]() : Promise.resolve(undefined),
    ])
    return { Page: pageMod.default, Layout: layoutMod?.default }
}

function applyState(
    route: string,
    params: Record<string, string>,
    Page: Component,
    Layout: Component | undefined,
): void {
    renderState.Layout = Layout
    renderState.Page = Page
    const mutable = page as PageStateFor<string>
    mutable.route = route
    mutable.params = params
    mutable.url = new URL(window.location.href)
}

function syncUrl(): void {
    const mutable = page as PageStateFor<string>
    mutable.url = new URL(window.location.href)
}

/*
Resolves the JSON view payload for a target URL, or undefined when the fetch
fails for any reason (network error or non-2xx, including 404). The caller
falls back to a hard navigation in every failure case, so the failure modes
don't need to be distinguished.
*/
async function safeResolveFetch(target: string): Promise<Response | undefined> {
    try {
        const response = await fetch(target, { headers: { Accept: 'application/json' } })
        return response.ok ? response : undefined
    } catch {
        return undefined
    }
}

export type NavigateOptions = { replace?: boolean; scroll?: boolean }

/*
SPA navigation entrypoint. Writes history (push by default, replace on
request), then resolves the new view. When only `search` or `hash` changes
(same pathname), the JSON resolve fetch + loadView are skipped — only
`page.url` is reassigned, so $derived consumers re-run without paying a
network round-trip or remounting the page component. Falls back to a hard
navigation if the resolve fetch or page-module import fails, mirroring the
behaviour of the original click handler.
*/
export async function navigate(href: string, options: NavigateOptions = {}): Promise<void> {
    const { replace = false, scroll = true } = options
    const target = new URL(href, window.location.href)
    if (target.origin !== window.location.origin) {
        window.location.href = href
        return
    }
    const fullTarget = `${target.pathname}${target.search}${target.hash}`
    if (replace) {
        window.history.replaceState(undefined, '', fullTarget)
    } else {
        window.history.pushState(undefined, '', fullTarget)
    }
    await applyTarget(target.pathname, fullTarget, scroll && !replace)
}

/*
Called by both navigate() (after writing history) and the popstate handler
(history is already current). When the pathname hasn't changed, the route
+ params + Page are the same; we just refresh `page.url`. A true pathname
change triggers the JSON resolve fetch and a page swap.
*/
async function applyTarget(
    pathname: string,
    fullTarget: string,
    resetScroll: boolean,
): Promise<void> {
    if (pathname === page.url.pathname) {
        syncUrl()
        return
    }
    const response = await safeResolveFetch(fullTarget)
    if (!response) {
        window.location.href = fullTarget
        return
    }
    const result = (await response.json()) as SsrPayload
    try {
        const { Page, Layout } = await loadView(result.route)
        applyState(result.route, result.params, Page, Layout)
        if (resetScroll) {
            window.scrollTo(0, 0)
        }
    } catch (err) {
        console.error('[belte] navigation failed', err)
        window.location.href = fullTarget
    }
}

/*
popstate fires after the browser has already restored the URL, so this just
applies the current location without writing history again. Scroll position
is left alone — the browser's built-in history scroll restoration wins for
back/forward.
*/
export function handlePopstate(): void {
    const fullTarget = `${window.location.pathname}${window.location.search}${window.location.hash}`
    void applyTarget(window.location.pathname, fullTarget, false)
}
