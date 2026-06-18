import { RENDER } from '../runtime/RENDER.ts'
import { inheritedNamespace } from './inheritedNamespace.ts'

/*
The foreign namespace a child built under `parent` belongs to. A real element dictates
it from its own namespace (`inheritedNamespace`); a detached `DocumentFragment` — a
control-flow block's build buffer — carries none, so it inherits the ambient context
the enclosing block set via `enterNamespace`. `foreignWrapperTag` reads this so a
`skeleton` parsed into a block's fragment wraps its markup in the right namespace.
*/
export function effectiveChildNamespace(parent: Node): string | undefined {
    return (parent as Element).namespaceURI == null ? RENDER.namespace : inheritedNamespace(parent)
}
