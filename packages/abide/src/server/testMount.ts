// 38.119 — `mount` from `@abide/abide/test`: a component an app's test imported and bound, rendered
// into the document's body as the server writes it and hydrated there by its browser module — the
// same two halves a page load runs, in one process, so a test can click it and read the work.
//
// AFTER WHAT THE BODY HOLDS, not over it: two components a test mounts together — a toast and the
// list that shows it — each keep the markup their watches write to, and each one's stop takes away
// what it added.
//
// 38.235 — AT THE DOCUMENT'S ADDRESS, as a page load is: `route` arrives at it for the server pass
// with the fragment a server never receives taken off, and again whole for the hydration. Where
// the document has no router, the mount installs one for as long as any mount stands — written to
// `history`, so where a component navigated is `location`, `history.state` and `route`, read after
// the navigation, and no spy records it a second time.

import { CURRENT_ROUTER, type Navigable } from '#shared/CURRENT_ROUTER.ts'
import { startMadeIds } from '#shared/madeId.ts'
import { matchOf, type Params, partsOf } from '#shared/matchRoute.ts'
import { flushSync } from '#shared/reactive/Reactive.ts'
import { arrive } from '#shared/route.ts'
import { parseRoutePattern } from '#shared/routePattern.ts'

import { MOUNTABLE } from './MOUNTABLE.ts'
import { type Component, render } from './render.ts'

type Mountable = {
    accessors: Record<string, () => unknown>
    client: () => Promise<{
        default: (
            region: unknown,
            props: Record<string, () => unknown>,
        ) => { stop(): void } | undefined
    }>
    /** 38.235 — the route of a page, or `null` for any other component. */
    route: string | null
}

/** A mounted component: `stop` ends every watch its hydration opened, and removes its markup. */
export type Mounted = { stop(): void; [Symbol.dispose](): void }

/**
 * Renders `component` at the end of `document.body` and hydrates it there, with every effect its
 * mount woke already run.
 */
export async function mount(component: Component): Promise<Mounted> {
    const mountable = (component as Record<symbol, Mountable | undefined>)[
        MOUNTABLE
    ]
    if (mountable === undefined)
        throw new Error(
            'abide: mount takes a component a test imported from a `.abide` and bound — `mount(Counter({ start: 2 }))`. RULEBOOK 38.119.',
        )
    if (typeof document === 'undefined')
        throw new Error(
            'abide: mount renders into a DOM, and this process has none. Preload `@abide/harness/preload` ahead of `@abide/abide/test` in bunfig.toml. RULEBOOK 38.119.',
        )
    // The router stands for the server pass too.
    stand()
    try {
        return await mounted(component, mountable)
    } catch (thrown) {
        leave()
        throw thrown
    }
}

async function mounted(
    component: Component,
    mountable: Mountable,
): Promise<Mounted> {
    standingRoute = mountable.route ?? undefined
    // 23.29 — a server's own index, at the address a request would have carried.
    const served = new URL(location.href)
    served.hash = ''
    arrive(served.href, nameOf(served.pathname), paramsOf(served.pathname), 0)
    // 12.5 — the server pass's watches stop once its document is written, as any render's do.
    const html = new TextDecoder().decode(await render(component))
    // After the `<body …>` open tag, whatever attributes the component wrote onto it (35.15).
    const markup = document.createElement('template')
    markup.innerHTML = html.slice(
        html.indexOf('>', html.indexOf('<body')) + 1,
        html.indexOf('</body>'),
    )
    const added = [...markup.content.childNodes]
    document.body.append(markup.content)
    // LOADED HERE, not at the top: the preload this module is part of runs in processes with no DOM.
    const [{ default: hydrate }, { pageRegion, removeUntil }] =
        await Promise.all([mountable.client(), import('#ui/regions.ts')])
    const region = pageRegion(document.body, added[0] ?? null)
    arrived()
    // 41.36 — the ids its parts make counted as its render counted them.
    startMadeIds()
    const scope = hydrate(region, mountable.accessors)
    flushSync()
    let stopped = false
    const stop = (): void => {
        if (stopped) return
        stopped = true
        scope?.stop()
        leave()
        // What hydration put between the anchors is not what was added, so the region goes by them.
        removeUntil(region.open, region.close.nextSibling)
        for (const node of added) node.parentNode?.removeChild(node)
    }
    return { stop, [Symbol.dispose]: stop }
}

/**
 * The entry `history.state` holds — the client router's shape, so `route.index` reads the same
 * under a mount as under it (23.28).
 */
type Entry = { index: number; scroll: null }

function indexOfEntry(): number {
    const state = history.state as Partial<Entry> | null
    return typeof state?.index === 'number' ? state.index : 0
}

// 38.235 — the route of the page mounted last, which the address is resolved against.
let standingRoute: string | undefined

/**
 * The resolution path: the page's route, or the address itself for a component — no route table
 * is read, and a static route's literal is its pathname.
 */
function nameOf(pathname: string): string {
    return standingRoute ?? pathname
}

/** What the page's route matches in `pathname`: nothing for a component, or an address it misses. */
function paramsOf(pathname: string): Params {
    if (standingRoute === undefined) return {}
    const parts = partsOf(pathname)
    return (parts && matchOf(parseRoutePattern(standingRoute), parts)) ?? {}
}

/** `route` at the document's address, and every effect that woke for it run. */
function arrived(): void {
    const pathname = location.pathname
    arrive(location.href, nameOf(pathname), paramsOf(pathname), indexOfEntry())
    flushSync()
}

// Every `step` waiting on the next `popstate`, settled together as the client router's are (30.38).
const STEPPING: (() => void)[] = []

function popped(): void {
    arrived()
    for (const settle of STEPPING.splice(0)) settle()
}

const MOUNT_ROUTER: Navigable = {
    go(to, options) {
        const target = new URL(to, location.href)
        const full = `${target.pathname}${target.search}${target.hash}`
        const index = indexOfEntry()
        if (options.replace === true)
            history.replaceState(
                { index, scroll: null } satisfies Entry,
                '',
                full,
            )
        else
            history.pushState(
                { index: index + 1, scroll: null } satisfies Entry,
                '',
                full,
            )
        arrived()
        return Promise.resolve()
    },
    step(by) {
        // 30.39 — a step of none is over before it starts.
        if (by === 0) return Promise.resolve()
        return new Promise((settle) => {
            STEPPING.push(settle)
            history.go(by)
        })
    },
}

// How many mounts stand: the first installs `MOUNT_ROUTER` where the document has no router, and
// the last one's stop removes it.
let standing = 0
let routerInstalled = false

function stand(): void {
    standing += 1
    if (standing > 1) return
    routerInstalled = CURRENT_ROUTER.current === null
    if (!routerInstalled) return
    CURRENT_ROUTER.current = MOUNT_ROUTER
    addEventListener('popstate', popped)
}

function leave(): void {
    standing -= 1
    if (standing > 0 || !routerInstalled) return
    routerInstalled = false
    removeEventListener('popstate', popped)
    if (CURRENT_ROUTER.current === MOUNT_ROUTER) CURRENT_ROUTER.current = null
}
