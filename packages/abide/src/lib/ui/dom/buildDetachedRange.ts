import { RANGE_CLOSE, RANGE_OPEN } from '../runtime/RANGE_MARKER.ts'
import { scope } from '../runtime/scope.ts'
import { enterNamespace } from './enterNamespace.ts'

/*
Builds a `[ … ]`-bounded content range into a DETACHED fragment under a fresh reactive
scope, then returns the markers, the fragment, and the scope disposer — leaving
INSERTION to the caller. The create-path range builder for the keyed list runtimes
(`each` / `eachAsync`) and `awaitBlock` (branch swaps): `each` holds the fragment in
`pending` for deferred placement (its reconcile reorders rows), `eachAsync` inserts it
immediately at the stream anchor (arrival order). All need the same bracketed-fragment
build, so it lives here once.

Unlike `openMarker`, this never touches a live parent or the hydrate claim cursor — the
markers are created fresh and parked in a fragment — so it is a pure CREATE primitive;
the hydrate paths claim their server markers directly. `namespaceParent` sets the
ambient foreign namespace for the build (a row's svg/math children read it off the
fragment's eventual parent), matching `fillBefore`/`enterNamespace`.
*/
export function buildDetachedRange(
    namespaceParent: Node,
    build: (into: Node) => void,
): { start: Comment; end: Comment; fragment: DocumentFragment; dispose: () => void } {
    const start = document.createComment(RANGE_OPEN)
    const end = document.createComment(RANGE_CLOSE)
    const fragment = document.createDocumentFragment()
    fragment.appendChild(start)
    const dispose = enterNamespace(namespaceParent, () => scope(() => build(fragment)))
    fragment.appendChild(end)
    return { start, end, fragment, dispose }
}
