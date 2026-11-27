// 50.65-50.67 — A VIEWER OVER A SET OF PICTURES: a `carousel` inside a `dialog`, its arrow keys bound
// with `hotkeys` to the carousel's own buttons. The `<dialog>`'s part is the lightbox's; the carousel's
// go on elements of their own inside it, so they are handed back whole as `carousel` (49.18). `show`
// opens it resting on the one picked.

import { type Carousel, carousel, type CarouselOptions } from './carousel.ts'
import { dialog } from './dialog.ts'
import { hotkeys } from './hotkeys.ts'
import type { Reactive } from './reactive/index.ts'
import { withPart } from './withPart.ts'

/** The items, how each is told apart, the one it rests on, and whether it is showing. */
export type LightboxOptions<Item> = CarouselOptions<Item> & {
    /** Whether it is showing: a `Reactive` to read and write it. One of its own by default. */
    open?: Reactive<boolean> | undefined
}

/** The dialog's parts, the carousel's, whether it is showing, and what opens it on an item. */
export type Lightbox<Item> = {
    /** The `<dialog>`'s part: `dialog`'s, with the arrow keys stepping the carousel. */
    readonly dialog: Record<string, unknown>
    /** An element inside the `<dialog>` standing for its backdrop: `dialog`'s. */
    readonly backdrop: Record<string, unknown>
    /** The carousel inside the `<dialog>`, handed back whole. */
    readonly carousel: Carousel<Item>
    /** Whether it is showing — the `open` it was handed, or one of its own. */
    readonly open: Reactive<boolean>
    /** Opens it resting on the item `key` names. */
    show(key: string): void
}

/** A carousel in a dialog, stepped by the arrow keys, opened on the item picked. */
export function lightbox<Item>(options: LightboxOptions<Item>): Lightbox<Item> {
    const pictures = carousel(options)
    const shown = dialog(options)
    // 50.66 — an arrow is a press on the carousel's own button, disabled at its end as that one is.
    const press = (part: Record<string, unknown>) => () => {
        if (part.disabled !== true) (part.onclick as () => void)()
    }
    const keys = hotkeys({
        arrowleft: press(pictures.previous),
        arrowright: press(pictures.next),
    })
    return {
        // 50.65
        dialog: withPart({}, shown.dialog, {
            'data-lightbox': 'dialog',
            onkeydown: keys,
        }),
        backdrop: withPart({}, shown.backdrop, {
            'data-lightbox': 'backdrop',
        }),
        carousel: pictures,
        open: shown.open,
        // 50.67 — 49.19, both writes land or neither: a refused opening puts the pick back.
        show: (key: string) => {
            const before = pictures.selected.peek()
            if (pictures.selected.set(key) !== undefined) return
            if (shown.open.set(true) !== undefined)
                pictures.selected.set(before)
        },
    }
}
