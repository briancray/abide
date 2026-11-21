// 51.13-51.29, 51.61, 51.62, 51.64 — A FIELD THAT LISTS WHAT MATCHES AS IT IS TYPED IN, as parts an app
// spreads onto an input, a popup and options of its own: WAI-ARIA's combobox with a list popup. Focus
// stays in the input, which names the active option as its `aria-activedescendant`; the list is a
// `listbox` the input's keys move through, opened in the top layer against the input as `popover`
// opens one. Bound to an array, it picks many: each pick adds an item or takes it out again.

import { listbox } from './listbox.ts'
import { popover } from './popover.ts'
import { busy, type Reactive, reactive, watch } from './reactive/index.ts'
import { openingEnd } from './roving.ts'

/** What a combobox lists, how an item is told apart and written, and the pick it holds. */
export type ComboboxOptions<Item> = {
    /** The input's id, for a `<label for>`; the list's and each option's ids are derived from it. */
    id: string
    /** The items to pick from, narrowed to those whose label holds what was typed: read live. */
    options?: () => readonly Item[]
    /** Finds the items for what was typed, in place of narrowing `options`: a handler call, or any async function. */
    search?(
        query: string,
    ):
        | readonly Item[]
        | PromiseLike<readonly Item[]>
        | Reactive<readonly Item[], unknown, unknown, unknown>
    /** Milliseconds typing has to pause before `search` runs again. */
    debounce?: number
    /** What tells one item from another; unique among the items. */
    key(item: Item): string
    /** An item's text: what the input holds once it is picked. */
    label(item: Item): string
    /** The item picked, or every item picked where it holds an array (51.61): a `Reactive` to read and set. */
    value: Reactive<Item | undefined | readonly Item[]>
}

/** The parts `combobox` hands back, each spread onto an element: `<li {...box.option(item)}>`. */
export type ComboboxParts<Item> = {
    /** The element around the field: `data-open` while the list is, `data-busy` while a search is out. */
    readonly root: Record<string, unknown>
    /** The text field: its combobox role, its states, its keys, and the text it holds. */
    readonly input: Record<string, unknown>
    /** Whether the list is open, and so whether the popup is to be rendered. */
    open(): boolean
    /** The element holding the list and `empty`, opened in the top layer against the input (51.64). */
    readonly popup: Record<string, unknown>
    /** The list: its `listbox` role and id, multi-selectable where `value` is an array. */
    readonly listbox: Record<string, unknown>
    /** The items listed for what was typed: what a keyed `{#for}` over `option` walks. */
    items(): readonly Item[]
    /** An item's option: its role, id, `aria-selected`, `data-active`, `data-selected`, and the press that picks it. */
    option(item: Item): Record<string, unknown>
    /** Whether nothing is listed with no search in flight: where `empty` is rendered. */
    nothingFound(): boolean
    /** The element saying nothing matched: a status. */
    readonly empty: Record<string, unknown>
    /** The items picked, where `value` is an array; `undefined` where it holds one item. */
    picks(): readonly Item[] | undefined
    /** A button taking a picked item out (51.62). */
    remove(item: Item): Record<string, unknown>
    /** Takes a picked item out, for a chip of one's own. */
    unpick(item: Item): void
}

const NOTHING: readonly never[] = []

/** WAI-ARIA's combobox with a list popup, as parts to spread onto markup of one's own. */
export function combobox<Item>(
    options: ComboboxOptions<Item>,
): ComboboxParts<Item> {
    const { id, search, debounce, key, label, value } = options

    // What was typed since the last pick; the input shows the pick's label while nothing has been.
    const typed = reactive<string | undefined>(undefined)
    // 51.61 — the items picked, where `value` is an array; `undefined` where it holds one item.
    const picks = reactive((): readonly Item[] | undefined => {
        const held = value()
        return Array.isArray(held) ? (held as readonly Item[]) : undefined
    })
    const query = reactive(() => {
        const text = typed()
        const one = value()
        if (text !== undefined) return text
        return picks() !== undefined || one === undefined
            ? ''
            : label(one as Item)
    })
    const open = reactive(false)
    // 51.64 — what the open list is placed against.
    const input = reactive<HTMLInputElement | undefined>(undefined)

    // Nothing is searched while the list is shut, and a search in flight keeps the last results listed.
    const found = reactive(
        () => {
            if (!open()) return NOTHING as readonly Item[]
            const text = query()
            if (search !== undefined) return search(text)
            const lowered = text.toLowerCase()
            const kept: Item[] = []
            for (const item of options.options?.() ?? NOTHING)
                if (label(item).toLowerCase().includes(lowered)) kept.push(item)
            return kept
        },
        debounce === undefined ? {} : { debounce },
    )

    const list = listbox({
        id,
        options: () => found() as readonly Item[],
        key,
        onpick: pick,
        onescape: dismiss,
    })

    function write(text: string) {
        typed.set(text)
        open.set(true)
    }

    function pick(item: Item) {
        typed.set(undefined)
        const many = picks.peek()
        if (many === undefined) {
            value.set(item)
            open.set(false)
            return
        }
        const picked = key(item)
        const kept = many.filter((each) => key(each) !== picked)
        value.set(kept.length === many.length ? [...many, item] : kept)
    }

    function unpick(item: Item) {
        const removed = key(item)
        value.set((picks.peek() ?? []).filter((each) => key(each) !== removed))
    }

    function dismiss() {
        if (open.peek()) open.set(false)
        else {
            typed.set(undefined)
            // 51.61 — what is picked into an array is taken out one at a time, never by Escape.
            if (picks.peek() === undefined) value.set(undefined)
        }
    }

    function keydown(event: KeyboardEvent) {
        // Home and End move the caret in the text, not the active option.
        if (event.key === 'Home' || event.key === 'End') return
        // 51.28 — an Escape with nothing to shut or clear is left to whatever holds the input: a
        // `<dialog>` cancels only on an Escape no one prevented.
        if (event.key === 'Escape' && !open.peek() && query.peek() === '')
            return
        // 51.62 — Backspace in an empty input takes out the last item picked.
        const many = picks.peek()
        if (
            event.key === 'Backspace' &&
            query.peek() === '' &&
            many !== undefined
        ) {
            const last = many.at(-1)
            if (last !== undefined) unpick(last)
            return
        }
        if (!open.peek() && openingEnd(event.key, 'vertical') !== undefined) {
            event.preventDefault()
            open.set(true)
            return
        }
        list.keydown(event)
    }

    const pickedKeys = reactive(() => {
        const many = picks()
        const one = value()
        const keys = new Set<string>()
        if (many !== undefined) for (const each of many) keys.add(key(each))
        else if (one !== undefined) keys.add(key(one as Item))
        return keys
    })

    return {
        root: {
            get 'data-open'() {
                return open() ? '' : undefined
            },
            get 'data-busy'() {
                return open() && busy(found) ? '' : undefined
            },
        },
        input: {
            id,
            type: 'text',
            role: 'combobox',
            autocomplete: 'off',
            'aria-autocomplete': 'list',
            get 'aria-expanded'() {
                return open() ? 'true' : 'false'
            },
            get 'aria-controls'() {
                return open() ? `${id}-listbox` : undefined
            },
            get 'aria-activedescendant'() {
                return open() ? list.activeId() : undefined
            },
            // The text a server writes; in a browser the property below is kept in step with it.
            get value() {
                return query()
            },
            oninput: (event: Event) =>
                write((event.currentTarget as HTMLInputElement).value),
            onkeydown: keydown,
            onblur: () => open.set(false),
            // 32.5 — the field's text is its `value` property, which an attribute stops reaching once
            // it is typed in: written whenever the query moves away from what the field holds.
            'bind:element': (element: HTMLInputElement) => {
                input.set(element)
                const stop = watch(() => {
                    const text = query()
                    if (element.value !== text) element.value = text
                })
                return () => {
                    stop()
                    input.set(undefined)
                }
            },
        },
        open: () => open() && input() !== undefined,
        popup: {
            popover: 'manual',
            onmousedown: (event: MouseEvent) => event.preventDefault(),
            'bind:element': (element: Element) =>
                popover(input.peek() as HTMLInputElement, {
                    side: 'bottom',
                    align: 'start',
                    offset: 4,
                })(element),
        },
        listbox: {
            id: `${id}-listbox`,
            role: 'listbox',
            get 'aria-multiselectable'() {
                return picks() === undefined ? undefined : 'true'
            },
        },
        items: () => found() as readonly Item[],
        option: (item) => ({
            id: list.idOf(key(item)),
            role: 'option',
            get 'aria-selected'() {
                return list.active() === key(item) ? 'true' : 'false'
            },
            get 'data-active'() {
                return list.active() === key(item) ? '' : undefined
            },
            get 'data-selected'() {
                return pickedKeys().has(key(item)) ? '' : undefined
            },
            onpointermove: () => list.activate(key(item)),
            onclick: () => pick(item),
        }),
        nothingFound: () =>
            !busy(found) && (found() as readonly Item[]).length === 0,
        empty: { role: 'status' },
        picks: () => picks(),
        remove: (item) => ({
            type: 'button',
            'aria-label': `Remove ${label(item)}`,
            onclick: () => unpick(item),
        }),
        unpick,
    }
}
