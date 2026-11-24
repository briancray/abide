// 51.61, 51.171 — THE ELEMENT AN ELEMENT SCROLLS IN, for the headless components that follow a scroll
// they do not own: `virtualList` from its host, `scrollSpy` from its first section — and where a
// scroll lands within it, which both compute.

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

/** Where the scroller stands. */
export function scrolledIn(scroller: Scroller): number {
    return scroller === window
        ? window.scrollY
        : (scroller as Element).scrollTop
}

/** The element whose overflow `scroller` is: the document's root for the window. */
export function rootOf(scroller: Scroller): Element {
    return scroller === window
        ? document.documentElement
        : (scroller as Element)
}

/** What a section's top in the viewport adds up to where `scroller` lands it: its scroll less its scroll padding. */
export function offsetIn(scroller: Scroller): number {
    const viewTop = viewTopOf(scroller)
    const padding =
        Number.parseFloat(
            getComputedStyle(rootOf(scroller)).scrollPaddingTop,
        ) || 0
    return scrolledIn(scroller) - viewTop - padding
}

/** Where the scroller's view starts in the viewport: the top of the window, or of the element. */
export function viewTopOf(scroller: Scroller): number {
    return scroller === window
        ? 0
        : (scroller as Element).getBoundingClientRect().top
}

/** How tall the scroller's view is: the window's inner height, or the element's client height. */
export function viewHeightOf(scroller: Scroller): number {
    return scroller === window
        ? window.innerHeight
        : (scroller as Element).clientHeight
}
