// 51.145-51.151 — A LIST PUT IN ORDER BY HAND: a `listbox` over the items in the order put, its keys and
// its selection the listbox's own, with Alt and the arrows moving the items and a grip on each to drag
// them, each move read out through `announce`. The items moved are the selection where the item taken
// is in it, so several move as one. A drag measures every other item's middle once, as it begins, and
// is heard on the window, so moving reads no layout and a reorder moving the grip loses nothing.

import { announce } from './announce.ts'
import { type KeyOption, type LabelOption, writtenBy } from './itemKey.ts'
import { type Listbox, listbox } from './listbox.ts'
import { type Live, live } from './live.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import type { Picked } from './Selection.ts'
import { withPart } from './withPart.ts'

/** The items, how each is told apart and read out, their order, and what is selected. */
export type SortableListOptions<Item, Multiple extends boolean = false> = {
    /** The items; a function is read live. */
    items: Live<readonly Item[]>
    /** The keys of the items in the order put: a `Reactive` to read and set. Held by the parts, and handed back as `order`, where none is given. */
    order?: Reactive<readonly string[]>
    /** Whether many may be selected, to move as one. `false` by default. */
    multiple?: Multiple
    /** The keys selected, as a `listbox`'s are. Held by the parts, and handed back as `selected`, where none is given. */
    selected?: Reactive<Picked<string, Multiple>>
} & KeyOption<Item> &
    LabelOption<Item>

/** One item's parts: the item, a `listbox` option, and the grip that drags it. */
export type SortableItem = {
    /** The item's attributes: a `listbox` option, `data-grabbed` while it is dragged. */
    readonly item: Record<string, unknown>
    /** The grip's attributes: its drag, outside the tab order, since the list holds the keys. */
    readonly handle: Record<string, unknown>
}

/** The parts `sortableList` hands back: `<ol {...ranks.list}>`, `<li {...ranks.item(book).item}>`. */
export type SortableList<Item, Multiple extends boolean = false> = {
    /** The list's attributes: a `listbox`, in the tab order, its keys and Alt with the arrows. */
    readonly list: Record<string, unknown>
    /** An item's parts. */
    item(item: Item): SortableItem
    /** The items in the order put. */
    get sorted(): readonly Item[]
    /** The keys of the items in the order put; written, it puts them in that order. */
    readonly order: Reactive<readonly string[]>
    /** The keys selected, as the `listbox` holds them. */
    readonly selected: Reactive<Picked<string, Multiple>>
}

/** A listbox reordered by Alt and the arrows or by dragging a grip, the selection moving as one. */
export function sortableList<Item, Multiple extends boolean = false>(
    options: SortableListOptions<Item, Multiple>,
): SortableList<Item, Multiple> {
    const order = options.order ?? reactive<readonly string[]>([])
    const keyOf = (item: Item) => writtenBy(options.key, item)
    const labelOf = (item: Item) => writtenBy(options.label, item)
    const many = options.multiple === true
    const grabbed = reactive<ReadonlySet<string>>(new Set())
    // 51.145 — the order put, then any item it does not name, in the order given.
    const sorted = reactive((): Item[] => {
        const byKey = new Map<string, Item>()
        for (const item of live(options.items)) byKey.set(keyOf(item), item)
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
    // 51.150 — the listbox over the items as put.
    const choices: Listbox<Item, Multiple> = listbox({
        ...options,
        options: () => sorted(),
    })
    const keys = (): string[] => (sorted.peek() ?? []).map(keyOf)

    // 51.147 — the selection where the item taken is in it, else that item alone, in the order put.
    const moving = (taken: string): string[] => {
        if (!many) return [taken]
        const picked = new Set(
            (choices.selected.peek() as readonly string[] | undefined) ?? [],
        )
        return picked.has(taken)
            ? keys().filter((key) => picked.has(key))
            : [taken]
    }
    // The items placed together, `before` of the others ahead of them.
    const place = (block: readonly string[], before: number): void => {
        const held = new Set(block)
        const rest = keys().filter((key) => !held.has(key))
        rest.splice(Math.max(0, Math.min(rest.length, before)), 0, ...block)
        order.set(rest)
    }
    // How many of the others stand ahead of `key` as the list is now.
    const ahead = (key: string, block: readonly string[]): number => {
        const held = new Set(block)
        let count = 0
        for (const each of keys()) {
            if (each === key) return count
            if (!held.has(each)) count += 1
        }
        return count
    }
    // 51.149
    const say = (block: readonly string[], what: string): void => {
        const listed = keys()
        const first = listed.indexOf(block[0] as string) + 1
        if (block.length === 1) {
            const item = sorted.peek()?.find((each) => keyOf(each) === block[0])
            if (item !== undefined)
                announce(
                    `${labelOf(item)} ${what}, ${first} of ${listed.length}.`,
                )
            return
        }
        announce(
            `${block.length} items ${what}, ${first} to ${first + block.length - 1} of ${listed.length}.`,
        )
    }

    const elements = new Map<string, Element>()
    const parts = new Map<string, SortableItem>()
    const item = (entry: Item): SortableItem => {
        const key = keyOf(entry)
        let made = parts.get(key)
        if (made !== undefined) return made
        made = {
            item: withPart(withPart({}, choices.option(key)), {
                'data-sortable-list': 'item',
                get 'data-grabbed'() {
                    return grabbed().has(key) ? '' : undefined
                },
                'bind:element': (element: Element) => {
                    elements.set(key, element)
                    return () => {
                        if (elements.get(key) === element) elements.delete(key)
                    }
                },
            }),
            // 51.151
            handle: {
                'data-sortable-list': 'handle',
                'aria-hidden': 'true',
                // 51.146 — every other middle read before anything moves; the moves heard on the window.
                onpointerdown: (event: PointerEvent) => {
                    if (event.button !== 0) return
                    event.preventDefault()
                    choices.activate(key)
                    const block = moving(key)
                    const held = new Set(block)
                    const middles: number[] = []
                    for (const each of keys()) {
                        if (held.has(each)) continue
                        const box = elements.get(each)?.getBoundingClientRect()
                        if (box !== undefined)
                            middles.push(box.top + box.height / 2)
                    }
                    grabbed.set(held)
                    const moved = (move: PointerEvent): void => {
                        let before = 0
                        for (const middle of middles)
                            if (middle < move.clientY) before += 1
                        if (ahead(key, block) !== before) place(block, before)
                    }
                    const dropped = (): void => {
                        removeEventListener('pointermove', moved)
                        removeEventListener('pointerup', dropped)
                        removeEventListener('pointercancel', dropped)
                        grabbed.set(new Set())
                        say(block, 'moved')
                    }
                    addEventListener('pointermove', moved)
                    addEventListener('pointerup', dropped)
                    addEventListener('pointercancel', dropped)
                },
            },
        }
        parts.set(key, made)
        return made
    }

    return {
        // 51.150
        list: withPart(withPart({}, choices.listbox), {
            'data-sortable-list': 'list',
            tabindex: '0',
            get 'aria-activedescendant'() {
                return choices.activeId
            },
            // 51.148 — Alt with an arrow moves the items; every other key is the listbox's.
            onkeydown: (event: KeyboardEvent) => {
                const step =
                    event.altKey && event.key === 'ArrowUp'
                        ? -1
                        : event.altKey && event.key === 'ArrowDown'
                          ? 1
                          : 0
                if (step === 0) return choices.onkeydown(event)
                const taken = choices.active
                if (taken === undefined) return
                event.preventDefault()
                const block = moving(taken)
                const others = keys().length - block.length
                const before = Math.max(
                    0,
                    Math.min(others, ahead(block[0] as string, block) + step),
                )
                place(block, before)
                say(block, 'moved')
            },
        }),
        item,
        get sorted() {
            return sorted()
        },
        order,
        selected: choices.selected,
    }
}
