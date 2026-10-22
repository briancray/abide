import {
    boundValue,
    groupHolds,
    heldValue,
    writeBound,
} from '#shared/boundValue.ts'
import type { Scope } from './Scope.ts'

/**
 * Keeps a radio or checkbox's `checked` in step with a `bind:group` value, both ways.
 *
 * 32.8 — COMPARED AGAINST THE INPUT'S OWN VALUE, read through `own` — the `value` attribute's
 * expression, or its static text, or `on` where it has none — rather than off the element: a
 * `value={option.id}` that moves reruns the compare, and a number stays a number in the group
 * where the element's `value` property would have handed back its text.
 */
export function bindGroup(
    element: Element,
    operand: unknown,
    own: () => unknown,
    scope: Scope,
): void {
    const bound = element as HTMLInputElement
    scope.watch(() => {
        const checked = groupHolds(boundValue(operand), own())
        bound.checked = checked
        bound.toggleAttribute('checked', checked)
    })
    bound.addEventListener('change', () => {
        const value = own()
        const standing = heldValue(operand)
        // A checkbox group holds a list, and keeps its order; a radio group holds the one value.
        if (Array.isArray(standing)) {
            const next: unknown[] = []
            for (const member of standing)
                if (member !== value) next.push(member)
            if (bound.checked) next.push(value)
            writeBound(operand, next)
        } else if (bound.checked) writeBound(operand, value)
    })
}
