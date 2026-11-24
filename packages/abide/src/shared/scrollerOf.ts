// 51.61, 51.171 — THE ELEMENT AN ELEMENT SCROLLS IN, for the headless components that follow a scroll
// they do not own: `virtualList` from its host, `scrollSpy` from its first section.

/** What scrolls: an element whose overflow does, or the window. */
export type Scroller = Element | Window

// An element whose overflow scrolls, as `overflow-y` says.
const SCROLLS = new Set(['auto', 'scroll', 'overlay'])

/** The element `element` scrolls in: its nearest ancestor whose overflow scrolls, or the window. */
export function scrollerOf(element: Element): Scroller {
    for (
        let ancestor = element.parentElement;
        ancestor !== null;
        ancestor = ancestor.parentElement
    )
        if (SCROLLS.has(getComputedStyle(ancestor).overflowY)) return ancestor
    return window
}
