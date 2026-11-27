// 51.110-51.115 — A ROW OF BUTTONS THAT HOLD A CHOICE, as parts an app spreads onto a group and a
// button per item of its own. Picking many, it is a `toggle` per key, each pressed while `value` holds
// its key: filter chips. Picking one, it is WAI-ARIA's radio group, the arrow keys moving the pick and
// focus together: a segmented control. What it picks is a `Selection`, as a `listbox`'s is.

import {
    type ItemKey,
    type KeyOf,
    keyOfItem,
    type KeyOption,
    listedKeys,
    listedOrFirst,
} from './itemKey.ts'
import { type Live, live } from './live.ts'
import { randomToken } from './randomToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { reactiveOver } from './reactiveOver.ts'
import { roving } from './roving.ts'
import { type Picked, Selection } from './Selection.ts'
import { toggle } from './toggle.ts'
import { withPart } from './withPart.ts'

/** The items a group offers, how each is told apart, what it picks, and what it is called. */
export type ToggleGroupOptions<
    Item,
    Multiple extends boolean = false,
    Key extends ItemKey = KeyOf<Item>,
> = {
    /** The base the ids its buttons write are derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
    /** The items, in the order their buttons render; a function is read live. */
    items: Live<readonly Item[]>
    /** Whether it picks many, each press adding its key or taking it out. `false` by default. */
    multiple?: Multiple | undefined
    /** The key picked, or every key picked where it picks many: a `Reactive` to read and set. Held by the parts, and handed back as `value`, where none is given. */
    value?: Reactive<Picked<Key, Multiple>> | undefined
    /** The group's accessible name; a function is read live. */
    label?: Live<string> | undefined
    /** Picking one, whether a click on the item picked unpicks it, leaving `value` `undefined`. `false` by default. */
    deselectable?: boolean | undefined
} & KeyOption<Item, Key>

/** The parts `toggleGroup` hands back: `<div {...view.group}>`, `<button {...view.item('board')}>`. */
export type ToggleGroup<
    Item,
    Multiple extends boolean = false,
    Key extends ItemKey = KeyOf<Item>,
> = {
    /** The base its buttons' ids are derived from. */
    readonly id: string
    /** The group's attributes, and its keyboard where it picks one. */
    readonly group: Record<string, unknown>
    /** An item's button: its attributes and its click. */
    item(item: Item): Record<string, unknown>
    /** The key picked, or every key picked where it picks many; written, it picks. */
    readonly value: Reactive<Picked<Key, Multiple>>
}

/** Toggle buttons over a set of items, picking one as a radio group does or picking many. */
export function toggleGroup<
    Item,
    Multiple extends boolean = false,
    Key extends ItemKey = KeyOf<Item>,
>(
    options: ToggleGroupOptions<Item, Multiple, Key>,
): ToggleGroup<Item, Multiple, Key> {
    const many = options.multiple === true
    const deselectable = options.deselectable === true
    const picks = new Selection(
        options.value as Reactive<Picked<ItemKey, boolean>> | undefined,
        many,
    )
    const keyOf = (item: Item) =>
        keyOfItem(options.key as ((item: Item) => Key) | undefined, item)
    const keysOf = listedKeys(options.items, keyOf)
    // Hydration runs setup again (41.6), and the focus a key moves is found by these ids.
    const base = options.id ?? `toggle-group-${randomToken(4, 'hex')}`
    const itemId = (key: Key) => `${base}-${encodeURIComponent(key)}`

    // 51.114 — picking one, the key in the tab order: the one picked, the first where none is listed.
    // A computed, as `tabs`' is: every radio's `tabindex` reads it, so a pick walks the keys once.
    const current = reactive((): Key | undefined =>
        listedOrFirst(keysOf(), picks.selected() as Key | undefined),
    )

    // 51.110 — picking many, a key's button is a `toggle`, pressed while the key is picked.
    const toggled = (key: Key): Record<string, unknown> =>
        withPart(
            {},
            toggle({
                pressed: reactiveOver(
                    () => picks.has(key),
                    (on: boolean) => {
                        if (on !== picks.has(key)) picks.toggle(key)
                    },
                ),
            }).button,
            { id: itemId(key), 'data-toggle-group': 'item' },
        )

    // 51.111 — picking one, a key's button is a radio.
    const radio = (key: Key): Record<string, unknown> => ({
        type: 'button',
        role: 'radio',
        id: itemId(key),
        'data-toggle-group': 'item',
        get 'aria-checked'() {
            return picks.has(key) ? 'true' : 'false'
        },
        get 'data-pressed'() {
            return picks.has(key) ? '' : undefined
        },
        get tabindex() {
            return current() === key ? '0' : '-1'
        },
        // 51.112
        onclick: () =>
            deselectable && picks.has(key)
                ? picks.selected.set(undefined)
                : picks.pick(key),
    })

    // Each key's part is built once and kept, so a render asking for it again builds nothing.
    const parts = new Map<Key, Record<string, unknown>>()
    const item = (entry: Item): Record<string, unknown> => {
        const key = keyOf(entry)
        let part = parts.get(key)
        if (part === undefined) {
            part = many ? toggled(key) : radio(key)
            parts.set(key, part)
        }
        return part
    }

    // 51.115
    const group = {
        role: many ? 'group' : 'radiogroup',
        'data-toggle-group': 'group',
        get 'aria-label'() {
            return live(options.label)
        },
        // 51.113 — picking one, every arrow moves the pick and focus with it, going round.
        onkeydown: (event: KeyboardEvent) => {
            if (many) return
            const listed = keysOf()
            const along =
                event.key === 'ArrowDown'
                    ? 'ArrowRight'
                    : event.key === 'ArrowUp'
                      ? 'ArrowLeft'
                      : event.key
            const next =
                listed[
                    roving(along, 'horizontal', () => [
                        listed.indexOf(current() as Key),
                        listed.length,
                    ])
                ]
            if (next === undefined) return
            event.preventDefault()
            if (picks.pick(next))
                globalThis.document?.getElementById(itemId(next))?.focus()
        },
    }

    return {
        id: base,
        group,
        item,
        value: picks.selected as Reactive<Picked<Key, Multiple>>,
    }
}
