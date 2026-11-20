// 51.36-51.44 — WAI-ARIA's tabs, as parts an app spreads onto elements of its own: a tab list, a
// tab per key, and a panel — one following the selection, or one per tab, kept while hidden. The
// server writes every attribute, so the page is the selected tab's before it hydrates.

import { randomToken } from './randomToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { roving } from './roving.ts'

/** The tabs, and the one selected. */
export type TabsOptions = {
    /** The tabs' keys, in the order they render; a function is read live. */
    keys: readonly string[] | (() => readonly string[])
    /** The selected tab's key: hand it a `Reactive` to read and set the pick. A key no tab has selects the first. */
    selected?: Reactive<string | undefined>
}

/** The parts `tabs` hands back, each spread onto an element: `<button {...view.tab('notes')}>`. */
export type Tabs = {
    /** The tab list's attributes and its keyboard. */
    readonly list: Record<string, unknown>
    /** A tab's attributes and its click. */
    tab(key: string): Record<string, unknown>
    /** A panel's attributes: the one tab `key` names, hidden while another is selected, or, with no key, whichever is selected. */
    panel(key?: string): Record<string, unknown>
    /** The key of the tab selected, the first tab's where `selected` names none. */
    readonly current: Reactive<string | undefined>
}

/** WAI-ARIA's tabs: a list of tabs and the panels they show, as parts to spread. */
export function tabs(options: TabsOptions): Tabs {
    const { keys } = options
    const keysOf = typeof keys === 'function' ? keys : () => keys
    const selected = options.selected ?? reactive<string | undefined>(undefined)
    // 51.36 — a key no tab has selects the first.
    const current = reactive((): string | undefined => {
        const listed = keysOf()
        const wanted = selected()
        for (const each of listed) if (each === wanted) return wanted
        return listed[0]
    })
    // Hydration runs setup again (41.6), and every attribute naming one is bound to it, so the ids
    // are rewritten together.
    const base = `tabs-${randomToken(4, 'hex')}`
    const tabId = (key: string) => `${base}-tab-${encodeURIComponent(key)}`
    const panelId = (key: string) => `${base}-panel-${encodeURIComponent(key)}`

    // 51.40 — a key that selects moves focus with it.
    const select = (key: string): void => {
        selected.set(key)
        globalThis.document?.getElementById(tabId(key))?.focus()
    }

    const list = {
        role: 'tablist',
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

    const tab = (key: string): Record<string, unknown> => ({
        type: 'button',
        role: 'tab',
        id: tabId(key),
        'aria-controls': panelId(key),
        get 'aria-selected'() {
            return current() === key ? 'true' : 'false'
        },
        // 51.41 — only the selected tab is in the page's tab order.
        get tabindex() {
            return current() === key ? '0' : '-1'
        },
        get 'data-selected'() {
            return current() === key ? '' : undefined
        },
        onclick: () => select(key),
    })

    // 51.42 — a panel for one tab is hidden while another is selected; a panel for none takes the
    // selected tab's id, so that tab's `aria-controls` names it.
    const panel = (key?: string): Record<string, unknown> =>
        key === undefined
            ? {
                  role: 'tabpanel',
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
            : {
                  role: 'tabpanel',
                  tabindex: '0',
                  id: panelId(key),
                  'aria-labelledby': tabId(key),
                  get hidden() {
                      return current() !== key
                  },
              }

    return { list, tab, panel, current }
}
