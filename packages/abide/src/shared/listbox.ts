import { checkParts } from './checkParts.ts'
import { hotkeys } from './hotkeys.ts'
import { type KeyOption, writtenBy } from './itemKey.ts'
import { type Live, live } from './live.ts'
import { randomToken } from './randomToken.ts'
import { memo, type Reactive, reactive } from './reactive/index.ts'
import { roving } from './roving.ts'
import { type Picked, Selection } from './Selection.ts'

/** What `listbox` is handed: the options, how each is told apart, what is selected, and what Enter and Escape do. */
export type ListboxOptions<Option, Multiple extends boolean = false> = {
    /** The base every option's element id is derived from; unique on the page. One is made where none is given. */
    id?: string
    /** The options in the order they render; a function is read live. */
    options: Live<readonly Option[]>
    /** Whether an arrow past either end goes round to the other end. `true` unless set; a function is read live. */
    wrap?: Live<boolean>
    /** 51.98 — whether it selects many, each press changing the selection rather than moving it. `false` by default. */
    multiple?: Multiple
    /** The keys selected, where the app holds them: a `Reactive` to read and set. Where it selects one, the key last moved to (51.104). Held by the parts, and handed back as `selected`, where none is given. */
    selected?: Reactive<Picked<string, Multiple>>
    /** Called with the active option when Enter is pressed, and with an option clicked where it selects one. */
    onpick?: (option: Option) => void
    /** Called when Escape is pressed. */
    onescape?: () => void
} & KeyOption<Option>

/** The keyboard over a list of options, which of them is active, and which are selected. */
export type Listbox<Option, Multiple extends boolean = false> = {
    /** The base the options' ids are derived from. */
    readonly id: string
    /** The active option's key, read live; `undefined` while the list is empty. */
    get active(): string | undefined
    /** The active option itself. */
    get activeOption(): Option | undefined
    /** The active option's id, for the focused element's `aria-activedescendant`; `undefined` while none is active. */
    get activeId(): string | undefined
    /** Makes the option with `key` active, as a pointer resting on it does. */
    activate: (key: string) => void
    /** The id the option with `key` renders with, which `aria-activedescendant` names. */
    idOf: (key: string) => string
    /** The `keydown` listener for the focused element: the list's own, or a field that keeps focus while it walks the list. */
    onkeydown: (event: KeyboardEvent) => void
    /** The list's part: its role. */
    readonly listbox: Record<string, unknown>
    /** The option of `key`'s part: its id, role, `aria-selected`, `data-active`, `data-selected`, the pointer resting on it activating it, and its click. */
    option(key: string): Record<string, unknown>
    /** The keys selected, read and set: the key last moved to, or every key selected where it selects many. */
    readonly selected: Reactive<Picked<string, Multiple>>
}

/** A keyboard controller over a list of keyed options, for markup the app writes itself. */
export function listbox<Option, Multiple extends boolean = false>(
    given: ListboxOptions<Option, Multiple>,
): Listbox<Option, Multiple> {
    // 49.11 — read where they are used; the id and whether it selects many are fixed for the life of
    // the parts.
    const options = () => live(given.options)
    const id = given.id ?? `listbox-${randomToken(4, 'hex')}`
    const key = (option: Option) => writtenBy(given.key, option)
    const many = given.multiple === true
    if (process.env.NODE_ENV !== 'production') checkParts('listbox', `${id}-`)
    const selection = new Selection(
        given.selected as Reactive<Picked<string, boolean>> | undefined,
        many,
    )
    // The key last moved to; what is active is this key while it is listed, and the first otherwise.
    // 51.104 — where it selects one, that key is the selection.
    const chosen = many
        ? reactive<string | undefined>(undefined)
        : (selection.selected as Reactive<string | undefined>)
    const order = () => {
        const keys: string[] = []
        for (const option of options()) keys.push(key(option))
        return keys
    }
    // 51.101 — `mod+a` as `hotkeys` reads it, only where it selects many.
    const selectAll = many
        ? hotkeys({ 'mod+a': () => selection.all(order) })
        : undefined
    const active = memo(() => {
        const wanted = chosen()
        let first: string | undefined
        for (const option of options()) {
            const each = key(option)
            if (each === wanted) return each
            first ??= each
        }
        return first
    })

    function optionOf(wanted: string | undefined): Option | undefined {
        for (const option of options())
            if (key(option) === wanted) return option
        return undefined
    }

    function activeOption(): Option | undefined {
        return optionOf(active())
    }

    function idOf(each: string): string {
        return `${id}-option-${encodeURIComponent(each)}`
    }

    function moveTo(at: number, extend: boolean): void {
        const list = options()
        const option = list[at]
        if (option === undefined) return
        const each = key(option)
        const from = active.peek()
        chosen.set(each)
        // 51.103 — Shift carries the selection along with the move.
        if (extend) selection.extend(from, each, order)
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

    return {
        id,
        get active() {
            return active()
        },
        get activeOption() {
            return activeOption()
        },
        get activeId() {
            const current = active()
            return current === undefined ? undefined : idOf(current)
        },
        activate: (each) => chosen.set(each),
        idOf,
        onkeydown: keydown,
        listbox: {
            role: 'listbox',
            'data-listbox': 'listbox',
            'aria-multiselectable': many ? 'true' : undefined,
        },
        option: (each) => ({
            id: idOf(each),
            role: 'option',
            'data-listbox': 'option',
            // 51.98 — where it selects one, the selection is the active option (51.104).
            get 'aria-selected'() {
                return (many ? selection.has(each) : active() === each)
                    ? 'true'
                    : 'false'
            },
            get 'data-active'() {
                return active() === each ? '' : undefined
            },
            get 'data-selected'() {
                return many && selection.has(each) ? '' : undefined
            },
            onpointermove: () => chosen.set(each),
            // 51.99, 51.105.
            onclick: (event: MouseEvent) => {
                if (many) {
                    selection.press(each, event, active.peek(), order)
                    chosen.set(each)
                    return
                }
                chosen.set(each)
                const option = optionOf(each)
                if (option !== undefined) given.onpick?.(option)
            },
        }),
        selected: selection.selected as Reactive<Picked<string, Multiple>>,
    }
}
