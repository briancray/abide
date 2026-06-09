import type { Component } from 'svelte'
import { activePage } from '../shared/activePage.ts'
import {
    type NormalizedLayoutPrefix,
    nearestLayoutPrefix,
    normalizeLayoutPrefixes,
} from '../shared/nearestLayoutPrefix.ts'
import type { PageSnapshot } from '../shared/types/PageSnapshot.ts'
import { abortPageStream } from './pageStreamController.ts'
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
    navigating: boolean
}

/*
Discriminated union keyed on `route`, so consumers that narrow on `page.route`
get the matching `page.params` shape automatically. `url` is the live
WHATWG URL for the currently-displayed location; navigation reassigns the
reference so $derived subscribers re-run on every nav (not just on the
fields they happen to touch). `navigating` is true while a pathname-changing
SPA navigation is resolving its view, false otherwise (always false on the
server).
*/
export type Page = keyof Routes extends never
    ? PageStateFor<string>
    : { [R in keyof Routes]: PageStateFor<R> }[keyof Routes]

/*
Client-side singleton the resolver returns. navigate()/applyState mutate it;
because it's $state, reads taken through the `page` proxy inside a $derived
re-run on every nav. Never populated server-side — there the resolver reads
the per-request ALS store instead, so concurrent renders don't share it.
*/
export const clientPageState: PageSnapshot = $state({
    route: '',
    params: {},
    url: new URL('http://localhost/'),
    navigating: false,
})

/*
Public page state. A getter proxy over the side's registered resolver
(activePage): client → clientPageState singleton, server → the per-request
ALS snapshot. Property reads on the client resolve to the $state singleton, so
reactivity flows; on the server each render reads its own request scope. Users
only ever see route/params/url.
*/
export const page = {
    get route() {
        return activePage().route
    },
    get params() {
        return activePage().params
    },
    get url() {
        return activePage().url
    },
    get navigating() {
        return activePage().navigating
    },
} as unknown as Page

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
    clientPageState.route = route
    clientPageState.params = params
    syncUrl()
}

function syncUrl(): void {
    clientPageState.url = new URL(window.location.href)
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

function hasRoute(route: string): boolean {
    return Boolean(boundPages?.[route])
}

type ResolvedView = {
    route: string
    params: Record<string, string>
    Page: Component
    Layout: Component | undefined
}

/*
Resolves a target into the Page/Layout components to render, or undefined
when the target isn't an SPA route: the resolve fetch failed, the body wasn't
a known route (e.g. a raw JSON endpoint that 200s on `Accept: json`), or the
page module import threw. Callers fall back to a hard navigation in every
undefined case. A missing/unknown route is expected and stays silent; a known
route whose module fails to import is a real error and is surfaced.
*/
async function resolveView(fullTarget: string): Promise<ResolvedView | undefined> {
    const response = await safeResolveFetch(fullTarget)
    if (!response) {
        return undefined
    }
    const result = (await response.json()) as SsrPayload
    if (!result.route || !hasRoute(result.route)) {
        return undefined
    }
    try {
        const { Page, Layout } = await loadView(result.route)
        return { route: result.route, params: result.params, Page, Layout }
    } catch (err) {
        console.error('[belte] navigation failed', err)
        return undefined
    }
}

function writeHistory(replace: boolean, fullTarget: string): void {
    if (replace) {
        window.history.replaceState(undefined, '', fullTarget)
    } else {
        window.history.pushState(undefined, '', fullTarget)
    }
}

export type NavigateOptions = { replace?: boolean; scroll?: boolean }

/*
Shared pathname-navigation core for navigate() and popstate's applyTarget().
Cancels any open resolution stream, flags the in-flight nav so $derived
consumers (loading indicators) re-run, then resolves + applies the target
view. `beforeApply` runs between resolve and apply — navigate writes history
there, which applyState's syncUrl reads. Returns false when the target wasn't
an SPA route and we hard-navigated via location.href instead, so callers skip
post-apply work like scrolling. The finally clears the flag on every exit,
including the hard-nav bail.
*/
async function applyResolvedView(fullTarget: string, beforeApply?: () => void): Promise<boolean> {
    abortPageStream()
    clientPageState.navigating = true
    try {
        const view = await resolveView(fullTarget)
        if (!view) {
            window.location.href = fullTarget
            return false
        }
        beforeApply?.()
        applyState(view.route, view.params, view.Page, view.Layout)
        return true
    } finally {
        clientPageState.navigating = false
    }
}

/*
SPA navigation entrypoint. When only `search` or `hash` changes (same
pathname) the JSON resolve fetch + loadView are skipped — history is written
and `page.url` reassigned so $derived consumers re-run without a network
round-trip or page remount. On a pathname change the target view is resolved
*before* history is touched: a non-SPA target (raw JSON endpoint, unknown
route, failed import) hard-navigates cleanly via `location.href`, because a
pushed entry whose URL no longer matches its in-memory document corrupts
back/forward (Safari restores the stale document under the new URL).
*/
export async function navigate(href: string, options: NavigateOptions = {}): Promise<void> {
    const { replace = false, scroll = true } = options
    const target = new URL(href, window.location.href)
    if (target.origin !== window.location.origin) {
        window.location.href = href
        return
    }
    const fullTarget = `${target.pathname}${target.search}${target.hash}`
    if (target.pathname === clientPageState.url.pathname) {
        writeHistory(replace, fullTarget)
        syncUrl()
        return
    }
    const applied = await applyResolvedView(fullTarget, () => writeHistory(replace, fullTarget))
    if (applied && scroll && !replace) {
        window.scrollTo(0, 0)
    }
}

/*
popstate fires after the browser has already restored the URL, so this never
writes history — it just applies the current location. A same-pathname change
only refreshes `page.url`; a pathname change resolves and swaps the page, or
hard-navigates when the restored URL isn't an SPA route.
*/
async function applyTarget(pathname: string, fullTarget: string): Promise<void> {
    if (pathname === clientPageState.url.pathname) {
        syncUrl()
        return
    }
    await applyResolvedView(fullTarget)
}

/*
popstate fires after the browser has already restored the URL. Scroll
position is left alone — the browser's built-in history scroll restoration
wins for back/forward.
*/
export function handlePopstate(): void {
    const fullTarget = `${window.location.pathname}${window.location.search}${window.location.hash}`
    void applyTarget(window.location.pathname, fullTarget)
}
