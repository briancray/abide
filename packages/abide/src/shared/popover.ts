// 50.19-50.22, 50.26, 50.27, 50.48, 50.55, 50.56, 50.59, 50.60, 50.75, 50.76 — AN APP'S OWN OVERLAY HELD AGAINST AN ANCHOR, as
// parts an app spreads onto elements of its own: a trigger that opens it and anchors it, or an anchor
// that only anchors it, and the popover itself, in the anchored layer `tooltip` opens in. A `menu` handed one opens in it.
//
// THE PARTS FIND EACH OTHER BY ID: what an app writes is two spreads, and no element
// is handed from one to the other. The server writes every attribute, a manual popover included, so
// the popover is shut before the page hydrates.

import { anchored } from './anchored.ts'
import { checkParts } from './checkParts.ts'
import { dismissing } from './dismissible.ts'
import {
    hoverAndFocus,
    type HoverAndFocusOptions,
    type OpenedBy,
} from './hoverAndFocus.ts'
import type { PlaceOptions } from './place.ts'
import { randomToken } from './randomToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { type Disposer, watch } from './reactive/watch.ts'
import { withPart } from './withPart.ts'

/** 50.19-50.21, 50.35, 50.55, 50.56, 50.59, 50.60, 50.75 — where a popover opens, and what opens and closes it. */
export type PopoverOptions = PlaceOptions &
    HoverAndFocusOptions & {
        /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
        id?: string | undefined
        /** Whether the popover is open: hand it a `Reactive` to read and write it, and every way it closes writes `false` back. */
        open?: Reactive<boolean> | undefined
        /** 50.60 — whether Escape closes it. `true` by default. */
        escape?: boolean | undefined
        /** 50.60 — whether a press outside it and its trigger or anchor closes it. `true` by default. */
        outside?: boolean | undefined
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
 * @param options where it opens, its id, its `open`, what besides a press opens it, and what closes it
 */
export function popover(options: PopoverOptions = {}): PopoverParts {
    const { id, trigger, anchor, popover: layer, open } = popoverLayer(options)
    return { id, trigger, anchor, popover: layer, open }
}

/**
 * `popover`'s parts, with how the open popover was opened and what opens it by a rest or by focus:
 * what `menu` builds on, deciding where focus goes as it opens (50.28). Not `popover`'s own, so it is
 * no name an app writes.
 */
export function popoverLayer(options: PopoverOptions): PopoverParts & {
    openedBy(): OpenedBy | undefined
    /** Opens it as `by` opened it; false where its `open` refused the write (49.19). */
    show(by: OpenedBy | undefined): boolean
    /** Closes it; false where its `open` refused the write. */
    hide(): boolean
} {
    const open = options.open ?? reactive(false)
    // Hydration runs setup again (41.6), and every attribute naming one is bound to it, so the ids are
    // rewritten together.
    const id = options.id ?? `popover-${randomToken(4, 'hex')}`
    const anchorId = `${id}-anchor`
    if (process.env.NODE_ENV !== 'production') checkParts('popover', id)
    // Whether it was open as the trigger was pressed: the press outside closes it before the click
    // lands, and the click must not open it again (50.59).
    let openAtPress = false
    // 50.56, 50.76 — how the open popover was opened, which decides what a leave and a blur close.
    let openedBy: OpenedBy | undefined
    const show = (by: OpenedBy | undefined): boolean => {
        if (open.peek() === true) return true
        const was = openedBy
        openedBy = by
        if (open.set(true) === undefined) return true
        openedBy = was
        return false
    }
    const hide = (): boolean => {
        if (open.peek() !== true) return true
        if (open.set(false) !== undefined) return false
        openedBy = undefined
        return true
    }
    const opens = hoverAndFocus(options, {
        isOpen: () => open.peek() === true,
        openedBy: () => openedBy,
        show,
        hide,
        inside: () => [
            document.getElementById(anchorId),
            document.getElementById(id),
        ],
    })
    // What the trigger and the anchor share: their state, and what opens and closes on them.
    const anchoring = (part: 'trigger' | 'anchor') => ({
        id: anchorId,
        'data-popover': part,
        'aria-controls': id,
        get 'aria-expanded'() {
            return open() ? 'true' : 'false'
        },
        // 49.17
        get 'data-open'() {
            return open() ? '' : undefined
        },
        onpointerenter: opens.enter,
        onpointerleave: opens.leave,
        onfocusin: opens.focused,
        onfocusout: opens.blurred,
    })
    return {
        id,
        trigger: withPart(anchoring('trigger'), {
            onpointerdown: () => {
                openAtPress = open.peek() === true
            },
            // 50.59 — a click from a key (Enter, Space) has no pointer under it, and `detail` 0 says so.
            onclick: (event: MouseEvent) => {
                if (open.peek() || openAtPress) hide()
                else show(event.detail === 0 ? undefined : 'press')
                openAtPress = false
            },
        }),
        anchor: anchoring('anchor'),
        openedBy: () => openedBy,
        show,
        hide,
        popover: {
            id,
            popover: 'manual',
            'data-popover': 'popover',
            get 'data-open'() {
                return open() ? '' : undefined
            },
            onpointerenter: opens.enter,
            onpointerleave: opens.leave,
            onfocusout: opens.blurred,
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
                        // Closed or let go: nothing pending outlives it, and its next opening says how.
                        opens.stop()
                        openedBy = undefined
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
