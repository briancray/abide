import { checkParts } from './checkParts.ts'
import { type KeyOption, writtenBy } from './itemKey.ts'
import { type Live, live } from './live.ts'
import { randomToken } from './randomToken.ts'
import { reactive } from './reactive/index.ts'
import { roving } from './roving.ts'

/** What `listbox` is handed: the options, how each is told apart, and what Enter and Escape do. */
export type ListboxOptions<Option> = {
    /** The base every option's element id is derived from; unique on the page. One is made where none is given. */
    id?: string
    /** The options in the order they render; a function is read live. */
    options: Live<readonly Option[]>
    /** Whether an arrow past either end goes round to the other end. `true` unless set; a function is read live. */
    wrap?: Live<boolean>
    /** Called with the active option when Enter is pressed. */
    onpick?: (option: Option) => void
    /** Called when Escape is pressed. */
    onescape?: () => void
} & KeyOption<Option>

/** The keyboard over a list of options, and which of them is active. */
export type Listbox<Option> = {
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
    /** The listener a focused element hands its `keydown` to. */
    keydown: (event: KeyboardEvent) => void
    /** The list's part: its role. */
    readonly listbox: Record<string, unknown>
    /** The option of `key`'s part: its id, role, `aria-selected`, `data-active`, and the pointer resting on it activating it. */
    option(key: string): Record<string, unknown>
}

/** A keyboard controller over a list of keyed options, for markup the app writes itself. */
export function listbox<Option>(
    given: ListboxOptions<Option>,
): Listbox<Option> {
    // 49.13 — read where they are used; the id is fixed for the life of the parts.
    const options = () => live(given.options)
    const id = given.id ?? `listbox-${randomToken(4, 'hex')}`
    const key = (option: Option) => writtenBy(given.key, option)
    if (process.env.NODE_ENV !== 'production') checkParts('listbox', `${id}-`)
    // The key last moved to; what is active is this key while it is listed, and the first otherwise.
    const chosen = reactive<string | undefined>(undefined)
    const active = reactive(() => {
        const wanted = chosen()
        let first: string | undefined
        for (const option of options()) {
            const each = key(option)
            if (each === wanted) return each
            first ??= each
        }
        return first
    })

    function activeOption(): Option | undefined {
        const current = active()
        for (const option of options())
            if (key(option) === current) return option
        return undefined
    }

    function idOf(each: string): string {
        return `${id}-option-${encodeURIComponent(each)}`
    }

    function moveTo(at: number): void {
        const list = options()
        const option = list[at]
        if (option === undefined) return
        const each = key(option)
        chosen.set(each)
        // The active option kept in view as the arrows step through a list longer than its box.
        globalThis.document
            ?.getElementById(idOf(each))
            ?.scrollIntoView?.({ block: 'nearest' })
    }

    function keydown(event: KeyboardEvent): void {
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
            moveTo(next)
            return
        }
        switch (event.key) {
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
        keydown,
        listbox: { role: 'listbox', 'data-listbox': 'listbox' },
        option: (each) => ({
            id: idOf(each),
            role: 'option',
            'data-listbox': 'option',
            get 'aria-selected'() {
                return active() === each ? 'true' : 'false'
            },
            get 'data-active'() {
                return active() === each ? '' : undefined
            },
            onpointermove: () => chosen.set(each),
        }),
    }
}
