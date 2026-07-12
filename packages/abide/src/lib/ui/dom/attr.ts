import { effect } from '../effect.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { reportHydrationDivergence } from '../runtime/reportHydrationDivergence.ts'

/* The attribute string an element carries for `value`, or `null` when absent — the present/absent +
   stringify semantics below, factored so the hydration compare and the write agree exactly. */
function attributeText(value: unknown): string | null {
    if (value === false || value === null || value === undefined) {
        return null
    }
    return value === true ? '' : String(value)
}

/*
Binds an element attribute to `read()`. A boolean true sets the bare attribute,
and false/null/undefined removes it (the standard present/absent semantics);
anything else is stringified. One effect per bound attribute, so only the
changed attribute touches the DOM.
*/
// @documentation plumbing
export function attr(element: Element, name: string, read: () => unknown): void {
    /* Captured at bind time (inside the hydrating build) so the first effect run can compare the
       server-rendered attribute before overwriting it — an attribute divergence is otherwise
       invisible, since the effect always overwrites. */
    let hydrating = RENDER.hydration !== undefined
    effect(() => {
        const value = read()
        const next = attributeText(value)
        if (hydrating) {
            hydrating = false
            const server = element.getAttribute(name)
            if (server !== next) {
                reportHydrationDivergence(`attr "${name}" desync`, { server, client: next })
            }
        }
        if (next === null) {
            element.removeAttribute(name)
        } else {
            element.setAttribute(name, next)
        }
    })
}
