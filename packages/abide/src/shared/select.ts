// 51.193-51.204 — A FIELD THAT PICKS ONE OF A LIST AND IS NEVER TYPED IN, as parts an app spreads onto a
// trigger, a popup and options of its own: WAI-ARIA's select-only combobox. Focus stays on the
// trigger, which names the active option as its `aria-activedescendant`; the list is a `listbox` the
// trigger's keys move through, opened in the top layer against the trigger as `popover` opens one.
// Where `combobox` narrows its list by what is typed, a letter here only moves to the item it starts.
// Bound to an array, it picks many: each pick adds an item or takes it out again, and the list stays open.

import {
    type ItemKey,
    keyOfItem,
    type KeyOption,
    type LabelOption,
    writtenBy,
} from './itemKey.ts'
import { listbox } from './listbox.ts'
import { type Live, live } from './live.ts'
import { madeId } from './madeId.ts'
import { popoverOn } from './popover.ts'
import { type Bindable, bindable } from './reactive/bindable.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { reactiveOver } from './reactiveOver.ts'
import { typeahead } from './roving.ts'
import type { Picked } from './Selection.ts'
import { withPart } from './withPart.ts'

/** What a select lists, how an item is told apart and written, the pick it holds and the name it submits under. */
export type SelectOptions<Item, Multiple extends boolean = false> = {
    /** The trigger's id; the list's and each option's ids are derived from it. One is made where none is given. */
    id?: string | undefined
    /** The items to pick from, in the order they are listed; a function is read live. */
    options: Live<readonly Item[]>
    /** 51.204 — whether it picks many: a pick adds an item or takes it out again. `false` by default. */
    multiple?: Multiple | undefined
    /** The pick, where the app holds it: a `Reactive` to read and set. Held by the parts, and handed back as `value`, where none is given. */
    value?: Bindable<Picked<Item, Multiple>> | undefined
    /** The name each picked key is submitted under by `input` (51.201); a function is read live. */
    name?: Live<string | undefined> | undefined
} & KeyOption<Item> &
    LabelOption<Item>

/** The parts `select` hands back, each spread onto an element: `<li {...choose.option(item)}>`. */
export type SelectParts<Item, Multiple extends boolean = false> = {
    /** The trigger's id, and the base of the list's and the options'. */
    readonly id: string
    /** The element around the field: `data-open` while the list is. */
    readonly root: Record<string, unknown>
    /** The element showing the pick: its combobox role, its states, its keys and its press. */
    readonly trigger: Record<string, unknown>
    /** Whether the list is open, and so whether the popup is to be rendered; written, it opens or shuts it. */
    readonly open: Reactive<boolean>
    /** The element holding the list, opened in the top layer against the trigger (51.202). */
    readonly popup: Record<string, unknown>
    /** The list: its `listbox` role and id, multi-selectable where it picks many. */
    readonly listbox: Record<string, unknown>
    /** The items listed: what a keyed `{#for}` over `option` walks. */
    get items(): readonly Item[]
    /** An item's option: its role, id, `aria-selected`, `data-active`, `data-selected`, and the press that picks it. */
    option(item: Item): Record<string, unknown>
    /** A hidden field submitting the pick's key under `name`, or where it picks many, a picked item's (51.201). */
    readonly input: Multiple extends true
        ? (item: Item) => Record<string, unknown>
        : Record<string, unknown>
    /** The pick, read and set: the item, or every item where it picks many. */
    readonly value: Reactive<Picked<Item, Multiple>>
}

const NONE: readonly never[] = []

/** WAI-ARIA's select-only combobox, as parts to spread onto markup of one's own. */
export function select<Item, Multiple extends boolean = false>(
    options: SelectOptions<Item, Multiple>,
): SelectParts<Item, Multiple> {
    const id = options.id ?? madeId('select')
    // 49.11 — read where they are used; the id and whether it picks many are fixed for the life of
    // the parts.
    const key = (item: Item): ItemKey => keyOfItem(options.key, item)
    const label = (item: Item) => writtenBy(options.label, item)
    const many = options.multiple === true
    const listed = () => live(options.options)
    const value = (bindable(options.value) ??
        (many
            ? reactive<readonly Item[]>([])
            : reactive<Item | undefined>(undefined))) as Reactive<
        Item | undefined | readonly Item[]
    >
    // Every item picked, one or many, read the same way by what marks and submits them.
    const picks = reactive((): readonly Item[] => {
        const held = value.get()
        if (many) return (held ?? []) as readonly Item[]
        return held === undefined ? [] : [held as Item]
    })
    const pickedKeys = reactive(() => {
        const keys = new Set<ItemKey>()
        for (const each of picks.get()) keys.add(key(each))
        return keys
    })
    const open = reactive(false)
    const trigger = reactive<HTMLElement | undefined>(undefined)
    // The key the arrows are on while the list is open, set to the first pick's as it opens (51.194).
    const moved = reactive<ItemKey | undefined>(undefined)
    const typedTo = typeahead()

    const list = listbox({
        id,
        options: listed,
        key,
        selected: moved,
        onpick: pick,
        onescape: () => open.set(false),
    })

    // 49.19 — a refused write leaves the list as it stood.
    function pick(item: Item) {
        // 51.203.
        if (!many) {
            if (value.set(item) !== undefined) return
            open.set(false)
            return
        }
        // 51.204 — a pick into an array adds the item or takes it out, and the list stays open.
        const held = picks.peek() ?? NONE
        const picked = key(item)
        const kept = held.filter((each) => key(each) !== picked)
        value.set(kept.length === held.length ? [...held, item] : kept)
    }

    function openOn(item: Item | undefined) {
        moved.set(item === undefined ? undefined : key(item))
        open.set(true)
    }

    // 51.193 — a press opens a shut list and shuts an open one, as a press on a `popover`'s trigger does.
    function press() {
        if (open.peek()) open.set(false)
        else openOn((picks.peek() ?? NONE)[0])
    }

    // 51.196 — the index a printable key moves to from `at`, or `-1`.
    function typedFrom(event: KeyboardEvent, at: ItemKey | undefined): number {
        const items = listed()
        let from = -1
        for (let index = 0; index < items.length; index += 1)
            if (key(items[index] as Item) === at) from = index
        return typedTo(event, from, items.length, (index) =>
            label(items[index] as Item),
        )
    }

    function keydown(event: KeyboardEvent) {
        if (!open.peek()) {
            const items = listed()
            const first = (picks.peek() ?? NONE)[0]
            switch (event.key) {
                // 51.194.
                case 'ArrowDown':
                case 'ArrowUp':
                case 'Enter':
                case ' ':
                    event.preventDefault()
                    openOn(first)
                    return
                case 'Home':
                    event.preventDefault()
                    openOn(items[0])
                    return
                case 'End':
                    event.preventDefault()
                    openOn(items.at(-1))
                    return
            }
            const to = typedFrom(
                event,
                first === undefined ? undefined : key(first),
            )
            if (to === -1) return
            event.preventDefault()
            openOn(items[to])
            return
        }
        // 51.197 — Space picks as Enter does; a `listbox` that picks one leaves Space alone.
        if (event.key === ' ') {
            event.preventDefault()
            const active = list.activeOption
            if (active !== undefined) pick(active)
            return
        }
        // 51.199 — Tab leaves the field, and its blur shuts the list.
        if (event.key === 'Tab') return
        const to = typedFrom(event, list.active)
        if (to !== -1) {
            event.preventDefault()
            const each = key(listed()[to] as Item)
            moved.set(each)
            globalThis.document
                ?.getElementById(list.idOf(each))
                ?.scrollIntoView?.({ block: 'nearest' })
            return
        }
        list.onkeydown(event)
    }

    const field = (picked: () => Item | undefined) => ({
        type: 'hidden',
        'data-select': 'input',
        get name() {
            return live(options.name)
        },
        get value() {
            const held = picked()
            return held === undefined ? '' : String(key(held))
        },
    })

    return {
        id,
        root: {
            'data-select': 'root',
            get 'data-open'() {
                return open.get() ? '' : undefined
            },
        },
        trigger: {
            id,
            role: 'combobox',
            tabindex: '0',
            'data-select': 'trigger',
            'aria-haspopup': 'listbox',
            get 'aria-expanded'() {
                return open.get() ? 'true' : 'false'
            },
            // 49.17
            get 'data-open'() {
                return open.get() ? '' : undefined
            },
            get 'data-placeholder'() {
                return picks.get().length === 0 ? '' : undefined
            },
            get 'aria-controls'() {
                return open.get() ? `${id}-listbox` : undefined
            },
            get 'aria-activedescendant'() {
                return open.get() ? list.activeId : undefined
            },
            onkeydown: keydown,
            onclick: press,
            onblur: () => open.set(false),
            'bind:element': (element: HTMLElement) => {
                trigger.set(element)
                return () => trigger.set(undefined)
            },
        },
        // The list is open for the popup once there is a trigger to open it against.
        open: reactiveOver(
            () => open.get() && trigger.get() !== undefined,
            (next: boolean) => {
                if (next) openOn((picks.peek() ?? NONE)[0])
                else open.set(false)
            },
        ),
        popup: {
            popover: 'manual',
            'data-select': 'popup',
            onmousedown: (event: MouseEvent) => event.preventDefault(),
            'bind:element': (element: Element) =>
                popoverOn(trigger.peek() as HTMLElement, {
                    side: 'bottom',
                    align: 'start',
                    offset: 4,
                })(element),
        },
        // 49.18 — the listbox's own part, with the id the trigger's `aria-controls` names.
        listbox: withPart({}, list.listbox, {
            id: `${id}-listbox`,
            'data-select': 'listbox',
            // Its own listbox picks one at a time; the select's picks are many where it says so.
            'aria-multiselectable': many ? 'true' : undefined,
        }),
        get items() {
            return listed()
        },
        option: (item) => {
            const part = withPart(list.option(item), {
                'data-select': 'option',
                get 'data-selected'() {
                    return pickedKeys.get().has(key(item)) ? '' : undefined
                },
            })
            // Where it picks many, what is selected is what is picked, not the option the arrows are on.
            if (many)
                withPart(part, {
                    get 'aria-selected'() {
                        return pickedKeys.get().has(key(item))
                            ? 'true'
                            : 'false'
                    },
                })
            return part
        },
        input: (many
            ? (item: Item) => field(() => item)
            : field(() => picks.get()[0])) as unknown as SelectParts<
            Item,
            Multiple
        >['input'],
        value: value as Reactive<Picked<Item, Multiple>>,
    }
}
