// 32.81 — ONE `ResizeObserver` FOR EVERY ELEMENT WATCHED FOR A RESIZE IN THE DOCUMENT: each
// `elementSize`, each `elementRect`, each element `scrollEdges` marks (32.104), and the anchor and
// the popover `anchored` keeps placed. Made by the first and dropped with the last, so the next is
// made by whatever `ResizeObserver` stands then — a test's fake among them. An observer per caller
// is a callback per caller per frame a layout moves, where one hands every resize of the frame over
// in a single batch.
//
// THE BOX IS AN OPTION OF THE ELEMENT, not of the observer: an element is observed in the box a
// listener asks for other than the content box (32.90), and in its content box otherwise. Only
// `elementSize` and `virtualList`'s rows ask for a box — the rows the border box — and one element
// takes one `elementSize` (32.92); where two listeners on one element ask for two boxes, the one
// asked for last is observed, and each reads the box it asked for off the entry.

import type { Disposer } from '../reactive/watch.ts'

/** Told each delivery for the element it was registered against. */
export type Resized = (entry: ResizeObserverEntry) => void

/** An element's listeners, the box the last of them asking for one asked for, and how many ask. */
class Watched {
    // Replaced rather than spliced, so a delivery walking the old array is not disturbed by a
    // listener leaving mid-walk.
    listeners: readonly Resized[] = []
    asking = 0
    box: ResizeObserverBoxOptions = 'content-box'
    observedBox: ResizeObserverBoxOptions = 'content-box'
}

let observer: ResizeObserver | undefined
const watched = new Map<Element, Watched>()

/**
 * Registers `listener` for every resize of `element`, observed in `box`. The first delivery, which
 * an element is owed on being observed, comes to every listener of the element, since observing it
 * again is what owes it.
 */
export function resized(
    element: Element,
    listener: Resized,
    box: ResizeObserverBoxOptions = 'content-box',
): Disposer {
    let each = watched.get(element)
    if (each === undefined) {
        each = new Watched()
        watched.set(element, each)
    }
    each.listeners = [...each.listeners, listener]
    if (box !== 'content-box') {
        each.asking += 1
        each.box = box
    }
    observer ??= new ResizeObserver(deliver)
    observeIn(element, each)
    return () => {
        const at = (each as Watched).listeners.indexOf(listener)
        if (at === -1) return
        const current = each as Watched
        current.listeners = current.listeners.filter((_, index) => index !== at)
        if (box !== 'content-box') {
            current.asking -= 1
            if (current.asking === 0) current.box = 'content-box'
        }
        const live = observer as ResizeObserver
        if (current.listeners.length > 0) {
            if (current.box !== current.observedBox) observeIn(element, current)
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
    each.observedBox = each.box
    ;(observer as ResizeObserver).observe(
        element,
        each.box === 'content-box' ? undefined : { box: each.box },
    )
}

function deliver(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
        const each = watched.get(entry.target)
        if (each === undefined) continue
        for (const listener of each.listeners) listener(entry)
    }
}
