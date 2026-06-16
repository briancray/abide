import { staticAttrValue } from './staticAttrValue.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
The pieces a `bind:group` needs from its own element: `valueCode` is the JS source
of the control's `value` (a string literal for static `value="x"`, the expression
for `value={expr}`); `isRadio` selects single-value (radio) vs array-membership
(checkbox) semantics. Throws on the two cases the binding can't mean anything for —
a missing `value`, or a `type` not statically `radio`/`checkbox` (the semantics are
chosen at compile time, so the type can't be dynamic).
*/
export function groupBindParts(node: Extract<TemplateNode, { kind: 'element' }>): {
    valueCode: string
    isRadio: boolean
} {
    const value = node.attrs.find(
        (attr) => (attr.kind === 'static' || attr.kind === 'expression') && attr.name === 'value',
    )
    if (value === undefined || (value.kind !== 'static' && value.kind !== 'expression')) {
        throw new Error('bind:group requires a `value` attribute on the same element')
    }
    const valueCode = value.kind === 'static' ? JSON.stringify(value.value) : value.code
    const type = staticAttrValue(node, 'type')
    if (type !== 'radio' && type !== 'checkbox') {
        throw new Error('bind:group requires a static type="radio" or type="checkbox"')
    }
    return { valueCode, isRadio: type === 'radio' }
}
