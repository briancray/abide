import { MATHML_NAMESPACE } from './MATHML_NAMESPACE.ts'
import { SVG_NAMESPACE } from './SVG_NAMESPACE.ts'

/*
The foreign namespace that element children of `node` inherit — `SVG_NAMESPACE` under
an svg, `MATHML_NAMESPACE` under math — or undefined for ordinary HTML. `<foreignObject>`
is SVG's re-entry point back into HTML, so its children are HTML despite its own SVG
namespace.
*/
export function inheritedNamespace(node: Node): string | undefined {
    const namespace = (node as Element).namespaceURI
    if (namespace === SVG_NAMESPACE && (node as Element).localName !== 'foreignObject') {
        return SVG_NAMESPACE
    }
    if (namespace === MATHML_NAMESPACE) {
        return MATHML_NAMESPACE
    }
    return undefined
}
