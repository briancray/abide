import { ELEMENT_ATTRIBUTE } from './MARKERS.ts'

// The elements the server marked as carrying a listener, indexed by the number the compiler gave
// them. The attribute is REMOVED as it is read: it is addressing for hydration, not state, and a
// document that keeps it invites something to start selecting on it.
export function handlers(root: ParentNode): Element[] {
    const found: Element[] = []
    for (const element of root.querySelectorAll(`[${ELEMENT_ATTRIBUTE}]`)) {
        const at = Number(element.getAttribute(ELEMENT_ATTRIBUTE))
        element.removeAttribute(ELEMENT_ATTRIBUTE)
        found[at] = element
    }
    return found
}
