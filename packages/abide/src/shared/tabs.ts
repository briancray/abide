// 51.34-51.42 — WAI-ARIA's tabs, as parts an app spreads onto elements of its own: a tab list, a
// tab per item, and a panel — one following the selection, or one per tab, kept while hidden. The
// server writes every attribute, so the page is the selected tab's before it hydrates.

import { checkParts } from './checkParts.ts'
import { keyOfItem, type KeyOption } from './itemKey.ts'
import { type Live, live } from './live.ts'
import { randomToken } from './randomToken.ts'
import { derived, type Reactive, reactive } from './reactive/index.ts'
import { reactiveOver } from './reactiveOver.ts'
import { roving } from './roving.ts'

/** The tabs, how each is told apart, and the one selected. */
export type TabsOptions<Item> = {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
    /** The tabs, in the order they render; a function is read live. */
    items: Live<readonly Item[]>
    /** The selected tab's key, where the app holds it: a `Reactive` to read and set the pick. Held by the parts, and handed back as `selected`, where none is given. A key no tab has selects the first. */
    selected?: Reactive<string | undefined> | undefined
} & KeyOption<Item>

/** One tab's parts: its button, and the panel kept for it alone, hidden while another is selected. */
export type TabParts = {
    /** The tab's attributes and its click, on a `<button>`. */
    readonly button: Record<string, unknown>
    /** The attributes of a panel shown for this tab alone and kept, hidden, while another is selected. */
    readonly panel: Record<string, unknown>
}

/** The parts `tabs` hands back, each spread onto an element: `<button {...view.tab('notes').button}>`. */
export type Tabs<Item> = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The tab list's attributes and its keyboard. */
    readonly list: Record<string, unknown>
    /** One tab's parts. */
    tab(item: Item): TabParts
    /** The attributes of the one panel every tab shows in, holding whichever is selected. */
    readonly panel: Record<string, unknown>
    /** The key of the tab selected, the first tab's where none is picked; written, it picks one. */
    readonly selected: Reactive<string | undefined>
}

/** WAI-ARIA's tabs: a list of tabs and the panels they show, as parts to spread. */
export function tabs<Item>(options: TabsOptions<Item>): Tabs<Item> {
    const keyOf = (item: Item) => keyOfItem(options.key, item)
    const keysOf = derived((): readonly string[] => {
        const written: string[] = []
        for (const item of live(options.items)) written.push(keyOf(item))
        return written
    })
    const picked = options.selected ?? reactive<string | undefined>(undefined)
    // 51.34 — a key no tab has selects the first.
    const current = derived((): string | undefined => {
        const listed = keysOf()
        const wanted = picked()
        for (const each of listed) if (each === wanted) return wanted
        return listed[0]
    })
    // Hydration runs setup again (41.6), and every attribute naming one is bound to it, so the ids
    // are rewritten together.
    const base = options.id ?? `tabs-${randomToken(4, 'hex')}`
    const tabId = (key: string) => `${base}-tab-${encodeURIComponent(key)}`
    const panelId = (key: string) => `${base}-panel-${encodeURIComponent(key)}`
    if (process.env.NODE_ENV !== 'production') checkParts('tabs', base)

    // 51.38 — a key that selects moves focus with it.
    const select = (key: string): void => {
        if (picked.set(key) === undefined)
            globalThis.document?.getElementById(tabId(key))?.focus()
    }

    const list = {
        role: 'tablist',
        'data-tabs': 'list',
        onkeydown: (event: KeyboardEvent) => {
            const listed = keysOf()
            const key =
                listed[
                    roving(event.key, 'horizontal', () => [
                        listed.indexOf(current() as string),
                        listed.length,
                    ])
                ]
            if (key === undefined) return
            event.preventDefault()
            select(key)
        },
    }

    const tab = (item: Item): TabParts => {
        const key = keyOf(item)
        return {
            button: {
                type: 'button',
                role: 'tab',
                'data-tabs': 'tab',
                id: tabId(key),
                // 51.40 — only the selected tab names its panel: the shared panel exists for it alone, so a
                // tab naming its own while another is selected would name nothing.
                get 'aria-controls'() {
                    return current() === key ? panelId(key) : undefined
                },
                get 'aria-selected'() {
                    return current() === key ? 'true' : 'false'
                },
                // 51.39 — only the selected tab is in the page's tab order.
                get tabindex() {
                    return current() === key ? '0' : '-1'
                },
                get 'data-selected'() {
                    return current() === key ? '' : undefined
                },
                onclick: () => select(key),
            },
            // 51.40 — a tab's own panel is hidden while another is selected.
            panel: {
                role: 'tabpanel',
                'data-tabs': 'panel',
                tabindex: '0',
                id: panelId(key),
                'aria-labelledby': tabId(key),
                get hidden() {
                    return current() !== key
                },
            },
        }
    }

    // 51.40 — the shared panel takes the selected tab's id, so that tab's `aria-controls` names it.
    const panel = {
        role: 'tabpanel',
        'data-tabs': 'panel',
        tabindex: '0',
        get id() {
            const shown = current()
            return shown === undefined ? undefined : panelId(shown)
        },
        get 'aria-labelledby'() {
            const shown = current()
            return shown === undefined ? undefined : tabId(shown)
        },
    }

    const selected = reactiveOver(
        () => current(),
        (key: string | undefined) => picked.set(key),
    )
    return { id: base, list, tab, panel, selected }
}
