import { hydratingSlot } from '../shared/hydratingSlot.ts'
import { layoutChainForRoute } from '../shared/layoutChainForRoute.ts'
import { matchRoute } from '../shared/matchRoute.ts'
import { wakeHydrationPeeks } from '../shared/wakeHydrationPeeks.ts'
import { fillBoundary } from './dom/fillBoundary.ts'
import { outlet } from './dom/outlet.ts'
import { effect } from './effect.ts'
import { navigatePath } from './navigate.ts'
import { CHILD_PRESENT } from './runtime/CHILD_PRESENT.ts'
import { clientPage } from './runtime/clientPage.ts'
import { enterRenderPass } from './runtime/enterRenderPass.ts'
import { exitRenderPass } from './runtime/exitRenderPass.ts'
import { historyEntries } from './runtime/historyEntries.ts'
import { PENDING_OUTLET } from './runtime/PENDING_OUTLET.ts'
import { RENDER } from './runtime/RENDER.ts'
import { runtimePath } from './runtime/runtimePath.ts'
import type { AbideHistoryState } from './runtime/types/AbideHistoryState.ts'
import type { NavVerdict } from './runtime/types/NavVerdict.ts'
import type { Route } from './runtime/types/Route.ts'
import type { RouteLoader } from './runtime/types/RouteLoader.ts'
import type { UiProps } from './runtime/types/UiProps.ts'
import { untrack } from './runtime/untrack.ts'

/* An outlet boundary — the `<!--abide:outlet-->`…`<!--/abide:outlet-->` marker pair a
   layer's content lives between (a layout's `<slot/>`, or the router's root boundary in
   the mount host). The next chain layer fills it; no `<abide-outlet>` element. */
type Boundary = { open: Comment; close: Comment }

/* A layout mounted in the active chain: its route key (the directory URL — its identity
   for the diff), the disposer that stops its reactivity and clears its content, and the
   boundary of its own `<slot/>` — where the next layer mounts. */
type MountedLayout = { key: string; dispose: () => void; slot: Boundary }

/* The destination URL for a navigation `path`. On the server / headless there is no
   `location`, so resolve against a localhost origin; in the browser, against the real
   origin — `location` is already updated to `path` by the time a swap reads it, so this
   matches `new URL(location.href)`. */
const resolveUrl = (path: string): URL =>
    typeof location === 'undefined'
        ? new URL(`http://localhost${path}`)
        : new URL(path, location.origin)

/* A full browser load is the recovery for an import/probe failure — offline, a hashed
   chunk name rotated by a deploy, a transient 5xx. But a DETERMINISTIC failure (a chunk
   that throws every load) would reload forever. Bound it per destination: after
   MAX_RECOVERY_RELOADS consecutive reloads of the same URL, stop and leave the error
   visible instead of thrashing. `sessionStorage` so the count survives the reload it
   triggers (and clears with the tab); absent it (SSR / privacy mode), fall back to a
   single reload. `clearRecoveryReloads` resets the count once that URL mounts cleanly,
   so a later genuine blip gets its reload again. */
const MAX_RECOVERY_RELOADS = 2
const reloadCountKey = (url: string): string => `abide:reload:${url}`

function boundedReload(url: string): void {
    if (typeof location === 'undefined') {
        return
    }
    let count = 0
    try {
        count = Number(sessionStorage.getItem(reloadCountKey(url)) ?? '0')
        sessionStorage.setItem(reloadCountKey(url), String(count + 1))
    } catch {
        /* sessionStorage blocked — proceed with an unbounded single reload. */
    }
    if (count >= MAX_RECOVERY_RELOADS) {
        console.error(
            `[abide] gave up reloading ${url} after ${count} attempts — the page keeps failing to load. See the error above.`,
        )
        return
    }
    location.href = url
}

/* A URL mounted cleanly — forget its reload history so a future transient failure there
   is allowed to recover by reloading again. */
function clearRecoveryReloads(url: string): void {
    try {
        sessionStorage.removeItem(reloadCountKey(url))
    } catch {
        /* nothing persisted — nothing to clear. */
    }
}

/*
A minimal client router on the History API. `router` matches the current path
against the route patterns (literal / `[name]` / `[[name]]` / `[...rest]`, via
the shared matchRoute — the same matcher the server dispatches with),
imports the matching page's chunk — plus every `layout.abide` chunk that wraps it
(`layoutChainForRoute`) — on demand, and mounts them as a chain: each layout into
the previous layout's `<slot/>` outlet, the page into the innermost outlet.

Navigation re-resolves the chain and DIFFS it against the mounted one: layouts whose
route key still matches at the same depth stay mounted (their state, effects, scroll,
and DOM survive); from the first divergent layout down — the leaf layers — everything
is disposed and rebuilt, and the page (always the leaf) re-mounts every time. The
reactive `page` proxy means a persisted layout reading route/params updates in place
without a remount. Each chunk loads only on first visit, cached after.

Scroll restoration is manual (`historyEntries`): because the page is rebuilt after the
browser would restore scroll, each history entry's offset is bucketed by an `abideEntry`
id and reapplied once the destination DOM exists — back/forward returns to its offset, a
fresh navigation scrolls to the top.

`probe` (when given) runs each post-boot navigation's destination through the
server's app.handle first, so auth/redirect gating applies to client navigation
just as it does to a fresh load; its verdict either clears the mount, soft-redirects
where handle() pointed, or hands off to a full browser load. The first render
adopts a document handle() already ran on, so it isn't probed. There is no server
router — the server picks the page by request URL directly; this is the client
half. `*` is the fallback route.
*/
// @documentation plumbing
export function router(
    host: Element,
    loaders: Record<string, RouteLoader>,
    layoutLoaders: Record<string, RouteLoader> = {},
    probe?: (path: string) => Promise<NavVerdict>,
): () => void {
    /* The mounted layout chain (outermost first) + the page disposer. */
    const mountedLayouts: MountedLayout[] = []
    let disposePage: (() => void) | undefined
    /* The route key of the currently mounted leaf page — its identity for the
       same-page in-place diff: when a navigation resolves to this same key with an
       unchanged layout chain, only params/url differ, so the page stays mounted and
       updates through the reactive `page` proxy (no teardown). */
    let mountedPageKey: string | undefined
    /* The root outlet boundary in `host` (`#app`) the outermost layer fills — established
       once on the first mount (claimed from the SSR DOM when hydrating, created otherwise)
       and reused across navigations, since `#app` itself never re-mounts. */
    let rootBoundary: Boundary | undefined
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

    /* Tear down the page and every layout from `index` inward (innermost first). Each
       layer's disposer stops its reactivity and clears its content from its boundary
       (the outermost cleared range removes the inner DOM too — harmless double-clears).
       Leaves the boundary markers in place so the rebuild fills the same boundary. */
    const disposeFrom = (index: number): void => {
        disposePage?.()
        disposePage = undefined
        for (let depth = mountedLayouts.length - 1; depth >= index; depth -= 1) {
            mountedLayouts[depth]?.dispose()
        }
        mountedLayouts.length = index
    }

    /* The outlet boundary the layer at `index` fills: the root boundary for the outermost
       layer, else the surviving parent layout's `<slot/>`. */
    const baseBoundary = (index: number): Boundary =>
        index === 0 ? (rootBoundary as Boundary) : (mountedLayouts[index - 1] as MountedLayout).slot

    /* Build (or hydrate) the chain tail — layouts `[index..]` then the page — filling each
       layer into the previous one's `<slot/>` boundary (the root boundary for the
       outermost). `outlet()` records each layer's own slot in `PENDING_OUTLET` as the
       layer builds, so the next layer knows where to mount — no DOM scan. Hydration
       brackets ONE render pass + claim cursor across all layers so await/try block ids
       stay unique and aligned with the SSR stream; a fresh mount needs no shared pass. */
    const buildFrom = (
        index: number,
        chainKeys: string[],
        layoutViews: Route[],
        pageView: Route | undefined,
        pageKey: string,
        params: Record<string, string>,
        hydrating: boolean,
    ): void => {
        const run = (): void => {
            /* Establish the root boundary on the first mount — `outlet(host)` claims the
               SSR root boundary (hydrating) or creates it (fresh), recording it in
               `PENDING_OUTLET`. Reused across navigations thereafter. A fresh first mount
               (no claim cursor — e.g. a non-hydratable page whose SSR shell can't be
               adopted) discards whatever the server put in `#app` first, so the created
               boundary is the only content. */
            if (rootBoundary === undefined) {
                if (RENDER.hydration === undefined) {
                    host.textContent = ''
                }
                outlet(host)
                rootBoundary = PENDING_OUTLET.current as Boundary
            }
            /* Route params as reactive thunks: reading `clientPage.value.params` inside the
               thunk tracks the page signal, so an in-place same-route hop (params change, the
               page stays mounted) re-runs each `props()` derive. The key set is stable across
               same-route hops, so the bag need not rebuild. A layout also gets `$children`
               set to `CHILD_PRESENT` when a child layer exists below it, read by
               `{#if children}` (a layout's `{children()}` lowers to its `outlet()` boundary,
               so it ignores this value). */
            const propsBag = (hasChild: boolean): UiProps => {
                const bag: UiProps = {}
                for (const key of Object.keys(params)) {
                    bag[key] = () => clientPage.value.params[key]
                }
                if (hasChild) {
                    bag.$children = CHILD_PRESENT
                }
                return bag
            }
            let boundary = baseBoundary(index)
            for (let depth = index; depth < layoutViews.length; depth += 1) {
                const view = layoutViews[depth] as Route
                PENDING_OUTLET.current = undefined
                const { dispose } = fillBoundary(
                    boundary.open,
                    boundary.close,
                    view.build,
                    /* A layout always has a child below: a deeper layout, or the page. */
                    propsBag(depth < layoutViews.length - 1 || pageView !== undefined),
                    /* The layout's route key names its scope in the inspector's Reactive tab
                       (no host element to read a tag from — see `scopeLabel`). */
                    chainKeys[depth],
                )
                const slot = PENDING_OUTLET.current
                if (slot === undefined) {
                    throw new Error('[abide] a layout.abide must contain a {children()} outlet')
                }
                mountedLayouts.push({ key: chainKeys[depth] as string, dispose, slot })
                boundary = slot
            }
            if (pageView === undefined) {
                mountedPageKey = undefined
                return
            }
            disposePage = fillBoundary(
                boundary.open,
                boundary.close,
                pageView.build,
                /* A page is a leaf — no child layer. */
                propsBag(false),
                /* The page's route key names its scope in the inspector (see above). */
                pageKey,
            ).dispose
            mountedPageKey = pageKey
        }
        if (hydrating) {
            const previous = RENDER.hydration
            const previousHydrating = hydratingSlot.active
            RENDER.hydration = { next: new Map() }
            hydratingSlot.active = true
            enterRenderPass()
            try {
                run()
            } finally {
                exitRenderPass()
                RENDER.hydration = previous
                hydratingSlot.active = previousHydrating
                /* Wake the peeks this pass withheld for SSR congruence, now that the pass is
                   over and the warm value is congruent to show. Only on the outermost unwind. */
                if (!previousHydrating) {
                    wakeHydrationPeeks()
                }
            }
            return
        }
        run()
    }

    const entryOf = (): number =>
        (history.state as AbideHistoryState | null)?.abideEntry ?? historyEntries.current
    const onPopState = (): void => {
        /* Bucket the leaving entry's scroll (current still its id) before adopting the
           one back/forward landed on; `swap` restores the adopted entry's offset once
           its DOM is rebuilt. */
        historyEntries.save()
        historyEntries.adopt(entryOf())
        runtimePath.value = location.pathname + location.search + location.hash
    }
    const onPageHide = (): void => {
        /* Mirror the live scroll into the active entry's state before it unloads, so a
           non-hydratable reload (which tears the SSR DOM down) can recover it from the
           manual bucket. */
        historyEntries.persist()
        /* Re-enable native scroll restoration for the NEXT document load (a reload): the
           browser restores the SSR DOM's offset before paint, flash-free — where the
           manual bucket, gated behind the async chunk import, would re-apply post-paint
           (a visible scroll). The first paint flips back to `manual` for in-session nav. */
        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'auto'
        }
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
        /* `closest?.` is undefined when the target is a non-Element (text node, document)
           that has no `closest`; `== null` catches both that and a genuine no-match null. */
        const link = target.closest?.('a[href]') as HTMLAnchorElement | null
        if (link == null) {
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
        navigatePath(destination.pathname + destination.search + destination.hash)
    }
    if (typeof window !== 'undefined') {
        /* Scroll restoration is the browser's job on a document load (reload / first
           paint): native restoration runs BEFORE paint, so a hydrating in-place adopt
           returns to the reload offset flash-free (`auto` here also self-heals an entry a
           prior session left `manual`). The first paint then flips to `manual` (below) so
           an in-session back/forward — which tears the page down and rebuilds — restores
           against the new DOM instead of letting the browser restore against the
           torn-down one; `onPageHide` flips back to `auto` for the next load. Still adopt
           the initial entry's id (survives a reload) and stamp it onto the landing entry —
           merging so any `scroll` a prior unload persisted stays put for a non-hydratable
           first paint's manual `restore` to recover. */
        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'auto'
        }
        historyEntries.adopt(entryOf())
        const landingState = (history.state as AbideHistoryState | null) ?? {}
        history.replaceState(
            { ...landingState, abideEntry: historyEntries.current },
            '',
            location.href,
        )
        window.addEventListener('popstate', onPopState)
        window.addEventListener('pagehide', onPageHide)
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
            /* Capture whether THIS run is the first paint, then flip the shared flag
               synchronously. Previously `first` was only cleared inside the async `.then`,
               so a second navigation that began before the boot resolve settled (a
               double-tapped back button, two quick `navigate()` calls) still read
               `first === true` and skipped its auth/redirect probe. Each run's `.then`
               closes over its own `isFirstRun`, so hydration still keys off the real first
               paint. */
            const isFirstRun = first
            first = false
            /* The route matches on the pathname only; the query/hash ride along for
               the probe (so server gating sees them) and for clientPage.url. */
            const pathname = path.split(/[?#]/)[0] ?? path
            /* A same-document navigation — only the `#hash` (and thus scroll) differs from
               the mounted page — needs no teardown: the live page stays, page.url
               republishes (so `page.url.hash` updates in place), and we restore the entry's
               scroll bucket or scroll to the anchor. A differing pathname or query still
               rebuilds (a query is page data). Skipped on first paint — nothing is mounted. */
            const targetUrl = resolveUrl(path)
            const mountedUrl = clientPage.value.url
            if (
                !isFirstRun &&
                mountedUrl.pathname === targetUrl.pathname &&
                mountedUrl.search === targetUrl.search &&
                mountedUrl.hash !== targetUrl.hash
            ) {
                /* Invalidate any in-flight full navigation so its late `.then` can't
                   rebuild over the page this hash hop keeps mounted (the token guard
                   only bails on a NEWER sequence). That bailed `.then` is also the only
                   writer of `navigating: false`, so clear the flag here — a hash hop is
                   synchronous and settles immediately. */
                sequence += 1
                clientPage.value = { ...clientPage.value, url: targetUrl, navigating: false }
                historyEntries.restore(targetUrl.hash)
                return
            }
            const matched = matchRoute(patterns, pathname)
            const key = matched?.route ?? '*'
            const params = matched?.params ?? {}
            /* The layout chain resolves off the literal route key (so a layout at a
               `[id]` directory matches the `[name]` pattern, not the concrete path). */
            const chainRoute = matched?.route ?? pathname
            const chainKeys = layoutChainForRoute(chainRoute, layoutKeys)
            sequence += 1
            const token = sequence
            /* Flag the outgoing page as navigating for the resolve window — chunk
               import + probe + the view transition all run before the swap commits.
               Published on the CURRENT snapshot (route/params unchanged) so a spinner
               bound to `page.navigating` shows over the page being left; `swap`
               republishes with the destination and `navigating: false` on commit.
               Skipped on first paint — there is no page to leave. An instant SPA hop
               (chunk cached, no probe) flips it back within the same microtask, so the
               browser never paints the intermediate state — no flash. */
            if (!isFirstRun && !clientPage.value.navigating) {
                clientPage.value = { ...clientPage.value, navigating: true }
            }
            /* First paint adopts a document the server already ran handle() on;
               only later navigations re-run it through the probe. */
            const verdict: Promise<NavVerdict> =
                isFirstRun || probe === undefined ? Promise.resolve({ kind: 'mount' }) : probe(path)
            /* Resolve the page chunk, its layout chunks, and the gate in parallel,
               keeping the current chain mounted until all land — no blank frame while
               imports are in flight or the probe is in the air. */
            void Promise.all([
                resolvePage(key),
                Promise.all(chainKeys.map((layoutKey) => resolveLayout(layoutKey))),
                verdict,
            ])
                .then(([pageView, resolvedLayouts, decision]) => {
                    if (token !== sequence || disposed) {
                        /* Superseded (or disposed) — drop this build. The first-paint flag was
                           already consumed synchronously at run start (`first = false`), so a
                           navigation that started after this one already saw `first === false`,
                           ran its probe, and builds in create mode over the stale SSR DOM. */
                        return
                    }
                    /* handle() redirected: go where it pointed, replacing the blocked
                   URL so back doesn't trap on it. The router re-probes the target. */
                    if (decision.kind === 'redirect') {
                        navigatePath(decision.path, { replace: true })
                        return
                    }
                    /* handle() blocked it / redirected off-origin / the probe failed:
                   let the browser load the server's real response. */
                    if (decision.kind === 'reload') {
                        boundedReload(decision.url)
                        return
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
                    const firstPaint = isFirstRun
                    const hydrating = isFirstRun && pageView?.hydratable === true
                    /* Same page, same layout chain — only params/url differ (e.g. stepping
                       between episodes on one detail page). The whole structure survives, so
                       publish the new snapshot on the reactive `page` proxy and let the mounted
                       page + layouts re-derive in place — no teardown, no rebuild, so local
                       state, scroll, and DOM are kept (the persistence layouts already get,
                       now extended to the leaf). A reader keyed on an *unchanged* param (a page
                       whose data is `cache(...)({ id: page.params.id })`) doesn't re-fire at
                       all — value-memoised computeds stop the equal id from waking it — so the
                       page's blocking await never re-suspends. No view transition: nothing
                       structurally swaps. */
                    const targetUrl = resolveUrl(path)
                    const samePageInPlace =
                        pageView !== undefined &&
                        key === mountedPageKey &&
                        divergence === mountedLayouts.length &&
                        divergence === chainKeys.length &&
                        /* A differing query is page data — it still rebuilds, matching the
                           hash-only fast path's guard. Only path-param changes within the same
                           route key (e.g. the episode segment) take the in-place route. */
                        clientPage.value.url.search === targetUrl.search
                    if (samePageInPlace) {
                        clientPage.value = {
                            route: chainRoute,
                            params,
                            url: targetUrl,
                            navigating: false,
                        }
                        historyEntries.restore(targetUrl.hash)
                        return
                    }
                    /* The DOM mutation a navigation makes: tear the divergent chain down
                   (clearing its content from its boundary) and rebuild into the same
                   boundary (hydration adopts in place). */
                    const swap = (): void => {
                        /* `startViewTransition` runs this callback in a later frame, so a newer
                           navigation may have superseded this one since the token guard above —
                           re-check before mutating, or a stale swap clobbers the newer page. */
                        if (token !== sequence || disposed) {
                            return
                        }
                        /* Tear the outgoing page + divergent layouts down BEFORE publishing the
                       new snapshot. Publishing first would re-run the doomed leaf page's
                       computeds against the new route's params (a missing `[id]` reads back
                       `undefined`, e.g. `Number(page.params.id)` → NaN → a bogus request)
                       while it's still mounted. Disposing first kills that scope; surviving
                       prefix layouts then update in place on publish. */
                        disposeFrom(divergence)
                        const url = resolveUrl(path)
                        clientPage.value = { route: chainRoute, params, url, navigating: false }
                        buildFrom(
                            divergence,
                            chainKeys,
                            layoutViews,
                            pageView,
                            key,
                            params,
                            hydrating,
                        )
                        /* Reapply the destination entry's scroll once its DOM exists — a
                       back/forward restores its offset, a fresh nav scrolls to the `#hash`
                       anchor (now built) or the top. SKIPPED on a hydrating first paint:
                       the SSR DOM is adopted in place, so the browser's native restoration
                       already returned the entry to its reload offset before paint — the
                       manual bucket, gated behind the async chunk import above, would only
                       re-apply post-paint (a visible scroll = the flash). A non-hydratable
                       first paint tore the SSR DOM down and rebuilt, so it still needs the
                       manual restore (recovered from the persisted `history.state`). */
                        if (!hydrating) {
                            historyEntries.restore(url.hash)
                        }
                        /* Take over scroll restoration once abide owns the DOM: a later
                       same-document back/forward must restore against the rebuilt page, so
                       the browser must not. `onPageHide` flips back to `auto` so the next
                       document load restores natively (flash-free) again. */
                        if (
                            firstPaint &&
                            typeof history !== 'undefined' &&
                            'scrollRestoration' in history
                        ) {
                            history.scrollRestoration = 'manual'
                        }
                    }
                    /* Build / hydrate is the deterministic surface — a codegen defect or a
                       throw in user render code fails the SAME way every load, so reloading
                       would loop forever. Catch it HERE (not in the outer `.catch`, which a
                       hydrating swap's synchronous throw would otherwise reach): surface the
                       error and stop, never reload. A clean mount clears any prior recovery
                       reloads for this URL so a later transient failure can recover again. */
                    const commit = (): void => {
                        try {
                            swap()
                            clearRecoveryReloads(resolveUrl(path).href)
                        } catch (error) {
                            console.error(
                                `[abide] page at ${path} threw while mounting — not reloading (a reload would re-run the same failure):`,
                                error,
                            )
                        }
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
                        document.startViewTransition(commit)
                    } else {
                        commit()
                    }
                })
                .catch((error) => {
                    /* A page/layout chunk IMPORT (or the probe) rejected — offline, a hashed
                   chunk filename rotated by a deploy, or a transient asset 5xx: recoverable,
                   so a full browser load is the right fallback (and clears the latched
                   navigating:true, so a bound spinner doesn't spin forever). Bounded, so a
                   chunk that fails to import every time can't reload-loop. Deterministic
                   render throws don't land here — `commit` swallows them above. */
                    if (token !== sequence || disposed) {
                        return
                    }
                    console.error(`[abide] failed to load page at ${path} — reloading:`, error)
                    boundedReload(resolveUrl(path).href)
                })
        })
    })

    return () => {
        disposed = true
        if (typeof window !== 'undefined') {
            window.removeEventListener('popstate', onPopState)
            window.removeEventListener('pagehide', onPageHide)
            document.removeEventListener('click', onClick as EventListener)
        }
        stop()
        disposeFrom(0)
    }
}
