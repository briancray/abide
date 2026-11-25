// 50.65-50.67 — A VIEWER OVER A SET OF PICTURES: a `carousel` inside a `dialog`, its arrow keys bound
// with `hotkeys` to the carousel's own buttons, as parts an app spreads onto a `<dialog>` and the
// carousel's markup of its own. `show` opens it resting on the one picked.

import { type Carousel, carousel, type CarouselOptions } from './carousel.ts'
import { dialog } from './dialog.ts'
import { hotkeys } from './hotkeys.ts'
import type { Reactive } from './reactive/index.ts'
import { withPart } from './withPart.ts'

/** The items, how each is told apart, the one it rests on, and whether it is showing. */
export type LightboxOptions<Item> = CarouselOptions<Item> & {
    /** Whether it is showing: a `Reactive` to read and write it. One of its own by default. */
    open?: Reactive<boolean>
}

/** A carousel's parts, the dialog's, whether it is showing, and what opens it on an item. */
export type Lightbox<Item> = Carousel<Item> & {
    /** The `<dialog>`'s part: `dialog`'s, with the arrow keys stepping the carousel. */
    readonly dialog: Record<string, unknown>
    /** An element inside the `<dialog>` standing for its backdrop: `dialog`'s. */
    readonly backdrop: Record<string, unknown>
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
    // Laid over the carousel's parts, so its `current` stays the getter it is (49.9).
    return withPart(withPart({}, pictures), {
        // 50.65
        dialog: withPart(withPart({}, shown.dialog), {
            'data-lightbox': 'dialog',
            onkeydown: keys,
        }),
        backdrop: withPart(withPart({}, shown.backdrop), {
            'data-lightbox': 'backdrop',
        }),
        open: shown.open,
        // 50.67
        show: (key: string) => {
            pictures.selected.set(key)
            shown.open.set(true)
        },
    })
}
