// 56.29-56.33 — A NUMBER STEPPED UP AND DOWN: WAI-ARIA's spin button, as parts an app spreads onto a
// field and the buttons either side of it. The keys step it; a number typed is taken as it is typed, and kept to its
// bounds and its step; the buttons stand outside the tab order, as the field holds the keys.

import { handFocus } from './handFocus.ts'
import { type Live, live } from './live.ts'
import { randomToken } from './randomToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'

/** The number, its bounds, how far a step moves it, and its accessible name. */
export type StepperOptions = {
    /** The base the field's id is derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
    /** The number: a `Reactive` to read and set. Held by the parts, and handed back as `value`, where none is given. */
    value?: Reactive<number> | undefined
    /** The least it takes. Unbounded by default; a function is read live. */
    min?: Live<number> | undefined
    /** The most it takes. Unbounded by default; a function is read live. */
    max?: Live<number> | undefined
    /** How far a step moves it. `1` by default; a function is read live. */
    step?: Live<number> | undefined
    /** The field's accessible name; a function is read live. */
    label?: Live<string> | undefined
}

/** The parts `stepper` hands back: `<input {...seats.input}>`, `<button {...seats.increment}>`. */
export type Stepper = {
    /** The field's attributes and keys. */
    readonly input: Record<string, unknown>
    /** The button stepping it down. */
    readonly decrement: Record<string, unknown>
    /** The button stepping it up. */
    readonly increment: Record<string, unknown>
    /** The number — the `value` it was handed, or one of its own. */
    readonly value: Reactive<number>
}

/** WAI-ARIA's spin button: a field and its two buttons, as parts to spread. */
export function stepper(options: StepperOptions = {}): Stepper {
    const value = options.value ?? reactive(live(options.min) ?? 0)
    const id = options.id ?? `stepper-${randomToken(4, 'hex')}`
    const step = () => live(options.step) ?? 1
    const min = () => live(options.min) ?? Number.NEGATIVE_INFINITY
    const max = () => live(options.max) ?? Number.POSITIVE_INFINITY
    // 56.32 — kept to its bounds, and to a whole number of steps from its least, or from 0.
    const kept = (to: number): number => {
        const from = Number.isFinite(min()) ? min() : 0
        const snapped = from + Math.round((to - from) / step()) * step()
        // Rounded to the step's own decimals, so three steps of a tenth read as three tenths, not as
        // the float their sum makes.
        const places = (String(step()).split('.')[1] ?? '').length
        return Math.min(max(), Math.max(min(), Number(snapped.toFixed(places))))
    }
    const now = () => value.peek() ?? 0
    const by = (steps: number) => () => value.set(kept(now() + steps * step()))
    const bound = (which: 'min' | 'max') => {
        const limit = which === 'min' ? min() : max()
        return Number.isFinite(limit) ? limit : undefined
    }
    const button = (part: string, steps: number, name: string) => ({
        type: 'button',
        'data-stepper': part,
        tabindex: '-1',
        'aria-controls': id,
        'aria-label': name,
        // 56.31
        get disabled() {
            const at = value()
            return steps < 0 ? at <= min() : at >= max()
        },
        // 49.15 — at its bound, focus goes to the field, which holds the keys.
        onclick: (event?: MouseEvent) => {
            by(steps)()
            const at = now()
            handFocus(
                event?.currentTarget,
                steps < 0 ? at <= min() : at >= max(),
                () => globalThis.document?.getElementById(id),
            )
        },
    })
    return {
        // 56.29
        input: {
            id,
            role: 'spinbutton',
            inputmode: 'decimal',
            'data-stepper': 'input',
            get 'aria-label'() {
                return live(options.label)
            },
            get 'aria-valuenow'() {
                return value()
            },
            get 'aria-valuemin'() {
                return bound('min')
            },
            get 'aria-valuemax'() {
                return bound('max')
            },
            get value() {
                return String(value())
            },
            // 56.30
            onkeydown: (event: KeyboardEvent) => {
                const moves: Record<string, () => void> = {
                    ArrowUp: by(1),
                    ArrowDown: by(-1),
                    PageUp: by(10),
                    PageDown: by(-10),
                    Home: () => Number.isFinite(min()) && value.set(min()),
                    End: () => Number.isFinite(max()) && value.set(max()),
                }
                const move = moves[event.key]
                if (move === undefined) return
                event.preventDefault()
                move()
            },
            // 56.33 — taken as typed only where the text already reads as the number it is kept to,
            // so the field's own write-back is the text already there and nothing moves under the caret.
            oninput: (event: Event) => {
                const text = (
                    event.currentTarget as HTMLInputElement
                ).value.trim()
                const typed = Number(text)
                if (
                    text !== '' &&
                    Number.isFinite(typed) &&
                    String(kept(typed)) === text
                )
                    value.set(typed)
            },
            // 56.32 — the text typed, read as a number; anything else puts the number back.
            onchange: (event: Event) => {
                const field = event.currentTarget as HTMLInputElement
                const typed = Number(field.value.trim())
                if (field.value.trim() !== '' && Number.isFinite(typed))
                    value.set(kept(typed))
                field.value = String(value.peek())
            },
        },
        decrement: button('decrement', -1, 'Decrease'),
        increment: button('increment', 1, 'Increase'),
        value,
    }
}
