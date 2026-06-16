import { OUTLET_TAG } from './OUTLET_TAG.ts'

/*
The first `<abide-outlet>` in `root`'s subtree, in document order — the position
the router fills with the next layer of a route's layout chain. A depth-first walk
over `children` rather than `querySelector`: the router runs against real DOM and
the test mini-DOM alike, and only the former has `querySelector`. Tag comparison is
case-insensitive (the real DOM uppercases `tagName`, the mini-DOM keeps it as
created). Returns undefined when the layout declares no `<slot/>`.
*/
export function firstOutlet(root: Element): Element | undefined {
    for (const child of root.children) {
        if (child.tagName.toLowerCase() === OUTLET_TAG) {
            return child
        }
        const nested = firstOutlet(child)
        if (nested !== undefined) {
            return nested
        }
    }
    return undefined
}
