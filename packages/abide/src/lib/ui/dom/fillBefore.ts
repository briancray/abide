import { scope } from '../runtime/scope.ts'

/*
Builds `content` into a fragment under a fresh reactive scope, then inserts it just
before the `end` marker; returns the scope disposer. Building into a fragment lets
the content append freely (elements, components, nested blocks all use the normal
append path) before it lands as a unit. Inserting via the marker's LIVE parent
(`end.parentNode`) keeps placement correct even after an enclosing block has moved
the markers from a build-time fragment into the document.
*/
export function fillBefore(end: Node, content: (into: Node) => void): () => void {
    const fragment = document.createDocumentFragment()
    const dispose = scope(() => content(fragment))
    ;(end.parentNode ?? end).insertBefore(fragment, end)
    return dispose
}
