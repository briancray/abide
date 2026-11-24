// 53.61-53.78 — A SCROLL-SNAP CAROUSEL THAT RESTS ON A SELECTION, as parts an app spreads onto markup of
// its own: the scroller, an item per entry, a button either side, and one that plays and pauses. The
// snapping is the app's CSS; the parts scroll to the selection, follow which item a scroll centers, go
// back on `reset`, and step on a timer where `autoplay` is given. The server writes the item it rests on
// as centered, since a page arrives resting.

import { checkParts } from './checkParts.ts'
import { handFocus } from './handFocus.ts'
import {
    keyOfItem,
    type KeyOption,
    type LabelOption,
    writtenBy,
} from './itemKey.ts'
import { type Live, live } from './live.ts'
import { media } from './media.ts'
import { resized } from './observe/resized.ts'
import { randomToken } from './randomToken.ts'
import { memo, type Reactive, reactive, watch } from './reactive/index.ts'
import type { Disposer } from './reactive/watch.ts'
import { reactiveOver } from './reactiveOver.ts'
import { toggle } from './toggle.ts'
import { withPart } from './withPart.ts'

/** The items, how each is told apart and named, the one the carousel rests on, and how it scrolls. */
export type CarouselOptions<Item> = {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string
    /** The items, in the order they render; a function is read live. */
    items: Live<readonly Item[]>
    /** The key of the item the carousel rests on, where the app holds it: a `Reactive` to read and set. Held by the parts, and handed back as `selected`, where none is given. A key no item has rests on the first. */
    selected?: Reactive<string | undefined>
    /** How `scrollTo`, `reset`, `previous` and `next` scroll. `'smooth'` by default; a function is read live. */
    behavior?: Live<'auto' | 'smooth'>
    /** Whether `next` at the last item goes to the first, and `previous` at the first to the last. `false` by default; a function is read live. */
    loop?: Live<boolean>
    /** The milliseconds between steps while it plays; none, and it never steps by itself. A function is read live. */
    autoplay?: Live<number | undefined>
    /** Whether it is playing: a `Reactive` to read and set. Held by the parts, and handed back as `playing`, where none is given — starting true where `autoplay` is given. */
    playing?: Reactive<boolean>
} & KeyOption<Item> &
    LabelOption<Item>

/** The parts `carousel` hands back: `<ul {...view.host}>`, `<li {...view.item(item)}>`. */
export type Carousel<Item> = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The scroller's part: what rests it on the selection and follows what a scroll centers. */
    readonly host: Record<string, unknown>
    /** One item's part, carrying `data-centered` and `data-selected` while each holds. */
    item(item: Item): Record<string, unknown>
    /** The button's part scrolling to the item before the centered one, disabled at the first unless it loops. */
    readonly previous: Record<string, unknown>
    /** The button's part scrolling to the item after the centered one, disabled at the last unless it loops. */
    readonly next: Record<string, unknown>
    /** The play button: a `toggle`'s, pressed while it plays. */
    readonly play: Record<string, unknown>
    /** Whether it is playing; written, it plays or pauses. */
    readonly playing: Reactive<boolean>
    /** The key of the item centered in the scroller. */
    get centered(): string | undefined
    /** The key of the item the carousel rests on, read and set. */
    readonly selected: Reactive<string | undefined>
    /** Scrolls the item a key names to the scroller's center. */
    scrollTo(key: string): void
    /** Scrolls back to the item the carousel rests on. */
    reset(): void
}

// What 53.66 reads off a snap event: the element the scroller snaps to, on either axis.
type SnapEvent = Event & {
    snapTargetInline?: Element | null
    snapTargetBlock?: Element | null
}

/** A scroll-snap carousel resting on a selection, as parts to spread. */
export function carousel<Item>(options: CarouselOptions<Item>): Carousel<Item> {
    // 49.11 — read where they are used.
    const keyOf = (item: Item) => keyOfItem(options.key, item)
    const labelOf = (item: Item) => writtenBy(options.label, item)
    const behavior = () => live(options.behavior) ?? 'smooth'
    const keys = memo((): readonly string[] => {
        const items = live(options.items)
        const written: string[] = []
        for (const item of items) written.push(keyOf(item))
        return written
    })
    const selected = options.selected ?? reactive<string | undefined>(undefined)
    // 53.61 — a key no item has rests on the first.
    const resting = memo((): string | undefined => {
        const listed = keys()
        const wanted = selected()
        return wanted !== undefined && listed.includes(wanted)
            ? wanted
            : listed[0]
    })
    // 53.63 — what a scroll writes, and replaced by the resting item whenever that moves.
    const centered = memo((): string | undefined => resting())
    const base = options.id ?? `carousel-${randomToken(4, 'hex')}`
    if (process.env.NODE_ENV !== 'production') checkParts('carousel', base)

    const elements = new Map<string, Element>()
    // Bumped as an item's element comes and goes, so the resting element is looked up again.
    let bindings = 0
    const bound = reactive(bindings)
    const restingElement = memo((): Element | undefined => {
        bound()
        const key = resting()
        return key === undefined ? undefined : elements.get(key)
    })
    let scroller: Element | undefined
    // Whether the bound scroller has a box: none bound, or one in a closed dialog, never rotates.
    const shown = reactive(false)
    // The key a scroll the parts made is on its way to: what the scroll passes on the way is not
    // centered, until it arrives or the scrolling ends.
    let heading: string | undefined

    // Every rect read before the one write.
    const center = (
        key: string,
        target: Element,
        how: ScrollBehavior,
    ): void => {
        if (scroller === undefined) return
        const outer = scroller.getBoundingClientRect()
        const inner = target.getBoundingClientRect()
        const left =
            inner.left + inner.width / 2 - (outer.left + outer.width / 2)
        const top =
            inner.top + inner.height / 2 - (outer.top + outer.height / 2)
        // An instant scroll lands before anything measures, and one going nowhere passes nothing.
        if (
            how !== 'instant' &&
            (Math.round(left) !== 0 || Math.round(top) !== 0)
        )
            heading = key
        // To an offset rather than by one: webkit resolves a smooth `scrollBy` made while another is
        // on its way against neither where the scroll is nor where it is going, and a quick second
        // click of `previous` landed ~26px off its item.
        scroller.scrollTo({
            left: scroller.scrollLeft + left,
            top: scroller.scrollTop + top,
            behavior: how,
        })
    }

    function scrollTo(key: string): void {
        centered.set(key)
        const target = elements.get(key)
        if (target !== undefined) center(key, target, behavior())
    }

    function reset(): void {
        const key = resting.peek()
        if (key !== undefined) scrollTo(key)
    }

    // 53.64 — the item whose center is nearest the scroller's.
    const nearest = (element: Element): string | undefined => {
        const outer = element.getBoundingClientRect()
        const x = outer.left + outer.width / 2
        const y = outer.top + outer.height / 2
        let closest: string | undefined
        let distance = Number.POSITIVE_INFINITY
        for (const [key, item] of elements) {
            const inner = item.getBoundingClientRect()
            const across = inner.left + inner.width / 2 - x
            const down = inner.top + inner.height / 2 - y
            const apart = across * across + down * down
            if (apart < distance) {
                distance = apart
                closest = key
            }
        }
        return closest
    }

    // 53.66 — the item the snap target is, holds, or sits inside.
    const snapped = (target: Element): string | undefined => {
        for (const [key, item] of elements)
            if (
                item === target ||
                item.contains(target) ||
                target.contains(item)
            )
                return key
        return undefined
    }

    // 53.65 — what a scroll passes on its way to where the parts scrolled is not centered.
    const arrive = (key: string | undefined): void => {
        if (key === undefined) return
        if (heading !== undefined) {
            if (key !== heading) return
            heading = undefined
        }
        if (key !== centered.peek()) centered.set(key)
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
                    centered.set(key)
                    center(key, target, 'instant')
                }
            }
            boxed = showing
            shown.set(showing)
        })
        // 53.62 — at once when bound, as `behavior` names after.
        let rested = false
        const stop = watch(() => {
            const target = restingElement()
            if (target === undefined) return
            center(
                resting.peek() as string,
                target,
                rested ? behavior() : 'instant',
            )
            rested = true
        })
        return () => {
            stop()
            unresize()
            if (frame !== 0) cancelAnimationFrame(frame)
            element.removeEventListener('scroll', scrolled)
            element.removeEventListener('scrollsnapchanging', snap)
            element.removeEventListener('scrollsnapchange', snap)
            element.removeEventListener('scrollend', ended)
            if (scroller === element) {
                scroller = undefined
                shown.set(false)
            }
        }
    }

    // 53.67 — the key `step` places from the centered one, where there is one, past an end to the
    // other where `loop` holds, and never the centered one itself.
    const beside = (step: number): string | undefined => {
        const listed = keys()
        const at = listed.indexOf(centered() as string)
        if (at === -1 || listed.length < 2) return undefined
        const to = at + step
        if (to >= 0 && to < listed.length) return listed[to]
        return live(options.loop) === true
            ? listed[(to + listed.length) % listed.length]
            : undefined
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
        options.playing ?? reactive(live(options.autoplay) !== undefined)
    // 53.76 — the hydrating page reads the server's `false` (23.31), so this fires once it settles too.
    const reduced = media('(prefers-reduced-motion: reduce)')
    watch(() => {
        if (reduced()) playing.set(false)
    })
    // 53.73, 53.74
    const rotating = memo(
        (): boolean =>
            playing() &&
            live(options.autoplay) !== undefined &&
            shown() &&
            !held(),
    )
    // 53.71, 53.72 — one timer per item centered, so a step by hand or a swipe starts the count again.
    watch(() => {
        const every = live(options.autoplay)
        if (!rotating() || every === undefined) return
        centered()
        const timer = setTimeout(() => {
            const key = beside(1)
            if (key === undefined) playing.set(false)
            else scrollTo(key)
        }, every)
        return () => clearTimeout(timer)
    })

    // 53.77 — playing from the end starts over.
    const pressed = reactiveOver(
        () => playing(),
        (on: boolean) => {
            const first = keys()[0]
            if (on && beside(1) === undefined && first !== undefined)
                scrollTo(first)
            playing.set(on)
        },
    )
    const play = withPart(withPart({}, toggle({ pressed }).button), {
        'data-carousel': 'play',
        'aria-controls': base,
        get 'aria-label'() {
            return playing() ? 'Pause' : 'Play'
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
                return rotating() ? 'off' : undefined
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
                get 'data-centered'() {
                    return centered() === key ? '' : undefined
                },
                get 'data-selected'() {
                    return selected() === key ? '' : undefined
                },
                'bind:element': (element: Element): Disposer => {
                    elements.set(key, element)
                    bound.set(++bindings)
                    return () => {
                        if (elements.get(key) !== element) return
                        elements.delete(key)
                        bound.set(++bindings)
                    }
                },
            }
        },
        previous: stepper('previous', -1),
        next: stepper('next', 1),
        play,
        playing,
        get centered() {
            return centered()
        },
        selected,
        scrollTo,
        reset,
    }
}
