// 32.81 — ONE `ResizeObserver` FOR EVERY ELEMENT WATCHED FOR A RESIZE IN THE DOCUMENT: each
// `observe.size`, each `observe.rect`, each element `scrollEdges` marks and its element children
// (32.104), and the anchor and the popover `anchored` keeps placed. Made by the
// first and dropped with the last, so the next is made by whatever `ResizeObserver` stands then — a
// test's fake among them. An observer per caller is a callback per caller per frame a layout moves,
// where one hands every resize of the frame over in a single batch.
//
// THE BOX IS AN OPTION OF THE ELEMENT, not of the observer: an element is observed in its border box
// where any of its listeners asks for it (32.90), and in its content box otherwise. Only
// `observe.size` asks for a box, and one element takes one `observe.size` (32.92), so a listener
// asking for the content box never shares an element with one asking for the border box.

import type { Disposer } from '../reactive/watch.ts'

/** Told each delivery for the element it was registered against. */
export type Resized = (entry: ResizeObserverEntry) => void

/** An element's listeners, and how many of them ask for its border box. */
class Watched {
    // Replaced rather than spliced, so a delivery walking the old array is not disturbed by a
    // listener leaving mid-walk.
    listeners: readonly Resized[] = []
    border = 0
    observedBorder = false
}

let observer: ResizeObserver | undefined
const watched = new Map<Element, Watched>()
const BORDER_BOX: ResizeObserverOptions = { box: 'border-box' }

/**
 * Registers `listener` for every resize of `element`, in `box` where `"border"`. The first delivery,
 * which an element is owed on being observed, comes to every listener of the element, since
 * observing it again is what owes it.
 */
export function resized(
    element: Element,
    listener: Resized,
    box?: 'content' | 'border',
): Disposer {
    let each = watched.get(element)
    if (each === undefined) {
        each = new Watched()
        watched.set(element, each)
    }
    each.listeners = [...each.listeners, listener]
    if (box === 'border') each.border += 1
    observer ??= new ResizeObserver(deliver)
    observeIn(element, each)
    return () => {
        const at = (each as Watched).listeners.indexOf(listener)
        if (at === -1) return
        const current = each as Watched
        current.listeners = current.listeners.filter((_, index) => index !== at)
        if (box === 'border') current.border -= 1
        const live = observer as ResizeObserver
        if (current.listeners.length > 0) {
            if (current.border > 0 !== current.observedBorder)
                observeIn(element, current)
            return
        }
        watched.delete(element)
        live.unobserve(element)
        if (watched.size > 0) return
        live.disconnect()
        observer = undefined
    }
}

// Observing an element again replaces its box.
function observeIn(element: Element, each: Watched): void {
    each.observedBorder = each.border > 0
    ;(observer as ResizeObserver).observe(
        element,
        each.observedBorder ? BORDER_BOX : undefined,
    )
}

function deliver(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
        const each = watched.get(entry.target)
        if (each === undefined) continue
        for (const listener of each.listeners) listener(entry)
    }
}
