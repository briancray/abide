// 32.5, 32.7, 32.8 — AN ELEMENT'S PROPERTY AND A VALUE, KEPT IN STEP BOTH WAYS. A watch writes the
// value into the property; a listener writes the property back into the value. The server wrote the
// value standing at render as the attribute, or as a `<textarea>`'s text and an option's `selected`
// (32.61), so hydration moves nothing that is already right.
//
// 32.7 — A BOOLEAN BIND IS A BOOLEAN: the property is set to one, and mirrored as a boolean attribute
// rather than written as a string.

import {
    boundValue,
    heldValue,
    selectHolds,
    writeBound,
} from '#shared/boundValue.ts'
import { numberFromText } from '#shared/numberFromText.ts'

import type { Scope } from './Scope.ts'

type Bound = HTMLInputElement & HTMLDetailsElement

export function bindProperty(
    element: Element,
    kind: 'value' | 'checked' | 'open',
    operand: unknown,
    scope: Scope,
): void {
    const bound = element as Bound
    if (kind === 'value') {
        bindValue(bound, operand, scope)
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

// 32.5 — `bind:value`, on an input, a `<textarea>` or a `<select>`.
function bindValue(bound: Bound, operand: unknown, scope: Scope): void {
    if (
        bound.tagName === 'SELECT' &&
        (bound as unknown as HTMLSelectElement).multiple
    ) {
        // 32.62 — the list of what is selected, read and written per option.
        const select = bound as unknown as HTMLSelectElement
        const choose = (value: unknown) => {
            for (const option of select.options)
                option.selected = selectHolds(value, option.value)
        }
        scope.watch(() => choose(boundValue(operand)))
        chooseOnNewOptions(select, () => choose(heldValue(operand)), scope)
        select.addEventListener('change', () => {
            const chosen: string[] = []
            for (const option of select.selectedOptions)
                chosen.push(option.value)
            writeBound(operand, chosen)
        })
        return
    }
    // 32.58 — NUMERIC ONCE, NUMERIC FROM THEN ON: a blank field writes `undefined`, and the
    // keystroke after it still has to know the value was a number.
    let numeric = bound.type === 'number' || bound.type === 'range'
    const show = (value: unknown) => {
        if (typeof value === 'number') numeric = true
        // 32.59 — text that already reads as the value is the reader's spelling of it: a trailing
        // decimal point or zero is mid-typing, and rewriting it to the number's own text takes the
        // keystroke back.
        if (typeof value === 'number' && value === numberFromText(bound.value))
            return
        const text = value === undefined || value === null ? '' : String(value)
        if (bound.value !== text) bound.value = text
    }
    scope.watch(() => show(boundValue(operand)))
    const write = () => {
        const typed = bound.value
        if (!numeric) {
            writeBound(operand, typed)
            return
        }
        // 32.58 — text that reads as no number, `-` on its way to `-3`, writes nothing.
        const number = numberFromText(typed)
        if (number !== undefined) writeBound(operand, number)
        else if (typed.trim() === '') writeBound(operand, undefined)
    }
    // A `<select>` settles on `change`; everything else that takes text reports each keystroke.
    if (bound.tagName === 'SELECT') {
        chooseOnNewOptions(bound, () => show(heldValue(operand)), scope)
        bound.addEventListener('change', write)
        return
    }
    // 32.60 — A COMPOSITION IS ONE WRITE: what an input method shows between its start and its end
    // is not text the reader has chosen yet.
    let composing = false
    bound.addEventListener('compositionstart', () => {
        composing = true
    })
    bound.addEventListener('compositionend', () => {
        composing = false
        write()
    })
    bound.addEventListener('input', () => {
        if (!composing) write()
    })
}

// 32.62 — AN OPTION THAT ARRIVES AFTER THE VALUE IS SELECTED WHEN IT IS THE VALUE. The value's
// watch does not read the options, so a `{#for}` that grows them later wakes nothing of its own, and
// the select would stay on whatever the browser picked when it changed.
function chooseOnNewOptions(
    select: Element,
    choose: () => void,
    scope: Scope,
): void {
    const observer = new MutationObserver(choose)
    observer.observe(select, { childList: true, subtree: true })
    scope.stops.push(() => observer.disconnect())
}
