// 51.145-51.151, 51.178-51.183 — A LIST PUT IN ORDER BY HAND: a `listbox` over the items in the order
// put, its keys and its selection the listbox's own, with Alt and the arrows moving the items and a grip
// on each to drag them, each move read out through `announce`. The items moved are the selection where
// the item taken is in it, so several move as one. Lists sharing a `group` take each other's items. A
// drag measures every list's box and every other item's middle once, as it begins, and is heard on the
// window, so moving reads no layout and a reorder moving the grip loses nothing.

import { announce } from './announce.ts'
import {
    keyOfItem,
    type KeyOption,
    type LabelOption,
    writtenBy,
} from './itemKey.ts'
import { type Listbox, listbox } from './listbox.ts'
import { type Live, live } from './live.ts'
import { computed, type Reactive, reactive } from './reactive/index.ts'
import { inGroup, join } from './register.ts'
import type { Picked } from './Selection.ts'
import { withPart } from './withPart.ts'

/** The items, how each is told apart and read out, their order, what is selected, and the lists it trades items with. */
export type SortableListOptions<Item, Multiple extends boolean = false> = {
    /** The items; a function is read live. */
    items: Live<readonly Item[]>
    /** The keys of the items in the order put: a `Reactive` to read and set. Held by the parts, and handed back as `order`, where none is given. */
    order?: Reactive<readonly string[]> | undefined
    /** Whether many may be selected, to move as one. `false` by default. */
    multiple?: Multiple | undefined
    /** The keys selected, as a `listbox`'s are. Held by the parts, and handed back as `selected`, where none is given. */
    selected?: Reactive<Picked<string, Multiple>> | undefined
    /** The lists sharing this name take each other's items, by a grip dragged or by Alt with ArrowLeft and ArrowRight. A function is read live. */
    group?: Live<string | undefined> | undefined
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

// 51.178-51.183 — every list standing, so a group finds its lists: one list per request on a server, as
// every `reactive` without `global` is (11.32), and a list is a member for as long as its setup stands.
type Member = {
    group(): string | undefined
    /** The element its `list` part is spread on, whose place in the document orders its group. */
    element(): Element | null
    readonly order: Reactive<readonly string[]>
    /** The item of `key` among its own `items`. */
    find(key: string): unknown
    /** Places `block` after `before` of its items, answering whether the write landed. */
    place(block: readonly string[], before: number): boolean
    /** Takes `block` out of its order and its selection, handing back those of them that were selected — `undefined`, and nothing changed, where the order's write is refused. */
    leave(block: readonly string[]): string[] | undefined
    /** Makes the first of `block`, placed here, active, and `picked` selected. */
    enter(block: readonly string[], picked: readonly string[]): void
    grab(held: ReadonlySet<string>): void
    /** The middle of each of its items not `held`, top to bottom, as they stand. */
    middles(held: ReadonlySet<string>): number[]
    say(block: readonly string[], what: string): void
}
const members = reactive<readonly Member[]>([])
const NONE: ReadonlySet<string> = new Set()

// 51.178 — out of one list's order and into the other's, the selection going with them (51.182).
// 49.19 — both orders' writes land or neither: the target's first, put back where the source's is refused.
function carry(
    from: Member,
    to: Member,
    block: readonly string[],
    before: number,
): boolean {
    const was = to.order.peek() ?? []
    if (!to.place(block, before)) return false
    const selected = from.leave(block)
    if (selected === undefined) {
        to.order.set(was)
        return false
    }
    to.enter(block, selected)
    return true
}

// 51.183 — a list's name as a screen reader reads it: its `aria-label`, else the text it is labelled by.
function nameOf(list: Element | null): string {
    const label = list?.getAttribute('aria-label')
    if (label) return label
    let name = ''
    for (const id of list?.getAttribute('aria-labelledby')?.split(' ') ?? []) {
        const text = document.getElementById(id)?.textContent?.trim()
        if (text) name = name === '' ? text : `${name} ${text}`
    }
    return name === '' ? 'another list' : name
}

/** A listbox reordered by Alt and the arrows or by dragging a grip, the selection moving as one. */
export function sortableList<Item, Multiple extends boolean = false>(
    options: SortableListOptions<Item, Multiple>,
): SortableList<Item, Multiple> {
    const order = options.order ?? reactive<readonly string[]>([])
    const keyOf = (item: Item) => keyOfItem(options.key, item)
    const labelOf = (item: Item) => writtenBy(options.label, item)
    const many = options.multiple === true
    const grabbed = reactive<ReadonlySet<string>>(NONE)
    const group = (): string | undefined => live(options.group)
    // 51.145, 51.179 — the order put, then any item it does not name, in the order given; in a group, a
    // key it names is found among another list's items too, and an item another list names is that
    // list's.
    const sorted = computed((): Item[] => {
        const byKey = new Map<string, Item>()
        for (const item of live(options.items)) byKey.set(keyOf(item), item)
        const named = group()
        const mates: Member[] = []
        if (named !== undefined)
            for (const member of members())
                if (member !== self && member.group() === named)
                    mates.push(member)
        const placed: Item[] = []
        for (const key of order() ?? []) {
            let item = byKey.get(key)
            if (item !== undefined) byKey.delete(key)
            else
                for (const mate of mates) {
                    item = mate.find(key) as Item | undefined
                    if (item !== undefined) break
                }
            if (item !== undefined) placed.push(item)
        }
        if (byKey.size === 0 || mates.length === 0) {
            for (const item of byKey.values()) placed.push(item)
            return placed
        }
        const elsewhere = new Set<string>()
        for (const mate of mates)
            for (const key of mate.order() ?? []) elsewhere.add(key)
        for (const [key, item] of byKey)
            if (!elsewhere.has(key)) placed.push(item)
        return placed
    })
    // 51.150 — the listbox over the items as put.
    const choices: Listbox<Item, Multiple> = listbox({
        ...options,
        options: () => sorted(),
    })
    const keys = (): string[] => (sorted.peek() ?? []).map(keyOf)
    // The selection as each of its two shapes, read by the one `multiple` says it is.
    const pickedMany = choices.selected as unknown as Reactive<
        readonly string[]
    >
    const pickedOne = choices.selected as unknown as Reactive<
        string | undefined
    >
    const picked = (): readonly string[] => pickedMany.peek() ?? []

    // 51.147 — the selection where the item taken is in it, else that item alone, in the order put.
    const moving = (taken: string): string[] => {
        if (!many) return [taken]
        const selected = new Set(picked())
        return selected.has(taken)
            ? keys().filter((key) => selected.has(key))
            : [taken]
    }
    // The items placed together, `before` of the others ahead of them.
    const place = (block: readonly string[], before: number): boolean => {
        const held = new Set(block)
        const rest = keys().filter((key) => !held.has(key))
        rest.splice(Math.max(0, Math.min(rest.length, before)), 0, ...block)
        return order.set(rest) === undefined
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
    let listElement: Element | null = null
    const self: Member = {
        group,
        element: () => listElement,
        order,
        find: (key) => {
            for (const item of live(options.items))
                if (keyOf(item) === key) return item
            return undefined
        },
        place,
        // 51.182 — the items moved leave this list's selection.
        leave: (block) => {
            const held = new Set(block)
            if (order.set(keys().filter((key) => !held.has(key))) !== undefined)
                return undefined
            grabbed.set(NONE)
            if (!many) {
                const selected = pickedOne.peek()
                if (selected !== undefined && held.has(selected))
                    pickedOne.set(undefined)
                return []
            }
            const gone: string[] = []
            const kept: string[] = []
            for (const key of picked()) (held.has(key) ? gone : kept).push(key)
            if (gone.length !== 0) pickedMany.set(kept)
            return gone
        },
        // 51.182 — the first of them active here, and those that were selected selected here.
        enter: (block, selected) => {
            choices.activate(block[0] as string)
            if (many && selected.length !== 0)
                pickedMany.set([...picked(), ...selected])
        },
        grab: (held) => grabbed.set(held),
        middles: (held) => {
            const middles: number[] = []
            for (const each of keys()) {
                if (held.has(each)) continue
                const box = elements.get(each)?.getBoundingClientRect()
                if (box !== undefined) middles.push(box.top + box.height / 2)
            }
            return middles
        },
        say,
    }
    join(members, self)
    // The lists a move may enter, this one among them: its group's in document order, or this one alone.
    const lists = (): Member[] => {
        const named = group()
        return named === undefined || listElement === null
            ? [self]
            : inGroup(members, named)
    }

    const parts = new Map<string, SortableItem>()
    const item = (entry: Item): SortableItem => {
        const key = keyOf(entry)
        let made = parts.get(key)
        if (made !== undefined) return made
        made = {
            item: withPart(withPart({}, choices.option(entry)), {
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
                // 51.146, 51.181 — every list's box and every other middle read before anything moves,
                // and the moves heard on the window: a move reads no layout, and allocates nothing
                // until the place it lands on changes.
                onpointerdown: (event: PointerEvent) => {
                    if (event.button !== 0) return
                    event.preventDefault()
                    choices.activate(key)
                    const block = moving(key)
                    const held = new Set(block)
                    const standing = lists()
                    const boxes: (DOMRect | undefined)[] = []
                    const middles: number[][] = []
                    for (const list of standing) {
                        boxes.push(
                            standing.length === 1
                                ? undefined
                                : list.element()?.getBoundingClientRect(),
                        )
                        middles.push(list.middles(held))
                    }
                    const start = standing.indexOf(self)
                    let at = start
                    let before = ahead(key, block)
                    grabbed.set(held)
                    const moved = (move: PointerEvent): void => {
                        let into = at
                        for (let index = 0; index < boxes.length; index += 1) {
                            const box = boxes[index]
                            if (
                                box !== undefined &&
                                move.clientX >= box.left &&
                                move.clientX < box.right &&
                                move.clientY >= box.top &&
                                move.clientY < box.bottom
                            ) {
                                into = index
                                break
                            }
                        }
                        const others = middles[into] as number[]
                        let count = 0
                        for (let index = 0; index < others.length; index += 1)
                            if ((others[index] as number) < move.clientY)
                                count += 1
                        if (into !== at) {
                            const to = standing[into] as Member
                            if (
                                !carry(standing[at] as Member, to, block, count)
                            )
                                return
                            to.grab(held)
                            at = into
                        } else if (
                            count !== before &&
                            !(standing[at] as Member).place(block, count)
                        )
                            return
                        before = count
                    }
                    const dropped = (): void => {
                        removeEventListener('pointermove', moved)
                        removeEventListener('pointerup', dropped)
                        removeEventListener('pointercancel', dropped)
                        const list = standing[at] as Member
                        list.grab(NONE)
                        list.say(
                            block,
                            at === start
                                ? 'moved'
                                : `moved to ${nameOf(list.element())}`,
                        )
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

    // 51.180 — Alt with ArrowLeft or ArrowRight carries the items into the list before or after this
    // one, after as many of its items as stood ahead of them here; past either end it moves nothing.
    const across = (event: KeyboardEvent, step: -1 | 1): void => {
        event.preventDefault()
        const taken = choices.active
        if (taken === undefined) return
        const standing = lists()
        const to = standing[standing.indexOf(self) + step]
        if (to === undefined || to === self) return
        const block = moving(taken)
        if (!carry(self, to, block, ahead(block[0] as string, block))) return
        ;(to.element() as HTMLElement).focus()
        to.say(block, `moved to ${nameOf(to.element())}`)
    }

    return {
        // 51.150
        list: withPart(withPart({}, choices.listbox), {
            'data-sortable-list': 'list',
            tabindex: '0',
            get 'aria-activedescendant'() {
                return choices.activeId
            },
            'bind:element': (element: Element) => {
                listElement = element
                return () => {
                    if (listElement === element) listElement = null
                }
            },
            // 51.148, 51.180 — Alt with an arrow moves the items; every other key is the listbox's.
            onkeydown: (event: KeyboardEvent) => {
                if (event.altKey && group() !== undefined) {
                    if (event.key === 'ArrowLeft') return across(event, -1)
                    if (event.key === 'ArrowRight') return across(event, 1)
                }
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
                if (place(block, before)) say(block, 'moved')
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
