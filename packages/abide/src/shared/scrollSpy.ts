// 51.169-51.177 — WHICH SECTION OF A LONG PAGE THE READER IS AT, as `Sections` parts (51.95): a link per
// section to its element — the element whose id is its key — marked while it is the one scrolled to.
//
// WHERE EACH SECTION STARTS IS MEASURED, NOT READ PER SCROLL: a frame after the host is bound, after
// `items` changes, and after the scroller or an element holding a section resizes — a webfont swapping
// in, a part streaming in, an accordion opening. A scroll is then arithmetic over the measurement, read
// once a frame, so it reads the scroll position and no layout. Measuring as the host is bound would
// force a layout of the page the router has just inserted, in the middle of its mount.
//
// A SECTION STARTS WHERE A LINK TO IT LANDS IT: its top less its `scroll-margin-top` and its scroller's
// `scroll-padding-top`, the arithmetic the browser lands a fragment by. So a jump — this one's or the
// browser's own, before the script has run — always lands with its section current, and a sticky header
// is said once, in CSS, for both. At the end of a scroller the last section is current, though its top
// never reaches where it would land: there is no room left to scroll it there.

import { resized } from './element/resized.ts'
import { isPlainClick } from './isPlainClick.ts'
import { keyOfItem, type KeyOption } from './itemKey.ts'
import { type Live, live } from './live.ts'
import { memo, reactive } from './reactive/index.ts'
import { type Disposer, watch } from './reactive/watch.ts'
import {
    offsetIn,
    rootOf,
    scrolledIn,
    type Scroller,
    scrollerOf,
    viewHeightOf,
} from './scrollerOf.ts'
import { type Sections, sections } from './sections.ts'

/** The sections `scrollSpy` follows, how one is told apart, how a jump scrolls, and whether a drag scrubs. */
export type ScrollSpyOptions<Item> = {
    /** The sections, in the order they stand; a function is read live. Each one's element is the one whose id is its key. */
    items: Live<readonly Item[]>
    /** How a jump scrolls. `'auto'` by default; a function is read live. */
    behavior?: Live<'auto' | 'smooth'> | undefined
    /** Whether a pointer dragged along the host jumps by each jump it reaches. `false` by default; a function is read live. */
    scrub?: Live<boolean> | undefined
} & KeyOption<Item>

// Pixels short of the end that still count as at it.
const AT_END = 2

/** Where a scroller `offset` stands for (`offsetIn`) lands `element`: its top less its scroll margin, in whole pixels. */
function landingOf(element: Element, offset: number): number {
    const margin =
        Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0
    return Math.floor(element.getBoundingClientRect().top + offset - margin)
}

/** The section of a long page scrolled to, and a link to each, as parts to spread. */
export function scrollSpy<Item>(
    options: ScrollSpyOptions<Item>,
): Sections<Item> {
    const items = () => live(options.items)
    const keyOf = (item: Item) => keyOfItem(options.key, item)
    // The key the last scroll found current; none until the first measurement.
    const found = reactive<string | undefined>(undefined)
    // 51.169 — the first section until anything is measured, on a server as in a browser.
    const current = memo(() => {
        const first = items()[0]
        return found() ?? (first === undefined ? undefined : keyOf(first))
    })

    let scroller: Scroller | undefined
    // Where each section in the document lands, its key at the same place, and which stands last.
    let landings: number[] = []
    let keys: string[] = []
    let last = 0
    // How far the scroller scrolls, measured with the landings.
    let end = 0
    let frame = 0
    let stale = false
    let listening: AbortController | undefined
    // The elements followed for a resize: each holding a section, and the scroller's root.
    const observed = new Map<Element, Disposer>()

    // 51.169, 51.170 — arithmetic over the measurement, and the scroll position. A walk rather than a
    // search: the sections are a page's headings, a few dozen, and a walk needs them in no order.
    const update = (): void => {
        if (scroller === undefined || keys.length === 0) return
        const scrolled = scrolledIn(scroller)
        let at = 0
        if (end > 0 && scrolled >= end - AT_END) at = last
        else {
            let highest = Number.NEGATIVE_INFINITY
            for (let index = 0; index < landings.length; index += 1) {
                const landing = landings[index] as number
                if (landing <= scrolled && landing >= highest) {
                    highest = landing
                    at = index
                }
            }
        }
        const key = keys[at]
        if (key !== found.peek()) found.set(key)
    }

    // 51.172, 51.173 — every read before any write, so the measurement forces at most one layout.
    const measure = (): void => {
        const elements: Element[] = []
        const listed: string[] = []
        for (const item of items()) {
            const key = keyOf(item)
            const element = document.getElementById(key)
            if (element === null) continue
            elements.push(element)
            listed.push(key)
        }
        const first = elements[0]
        if (first === undefined) {
            landings = []
            keys = []
            return
        }
        // 51.171 — found at the first measurement with a section in the document.
        if (scroller === undefined) {
            scroller = scrollerOf(first)
            const signal = (listening as AbortController).signal
            scroller.addEventListener('scroll', () => schedule(false), {
                passive: true,
                signal,
            })
            if (scroller === window)
                addEventListener('resize', () => schedule(true), {
                    passive: true,
                    signal,
                })
        }
        const into = scroller
        const offset = offsetIn(into)
        const measured = new Array<number>(elements.length)
        last = 0
        for (let index = 0; index < elements.length; index += 1) {
            const landing = landingOf(elements[index] as Element, offset)
            measured[index] = landing
            if (landing >= (measured[last] as number)) last = index
        }
        landings = measured
        keys = listed
        const root = rootOf(into)
        end = root.scrollHeight - viewHeightOf(into)
        // 51.173 — what moves a section is something holding one resizing, or the scroller's root.
        const following = new Set<Element>([root])
        for (const element of elements)
            if (element.parentElement !== null)
                following.add(element.parentElement)
        for (const [element, stop] of observed)
            if (!following.has(element)) {
                stop()
                observed.delete(element)
            }
        for (const element of following)
            if (!observed.has(element))
                observed.set(
                    element,
                    resized(element, () => schedule(true)),
                )
        update()
    }

    const run = (): void => {
        frame = 0
        if (!stale) return update()
        stale = false
        measure()
    }
    const schedule = (measuring: boolean): void => {
        if (measuring) stale = true
        if (frame === 0) frame = requestAnimationFrame(run)
    }

    const bind = (_host: Element): Disposer => {
        listening = new AbortController()
        // 51.173 — `items` changing measures again, a frame on.
        const stopItems = watch(() => {
            items()
            schedule(true)
        })
        // 51.177 — unbound, it follows nothing.
        return () => {
            stopItems()
            listening?.abort()
            listening = undefined
            if (frame !== 0) cancelAnimationFrame(frame)
            frame = 0
            for (const stop of observed.values()) stop()
            observed.clear()
            scroller = undefined
        }
    }

    // 51.175, 51.176 — a plain click lands the section as a link to it would, past any sticky header.
    const go = (item: Item, event: MouseEvent): void => {
        if (!isPlainClick(event)) return
        const key = keyOf(item)
        const element = document.getElementById(key)
        if (element === null) return
        event.preventDefault()
        const into = scroller ?? scrollerOf(element)
        const top = landingOf(element, offsetIn(into))
        history.replaceState(history.state, '', `#${key}`)
        into.scrollTo({ top, behavior: live(options.behavior) ?? 'auto' })
    }

    return sections({
        name: 'scroll-spy',
        host: { 'bind:element': bind, 'data-scroll-spy': 'host' },
        all: items,
        current,
        keyOf,
        // 51.174
        jump: (item) => ({ href: `#${keyOf(item)}` }),
        go,
        scrub: () => live(options.scrub),
    })
}
