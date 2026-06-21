import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import { enterNamespace } from './enterNamespace.ts'

/*
Builds `content` into a fragment under a fresh reactive scope, then inserts it just
before the `end` marker; returns the scope disposer. Building into a fragment lets
the content append freely (elements, components, nested blocks all use the normal
append path) before it lands as a unit. Inserting via the marker's LIVE parent
(`end.parentNode`) keeps placement correct even after an enclosing block has moved
the markers from a build-time fragment into the document.

`fillBefore` is exclusively the *create* path — control-flow blocks adopt SSR nodes
in place (a direct `scope(render)`) and route only fresh builds here. So neutralize
the global claim cursor for the build: a rebuild that runs while the hydrate pass is
still active (e.g. a synchronous write that flips a `when`/`switch` mid-hydrate)
would otherwise make the build helpers claim SSR nodes that don't exist for fresh
content. The same cursor is restored after (mirrors awaitBlock/tryBlock/each).
*/
export function fillBefore(end: Node, content: (into: Node) => void): () => void {
    /* A control-flow effect can fire one final time after its block was already
       detached — e.g. an enclosing await/each block tears the branch down in the same
       microtask flush that re-ran this effect, before the owner scope disposes it. The
       end marker then has no live parent, so there is nowhere to build into; inserting
       a fragment before a parentless comment throws HierarchyRequestError ("would yield
       an incorrect node tree"). Skip the rebuild — owner teardown disposes this dead
       block anyway. */
    if (!end.parentNode) {
        return () => {}
    }
    const fragment = document.createDocumentFragment()
    const previousHydration = RENDER.hydration
    RENDER.hydration = undefined
    try {
        /* Build under the insertion parent's foreign namespace (if any), so foreign
           elements built into the fragment are namespaced off `end`'s live parent. */
        const dispose = enterNamespace(end.parentNode ?? end, () => scope(() => content(fragment)))
        ;(end.parentNode ?? end).insertBefore(fragment, end)
        return dispose
    } finally {
        RENDER.hydration = previousHydration
    }
}
