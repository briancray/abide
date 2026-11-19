// 53.44 — a scrolling element kept at its bottom, as `Chat`'s transcript is (53.40).

import type { Disposer } from './reactive/watch.ts'

// How near the bottom, in pixels, still counts as at it: a fractional scroll position rounds short.
const AT_BOTTOM = 2

/**
 * The `bind:element` callback keeping a scrolling element at its bottom as what it holds grows,
 * until the reader scrolls up, and again once they scroll back down.
 */
export function followBottom(element: Element): Disposer {
    let following = true
    const scrolled = (): void => {
        following =
            element.scrollHeight - element.scrollTop - element.clientHeight <=
            AT_BOTTOM
    }
    // One delivery per batch of changes, however many chunks the batch held.
    const observer = new MutationObserver(() => {
        if (following) element.scrollTop = element.scrollHeight
    })
    observer.observe(element, {
        childList: true,
        subtree: true,
        characterData: true,
    })
    element.addEventListener('scroll', scrolled, { passive: true })
    return () => {
        observer.disconnect()
        element.removeEventListener('scroll', scrolled)
    }
}
