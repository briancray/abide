import { RENDER } from '../runtime/RENDER.ts'
import { effectiveChildNamespace } from './effectiveChildNamespace.ts'

/*
Runs a control-flow block's fragment build with the ambient foreign namespace set from
its insertion `parent`, then restores it. Foreign elements (svg/math children) the
block builds into its detached fragment read this context (the fragment carries no
namespace of its own). A foreign `parent` establishes the context; a fragment parent
keeps the current one, so a block nested inside foreign content stays foreign; a real
HTML parent (e.g. `<foreignObject>`'s content) resets it.
*/
export function enterNamespace<T>(parent: Node, build: () => T): T {
    const previous = RENDER.namespace
    RENDER.namespace = effectiveChildNamespace(parent)
    try {
        return build()
    } finally {
        RENDER.namespace = previous
    }
}
