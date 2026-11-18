import { reactive } from './reactive/index.ts'

/** What `listbox` is handed: the options, how each is told apart, and what Enter and Escape do. */
export type ListboxOptions<Option> = {
    /** The base every option's element id is derived from; unique on the page. */
    id: string
    /** The options in the order they render, read live: hand it a function reading a reactive value. */
    options: () => readonly Option[]
    /** What tells one option from another; the active option follows this key as the list changes. */
    key: (option: Option) => string
    /** Whether an arrow past either end goes round to the other end. `true` unless set. */
    wrap?: boolean
    /** Called with the active option when Enter is pressed. */
    onpick?: (option: Option) => void
    /** Called when Escape is pressed. */
    onescape?: () => void
}

/** The keyboard over a list of options, and which of them is active. */
export type Listbox<Option> = {
    /** The active option's key, read live; `undefined` while the list is empty. */
    active: () => string | undefined
    /** The active option itself. */
    activeOption: () => Option | undefined
    /** The active option's id, for the focused element's `aria-activedescendant`; `undefined` while none is active. */
    activeId: () => string | undefined
    /** Makes the option with `key` active, as a pointer resting on it does. */
    activate: (key: string) => void
    /** The id the option with `key` renders with, which `aria-activedescendant` names. */
    idOf: (key: string) => string
    /** The listener a focused element hands its `keydown` to. */
    keydown: (event: KeyboardEvent) => void
}

/** A keyboard controller over a list of keyed options, for markup the app writes itself. */
export function listbox<Option>(
    given: ListboxOptions<Option>,
): Listbox<Option> {
    const { id, options, key, wrap = true, onpick, onescape } = given
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

    function step(by: 1 | -1): void {
        const list = options()
        if (list.length === 0) return
        const current = active.peek()
        let at = -1
        for (let index = 0; index < list.length; index += 1)
            if (key(list[index] as Option) === current) at = index
        let next = at === -1 ? (by === 1 ? 0 : list.length - 1) : at + by
        if (next < 0) next = wrap ? list.length - 1 : 0
        if (next >= list.length) next = wrap ? 0 : list.length - 1
        moveTo(next)
    }

    function keydown(event: KeyboardEvent): void {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault()
                step(1)
                return
            case 'ArrowUp':
                event.preventDefault()
                step(-1)
                return
            case 'Home':
                event.preventDefault()
                moveTo(0)
                return
            case 'End':
                event.preventDefault()
                moveTo(options().length - 1)
                return
            case 'Enter': {
                const option = activeOption()
                if (option === undefined || onpick === undefined) return
                event.preventDefault()
                onpick(option)
                return
            }
            case 'Escape':
                if (onescape === undefined) return
                event.preventDefault()
                onescape()
        }
    }

    return {
        active: () => active(),
        activeOption,
        activeId: () => {
            const current = active()
            return current === undefined ? undefined : idOf(current)
        },
        activate: (each) => chosen.set(each),
        idOf,
        keydown,
    }
}
