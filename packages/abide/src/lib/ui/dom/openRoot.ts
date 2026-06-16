import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'

/*
Opens the root element of a control-flow branch/row, which the block inserts
itself. In create mode it returns a detached element (the block does the
insert); in hydrate mode it claims the existing server-rendered root from the
parent's claim pointer (in place — the block adopts it). The compiler emits this
for `each`/`if`/`switch`/`await` branch roots so adoption and creation share code.
*/
// @readme plumbing
export function openRoot(parent: Node, tag: string): Element {
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const current = claimChild(hydration, parent)
        hydration.next.set(parent, current === null ? null : current.nextSibling)
        return current as unknown as Element
    }
    return document.createElement(tag)
}
