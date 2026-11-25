// 51.13-51.29, 51.55, 51.56, 51.57, 51.106 — A FIELD THAT LISTS WHAT MATCHES AS IT IS TYPED IN, as parts an app
// spreads onto an input, a popup and options of its own: WAI-ARIA's combobox with a list popup. Focus
// stays in the input, which names the active option as its `aria-activedescendant`; the list is a
// `listbox` the input's keys move through, opened in the top layer against the input as `popover`
// opens one. Bound to an array, it picks many: each pick adds an item or takes it out again.

import {
    keyOfItem,
    type KeyOption,
    type LabelOption,
    writtenBy,
} from './itemKey.ts'
import { type LabelRun, labelRuns, needlesOf } from './labelRuns.ts'
import { listbox } from './listbox.ts'
import { type Live, live } from './live.ts'
import { popoverOn } from './popover.ts'
import { randomToken } from './randomToken.ts'
import { busy, computed, type Reactive, reactive } from './reactive/index.ts'
import { reactiveOver } from './reactiveOver.ts'
import { openingEnd } from './roving.ts'
import type { Picked } from './Selection.ts'
import { withPart } from './withPart.ts'

/** What a combobox lists, how an item is told apart and written, and the pick it holds. */
export type ComboboxOptions<Item, Multiple extends boolean = false> = {
    /** The input's id, for a `<label for>`; the list's and each option's ids are derived from it. One is made where none is given. */
    id?: string | undefined
    /** The items to pick from, narrowed to those whose label holds what was typed; a function is read live. */
    options?: Live<readonly Item[]> | undefined
    /** Finds the items for what was typed, in place of narrowing `options`: a handler call, or any async function. */
    search?(
        query: string,
    ):
        | readonly Item[]
        | PromiseLike<readonly Item[]>
        | Reactive<readonly Item[], unknown, unknown, unknown>
    /** Milliseconds typing has to pause before `search` runs again. */
    debounce?: number | undefined
    /** 51.55 — whether it picks many: a pick adds an item or takes it out again. `false` by default. */
    multiple?: Multiple | undefined
    /** The pick, where the app holds it: a `Reactive` to read and set. Held by the parts, and handed back as `value`, where none is given. */
    value?: Reactive<Picked<Item, Multiple>> | undefined
} & KeyOption<Item> &
    LabelOption<Item>

/** A picked item's chip, where it picks many: the chip, and the button taking the item out (51.56). */
export type ComboboxChip = {
    /** The chip's attributes. */
    readonly chip: Record<string, unknown>
    /** A button taking the item out. */
    readonly remove: Record<string, unknown>
}

/** The parts `combobox` hands back, each spread onto an element: `<li {...box.option(item)}>`. */
export type ComboboxParts<Item, Multiple extends boolean = false> = {
    /** The input's id, and the base of the list's and the options'. */
    readonly id: string
    /** The element around the field: `data-open` while the list is, `data-busy` while a search is out. */
    readonly root: Record<string, unknown>
    /** The text field: its combobox role, its states, its keys, and the text it holds. */
    readonly input: Record<string, unknown>
    /** Whether the list is open, and so whether the popup is to be rendered; written, it opens or shuts it. */
    readonly open: Reactive<boolean>
    /** The element holding the list and `empty`, opened in the top layer against the input (51.57). */
    readonly popup: Record<string, unknown>
    /** The list: its `listbox` role and id, multi-selectable where it picks many. */
    readonly listbox: Record<string, unknown>
    /** The items listed for what was typed: what a keyed `{#for}` over `option` walks. */
    get items(): readonly Item[]
    /** An item's option: its role, id, `aria-selected`, `data-active`, `data-selected`, and the press that picks it. */
    option(item: Item): Record<string, unknown>
    /** An item's `label` in runs, each run of it the input's text is found in carrying the `match` part (51.106). */
    runs(item: Item): readonly LabelRun[]
    /** Whether nothing is listed with no search in flight: where `empty` is rendered. */
    get nothingFound(): boolean
    /** The element saying nothing matched: a status. */
    readonly empty: Record<string, unknown>
    /** The pick, read and set: the item, or every item where it picks many. */
    readonly value: Reactive<Picked<Item, Multiple>>
    /** The element holding the chips, where it picks many. */
    readonly chips: Record<string, unknown>
    /** A picked item's chip and the button taking it out (51.56). */
    chip(item: Item): ComboboxChip
}

const NOTHING: readonly never[] = []
// 49.3 — the part a matched run of a label spreads.
const MATCH = { 'data-combobox': 'match' }

/** WAI-ARIA's combobox with a list popup, as parts to spread onto markup of one's own. */
export function combobox<Item, Multiple extends boolean = false>(
    options: ComboboxOptions<Item, Multiple>,
): ComboboxParts<Item, Multiple> {
    const { debounce } = options
    const id = options.id ?? `combobox-${randomToken(4, 'hex')}`
    // 49.11 — read where they are used; the id, the debounce and whether it picks many are
    // fixed for the life of the parts.
    const key = (item: Item) => keyOfItem(options.key, item)
    const label = (item: Item) => writtenBy(options.label, item)
    const many = options.multiple === true
    const value = (options.value ??
        (many
            ? reactive<readonly Item[]>([])
            : reactive<Item | undefined>(undefined))) as Reactive<
        Item | undefined | readonly Item[]
    >

    // What was typed since the last pick; the input shows the pick's label while nothing has been.
    const typed = reactive<string | undefined>(undefined)
    // 51.55 — the items picked, where it picks many; `undefined` where it picks one.
    const picks = computed((): readonly Item[] | undefined =>
        many ? ((value() ?? []) as readonly Item[]) : undefined,
    )
    const query = computed(() => {
        const text = typed()
        const one = value()
        if (text !== undefined) return text
        return picks() !== undefined || one === undefined
            ? ''
            : label(one as Item)
    })
    // 51.16, 51.106 — what the labels are narrowed by and marked with.
    const needles = computed(() => needlesOf(query(), false))
    const open = reactive(false)
    // 51.57 — what the open list is placed against.
    const input = reactive<HTMLInputElement | undefined>(undefined)

    // Nothing is searched while the list is shut, and a search in flight keeps the last results listed.
    const found = computed(
        () => {
            if (!open()) return NOTHING as readonly Item[]
            const text = query()
            const search = options.search
            if (search !== undefined) return search(text)
            const needle = needles()[0]
            const kept: Item[] = []
            for (const item of live(options.options) ?? NOTHING)
                if (needle === undefined || needle.test(label(item)))
                    kept.push(item)
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
        const held = picks.peek()
        if (held === undefined) {
            value.set(item)
            open.set(false)
            return
        }
        const picked = key(item)
        const kept = held.filter((each) => key(each) !== picked)
        value.set(kept.length === held.length ? [...held, item] : kept)
    }

    function unpick(item: Item) {
        const removed = key(item)
        value.set((picks.peek() ?? []).filter((each) => key(each) !== removed))
    }

    function dismiss() {
        if (open.peek()) open.set(false)
        else {
            typed.set(undefined)
            // 51.55 — what is picked into an array is taken out one at a time, never by Escape.
            if (picks.peek() === undefined) value.set(undefined)
        }
    }

    // 51.92 — a press opens a shut list and shuts an open one, as a press on a `popover`'s trigger does
    // (50.59). A press is a click, never focus: Tab reaching the input opens nothing. A search opens
    // only once there is text to search for, since nothing has been searched yet.
    function press() {
        if (open.peek()) {
            open.set(false)
            return
        }
        if (options.search !== undefined && query.peek() === '') return
        open.set(true)
    }

    function keydown(event: KeyboardEvent) {
        // Home and End move the caret in the text, not the active option.
        if (event.key === 'Home' || event.key === 'End') return
        // 51.93 — Alt with an arrow opens or shuts the list and never steps its active option.
        if (
            event.altKey &&
            (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        ) {
            event.preventDefault()
            if (event.key === 'ArrowDown') open.set(true)
            else if (open.peek()) open.set(false)
            return
        }
        // 51.28 — an Escape with nothing to shut or clear is left to whatever holds the input: a
        // `<dialog>` cancels only on an Escape no one prevented.
        if (event.key === 'Escape' && !open.peek() && query.peek() === '')
            return
        // 51.56 — Backspace in an empty input takes out the last item picked.
        const held = picks.peek()
        if (
            event.key === 'Backspace' &&
            query.peek() === '' &&
            held !== undefined
        ) {
            const last = held.at(-1)
            if (last !== undefined) unpick(last)
            return
        }
        if (!open.peek() && openingEnd(event.key, 'vertical') !== undefined) {
            event.preventDefault()
            open.set(true)
            return
        }
        list.onkeydown(event)
    }

    const pickedKeys = computed(() => {
        const held = picks()
        const one = value()
        const keys = new Set<string>()
        if (held !== undefined) for (const each of held) keys.add(key(each))
        else if (one !== undefined) keys.add(key(one as Item))
        return keys
    })

    return {
        id,
        root: {
            'data-combobox': 'root',
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
            'data-combobox': 'input',
            autocomplete: 'off',
            'aria-autocomplete': 'list',
            get 'aria-expanded'() {
                return open() ? 'true' : 'false'
            },
            // 49.17
            get 'data-open'() {
                return open() ? '' : undefined
            },
            get 'aria-controls'() {
                return open() ? `${id}-listbox` : undefined
            },
            get 'aria-activedescendant'() {
                return open() ? list.activeId : undefined
            },
            // 32.113 — the field's text, kept written into its property once it is typed in too.
            get value() {
                return query()
            },
            oninput: (event: Event) =>
                write((event.currentTarget as HTMLInputElement).value),
            onkeydown: keydown,
            onclick: press,
            onblur: () => open.set(false),
            'bind:element': (element: HTMLInputElement) => {
                input.set(element)
                return () => input.set(undefined)
            },
        },
        // The list is open for the popup once there is an input to open it against.
        open: reactiveOver(
            () => open() && input() !== undefined,
            (next: boolean) => open.set(next),
        ),
        popup: {
            popover: 'manual',
            'data-combobox': 'popup',
            onmousedown: (event: MouseEvent) => event.preventDefault(),
            'bind:element': (element: Element) =>
                popoverOn(input.peek() as HTMLInputElement, {
                    side: 'bottom',
                    align: 'start',
                    offset: 4,
                })(element),
        },
        // 49.18 — the listbox's own part, with the id the input's `aria-controls` names.
        listbox: withPart(withPart({}, list.listbox), {
            id: `${id}-listbox`,
            'data-combobox': 'listbox',
            // Its own listbox picks one at a time; the combobox's picks are many where it says so.
            get 'aria-multiselectable'() {
                return many ? 'true' : undefined
            },
        }),
        get items() {
            return found() as readonly Item[]
        },
        option: (item) =>
            withPart(list.option(item), {
                'data-combobox': 'option',
                get 'data-selected'() {
                    return pickedKeys().has(key(item)) ? '' : undefined
                },
            }),
        runs: (item) => labelRuns(label(item), needles(), MATCH),
        get nothingFound() {
            return !busy(found) && (found() as readonly Item[]).length === 0
        },
        empty: { role: 'status', 'data-combobox': 'empty' },
        value: value as Reactive<Picked<Item, Multiple>>,
        chips: { 'data-combobox': 'chips' },
        chip: (item) => ({
            chip: { 'data-combobox': 'chip' },
            remove: {
                type: 'button',
                'data-combobox': 'remove',
                'aria-label': `Remove ${label(item)}`,
                onclick: () => unpick(item),
            },
        }),
    }
}
