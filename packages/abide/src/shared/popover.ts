// 50.19-50.22, 50.26, 50.27, 50.48, 50.59, 50.60 — AN APP'S OWN OVERLAY HELD AGAINST AN ANCHOR, as
// parts an app spreads onto elements of its own: a trigger that opens it and anchors it, or an anchor
// that only anchors it, and the popover itself, in the anchored layer `tooltip` opens in. A `menu` handed one opens in it.
//
// THE PARTS FIND EACH OTHER BY ID: what an app writes is two spreads, and no element
// is handed from one to the other. The server writes every attribute, a manual popover included, so
// the popover is shut before the page hydrates.

import { anchored } from './anchored.ts'
import { checkParts } from './checkParts.ts'
import { dismissing } from './dismissible.ts'
import type { PlaceOptions } from './place.ts'
import { randomToken } from './randomToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { type Disposer, watch } from './reactive/watch.ts'

/** 50.19-50.21, 50.35, 50.59, 50.60 — where a popover opens, and what opens and closes it. */
export type PopoverOptions = PlaceOptions & {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string
    /** Whether the popover is open: hand it a `Reactive` to read and write it, and every way it closes writes `false` back. */
    open?: Reactive<boolean>
    /** 50.60 — whether Escape closes it. `true` by default. */
    escape?: boolean
    /** 50.60 — whether a press outside it and its trigger or anchor closes it. `true` by default. */
    outside?: boolean
}

/** The parts `popover` hands back: `<button {...filters.trigger}>`, `<div {...filters.popover}>`. */
export type PopoverParts = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** A button that opens and closes the popover, and that it is placed against. */
    readonly trigger: Record<string, unknown>
    /** An element the popover is placed against that does not open it: a field a popover suggests under. */
    readonly anchor: Record<string, unknown>
    /** The popover. */
    readonly popover: Record<string, unknown>
    /** Whether the popover is open — the `open` it was handed, or one of its own. */
    readonly open: Reactive<boolean>
}

/**
 * An app's own overlay as parts: shown in the top layer while `open` holds, placed against its trigger
 * or its anchor and placed again as anything moves it, and closed by a press outside or Escape.
 *
 * @param options where it opens, its id, its `open`, and which of a press outside and Escape close it
 */
export function popover(options: PopoverOptions = {}): PopoverParts {
    const open = options.open ?? reactive(false)
    // Hydration runs setup again (41.6), and every attribute naming one is bound to it, so the ids are
    // rewritten together.
    const id = options.id ?? `popover-${randomToken(4, 'hex')}`
    const anchorId = `${id}-anchor`
    if (process.env.NODE_ENV !== 'production') checkParts('popover', id)
    // Whether it was open as the trigger was pressed: the press outside closes it before the click
    // lands, and the click must not open it again (50.59).
    let openAtPress = false
    const anchor = {
        id: anchorId,
        'data-popover': 'anchor',
        'aria-controls': id,
        get 'aria-expanded'() {
            return open() ? 'true' : 'false'
        },
    }
    return {
        id,
        trigger: {
            id: anchorId,
            'data-popover': 'trigger',
            'aria-controls': id,
            get 'aria-expanded'() {
                return open() ? 'true' : 'false'
            },
            onpointerdown: () => {
                openAtPress = open.peek() === true
            },
            onclick: () => {
                open.set(!(open.peek() || openAtPress))
                openAtPress = false
            },
        },
        anchor,
        popover: {
            id,
            popover: 'manual',
            'data-popover': 'popover',
            get 'data-open'() {
                return open() ? '' : undefined
            },
            'bind:element': (element: Element): Disposer =>
                watch(() => {
                    const at = open() ? document.getElementById(anchorId) : null
                    if (at === null) return
                    const floating = element as HTMLElement
                    const stop = anchored(at, floating, options, (placement) =>
                        floating.setAttribute('data-side', placement.side),
                    )
                    // 50.60 — the trigger or the anchor is inside: pressing it again is its to answer.
                    const unstack = dismissing(() => open.set(false), {
                        escape: options.escape ?? true,
                        outside: options.outside ?? true,
                        inside: [at],
                    })(floating)
                    return () => {
                        unstack()
                        stop()
                    }
                }),
        },
        open,
    }
}

/** The binding showing an element against `anchor`, for a part of the framework's own that opens an element it holds. */
export function popoverOn(
    anchor: Element,
    options: PlaceOptions = {},
): (element: Element) => Disposer {
    return (element) => {
        const floating = element as HTMLElement
        // 50.48 — a manual popover, which no press elsewhere and no other popover closes: what opens
        // and closes it is the binding.
        if (!floating.hasAttribute('popover'))
            floating.setAttribute('popover', 'manual')
        return anchored(anchor, floating, options, (placement) =>
            floating.setAttribute('data-side', placement.side),
        )
    }
}
