// 53.61-53.78, 53.99 — A SCROLL-SNAP CAROUSEL THAT RESTS ON A SELECTION, as parts an app spreads onto
// markup of its own: the scroller, an item per entry, a button either side, and one that plays and
// pauses. The snapping is the app's CSS; the parts scroll to the selection, follow which item a scroll
// aligns, go back on `reset`, and step on a timer where `autoplay` is given. The server writes the item
// it rests on as current, since a page arrives resting.

import { checkParts } from './checkParts.ts'
import { resized } from './element/resized.ts'
import { handFocus } from './handFocus.ts'
import {
    type ItemKey,
    type KeyOf,
    keyOfItem,
    type KeyOption,
    type LabelOption,
    listedKeys,
    listedOrFirst,
    writtenBy,
} from './itemKey.ts'
import { type Live, live } from './live.ts'
import { madeId } from './madeId.ts'
import { media } from './media.ts'
import { type Bindable, bindable } from './reactive/bindable.ts'
import { type Reactive, reactive, watch } from './reactive/index.ts'
import type { Disposer } from './reactive/watch.ts'
import { reactiveOver } from './reactiveOver.ts'
import { toggle } from './toggle.ts'
import { withPart } from './withPart.ts'

/** The items, how each is told apart and named, the one the carousel rests on, and how it scrolls. */
export type CarouselOptions<Item, Key extends ItemKey = KeyOf<Item>> = {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
    /** The items, in the order they render; a function is read live. */
    items: Live<readonly Item[]>
    /** The key of the item the carousel rests on, where the app holds it: a `Reactive` to read and set. Held by the parts, and handed back as `selected`, where none is given. A key no item has rests on the first. */
    selected?: Bindable<Key | undefined> | undefined
    /** Which edge of an item, or its center, lines up with the same place in the scroller: `'center'` by default, as `scroll-snap-align` names it. A function is read live. */
    align?: Live<'start' | 'center' | 'end'> | undefined
    /** How `scrollTo`, `reset`, `previous` and `next` scroll. `'smooth'` by default; a function is read live. */
    behavior?: Live<'auto' | 'smooth'> | undefined
    /** Whether `next` at the last item goes to the first, and `previous` at the first to the last. `false` by default; a function is read live. */
    loop?: Live<boolean> | undefined
    /** The milliseconds between steps while it plays; none, and it never steps by itself. A function is read live. */
    autoplay?: Live<number | undefined> | undefined
    /** Whether it is playing: a `Reactive` to read and set. Held by the parts, and handed back as `playing`, where none is given — starting true where `autoplay` is given. */
    playing?: Bindable<boolean> | undefined
} & KeyOption<Item, Key> &
    LabelOption<Item>

/** The parts `carousel` hands back: `<ul {...view.host}>`, `<li {...view.item(item)}>`. */
export type Carousel<Item, Key extends ItemKey = KeyOf<Item>> = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The scroller's part: what rests it on the selection and follows what a scroll aligns. */
    readonly host: Record<string, unknown>
    /** One item's part, carrying `data-current` and `data-selected` while each holds. */
    item(item: Item): Record<string, unknown>
    /** The button's part scrolling to the item before the current one, disabled at the first unless it loops. */
    readonly previous: Record<string, unknown>
    /** The button's part scrolling to the item after the current one, disabled at the last unless it loops. */
    readonly next: Record<string, unknown>
    /** The play button: a `toggle`'s, pressed while it plays. */
    readonly play: Record<string, unknown>
    /** Whether it is playing; written, it plays or pauses. */
    readonly playing: Reactive<boolean>
    /** The key of the item aligned in the scroller. */
    get current(): Key | undefined
    /** The key of the item the carousel rests on, read and set. */
    readonly selected: Reactive<Key | undefined>
    /** Scrolls the item a key names to its aligned place in the scroller. */
    scrollTo(key: Key): void
    /** Scrolls back to the item the carousel rests on. */
    reset(): void
}

// What 53.66 reads off a snap event: the element the scroller snaps to, on either axis.
type SnapEvent = Event & {
    snapTargetInline?: Element | null | undefined
    snapTargetBlock?: Element | null | undefined
}

type Align = 'start' | 'center' | 'end'

// 53.99 — the point `align` names along a span: its start, its middle or its end.
const along = (where: Align, start: number, size: number): number =>
    where === 'start'
        ? start
        : where === 'end'
          ? start + size
          : start + size / 2

// `scroll-padding` reads `auto` where none is set, which is no padding.
const padding = (value: string): number => Number.parseFloat(value) || 0

// 53.99 — where an item is aligned to in the scroller on each axis, in viewport pixels, and how far it
// scrolls each way. The snapport is the padding box less `scroll-padding`, and in a right-to-left
// scroller the inline start is the right edge and `scrollLeft` runs negative.
type Snapport = {
    x: number
    y: number
    inline: Align
    block: Align
    leftMin: number
    leftMax: number
    topMax: number
}

function snapportOf(host: Element, align: Align): Snapport {
    const outer = host.getBoundingClientRect()
    const style = getComputedStyle(host)
    const rtl = style.direction === 'rtl'
    const inline: Align =
        rtl && align !== 'center'
            ? align === 'start'
                ? 'end'
                : 'start'
            : align
    const left = padding(style.scrollPaddingLeft)
    const top = padding(style.scrollPaddingTop)
    const across = host.scrollWidth - host.clientWidth
    return {
        x: along(
            inline,
            outer.left + host.clientLeft + left,
            host.clientWidth - left - padding(style.scrollPaddingRight),
        ),
        y: along(
            align,
            outer.top + host.clientTop + top,
            host.clientHeight - top - padding(style.scrollPaddingBottom),
        ),
        inline,
        block: align,
        leftMin: rtl ? -across : 0,
        leftMax: rtl ? 0 : across,
        topMax: host.scrollHeight - host.clientHeight,
    }
}

const clamp = (value: number, least: number, most: number): number =>
    value < least ? least : value > most ? most : value

// 53.99 — where a scroll aligning an item leaves the scroller: short of it where the scroller ends first.
function landing(
    host: Element,
    port: Snapport,
    item: DOMRect,
): { left: number; top: number } {
    return {
        left: clamp(
            host.scrollLeft +
                along(port.inline, item.left, item.width) -
                port.x,
            port.leftMin,
            Math.max(port.leftMin, port.leftMax),
        ),
        top: clamp(
            host.scrollTop + along(port.block, item.top, item.height) - port.y,
            0,
            Math.max(0, port.topMax),
        ),
    }
}

/** A scroll-snap carousel resting on a selection, as parts to spread. */
export function carousel<Item, Key extends ItemKey = KeyOf<Item>>(
    options: CarouselOptions<Item, Key>,
): Carousel<Item, Key> {
    // 49.11 — read where they are used. Keys are held as `ItemKey` inside, and as `Key` at the surface.
    const keyOf = (item: Item): ItemKey =>
        keyOfItem(options.key as ((item: Item) => Key) | undefined, item)
    const labelOf = (item: Item) => writtenBy(options.label, item)
    const behavior = () => live(options.behavior) ?? 'smooth'
    const align = () => live(options.align) ?? 'center'
    const keys = listedKeys(options.items, keyOf)
    const selected = (bindable(options.selected) ??
        reactive<Key | undefined>(undefined)) as Reactive<ItemKey | undefined>
    // 53.61 — a key no item has rests on the first.
    const resting = reactive((): ItemKey | undefined =>
        listedOrFirst(keys.get(), selected.get()),
    )
    // 53.63 — what a scroll writes, and replaced by the resting item whenever that moves.
    const current = reactive((): ItemKey | undefined => resting.get())
    const base = options.id ?? madeId('carousel')
    if (process.env.NODE_ENV !== 'production') checkParts('carousel', base)

    const elements = new Map<ItemKey, Element>()
    // Bumped as an item's element comes and goes, so the resting element is looked up again.
    let bindings = 0
    const bound = reactive(bindings)
    const restingElement = reactive((): Element | undefined => {
        bound.get()
        const key = resting.get()
        return key === undefined ? undefined : elements.get(key)
    })
    let scroller: Element | undefined
    // Whether the bound scroller has a box: none bound, or one in a closed dialog, never rotates.
    const shown = reactive(false)
    // The key a scroll the parts made is on its way to: what the scroll passes on the way is not
    // current, until it arrives or the scrolling ends.
    let heading: ItemKey | undefined

    // 53.67 — where a scroll to each item leaves the scroller, to the pixel, measured as the layout
    // changes rather than as a button reads it: items the scroller cannot tell apart, since it ends
    // before it aligns them, share one. None while there is no scroller with a box to measure.
    const stops = reactive<ReadonlyMap<ItemKey, string> | undefined>(undefined)
    let measuring = 0
    const measure = (): void => {
        measuring = 0
        const host = scroller
        const box = host?.getBoundingClientRect()
        if (
            host === undefined ||
            box === undefined ||
            (box.width === 0 && box.height === 0)
        ) {
            if (stops.peek() !== undefined) stops.set(undefined)
            return
        }
        const port = snapportOf(host, align())
        const measured = new Map<ItemKey, string>()
        for (const [key, item] of elements) {
            const to = landing(host, port, item.getBoundingClientRect())
            measured.set(key, `${Math.round(to.left)} ${Math.round(to.top)}`)
        }
        // The old map kept where nothing moved, so a button reading it does not wake.
        const before = stops.peek()
        if (before !== undefined && before.size === measured.size) {
            let same = true
            for (const [key, stop] of measured)
                if (before.get(key) !== stop) {
                    same = false
                    break
                }
            if (same) return
        }
        stops.set(measured)
    }
    const remeasure = (): void => {
        if (scroller !== undefined && measuring === 0)
            measuring = requestAnimationFrame(measure)
    }
    watch(() => {
        align()
        remeasure()
    })
    // Whether a scroll to either leaves the scroller in the same place.
    const together = (
        one: ItemKey,
        other: ItemKey | undefined,
        measured: ReadonlyMap<ItemKey, string> | undefined,
    ): boolean => {
        if (one === other) return true
        if (other === undefined || measured === undefined) return false
        const stop = measured.get(one)
        return stop !== undefined && stop === measured.get(other)
    }

    // 53.99 — every rect read before the one write.
    const alignTo = (
        key: ItemKey,
        target: Element,
        how: ScrollBehavior,
    ): void => {
        if (scroller === undefined) return
        const to = landing(
            scroller,
            snapportOf(scroller, align()),
            target.getBoundingClientRect(),
        )
        // An instant scroll lands before anything measures, and 53.101 — one going nowhere, already there
        // or the scroller ending short of it, passes nothing and ends nothing.
        if (
            how !== 'instant' &&
            (Math.round(to.left) !== Math.round(scroller.scrollLeft) ||
                Math.round(to.top) !== Math.round(scroller.scrollTop))
        )
            heading = key
        // To an offset rather than by one: webkit resolves a smooth `scrollBy` made while another is
        // on its way against neither where the scroll is nor where it is going, and a quick second
        // click of `previous` landed ~26px off its item.
        scroller.scrollTo({ left: to.left, top: to.top, behavior: how })
    }

    function scrollTo(key: ItemKey): void {
        current.set(key)
        const target = elements.get(key)
        if (target !== undefined) alignTo(key, target, behavior())
    }

    function reset(): void {
        const key = resting.peek()
        if (key !== undefined) scrollTo(key)
    }

    // 53.64 — the item whose aligned point is nearest where the scroller aligns one.
    const nearest = (element: Element): ItemKey | undefined => {
        const port = snapportOf(element, align())
        let closest: ItemKey | undefined
        let distance = Number.POSITIVE_INFINITY
        for (const [key, item] of elements) {
            const inner = item.getBoundingClientRect()
            const across = along(port.inline, inner.left, inner.width) - port.x
            const down = along(port.block, inner.top, inner.height) - port.y
            const apart = across * across + down * down
            if (apart < distance) {
                distance = apart
                closest = key
            }
        }
        return closest
    }

    // 53.66 — the item the snap target is, holds, or sits inside.
    const snapped = (target: Element): ItemKey | undefined => {
        for (const [key, item] of elements)
            if (
                item === target ||
                item.contains(target) ||
                target.contains(item)
            )
                return key
        return undefined
    }

    // 53.65 — what a scroll passes on its way to where the parts scrolled is not current; 53.100 — an
    // item left where the current one leaves the scroller does not replace it.
    const arrive = (key: ItemKey | undefined): void => {
        if (key === undefined) return
        const measured = stops.peek()
        if (heading !== undefined) {
            if (!together(key, heading, measured)) return
            const arrived = heading
            heading = undefined
            if (arrived !== current.peek()) current.set(arrived)
            return
        }
        if (!together(key, current.peek(), measured)) current.set(key)
    }

    const bindHost = (element: Element): Disposer => {
        scroller = element
        // A browser reporting snaps is read from them alone once one arrives; until then, and in one
        // that reports none, a scroll is measured once a frame.
        let snapping = false
        let frame = 0
        const measure = (): void => {
            frame = 0
            arrive(nearest(element))
        }
        const scrolled = (): void => {
            if (snapping || frame !== 0) return
            frame = requestAnimationFrame(measure)
        }
        const snap = (event: Event): void => {
            snapping = true
            if (frame !== 0) cancelAnimationFrame(frame)
            frame = 0
            const { snapTargetInline, snapTargetBlock } = event as SnapEvent
            const target = snapTargetInline ?? snapTargetBlock
            arrive(target ? snapped(target) : undefined)
        }
        const ended = (): void => {
            heading = undefined
        }
        element.addEventListener('scroll', scrolled, { passive: true })
        element.addEventListener('scrollsnapchanging', snap)
        element.addEventListener('scrollsnapchange', snap)
        element.addEventListener('scrollend', ended)
        // 53.62 — a host with no box (in a closed dialog, a hidden panel) measures every rect as 0 and
        // scrolls nowhere, so it rests again, at once, the moment it gets one.
        const box = element.getBoundingClientRect()
        let boxed = box.width > 0 || box.height > 0
        shown.set(boxed)
        const unresize = resized(element, (entry) => {
            const showing =
                entry.contentRect.width > 0 || entry.contentRect.height > 0
            if (showing && !boxed) {
                const key = resting.peek()
                const target = restingElement.peek()
                if (key !== undefined && target !== undefined) {
                    current.set(key)
                    alignTo(key, target, 'instant')
                }
            }
            boxed = showing
            shown.set(showing)
            remeasure()
        })
        // 53.62 — at once when bound, as `behavior` names after.
        let rested = false
        const stop = watch(() => {
            const target = restingElement.get()
            if (target === undefined) return
            alignTo(
                resting.peek() as ItemKey,
                target,
                rested ? behavior() : 'instant',
            )
            rested = true
        })
        remeasure()
        return () => {
            stop()
            unresize()
            if (frame !== 0) cancelAnimationFrame(frame)
            if (measuring !== 0) cancelAnimationFrame(measuring)
            measuring = 0
            element.removeEventListener('scroll', scrolled)
            element.removeEventListener('scrollsnapchanging', snap)
            element.removeEventListener('scrollsnapchange', snap)
            element.removeEventListener('scrollend', ended)
            if (scroller === element) {
                scroller = undefined
                shown.set(false)
                stops.set(undefined)
            }
        }
    }

    // 53.67 — the first key `step` reaches from the current one that a scroll to would move the
    // scroller, past an end to the other where `loop` holds, and never the current one itself.
    const beside = (step: number): ItemKey | undefined => {
        const listed = keys.get()
        const from = current.get()
        const at = listed.indexOf(from as ItemKey)
        if (at === -1) return undefined
        const measured = stops.get()
        const loops = live(options.loop) === true
        let to = at
        for (let left = listed.length - 1; left > 0; left--) {
            to += step
            if (to < 0 || to >= listed.length) {
                if (!loops) return undefined
                to = (to + listed.length) % listed.length
            }
            const key = listed[to] as ItemKey
            if (!together(key, from, measured)) return key
        }
        return undefined
    }

    // 53.74 — what the pointer is over and what focus is inside, by part.
    const holders = new Set<string>()
    const held = reactive(false)
    const hold = (holder: string, on: boolean): void => {
        if (on) holders.add(holder)
        else holders.delete(holder)
        held.set(holders.size > 0)
    }
    const holding = (part: string) => ({
        onpointerenter: () => hold(`${part} pointer`, true),
        onpointerleave: () => hold(`${part} pointer`, false),
        onfocusin: () => hold(`${part} focus`, true),
        onfocusout: (event: FocusEvent) => {
            const to = event.relatedTarget as Node | null
            if (!(event.currentTarget as Element).contains(to))
                hold(`${part} focus`, false)
        },
    })

    const stepper = (part: string, step: number) => ({
        ...holding(part),
        type: 'button',
        'data-carousel': part,
        'aria-controls': base,
        get disabled() {
            return beside(step) === undefined
        },
        onclick: (event?: MouseEvent) => {
            const key = beside(step)
            if (key === undefined) return
            scrollTo(key)
            // 49.15 — at the end, focus goes to the button stepping the other way.
            const other = step < 0 ? 'next' : 'previous'
            handFocus(event?.currentTarget, beside(step) === undefined, () =>
                globalThis.document?.querySelector<HTMLElement>(
                    `[data-carousel="${other}"][aria-controls="${CSS.escape(base)}"]`,
                ),
            )
        },
    })

    // 53.75
    const playing =
        bindable(options.playing) ??
        reactive(live(options.autoplay) !== undefined)
    // 53.76 — the hydrating page reads the server's `false` (23.31), so this fires once it settles too.
    const reduced = media('(prefers-reduced-motion: reduce)')
    watch(() => {
        if (reduced.get()) playing.set(false)
    })
    // 53.73, 53.74
    const rotating = reactive(
        (): boolean =>
            playing.get() &&
            live(options.autoplay) !== undefined &&
            shown.get() &&
            !held.get(),
    )
    // 53.71, 53.72 — one timer per item current, so a step by hand or a swipe starts the count again.
    watch(() => {
        const every = live(options.autoplay)
        if (!rotating.get() || every === undefined) return
        current.get()
        const timer = setTimeout(() => {
            const key = beside(1)
            if (key === undefined) playing.set(false)
            else scrollTo(key)
        }, every)
        return () => clearTimeout(timer)
    })

    // 53.77 — playing from the end starts over.
    const pressed = reactiveOver(
        () => playing.get(),
        (on: boolean) => {
            const first =
                on && beside(1) === undefined ? keys.get()[0] : undefined
            const refused = playing.set(on)
            if (refused === undefined && first !== undefined) scrollTo(first)
            return refused
        },
    )
    const play = withPart({}, toggle({ pressed }).button, {
        'data-carousel': 'play',
        'aria-controls': base,
        get 'aria-label'() {
            return playing.get() ? 'Pause' : 'Play'
        },
    })

    return {
        id: base,
        host: {
            ...holding('host'),
            id: base,
            role: 'region',
            'aria-roledescription': 'carousel',
            'data-carousel': 'host',
            // 53.78
            get 'aria-live'() {
                return rotating.get() ? 'off' : undefined
            },
            'bind:element': bindHost,
        },
        item: (item: Item) => {
            const key = keyOf(item)
            return {
                role: 'group',
                'aria-roledescription': 'slide',
                'aria-label': labelOf(item),
                'data-carousel': 'item',
                get 'data-current'() {
                    return current.get() === key ? '' : undefined
                },
                get 'data-selected'() {
                    return selected.get() === key ? '' : undefined
                },
                'bind:element': (element: Element): Disposer => {
                    elements.set(key, element)
                    bound.set(++bindings)
                    // An item's size moves every stop after it.
                    const unresize = resized(element, remeasure)
                    return () => {
                        unresize()
                        if (elements.get(key) !== element) return
                        elements.delete(key)
                        bound.set(++bindings)
                        remeasure()
                    }
                },
            }
        },
        previous: stepper('previous', -1),
        next: stepper('next', 1),
        play,
        playing,
        get current() {
            return current.get() as Key | undefined
        },
        selected: selected as Reactive<Key | undefined>,
        scrollTo,
        reset,
    }
}
