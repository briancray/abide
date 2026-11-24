// 51.58-51.64, 51.95-51.97 — THE ITEMS OF A LONG LIST THAT ARE IN VIEW, as parts spread on the app's
// own markup: a list, a CSS grid, rows that wrap — laid out by the app's CSS, and measured rather than
// described. The host's width and the items as they render say how many items a row holds and how tall
// a row is, so a breakpoint, a layout switched or a font loaded re-derives both with nothing handed in.
//
// THE ROWS LEFT OUT ARE THE HOST'S BLOCK PADDING, not spacer elements: a spacer in a grid takes a cell,
// and padding leaves every layout as it is. The host's own block padding is therefore the list's.
//
// NOTHING IS READ AT BIND (32.82): sizes arrive from the shared resize observer once the browser has
// laid things out, the scroller is found at the first of them, and a scroll is read once a frame. Until
// the first measurement, `shown` is the first `initial` items, on a server as in a browser.

import { keyOfItem, type KeyOption } from './itemKey.ts'
import { lastAtOrBefore } from './lastAtOrBefore.ts'
import { type Live, live } from './live.ts'
import { resized } from './observe/resized.ts'
import { memo, reactive } from './reactive/index.ts'
import { type Disposer, watch } from './reactive/watch.ts'

/** What `virtualList` lists, how an item is told apart and grouped, and how much is rendered first. */
export type VirtualListOptions<Item> = {
    /** The items, in order; a function is read live. */
    items: Live<readonly Item[]>
    /** The section an item stands in — the letter its title starts with, say — for `sections`. */
    section?: (item: Item) => string
    /** Every section `sections` lists, in order, those with no item among them; a function is read live. */
    labels?: Live<readonly string[]>
    /** Rows rendered past each end of the view. `3` by default; a function is read live. */
    overscan?: Live<number>
    /** Items rendered before the first measurement, and on a server. `40` by default. */
    initial?: number
    /** An item's height in pixels before one is measured. `48` by default. */
    estimate?: number
    /** How `scrollTo` and a section's jump scroll. `'auto'` by default; a function is read live. */
    behavior?: Live<'auto' | 'smooth'>
} & KeyOption<Item>

/** One item `shown` renders: the item, where it stands in `items`, and its key. */
export type VirtualListEntry<Item> = {
    item: Item
    index: number
    key: string
}

/** One section of the list: its label, and the index of its first item, or `-1` where it has none. */
export type VirtualListSection = {
    label: string
    index: number
}

/** The jump index over a list's sections: its host, every section, the one in view, and a jump's part. */
export type VirtualListSections = {
    /** The jump index's part. */
    readonly host: Record<string, unknown>
    /** Every section, in order. */
    get all(): readonly VirtualListSection[]
    /** The label of the section the first item in view stands in. */
    get current(): string | undefined
    /** A section's jump: `aria-current` while it is the one in view, `disabled` where it has no item. */
    jump(section: VirtualListSection): Record<string, unknown>
}

/** The parts `virtualList` hands back: `<div {...list.host}>`, an `item` per entry of `shown`. */
export type VirtualList<Item> = {
    /** The element the items sit in: what measures them, and carries the rows left out as its padding. */
    readonly host: Record<string, unknown>
    /** An entry's part: `data-virtual-list="item"`, its index, and what measures it. */
    item(entry: VirtualListEntry<Item>): Record<string, unknown>
    /** The items to render: the rows in view and `overscan` rows past each end. */
    get shown(): readonly VirtualListEntry<Item>[]
    /** The sections `section` groups the items into, and the jumps between them. */
    readonly sections: VirtualListSections
    /** Scrolls the item at `index` to the top of the view, past its scroll padding. */
    scrollTo(index: number): void
}

type Scroller = Element | Window

// An element whose overflow scrolls, as `overflow-y` says.
const SCROLLS = new Set(['auto', 'scroll', 'overlay'])

/** The element a host scrolls in: its nearest ancestor whose overflow scrolls, or the window. */
function scrollerOf(host: Element): Scroller {
    for (
        let element = host.parentElement;
        element !== null;
        element = element.parentElement
    )
        if (SCROLLS.has(getComputedStyle(element).overflowY)) return element
    return window
}

/** A long list's items that are in view, measured from its own markup, as parts to spread. */
export function virtualList<Item>(
    options: VirtualListOptions<Item>,
): VirtualList<Item> {
    // 49.11 — read once: what renders before anything is measured.
    const initial = options.initial ?? 40
    const estimate = options.estimate ?? 48
    const items = () => live(options.items)
    const keyOf = (item: Item) => keyOfItem(options.key, item)

    // What the measurements say: items a row holds, a row's height with its gap, the first row in view
    // and how many fit — and whether there is anything measured yet.
    const perRow = reactive(1)
    const rowSize = reactive(estimate)
    const firstRow = reactive(0)
    const fits = reactive(0)
    const measured = reactive(false)

    const shown = memo((): readonly VirtualListEntry<Item>[] => {
        const list = items()
        let from = 0
        let to = Math.min(list.length, initial)
        if (measured()) {
            const per = perRow()
            const rows = Math.ceil(list.length / per)
            const over = live(options.overscan) ?? 3
            const start = Math.min(rows, Math.max(0, firstRow() - over))
            const end = Math.min(rows, firstRow() + fits() + over)
            from = start * per
            to = Math.min(list.length, end * per)
        }
        const entries: VirtualListEntry<Item>[] = []
        for (let index = from; index < to; index += 1) {
            const item = list[index] as Item
            entries.push({ item, index, key: keyOf(item) })
        }
        return entries
    })

    // 51.62 — the rows before `shown` and after it, as the host's block padding.
    const padding = memo(() => {
        const list = items()
        const entries = shown()
        const per = measured() ? perRow() : 1
        const size = rowSize()
        const rows = Math.ceil(list.length / per)
        const first = entries[0]
        const last = entries.at(-1)
        if (first === undefined || last === undefined)
            return { before: 0, after: 0 }
        return {
            before: Math.floor(first.index / per) * size,
            after: Math.max(0, rows - Math.ceil((last.index + 1) / per)) * size,
        }
    })

    let host: Element | undefined
    let scroller: Scroller | undefined
    let hostWidth = 0
    let columnGap = 0
    let rowGap = 0
    let frame = 0
    // What each rendered item measured, its inline and its block size.
    const sizes = new Map<Element, { inline: number; block: number }>()

    // 51.59 — a row holds what fits across the host beside the first item measured, gaps counted, and
    // is as tall as the items measured are on average, its gap counted.
    // The last measure taken, kept for a resize of the host that lands while no item is measured.
    let itemInline = 0
    let itemBlock = 0
    const derive = (): void => {
        if (sizes.size > 0) {
            let blocks = 0
            itemInline = 0
            for (const size of sizes.values()) {
                if (itemInline === 0) itemInline = size.inline
                blocks += size.block
            }
            itemBlock = blocks / sizes.size
        }
        if (itemInline === 0) return
        const per = Math.max(
            1,
            Math.floor(
                (hostWidth + columnGap + 0.5) / (itemInline + columnGap),
            ),
        )
        const size = itemBlock + rowGap
        if (per !== perRow.peek()) perRow.set(per)
        if (Math.abs(size - (rowSize.peek() ?? 0)) > 0.5) rowSize.set(size)
        schedule()
    }

    // 51.58, 51.61 — once a frame: where the view stands over the host, read after the browser's
    // layout rather than in the scroll event that moved it.
    const read = (): void => {
        frame = 0
        if (host === undefined || scroller === undefined || itemInline === 0)
            return
        const hostTop = host.getBoundingClientRect().top
        const viewTop =
            scroller === window
                ? 0
                : (scroller as Element).getBoundingClientRect().top
        const viewHeight =
            scroller === window
                ? window.innerHeight
                : (scroller as Element).clientHeight
        const size = rowSize.peek() ?? estimate
        const above = viewTop - hostTop
        const row = Math.max(0, Math.floor(above / size))
        const across = Math.max(
            0,
            Math.ceil((viewHeight + Math.min(0, above)) / size) + 1,
        )
        if (row !== firstRow.peek()) firstRow.set(row)
        if (across !== fits.peek()) fits.set(across)
        if (!measured.peek()) measured.set(true)
    }
    const schedule = (): void => {
        if (frame === 0 && typeof requestAnimationFrame === 'function')
            frame = requestAnimationFrame(read)
    }

    function scrollTo(index: number): void {
        if (host === undefined || scroller === undefined) return
        const row = Math.floor(index / (perRow.peek() ?? 1))
        const size = rowSize.peek() ?? estimate
        const root =
            scroller === window
                ? document.documentElement
                : (scroller as Element)
        const scrolled =
            scroller === window
                ? window.scrollY
                : (scroller as Element).scrollTop
        const viewTop =
            scroller === window
                ? 0
                : (scroller as Element).getBoundingClientRect().top
        const clearance =
            Number.parseFloat(getComputedStyle(root).scrollPaddingTop) || 0
        const top =
            scrolled +
            host.getBoundingClientRect().top -
            viewTop +
            row * size -
            clearance
        // 51.63 — in `shown` before the scroll lands.
        firstRow.set(row)
        scroller.scrollTo({ top, behavior: live(options.behavior) ?? 'auto' })
    }

    const bindHost = (element: Element): Disposer => {
        host = element
        const style = (element as HTMLElement).style
        const stopPadding = watch(() => {
            const { before, after } = padding()
            style.paddingBlockStart = `${before}px`
            style.paddingBlockEnd = `${after}px`
        })
        let stopScroller: (() => void) | undefined
        const stopHost = resized(element, (entry) => {
            hostWidth = entry.contentRect.width
            const computed = getComputedStyle(element)
            columnGap = Number.parseFloat(computed.columnGap) || 0
            rowGap = Number.parseFloat(computed.rowGap) || 0
            // 51.61 — found at the first delivery, never as it is bound.
            if (scroller === undefined) {
                const found = scrollerOf(element)
                scroller = found
                found.addEventListener('scroll', schedule, { passive: true })
                const stopSize =
                    found === window
                        ? (() => {
                              window.addEventListener('resize', schedule)
                              return () =>
                                  window.removeEventListener('resize', schedule)
                          })()
                        : resized(found as Element, schedule)
                stopScroller = () => {
                    found.removeEventListener('scroll', schedule)
                    stopSize()
                }
            }
            derive()
        })
        // 51.97 — unbound, it follows nothing.
        return () => {
            stopPadding()
            stopHost()
            stopScroller?.()
            if (frame !== 0) cancelAnimationFrame(frame)
            frame = 0
            if (host === element) {
                host = undefined
                scroller = undefined
            }
        }
    }

    const sectionList = memo((): readonly VirtualListSection[] => {
        const of = options.section
        if (of === undefined) return []
        const list = items()
        const found: VirtualListSection[] = []
        const at = new Map<string, number>()
        for (let index = 0; index < list.length; index += 1) {
            const label = of(list[index] as Item)
            if (at.has(label)) continue
            at.set(label, index)
            found.push({ label, index })
        }
        const labels = live(options.labels)
        if (labels === undefined) return found
        const all: VirtualListSection[] = []
        for (const label of labels)
            all.push({ label, index: at.get(label) ?? -1 })
        return all
    })
    // 51.64 — the section the first item in view stands in.
    const current = memo(() => {
        const listed: VirtualListSection[] = []
        for (const section of sectionList())
            if (section.index !== -1) listed.push(section)
        const first = measured() ? firstRow() * perRow() : 0
        return listed[lastAtOrBefore(listed, (section) => section.index, first)]
            ?.label
    })

    return {
        host: { 'bind:element': bindHost, 'data-virtual-list': 'host' },
        item: (entry) => ({
            'data-virtual-list': 'item',
            'data-index': entry.index,
            'bind:element': (element: Element): Disposer => {
                const stop = resized(
                    element,
                    (measuredEntry) => {
                        const box = measuredEntry.borderBoxSize?.[0]
                        sizes.set(element, {
                            inline:
                                box?.inlineSize ??
                                measuredEntry.contentRect.width,
                            block:
                                box?.blockSize ??
                                measuredEntry.contentRect.height,
                        })
                        derive()
                    },
                    'border',
                )
                return () => {
                    stop()
                    sizes.delete(element)
                }
            },
        }),
        get shown() {
            return shown()
        },
        sections: {
            host: { 'data-virtual-list': 'sections' },
            get all() {
                return sectionList()
            },
            get current() {
                return current()
            },
            // 51.95, 51.96
            jump: (section) => ({
                type: 'button',
                'data-virtual-list': 'jump',
                get 'aria-current'() {
                    return current() === section.label ? 'true' : undefined
                },
                // 49.17
                get 'data-current'() {
                    return current() === section.label ? '' : undefined
                },
                disabled: section.index === -1,
                onclick: () => scrollTo(section.index),
            }),
        },
        scrollTo,
    }
}
