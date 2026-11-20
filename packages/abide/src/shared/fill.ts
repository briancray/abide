// 35.20-35.24 — A PLACE A LAYOUT OWNS, FILLED FROM BELOW IT: a page's toolbar actions, a section's
// side panel. `fill` hands a component to the `Outlet` of a name, and the `Outlet` renders it where it
// stands — so the markup is the outlet's own, in its own place in the tree, and hydration adopts it
// there as it adopts anything else.
//
// A FILL MADE IN SETUP IS PAINTED BY THE SERVER. Every level of a page chain is set up before any is
// built (41.19, 41.23), so a page's or a layout's `fill` has been made by the time the layout's
// `Outlet` is built, on the server and on the client alike. A fill made later — by a component the
// page renders, whose setup runs as it is built — stands once it is made, after an `Outlet` already
// built above it: in the browser that is the next turn, and on the server the `Outlet` has been
// written by then (35.23).
//
// NOT A PORTAL. Moving the nodes a component rendered to somewhere else in the document would leave
// hydration walking a tree whose nodes are not where the server wrote them; handing over the
// component, and rendering it in place, leaves every node where both renders put it.

import { isServer } from './isServer.ts'
import { namedLogger } from './log.ts'
import { reactive } from './reactive/index.ts'
import { watch } from './reactive/watch.ts'
import { register } from './register.ts'

/** A component handed to the `Outlet` of a name, and the props it renders with. */
export type Filling = {
    into: string
    Component: (props: never) => unknown
    props: Record<string, unknown>
}

// One per request on a server, as every `reactive` without `global` is (11.32): one visitor's fills
// never reach another's page.
export const fillings = reactive<readonly Filling[]>([])

/** An `Outlet` standing: the name it renders the fills of. */
export type Standing = { name: string }

// 35.22 — the `Outlet`s standing, in the order they stood: of two under one name, the last shows.
export const outlets = reactive<readonly Standing[]>([])

// The names an `Outlet` has stood under, which the warning reads after the fill's own turn: a
// process-wide record of names rather than of any visitor's page.
export const stood = new Set<string>()

const FILL_LOG = namedLogger('abide:fill')
let warned = false

/**
 * Renders `Component` with `props` in the `Outlet` named `into`, for as long as the setup calling it
 * stands — a page's, a layout's or a component's.
 *
 * @param into the name of the `Outlet` it renders in
 * @param Component the component it renders there
 * @param props the props it renders with
 */
export function fill<Props>(
    into: string,
    Component: (props: Props) => unknown,
    props?: NoInfer<Props>,
): void {
    const filling: Filling = {
        into,
        Component: Component as (props: never) => unknown,
        props: (props ?? {}) as Record<string, unknown>,
    }
    // 35.24 — a fill with no `Outlet` of its name stood is a place nothing renders: said once, looked
    // at once the page has been built — on the server as the render tears the fill down, and in the
    // browser past the task that mounted it, an `Outlet` of the layout standing after the page's setup.
    watch(() => {
        const remove = register(fillings, filling)
        return () => {
            remove()
            if (isServer()) unrendered(into)
        }
    })
    if (!isServer()) setTimeout(() => unrendered(into), 0)
}

function unrendered(into: string): void {
    if (warned || stood.has(into)) return
    warned = true
    FILL_LOG.warning(
        `fill('${into}') has no <Outlet name="${into}" /> rendered to show it. RULEBOOK 35.24.`,
    )
}
