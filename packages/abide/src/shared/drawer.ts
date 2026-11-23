// 50.61, 50.62 — A PANEL FROM AN EDGE OF THE PAGE: a `dialog` with a `resizable`'s panel laid over it,
// as parts an app spreads onto a `<dialog>` and a handle of its own. Where it stands is the app's CSS,
// told by `data-side`; the dialog opens and dismisses it, and the handle on its inner edge sizes it.

import { dialog, type DialogOptions } from './dialog.ts'
import type { Live } from './live.ts'
import type { Reactive } from './reactive/index.ts'
import { resizable } from './resizable.ts'
import { withPart } from './withPart.ts'

/** The edge it stands on, how it opens, and the bounds of its size. */
export type DrawerOptions = DialogOptions & {
    /** The edge of the page it stands on. `'end'` by default; read once, since it fixes the axis it sizes along. */
    side?: 'start' | 'end' | 'top' | 'bottom'
    /** Its size in pixels across its edge, or `undefined` for its own: a `Reactive` to read and set. Held by the parts, and handed back as `size`, where none is given. */
    size?: Reactive<number | undefined>
    /** The fewest pixels it keeps. `0` by default; a function is read live. */
    min?: Live<number>
    /** The most pixels it takes. Unbounded by default; a function is read live. */
    max?: Live<number>
    /** The handle's accessible name; a function is read live. */
    label?: Live<string>
}

/** The parts `drawer` hands back: `<dialog {...filters.drawer}>`, `<div {...filters.handle}>`. */
export type Drawer = {
    /** The `<dialog>`'s part: `dialog`'s, sized as a `resizable`'s panel, with `data-side`. */
    readonly drawer: Record<string, unknown>
    /** The handle on its inner edge: a `resizable`'s. */
    readonly handle: Record<string, unknown>
    /** Whether it is showing — the `open` it was handed, or one of its own. */
    readonly open: Reactive<boolean>
    /** Its size in pixels, `undefined` for its own; written, it sizes it. */
    readonly size: Reactive<number | undefined>
}

/** A dialog standing on an edge of the page, sized from the handle on its inner edge. */
export function drawer(options: DrawerOptions = {}): Drawer {
    const side = options.side ?? 'end'
    const shown = dialog(options)
    // 50.62 — sized across its edge, growing as the handle moves away from the edge it stands on.
    const sized = resizable({
        ...options,
        axis: side === 'top' || side === 'bottom' ? 'y' : 'x',
        edge: side === 'start' || side === 'top' ? 'end' : 'start',
    })
    return {
        // 50.61
        drawer: withPart(withPart(withPart({}, shown.dialog), sized.panel), {
            'data-drawer': 'drawer',
            'data-side': side,
        }),
        handle: withPart(withPart({}, sized.handle), {
            'data-drawer': 'handle',
        }),
        open: shown.open,
        size: sized.size,
    }
}
