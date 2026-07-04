/*
Run `callback` once, the first time `element` enters (or is already within) the viewport —
the trigger a below-the-fold deferred region uses to wake only when scrolled into view, so a
grid the user never reaches costs nothing. A synchronous fire where the observer is absent
(SSR/test DOMs), which keeps the region from staying inert where visibility can't be measured.
Returns a cancel to drop a pending watch on teardown. Fires at most once.

ONE shared IntersectionObserver backs every watcher (a grid of N islands registers N elements
on one observer, not N observers), and wakes are BATCHED off the observer callback into a
frame-flush capped at `WAKE_BUDGET_PER_FRAME`: a wake rebuilds DOM, so running it inside the
observer callback would force a synchronous layout that shifts other elements across the
margin and re-fires the observer — a cascade that locks the main thread at grid scale. Queuing
to a rAF and spending a bounded number per frame breaks that loop and keeps each frame cheap;
overflow spills to the next frame, so even a whole grid scrolled into view at once stays
responsive.
*/
// A screenful of margin so a region is live by the time it's actually read.
const ROOT_MARGIN = '256px'
// Max wakes (DOM rebuilds) per frame — the ceiling that keeps a flush off the critical path.
const WAKE_BUDGET_PER_FRAME = 40

let sharedObserver: IntersectionObserver | undefined
/* The IntersectionObserver constructor `sharedObserver` was built from. Identity only changes
   when a test swaps `globalThis.IntersectionObserver`; on a change the observer + its pending
   registrations are rebuilt, so module state doesn't leak across tests. */
let sharedObserverCtor: unknown
const wakeByElement = new Map<Element, () => void>()
const readyWakes = new Set<() => void>()
let flushScheduled = false

/* Next animation frame (browser) or macrotask (test/SSR) — the flush cadence. */
function scheduleFrame(run: () => void): void {
    const globalWithRaf = globalThis as { requestAnimationFrame?: (cb: () => void) => number }
    if (typeof globalWithRaf.requestAnimationFrame === 'function') {
        globalWithRaf.requestAnimationFrame(run)
    } else {
        setTimeout(run, 0)
    }
}

/* Spend up to the per-frame budget of queued wakes; reschedule if any remain. */
function flushWakes(): void {
    flushScheduled = false
    let processed = 0
    for (const wake of readyWakes) {
        readyWakes.delete(wake)
        wake()
        processed += 1
        if (processed >= WAKE_BUDGET_PER_FRAME) {
            break
        }
    }
    scheduleFlush()
}

function scheduleFlush(): void {
    if (flushScheduled || readyWakes.size === 0) {
        return
    }
    flushScheduled = true
    scheduleFrame(flushWakes)
}

/* Queue every newly-intersecting element's wake — never run it here (see the cascade note). */
function onIntersections(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
        if (entry.isIntersecting) {
            const wake = wakeByElement.get(entry.target)
            if (wake !== undefined) {
                wakeByElement.delete(entry.target)
                sharedObserver?.unobserve(entry.target)
                readyWakes.add(wake)
            }
        }
    }
    scheduleFlush()
}

function observerFor(observerConstructor: typeof IntersectionObserver): IntersectionObserver {
    if (sharedObserver === undefined || sharedObserverCtor !== observerConstructor) {
        wakeByElement.clear()
        readyWakes.clear()
        sharedObserver = new observerConstructor(onIntersections, { rootMargin: ROOT_MARGIN })
        sharedObserverCtor = observerConstructor
    }
    return sharedObserver
}

export function whenVisible(element: Element, callback: () => void): () => void {
    const observerConstructor = (
        globalThis as { IntersectionObserver?: typeof IntersectionObserver }
    ).IntersectionObserver
    if (typeof observerConstructor !== 'function') {
        callback()
        return () => undefined
    }
    const observer = observerFor(observerConstructor)
    wakeByElement.set(element, callback)
    observer.observe(element)
    return () => {
        wakeByElement.delete(element)
        readyWakes.delete(callback)
        observer.unobserve(element)
    }
}
