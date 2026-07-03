/*
Run `callback` once, the first time `element` enters (or is already within) the viewport —
the trigger a below-the-fold deferred region uses to wake only when scrolled into view, so a
grid the user never reaches costs nothing. `IntersectionObserver` when the runtime has it
(`rootMargin` wakes it a screenful early, so content is live by the time it's read); a
synchronous fire otherwise (SSR/test DOMs without the observer), which keeps the region from
staying inert where visibility can't be measured. Returns a cancel to drop a pending watch on
teardown. Fires at most once, then disconnects.
*/
export function whenVisible(
    element: Element,
    callback: () => void,
    rootMargin = '256px',
): () => void {
    const globalWithObserver = globalThis as {
        IntersectionObserver?: typeof IntersectionObserver
    }
    if (typeof globalWithObserver.IntersectionObserver !== 'function') {
        callback()
        return () => undefined
    }
    const observer = new globalWithObserver.IntersectionObserver(
        (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                observer.disconnect()
                callback()
            }
        },
        { rootMargin },
    )
    observer.observe(element)
    return () => observer.disconnect()
}
