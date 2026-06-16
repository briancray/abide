import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'

/*
Opens a child element of `parent`: creates and appends it (create mode), or claims
the existing server-rendered node at the parent's current build position (hydrate
mode), advancing the claim pointer. Returns the element so bindings and children
attach to it. The compiler emits this for every element so the same build code
serves both modes.
*/
// @readme plumbing
export function openChild(parent: Node, tag: string): Element {
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const current = claimChild(hydration, parent)
        hydration.next.set(parent, current === null ? null : current.nextSibling)
        return current as unknown as Element
    }
    const element = document.createElement(tag)
    parent.appendChild(element)
    return element
}
