// 53.53 — a scrolling element kept at its bottom, as `Chat`'s transcript is (53.40).

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
    // One delivery per batch of changes, however many chunks the batch held. AN OBSERVER OF ITS OWN,
    // not one shared as resizes are (32.81): a mutation record names the node that changed, deep in
    // the subtree, so a shared observer would walk each record's ancestors to find which followed
    // element it belongs to — a walk per record of a stream writing one per chunk — where an observer
    // per element is handed only its own, and is told nothing it has to sort.
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
