import { effectiveChildNamespace } from './effectiveChildNamespace.ts'
import { MATHML_NAMESPACE } from './MATHML_NAMESPACE.ts'
import { SVG_NAMESPACE } from './SVG_NAMESPACE.ts'

/*
The wrapper tag a static run must be parsed inside so its children land in `parent`'s
foreign namespace — `svg`/`math`, or undefined for HTML. A bare `<path>` fragment
parses into the HTML namespace; wrapping it in `<svg>` lets the parser namespace it.
`cloneStatic` uses this for a static run coalesced under a foreign parent that was
built imperatively, or under a control-flow block's fragment inside foreign content
(where `parent`'s effective namespace comes from the ambient context).
*/
export function foreignWrapperTag(parent: Node): string | undefined {
    const namespace = effectiveChildNamespace(parent)
    if (namespace === SVG_NAMESPACE) {
        return 'svg'
    }
    if (namespace === MATHML_NAMESPACE) {
        return 'math'
    }
    return undefined
}
