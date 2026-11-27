// 51.108, 51.109 — A BUTTON THAT STAYS PRESSED: WAI-ARIA's toggle button, or its switch, as a part an
// app spreads onto a button of its own. What a `toggleGroup` that picks many is made of, one per key.

import { type Live, live } from './live.ts'
import { type Bindable, bindable } from './reactive/bindable.ts'
import { type Reactive, reactive } from './reactive/index.ts'

/** Whether the button is pressed, and whether it reads as a toggle button or a switch. */
export type ToggleOptions = {
    /** Whether it is pressed: hand it a `Reactive` to read and write it. Held by the part, and handed back as `pressed`, where none is given. */
    pressed?: Bindable<boolean> | undefined
    /** `'switch'` for an on/off switch, read as `role="switch"` with `aria-checked`. `'button'` by default; a function is read live. */
    role?: Live<'button' | 'switch'> | undefined
}

/** The part `toggle` hands back, and whether it is pressed: `<button {...pin.button}>`. */
export type Toggle = {
    /** The button's attributes and its click. */
    readonly button: Record<string, unknown>
    /** Whether the button is pressed — the `pressed` it was handed, or one of its own. */
    readonly pressed: Reactive<boolean>
}

/** WAI-ARIA's toggle button, or its switch, as a part to spread on a button. */
export function toggle(options: ToggleOptions = {}): Toggle {
    const pressed = bindable(options.pressed) ?? reactive(false)
    const isSwitch = () => live(options.role) === 'switch'
    return {
        button: {
            type: 'button',
            'data-toggle': 'button',
            get role() {
                return isSwitch() ? 'switch' : undefined
            },
            get 'aria-pressed'() {
                return isSwitch() ? undefined : pressed.get() ? 'true' : 'false'
            },
            get 'aria-checked'() {
                return isSwitch()
                    ? pressed.get()
                        ? 'true'
                        : 'false'
                    : undefined
            },
            get 'data-pressed'() {
                return pressed.get() ? '' : undefined
            },
            onclick: () => pressed.set(!pressed.peek()),
        },
        pressed,
    }
}
