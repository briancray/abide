import { checkParts } from './checkParts.ts'
import { hotkeys } from './hotkeys.ts'
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
import { unowned } from './reactive/watch.ts'
import { roving } from './roving.ts'
import { type Picked, Selection } from './Selection.ts'

/** What `listbox` is handed: the options, how each is told apart, what is selected, and what Enter and Escape do. */
export type ListboxOptions<
    Option,
    Multiple extends boolean = false,
    Key extends ItemKey = KeyOf<Option>,
> = {
    /** The base every option's element id is derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
    /** The options in the order they render; a function is read live. */
    options: Live<readonly Option[]>
    /** Whether an arrow past either end goes round to the other end. `true` unless set; a function is read live. */
    wrap?: Live<boolean> | undefined
    /** 51.98 — whether it selects many, each press changing the selection rather than moving it. `false` by default. */
    multiple?: Multiple | undefined
    /** The keys selected, where the app holds them: a `Reactive` to read and set. Where it selects one, the key last moved to (51.104). Held by the parts, and handed back as `selected`, where none is given. */
    selected?: Reactive<Picked<NoInfer<Key>, Multiple>> | undefined
    /** Called with the active option when Enter is pressed, and with an option clicked where it selects one. */
    onpick?: ((option: Option) => void) | undefined
    /** Called when Escape is pressed. */
    onescape?: (() => void) | undefined
} & KeyOption<Option, Key>

/** The keyboard over a list of options, which of them is active, and which are selected. */
export type Listbox<
    Option,
    Multiple extends boolean = false,
    Key extends ItemKey = KeyOf<Option>,
> = {
    /** The base the options' ids are derived from. */
    readonly id: string
    /** The active option's key, read live; `undefined` while the list is empty. */
    get active(): Key | undefined
    /** The active option itself. */
    get activeOption(): Option | undefined
    /** The active option's id, for the focused element's `aria-activedescendant`; `undefined` while none is active. */
    get activeId(): string | undefined
    /** Makes the option with `key` active, as a pointer resting on it does. */
    activate: (key: Key) => void
    /** The id the option with `key` renders with, which `aria-activedescendant` names. */
    idOf: (key: Key) => string
    /** The `keydown` listener for the focused element: the list's own, or a field that keeps focus while it walks the list. */
    onkeydown: (event: KeyboardEvent) => void
    /** The list's part: its role. */
    readonly listbox: Record<string, unknown>
    /** An option's part: its id, role, `aria-selected`, `data-active`, `data-selected`, the pointer resting on it activating it, and its click. */
    option(option: Option): Record<string, unknown>
    /** The keys selected, read and set: the key last moved to, or every key selected where it selects many. */
    readonly selected: Reactive<Picked<Key, Multiple>>
}

// One option's standing state: the latest option under its key, its id, its two booleans and its handlers.
type OptionRow<Option> = {
    option: Option
    id: string
    active: () => boolean
    selected: () => boolean
    onpointermove: () => void
    onclick: (event: MouseEvent) => void
}

/** A keyboard controller over a list of keyed options, for markup the app writes itself. */
export function listbox<
    Option,
    Multiple extends boolean = false,
    Key extends ItemKey = KeyOf<Option>,
>(
    given: ListboxOptions<Option, Multiple, Key>,
): Listbox<Option, Multiple, Key> {
    // 49.11 — read where they are used; the id and whether it selects many are fixed for the life of
    // the parts.
    const options = () => live(given.options)
    const id = given.id ?? `listbox-${randomToken(4, 'hex')}`
    // Keys are held as `ItemKey` inside, and as `Key` at the surface.
    const key = (option: Option): ItemKey =>
        keyOfItem(given.key as ((option: Option) => Key) | undefined, option)
    const many = given.multiple === true
    if (process.env.NODE_ENV !== 'production') checkParts('listbox', `${id}-`)
    const selection = new Selection(
        given.selected as Reactive<Picked<ItemKey, boolean>> | undefined,
        many,
    )
    // The key last moved to; what is active is this key while it is listed, and the first otherwise.
    // 51.104 — where it selects one, that key is the selection.
    const chosen = many
        ? reactive<ItemKey | undefined>(undefined)
        : (selection.selected as Reactive<ItemKey | undefined>)
    const order = listedKeys(given.options, key)
    // 51.101 — `mod+a` as `hotkeys` reads it, only where it selects many.
    const selectAll = many
        ? hotkeys({ 'mod+a': () => selection.all(order) })
        : undefined
    // 51.94 — the key a pointer last moved over, and the key moved to when it did: a pointer
    // activates without moving, so it holds only until a move or a write to `selected` changes that key.
    const pointed = reactive<
        { key: ItemKey; over: ItemKey | undefined } | undefined
    >(undefined)
    // 49.19 — where it selects one, the move is the write to `selected`, and a refused one leaves the
    // pointer as it stood.
    function moveKey(each: ItemKey): boolean {
        if (chosen.set(each) !== undefined) return false
        pointed.set(undefined)
        return true
    }
    const active = reactive(() => {
        const moved = chosen()
        const pointer = pointed()
        return listedOrFirst(
            order(),
            pointer !== undefined && pointer.over === moved
                ? pointer.key
                : moved,
        )
    })

    const isSelected = (each: ItemKey): boolean =>
        many ? selection.has(each) : chosen() === each

    function activeOption(): Option | undefined {
        const wanted = active()
        for (const option of options())
            if (key(option) === wanted) return option
        return undefined
    }

    function idOf(each: ItemKey): string {
        return `${id}-option-${encodeURIComponent(each)}`
    }

    function moveTo(at: number, extend: boolean): void {
        const list = options()
        const option = list[at]
        if (option === undefined) return
        const each = key(option)
        // 51.103 — Shift carries the selection along with the move.
        if (extend && !selection.extend(active.peek(), each, order)) return
        if (!moveKey(each)) return
        // The active option kept in view as the arrows step through a list longer than its box.
        globalThis.document
            ?.getElementById(idOf(each))
            ?.scrollIntoView?.({ block: 'nearest' })
    }

    function keydown(event: KeyboardEvent): void {
        selectAll?.(event)
        const next = roving(
            event.key,
            'vertical',
            () => {
                const list = options()
                const current = active.peek()
                let at = -1
                for (let index = 0; index < list.length; index += 1)
                    if (key(list[index] as Option) === current) at = index
                return [at, list.length]
            },
            live(given.wrap) ?? true,
        )
        if (next !== -1) {
            event.preventDefault()
            moveTo(next, many && event.shiftKey)
            return
        }
        switch (event.key) {
            // 51.102.
            case ' ': {
                const current = active.peek()
                if (!many || current === undefined) return
                event.preventDefault()
                if (event.shiftKey) selection.extend(current, current, order)
                else selection.toggle(current)
                return
            }
            case 'Enter': {
                const option = activeOption()
                const onpick = given.onpick
                if (option === undefined || onpick === undefined) return
                event.preventDefault()
                onpick(option)
                return
            }
            case 'Escape': {
                const onescape = given.onescape
                if (onescape === undefined) return
                event.preventDefault()
                onescape()
            }
        }
    }

    // 51.192 — ONE ROW PER KEY, KEPT ACROSS CALLS: its handlers are the same functions at every call, so
    // a spread rerun binds no listener again, and its `active` and `selected` are its own booleans, so a
    // step wakes the two rows whose answer changed rather than every row reading the one active key.
    // Built unowned, as a row's spread is where `option` is first called and its rerun would stop them.
    const rows = new Map<ItemKey, OptionRow<Option>>()
    function rowOf(option: Option): OptionRow<Option> {
        const each = key(option)
        let row = rows.get(each)
        if (row === undefined) {
            // A long-lived list that has filtered through many keys keeps only those still listed.
            const listed = order.peek() ?? []
            if (rows.size > 64 && rows.size > 2 * listed.length) {
                const kept = new Set(listed)
                for (const stale of rows.keys())
                    if (!kept.has(stale)) rows.delete(stale)
            }
            row = unowned(() => newRow(option, each))
            rows.set(each, row)
        } else row.option = option
        return row
    }
    function newRow(option: Option, each: ItemKey): OptionRow<Option> {
        const row: OptionRow<Option> = {
            option,
            id: idOf(each),
            active: reactive(() => active() === each),
            selected: reactive(() => isSelected(each)),
            onpointermove: () => {
                const over = chosen.peek()
                const pointer = pointed.peek()
                if (pointer?.key === each && pointer.over === over) return
                pointed.set({ key: each, over })
            },
            // 51.99, 51.105.
            onclick: (event: MouseEvent) => {
                if (many) {
                    if (selection.press(each, event, active.peek(), order))
                        moveKey(each)
                    return
                }
                if (moveKey(each)) given.onpick?.(row.option)
            },
        }
        return row
    }

    return {
        id,
        get active() {
            return active() as Key | undefined
        },
        get activeOption() {
            return activeOption()
        },
        get activeId() {
            const current = active()
            return current === undefined ? undefined : idOf(current)
        },
        activate: moveKey,
        idOf,
        onkeydown: keydown,
        listbox: {
            role: 'listbox',
            'data-listbox': 'listbox',
            'aria-multiselectable': many ? 'true' : undefined,
        },
        option: (option) => {
            const row = rowOf(option)
            return {
                id: row.id,
                role: 'option',
                'data-listbox': 'option',
                // 51.98, 51.94 — where it selects one, the selection is the key moved to (51.104).
                get 'aria-selected'() {
                    return row.selected() ? 'true' : 'false'
                },
                get 'data-active'() {
                    return row.active() ? '' : undefined
                },
                get 'data-selected'() {
                    return row.selected() ? '' : undefined
                },
                onpointermove: row.onpointermove,
                onclick: row.onclick,
            }
        },
        selected: selection.selected as Reactive<Picked<Key, Multiple>>,
    }
}
