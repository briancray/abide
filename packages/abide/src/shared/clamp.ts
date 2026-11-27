// 51.122-51.124 — TEXT CUT TO A FEW LINES AND A BUTTON SHOWING THE REST: a `disclosure` whose region
// is the text itself, clamped while it is shut rather than hidden, and which says whether there is
// more than the lines show, measured as the text resizes.

import { disclosure } from './disclosure.ts'
import { resized } from './element/resized.ts'
import { type Live, live } from './live.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import type { Disposer } from './reactive/watch.ts'
import { withPart } from './withPart.ts'

/** How many lines show while it is shut, and whether it is open. */
export type ClampOptions = {
    /** The lines shown while it is shut. `3` by default; a function is read live. */
    lines?: Live<number> | undefined
    /** Whether all of it shows: hand it a `Reactive` to read and write it. Held by the parts, and handed back as `open`, where none is given. */
    open?: Reactive<boolean> | undefined
    /** The base the text's id is derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
}

/** The parts `clamp` hands back: `<p {...summary.text}>`, `<button {...summary.button}>`. */
export type Clamp = {
    /** The text's attributes: clamped to `lines` while it is shut. */
    readonly text: Record<string, unknown>
    /** The button showing all of it, and cutting it back: a `disclosure`'s. */
    readonly button: Record<string, unknown>
    /** Whether all of it shows — the `open` it was handed, or one of its own. */
    readonly open: Reactive<boolean>
    /** Whether the text holds more than `lines` lines: whether a button showing the rest is due. */
    get overflowing(): boolean
}

/** Text clamped to `lines` lines, and a disclosure's button showing the rest. */
export function clamp(options: ClampOptions = {}): Clamp {
    const shown = disclosure(options)
    const { open } = shown
    const overflowing = reactive(false)
    const lines = () => live(options.lines) ?? 3
    // 51.123 — measured while it is shut: a clamped box shorter than what it holds overflows. Open, it
    // keeps the answer it had, so the button that cuts it back stays.
    const measure = (element: Element): void => {
        if (open.peek()) return
        overflowing.set(element.scrollHeight > element.clientHeight + 1)
    }
    return {
        // 49.18 — the disclosure's region the button names, clamped rather than hidden. 51.122 — the
        // clamp's lines are the one value written to `style`, an option of the app's (49.5).
        text: withPart({}, shown.region, {
            hidden: undefined,
            'data-clamp': 'text',
            get style() {
                return open()
                    ? undefined
                    : `display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;-webkit-line-clamp:${lines()};line-clamp:${lines()}`
            },
            get 'data-clamped'() {
                return open() ? undefined : ''
            },
            'bind:element': (element: Element): Disposer =>
                resized(element, () => measure(element)),
        }),
        // 51.124
        button: withPart({}, shown.button, {
            'data-clamp': 'button',
        }),
        open,
        get overflowing() {
            return overflowing()
        },
    }
}
