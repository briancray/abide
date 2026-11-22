// 51.65-51.71 — THE ROWS OF A LONG LIST THAT ARE IN VIEW, for an app's own keyed `{#for}` over a
// slice of them: the list's scroller is bound, and the range follows its scroll and its height.
//
// THE RANGE MOVES BY WHOLE ROWS: a scroll writes the first row in view only when it changes, and
// each part of the range is a number of its own, so a scroll inside one row wakes nothing and a
// scroll by one row moves the slice by one — the keyed `{#for}` adds the row coming into view and
// drops the one leaving it, and every row between keeps its element.
//
// NOTHING IS READ AT BIND (32.82): the viewport's height and its scroll position are read at the
// first delivery the shared resize observer makes after the browser lays it out, so binding forces
// no layout. Until then the range is the one `height` gives, which is what the server rendered.

import { type Live, live } from './live.ts'
import { resized } from './observe/resized.ts'
import { reactive } from './reactive/index.ts'
import type { Disposer } from './reactive/watch.ts'

/** What `virtualRows` is handed: how many rows there are, and how tall each is. */
export type VirtualRowsOptions = {
    /** How many rows the list has, read live: hand it a function reading a reactive value. */
    count: Live<number>
    /** Every row's height in pixels. */
    rowHeight: number
    /** Rows rendered past each end of the view, so a scroll shows rows already made. Default `5`. */
    overscan?: Live<number>
    /** The viewport's height in pixels before it is measured, and on the server. Default `480`. */
    height?: number
}

/** The range of rows in view, and the adaptor binding it to the list's scroller. */
export type VirtualRows = {
    /** The `bind:element` adaptor for the element that scrolls the rows. */
    viewport: (element: Element) => Disposer
    /** The index of the first row to render. */
    start: () => number
    /** The index after the last row to render. */
    end: () => number
    /** The height in pixels of the rows before `start`, for a spacer above them. */
    before: () => number
    /** The height in pixels of the rows from `end` on, for a spacer below them. */
    after: () => number
    /** Scrolls the viewport just far enough to show the row at `index`, and renders it at once. */
    scrollTo: (index: number) => void
}

/**
 * The rows of a list of `count` rows, each `rowHeight` pixels tall, that its scroller shows,
 * with `overscan` more on each side.
 */
export function virtualRows(options: VirtualRowsOptions): VirtualRows {
    // 49.13 — read where they are used, save `rowHeight` and the starting `height`, read once.
    const { rowHeight } = options
    const count = () => live(options.count)
    const overscan = () => live(options.overscan) ?? 5
    let viewportHeight = options.height ?? 480
    // The first row in view, and how many rows the viewport fits: the two the range is made of.
    const first = reactive(0)
    const fits = reactive(Math.ceil(viewportHeight / rowHeight))
    // 51.66 — each end clamped into the list, so a list shorter than its view renders every row.
    const start = reactive(() =>
        Math.min(count(), Math.max(0, first() - overscan())),
    )
    const end = reactive(() => Math.min(count(), first() + fits() + overscan()))
    const before = reactive(() => start() * rowHeight)
    const after = reactive(() => (count() - end()) * rowHeight)
    let scroller: Element | undefined

    const follow = (top: number): void => {
        const row = Math.max(0, Math.floor(top / rowHeight))
        if (row !== first.peek()) first.set(row)
    }

    return {
        viewport: (element) => {
            scroller = element
            const scrolled = (): void => follow(element.scrollTop)
            element.addEventListener('scroll', scrolled, { passive: true })
            // 51.67 — the height it fits, and where a restored scroll left it, once it is laid out.
            const stop = resized(element, (entry) => {
                viewportHeight = entry.contentRect.height
                const rows = Math.ceil(viewportHeight / rowHeight)
                if (rows !== fits.peek()) fits.set(rows)
                follow(element.scrollTop)
            })
            return () => {
                element.removeEventListener('scroll', scrolled)
                stop()
                if (scroller === element) scroller = undefined
            }
        },
        start,
        end,
        before,
        after,
        // 51.70 — the row is in the range before the scroll lands, so a caller can focus it now.
        scrollTo: (index) => {
            const element = scroller
            if (element === undefined) return
            const top = index * rowHeight
            const shown = element.scrollTop
            let next = shown
            if (top < shown) next = top
            else if (top + rowHeight > shown + viewportHeight)
                next = top + rowHeight - viewportHeight
            if (next === shown) return
            element.scrollTop = next
            follow(next)
        },
    }
}
