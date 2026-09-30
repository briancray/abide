/**
 * 32.38 — AN ELEMENT LEAVING UNDER AN ANIMATION. A `bind:element` callback's `Disposer` that hands
 * back a thenable — `element.animate(…).finished` — keeps the nodes holding that element in the
 * document until it settles, wherever a region or a row removes them, and removes them then.
 *
 * AT THE NODE, NOT AT EACH CALLER: an arm's swap, a row the reconcile drops and a list emptied all
 * remove through `removeUntil` and `removeRow`, and what is leaving is a property of the element, not
 * of which of them reached it. A page with nothing leaving pays one `size` read per node removed.
 */
const LEAVING = new Map<Element, ChildNode[]>()

/** Holds `element`'s removal until `settling` settles. */
export function holdWhileLeaving(
    element: Element,
    settling: PromiseLike<unknown>,
): void {
    LEAVING.set(element, [])
    const done = (): void => {
        const held = LEAVING.get(element)
        LEAVING.delete(element)
        if (held !== undefined) for (const node of held) node.remove()
    }
    settling.then(done, done)
}

/** Removes `node`, or holds it where it is while an element it holds is leaving. */
export function leave(node: ChildNode): void {
    if (LEAVING.size !== 0)
        for (const [element, held] of LEAVING)
            if (node === element || node.contains(element)) {
                held.push(node)
                return
            }
    node.remove()
}
