// 32.5, 32.7, 32.8 — AN ELEMENT'S PROPERTY AND A VALUE, KEPT IN STEP BOTH WAYS. A watch writes the
// value into the property; a listener writes the property back into the value. The server wrote the
// value standing at render as the attribute (`emitComponent`), so hydration moves nothing that is
// already right.
//
// 32.7 — A BOOLEAN BIND IS A BOOLEAN: the property is set to one, and mirrored as a boolean attribute
// rather than written as a string.

import {
    boundValue,
    groupHolds,
    heldValue,
    writeBound,
} from '#shared/boundValue.ts'
import { numberFromText } from '#shared/numberFromText.ts'
import type { Scope } from './Scope.ts'

type Bound = HTMLInputElement & HTMLDetailsElement

export function bindProperty(
    element: Element,
    kind: 'value' | 'checked' | 'open' | 'group',
    operand: unknown,
    scope: Scope,
): void {
    const bound = element as Bound
    if (kind === 'value') {
        scope.watch(() => {
            const value = boundValue(operand)
            const text =
                value === undefined || value === null ? '' : String(value)
            if (bound.value !== text) bound.value = text
        })
        // A `<select>` settles on `change`; everything else that takes text reports each keystroke.
        const event = bound.tagName === 'SELECT' ? 'change' : 'input'
        bound.addEventListener(event, () => {
            // A value that was a number stays one: what the reader typed is text, and the value is
            // not the reader's to retype.
            const standing = heldValue(operand)
            const typed = bound.value
            writeBound(
                operand,
                typeof standing === 'number'
                    ? (numberFromText(typed) ?? typed)
                    : typed,
            )
        })
        return
    }
    if (kind === 'group') {
        scope.watch(() => {
            const checked = groupHolds(boundValue(operand), bound.value)
            bound.checked = checked
            bound.toggleAttribute('checked', checked)
        })
        bound.addEventListener('change', () => {
            const standing = heldValue(operand)
            // A checkbox group holds a list, and keeps its order; a radio group holds the one value.
            if (Array.isArray(standing)) {
                const next: unknown[] = []
                for (const member of standing)
                    if (member !== bound.value) next.push(member)
                if (bound.checked) next.push(bound.value)
                writeBound(operand, next)
            } else if (bound.checked) writeBound(operand, bound.value)
        })
        return
    }
    // `checked` on an input, `open` on a `<details>`.
    const property = kind
    scope.watch(() => {
        const on = Boolean(boundValue(operand))
        if (bound[property] !== on) bound[property] = on
        bound.toggleAttribute(property, on)
    })
    bound.addEventListener(kind === 'open' ? 'toggle' : 'change', () => {
        writeBound(operand, bound[property])
    })
}
