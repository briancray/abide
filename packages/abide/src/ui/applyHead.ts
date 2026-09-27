// 39.6 — ON A CLIENT NAVIGATION THE INCOMING PAGE'S KEYED CONTRIBUTIONS REPLACE THE OUTGOING
// PAGE'S BY KEY. The outgoing page's were written by a server on the first load and by this
// function on every one after, so they are found the same way either time: by their key, read off
// the document. Nothing is added to the head to mark ownership — a marker would be a fact about
// the framework in a document an author writes, and the key is already what decides.
//
// 39.5 — A CONTRIBUTION WITH NO KEY APPENDS. It cannot replace anything, because there is nothing
// it could be said to be the same as, and dropping it instead would lose the one kind of
// contribution a page makes several of.

import { headKeyOf } from '#shared/headKeyOf.ts'
import { markupNodes } from './parseMarkup.ts'

export function applyHead(markup: string): void {
    const head = document.head
    if (markup === '') return
    const incoming = markupNodes(head, markup)
    // KEYED ONCE, NOT ONCE PER CONTRIBUTION. Walking the head per incoming node asked `headKey` —
    // a `toLowerCase` and a fresh closure per call — for every standing element times every
    // arriving one. One pass builds the index and each contribution is then a lookup.
    const standingByKey = new Map<string, Element>()
    for (
        let node = head.firstElementChild;
        node !== null;
        node = node.nextElementSibling
    ) {
        const key = headKey(node)
        // 39.12 WITHIN THE STANDING HEAD: the FIRST element holding a key is the one a
        // contribution replaces, which is the node the per-contribution walk returned.
        if (key !== undefined && !standingByKey.has(key))
            standingByKey.set(key, node)
    }
    for (const node of incoming) {
        if (node.nodeType !== 1) {
            head.appendChild(node)
            continue
        }
        const element = node as Element
        const key = headKey(element)
        if (key === undefined) {
            head.appendChild(element)
            continue
        }
        const standing = standingByKey.get(key)
        if (standing === undefined) {
            head.appendChild(element)
            standingByKey.set(key, element)
            continue
        }
        // WHAT THE TWO PAGES SHARE IS NOT TOUCHED. `hydrate` skips `applyHead` outright because
        // re-applying a `<link rel=stylesheet>` refetches it and flashes the document unstyled —
        // and a navigation between two pages carrying the same stylesheet, viewport or icon walks
        // into that same cost per contribution. An identical node is the one case where the
        // cheaper arm is to do nothing at all.
        if (standing.outerHTML === element.outerHTML) continue
        head.replaceChild(element, standing)
        standingByKey.set(key, element)
    }
}

// 39.11 THROUGH THE ONE GRAMMAR (`headKeyOf`), asked with a RESOLVED attribute. The compiler
// answers the same question for a STATIC one and appends where it cannot (`<meta name={x}>` has a
// name only the run time knows) — here every attribute is resolved, so a contribution the compiler
// had to append arrives with a key. That is the same rule reaching further, not a different one.
function headKey(element: Element): string | undefined {
    return headKeyOf(element.tagName.toLowerCase(), (name) =>
        element.getAttribute(name),
    )
}
