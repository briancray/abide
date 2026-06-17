import { layoutChainForRoute } from '../shared/layoutChainForRoute.ts'
import { effect } from './effect.ts'
import { matchRoute } from './matchRoute.ts'
import { navigate } from './navigate.ts'
import { clientPage } from './runtime/clientPage.ts'
import { enterRenderPass } from './runtime/enterRenderPass.ts'
import { exitRenderPass } from './runtime/exitRenderPass.ts'
import { firstOutlet } from './runtime/firstOutlet.ts'
import { runtimePath } from './runtime/runtimePath.ts'
import type { NavVerdict } from './runtime/types/NavVerdict.ts'
import type { Route } from './runtime/types/Route.ts'
import type { RouteLoader } from './runtime/types/RouteLoader.ts'
import { untrack } from './runtime/untrack.ts'

/* A layout mounted in the active chain: its route key (the directory URL — its
   identity for the diff), the disposer that stops its reactivity, and the outlet
   element the next layer mounts into. */
type MountedLayout = { key: string; dispose: () => void; outlet: Element }

/* A layout mount that returns no disposer still needs one for the chain teardown. */
const noop = (): void => {}

/*
A minimal client router on the History API. `router` matches the current path
against the route patterns (literal / `[name]` / `[...rest]`, via matchRoute),
imports the matching page's chunk — plus every `layout.abide` chunk that wraps it
(`layoutChainForRoute`) — on demand, and mounts them as a chain: each layout into
the previous layout's `<slot/>` outlet, the page into the innermost outlet.

Navigation re-resolves the chain and DIFFS it against the mounted one: layouts whose
route key still matches at the same depth stay mounted (their state, effects, scroll,
and DOM survive); from the first divergent layout down — the leaf layers — everything
is disposed and rebuilt, and the page (always the leaf) re-mounts every time. The
reactive `page` proxy means a persisted layout reading route/params updates in place
without a remount. Each chunk loads only on first visit, cached after.

`probe` (when given) runs each post-boot navigation's destination through the
server's app.handle first, so auth/redirect gating applies to client navigation
just as it does to a fresh load; its verdict either clears the mount, soft-redirects
where handle() pointed, or hands off to a full browser load. The first render
adopts a document handle() already ran on, so it isn't probed. There is no server
router — the server picks the page by request URL directly; this is the client
half. `*` is the fallback route.
*/
// @readme plumbing
export function router(
    host: Element,
    loaders: Record<string, RouteLoader>,
    layoutLoaders: Record<string, RouteLoader> = {},
    probe?: (path: string) => Promise<NavVerdict>,
): () => void {
    /* The mounted layout chain (outermost first) + the page disposer. */
    const mountedLayouts: MountedLayout[] = []
    let disposePage: (() => void) | undefined
    const patterns = Object.keys(loaders).filter((key) => key !== '*')
    const layoutKeys = Object.keys(layoutLoaders)

    /* A code-split resolver over one loader map: resolved chunks keyed by route
       pattern, so a revisit re-mounts without a second import. */
    const resolver = (
        map: Record<string, RouteLoader>,
    ): ((key: string) => Promise<Route | undefined>) => {
        const resolved = new Map<string, Route | undefined>()
        return async (key) => {
            if (resolved.has(key)) {
                return resolved.get(key)
            }
            const loader = map[key]
            const view = loader === undefined ? undefined : (await loader()).default
            resolved.set(key, view)
            return view
        }
    }
    const resolvePage = resolver(loaders)
    const resolveLayout = resolver(layoutLoaders)

    /* Tear down the page and every layout from `index` inward (innermost first), then
       return the container the rebuild mounts into — the surviving layout's outlet, or
       `host` when the whole chain goes. */
    const disposeFrom = (index: number): Element => {
        disposePage?.()
        disposePage = undefined
        for (let depth = mountedLayouts.length - 1; depth >= index; depth -= 1) {
            mountedLayouts[depth]?.dispose()
        }
        const base = index === 0 ? host : (mountedLayouts[index - 1] as MountedLayout).outlet
        mountedLayouts.length = index
        return base
    }

    /* Mount (or hydrate) the chain tail — layouts `[index..]` then the page — into
       `base`, threading each layer into the previous one's outlet. Hydration brackets
       ONE render pass across all layers so await/try block ids stay unique and aligned
       with the SSR stream; a fresh mount needs no shared pass. */
    const buildFrom = (
        base: Element,
        index: number,
        chainKeys: string[],
        layoutViews: Route[],
        pageView: Route | undefined,
        params: Record<string, string>,
        hydrating: boolean,
    ): void => {
        const run = (): void => {
            let container = base
            for (let depth = index; depth < layoutViews.length; depth += 1) {
                const view = layoutViews[depth] as Route
                const dispose = hydrating
                    ? (view.hydrate as NonNullable<Route['hydrate']>)(container, params)
                    : (view(container, params) ?? noop)
                const outlet = firstOutlet(container)
                if (outlet === undefined) {
                    throw new Error('[abide] a layout.abide must contain a <slot/> outlet')
                }
                mountedLayouts.push({ key: chainKeys[depth] as string, dispose, outlet })
                container = outlet
            }
            if (pageView === undefined) {
                return
            }
            disposePage = hydrating
                ? (pageView.hydrate as NonNullable<Route['hydrate']>)(container, params)
                : (pageView(container, params) ?? undefined)
        }
        if (hydrating) {
            enterRenderPass()
            try {
                run()
            } finally {
                exitRenderPass()
            }
            return
        }
        run()
    }

    const onPopState = (): void => {
        runtimePath.value = location.pathname + location.search + location.hash
    }
    const onClick = (event: MouseEvent): void => {
        /* Let the browser own anything that isn't a plain primary-button click:
           modified clicks (open in a new tab/window), middle/right buttons, and
           already-handled events. */
        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return
        }
        const target = event.target as Element
        const link = target.closest?.('a[href]') as HTMLAnchorElement | null
        if (link === null) {
            return
        }
        /* Defer to the browser for links it should own: a new-tab target, a
           download, or an explicitly external rel. */
        if (
            (link.target !== '' && link.target !== '_self') ||
            link.hasAttribute('download') ||
            link.getAttribute('rel') === 'external'
        ) {
            return
        }
        const destination = new URL(link.href)
        if (destination.origin !== location.origin) {
            return
        }
        event.preventDefault()
        /* Carry the query and hash, not just the pathname, so the destination page's
           page.url sees them and an SPA navigation matches a fresh server load. */
        navigate(destination.pathname + destination.search + destination.hash)
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('popstate', onPopState)
        document.addEventListener('click', onClick as EventListener)
    }

    /* First render adopts the server-rendered DOM (when the matching page is
       hydratable); navigation after that re-mounts fresh. */
    let first = true
    /* Monotonic token: a newer navigation that resolves first wins, so a slow
       chunk landing late never overwrites the page the user has since moved to. */
    let sequence = 0
    /* Latched on teardown so a navigation whose imports/probe were in flight at
       dispose can't run its `.then` and rebuild a chain we just tore down — the
       `token` guard only catches a *newer* navigation, not disposal. */
    let disposed = false
    const stop = effect(() => {
        /* The route is the only dependency the router should re-run on. Everything
           else runs untracked so the page's build-time reads (each interpolation
           reads its value once before wrapping it in its own effect) bind to the
           page's own effects, not this one — otherwise any in-page state change
           would re-run the router and re-mount the page, dropping local state. */
        const path = runtimePath.value
        untrack(() => {
            /* The route matches on the pathname only; the query/hash ride along for
               the probe (so server gating sees them) and for clientPage.url. */
            const pathname = path.split(/[?#]/)[0] ?? path
            const matched = matchRoute(patterns, pathname)
            const key = matched?.route ?? '*'
            const params = matched?.params ?? {}
            /* The layout chain resolves off the literal route key (so a layout at a
               `[id]` directory matches the `[name]` pattern, not the concrete path). */
            const chainRoute = matched?.route ?? pathname
            const chainKeys = layoutChainForRoute(chainRoute, layoutKeys)
            sequence += 1
            const token = sequence
            /* First paint adopts a document the server already ran handle() on;
               only later navigations re-run it through the probe. */
            const verdict: Promise<NavVerdict> =
                first || probe === undefined ? Promise.resolve({ kind: 'mount' }) : probe(path)
            /* Resolve the page chunk, its layout chunks, and the gate in parallel,
               keeping the current chain mounted until all land — no blank frame while
               imports are in flight or the probe is in the air. */
            void Promise.all([
                resolvePage(key),
                Promise.all(chainKeys.map((layoutKey) => resolveLayout(layoutKey))),
                verdict,
            ]).then(([pageView, resolvedLayouts, decision]) => {
                if (token !== sequence || disposed) {
                    return
                }
                /* handle() redirected: go where it pointed, replacing the blocked
                   URL so back doesn't trap on it. The router re-probes the target. */
                if (decision.kind === 'redirect') {
                    navigate(decision.path, true)
                    return
                }
                /* handle() blocked it / redirected off-origin / the probe failed:
                   let the browser load the server's real response. */
                if (decision.kind === 'reload') {
                    if (typeof location !== 'undefined') {
                        location.href = decision.url
                    }
                    return
                }
                /* Publish the active page so the `page` proxy resolves route/params/url. */
                clientPage.value = {
                    route: matched?.route ?? pathname,
                    params,
                    url:
                        typeof location === 'undefined'
                            ? new URL(`http://localhost${path}`)
                            : new URL(location.href),
                    navigating: false,
                }
                const layoutViews = resolvedLayouts.filter(
                    (view): view is Route => view !== undefined,
                )
                /* The shared prefix of layouts (same route key at the same depth) stays
                   mounted; the first divergence and everything inward is rebuilt. */
                let divergence = 0
                while (
                    divergence < mountedLayouts.length &&
                    divergence < chainKeys.length &&
                    mountedLayouts[divergence]?.key === chainKeys[divergence]
                ) {
                    divergence += 1
                }
                const hydrating =
                    first && pageView?.hydratable === true && pageView.hydrate !== undefined
                first = false
                /* The DOM mutation a navigation makes: tear the divergent chain down,
                   clear its DOM (a fresh mount; hydration adopts in place), rebuild. */
                const swap = (): void => {
                    const base = disposeFrom(divergence)
                    if (!hydrating) {
                        base.textContent = ''
                    }
                    buildFrom(base, divergence, chainKeys, layoutViews, pageView, params, hydrating)
                }
                /* Wrap the swap in a View Transition where the browser supports it, so
                   the page change cross-fades (and shared `view-transition-name` elements
                   morph) — the synchronous swap is exactly the mutation the API snapshots
                   around. Skipped while hydrating: the first paint adopts SSR DOM in place,
                   not animate. CSS owns opting out (e.g. prefers-reduced-motion). */
                if (
                    !hydrating &&
                    typeof document !== 'undefined' &&
                    'startViewTransition' in document
                ) {
                    document.startViewTransition(swap)
                } else {
                    swap()
                }
            })
        })
    })

    return () => {
        disposed = true
        if (typeof window !== 'undefined') {
            window.removeEventListener('popstate', onPopState)
            document.removeEventListener('click', onClick as EventListener)
        }
        stop()
        disposeFrom(0)
    }
}
