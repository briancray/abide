import { isElement } from './isElement.ts'

/* The first Element in the sibling run `[start, end)` — the node a visible-wake observes for a
   deferred region (await branch or component island). Undefined when the run holds no element
   (text/comment only), so the caller falls back to an idle wake. Element detection is
   method-based (`isElement`), not `nodeType`, so the walk runs under the test mini-dom too. */
export function firstElementBetween(start: Node | null, end: Node | null): Element | undefined {
    for (let node = start; node !== null && node !== end; node = node.nextSibling) {
        if (isElement(node)) {
            return node
        }
    }
    return undefined
}
