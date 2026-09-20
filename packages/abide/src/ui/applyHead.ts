// 39.7 — ON A CLIENT NAVIGATION THE INCOMING PAGE'S KEYED CONTRIBUTIONS REPLACE THE OUTGOING
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
        const standing = findByKey(head, key)
        if (standing === undefined) {
            head.appendChild(element)
            continue
        }
        // WHAT THE TWO PAGES SHARE IS NOT TOUCHED. `hydrate` skips `applyHead` outright because
        // re-applying a `<link rel=stylesheet>` refetches it and flashes the document unstyled —
        // and a navigation between two pages carrying the same stylesheet, viewport or icon walks
        // into that same cost per contribution. An identical node is the one case where the
        // cheaper arm is to do nothing at all.
        if (standing.outerHTML === element.outerHTML) continue
        head.replaceChild(element, standing)
    }
}

// 39.12 THROUGH THE ONE GRAMMAR (`headKeyOf`), asked with a RESOLVED attribute. The compiler
// answers the same question for a STATIC one and appends where it cannot (`<meta name={x}>` has a
// name only the run time knows) — here every attribute is resolved, so a contribution the compiler
// had to append arrives with a key. That is the same rule reaching further, not a different one.
function headKey(element: Element): string | undefined {
    return headKeyOf(
        element.tagName.toLowerCase(),
        (name) => element.getAttribute(name) ?? undefined,
    )
}

function findByKey(head: Element, key: string): Element | undefined {
    for (
        let node = head.firstElementChild;
        node !== null;
        node = node.nextElementSibling
    )
        if (headKey(node) === key) return node
    return undefined
}
