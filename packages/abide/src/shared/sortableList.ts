// 51.145-51.149 — A LIST PUT IN ORDER BY HAND: an item's handle dragged to a new place, or grabbed with
// Space and moved with the arrow keys, each step read out through `announce`, as parts an app spreads
// onto a list, its items and their handles. A drag measures every item's middle once, as it begins, and
// places the item among them by the pointer, so moving reads no layout.

import { announce } from './announce.ts'
import { type KeyOption, type LabelOption, writtenBy } from './itemKey.ts'
import { type Live, live } from './live.ts'
import { type Reactive, reactive } from './reactive/index.ts'

/** The items, how each is told apart and read out, and the order they are put in. */
export type SortableListOptions<Item> = {
    /** The items; a function is read live. */
    items: Live<readonly Item[]>
    /** The keys of the items in the order put: a `Reactive` to read and set. Held by the parts, and handed back as `order`, where none is given. */
    order?: Reactive<readonly string[]>
} & KeyOption<Item> &
    LabelOption<Item>

/** One item's parts: the item, and the handle that moves it. */
export type SortableItem = {
    /** The item's attributes: `data-grabbed` while it is moved. */
    readonly item: Record<string, unknown>
    /** The handle's attributes, its drag and its keys. */
    readonly handle: Record<string, unknown>
}

/** The parts `sortableList` hands back: `<ol {...ranks.list}>`, `<li {...ranks.item(book).item}>`. */
export type SortableList<Item> = {
    /** The list's attributes. */
    readonly list: Record<string, unknown>
    /** An item's parts. */
    item(item: Item): SortableItem
    /** The items in the order put. */
    get sorted(): readonly Item[]
    /** The keys of the items in the order put; written, it puts them in that order. */
    readonly order: Reactive<readonly string[]>
}

/** A list reordered by dragging a handle or by the keys, as parts to spread. */
export function sortableList<Item>(
    options: SortableListOptions<Item>,
): SortableList<Item> {
    const order = options.order ?? reactive<readonly string[]>([])
    const keyOf = (item: Item) => writtenBy(options.key, item)
    const labelOf = (item: Item) => writtenBy(options.label, item)
    const grabbed = reactive<string | undefined>(undefined)
    // 51.145 — the order put, then any item it does not name, in the order given.
    const sorted = reactive((): Item[] => {
        const items = live(options.items)
        const byKey = new Map<string, Item>()
        for (const item of items) byKey.set(keyOf(item), item)
        const placed: Item[] = []
        for (const key of order() ?? []) {
            const item = byKey.get(key)
            if (item === undefined) continue
            placed.push(item)
            byKey.delete(key)
        }
        for (const item of byKey.values()) placed.push(item)
        return placed
    })
    const keys = (): string[] => (sorted.peek() ?? []).map(keyOf)
    const say = (item: Item, what: string): void => {
        const at = keys().indexOf(keyOf(item)) + 1
        announce(`${labelOf(item)} ${what}, ${at} of ${keys().length}.`)
    }
    const place = (key: string, to: number): void => {
        const rest = keys().filter((each) => each !== key)
        rest.splice(Math.max(0, Math.min(rest.length, to)), 0, key)
        order.set(rest)
    }

    // A drag's start: the keys as they stood, and each other item's middle along the list.
    let middles: { key: string; middle: number }[] = []
    let before: string[] = []
    const elements = new Map<string, Element>()

    const parts = new Map<string, SortableItem>()
    const item = (entry: Item): SortableItem => {
        const key = keyOf(entry)
        let made = parts.get(key)
        if (made !== undefined) return made
        made = {
            item: {
                'data-sortable-list': 'item',
                get 'data-grabbed'() {
                    return grabbed() === key ? '' : undefined
                },
                'bind:element': (element: Element) => {
                    elements.set(key, element)
                    return () => {
                        if (elements.get(key) === element) elements.delete(key)
                    }
                },
            },
            handle: {
                type: 'button',
                'data-sortable-list': 'handle',
                'aria-label': `Move ${labelOf(entry)}`,
                // 51.149
                get 'aria-pressed'() {
                    return grabbed() === key ? 'true' : 'false'
                },
                // 51.146 — every middle read before anything moves. The moves are heard on the window,
                // not captured by the handle: the list reordering moves the handle's element, and a
                // browser lets go of a capture whose element leaves the document.
                onpointerdown: (event: PointerEvent) => {
                    if (event.button !== 0) return
                    event.preventDefault()
                    before = keys()
                    middles = []
                    for (const each of before) {
                        if (each === key) continue
                        const box = elements.get(each)?.getBoundingClientRect()
                        if (box !== undefined)
                            middles.push({
                                key: each,
                                middle: box.top + box.height / 2,
                            })
                    }
                    grabbed.set(key)
                    say(entry, 'grabbed')
                    const moved = (move: PointerEvent): void => {
                        let to = 0
                        for (const { middle } of middles)
                            if (middle < move.clientY) to += 1
                        if (keys().indexOf(key) !== to) place(key, to)
                    }
                    const dropped = (): void => {
                        removeEventListener('pointermove', moved)
                        removeEventListener('pointerup', dropped)
                        removeEventListener('pointercancel', dropped)
                        grabbed.set(undefined)
                        middles = []
                        say(entry, 'dropped')
                    }
                    addEventListener('pointermove', moved)
                    addEventListener('pointerup', dropped)
                    addEventListener('pointercancel', dropped)
                },
                // 51.147
                onkeydown: (event: KeyboardEvent) => {
                    const holding = grabbed.peek() === key
                    if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault()
                        if (holding) {
                            grabbed.set(undefined)
                            say(entry, 'dropped')
                        } else {
                            before = keys()
                            grabbed.set(key)
                            say(entry, 'grabbed')
                        }
                        return
                    }
                    if (!holding) return
                    // The handle keeps focus as its item moves: a moved element loses it.
                    const handle = event.currentTarget as HTMLElement
                    const refocus = (): void =>
                        queueMicrotask(() => handle.focus())
                    if (event.key === 'Escape') {
                        event.preventDefault()
                        order.set(before)
                        grabbed.set(undefined)
                        say(entry, 'put back')
                        refocus()
                        return
                    }
                    const step =
                        event.key === 'ArrowUp'
                            ? -1
                            : event.key === 'ArrowDown'
                              ? 1
                              : 0
                    if (step === 0) return
                    event.preventDefault()
                    place(key, keys().indexOf(key) + step)
                    say(entry, 'moved')
                    refocus()
                },
            },
        }
        parts.set(key, made)
        return made
    }

    return {
        list: { 'data-sortable-list': 'list' },
        item,
        get sorted() {
            return sorted()
        },
        order,
    }
}
