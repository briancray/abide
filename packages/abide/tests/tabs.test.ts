// 51.34-51.40 — `tabs`'s parts, spread by hand as 32.11 spreads them: an attribute per string or
// boolean read at the spread, a listener per `on<event>`. What a template does with them is the
// CRM's tests'.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, jsonSchema, reactive, tabs, watch } from '#shared'

afterEach(() => document.body.replaceChildren())

function spread(element: HTMLElement, part: Record<string, unknown>): void {
    const names = Object.keys(part)
    for (const name of names)
        if (name.startsWith('on'))
            element.addEventListener(name.slice(2), part[name] as EventListener)
    watch(() => {
        for (const name of names) {
            if (name.startsWith('on')) continue
            const value = part[name]
            if (value === undefined || value === false)
                element.removeAttribute(name)
            else element.setAttribute(name, value === true ? '' : String(value))
        }
    })
}

// THE REVERT: drop the panel's `hidden`, and both panels show at once.
test('a panel per tab is hidden while another is selected, and kept — 51.34, 51.40', () => {
    const selected = reactive<string | undefined>('nowhere')
    const view = tabs({ items: ['details', 'notes'], selected })
    const panels = new Map<string, HTMLElement>()
    for (const key of ['details', 'notes']) {
        const tab = document.createElement('button')
        const panel = document.createElement('div')
        spread(tab, view.tab(key).button)
        spread(panel, view.tab(key).panel)
        panels.set(key, panel)
        document.body.append(tab, panel)
    }
    const hidden = () =>
        [...panels.values()].map((panel) => panel.hasAttribute('hidden'))
    expect(view.selected.get()).toBe('details')
    expect(hidden()).toEqual([false, true])
    const notes = panels.get('notes') as HTMLElement
    notes.textContent = 'call back Friday'
    ;(
        document.getElementById(
            notes.getAttribute('aria-labelledby') ?? '',
        ) as HTMLElement
    ).click()
    flushSync()
    expect(selected.peek()).toBe('notes')
    expect(hidden()).toEqual([true, false])
    expect(notes.textContent).toBe('call back Friday')
})

// 49.8, 49.16 — A RECORD IS TOLD APART BY ITS `id`, given no `key`, and its part is a function of the
// record. THE REVERT: key every item by `String(item)` again, and both views are `[object Object]` —
// one key, the second tab never selected.
test("tabs over records are told apart by each record's id, and a key replaces it — 49.8, 49.16", () => {
    const VIEWS = [
        { id: 'details', label: 'Details' },
        { id: 'stage', label: 'Stage' },
    ]
    const view = tabs({ items: VIEWS })
    expect(view.selected.get()).toBe('details')
    ;(
        view.tab(VIEWS[1] as (typeof VIEWS)[number]).button
            .onclick as () => void
    )()
    expect(view.selected.get()).toBe('stage')
    expect(
        view.tab(VIEWS[1] as (typeof VIEWS)[number]).button['aria-selected'],
    ).toBe('true')

    const byLabel = tabs({ items: VIEWS, key: (each) => each.label })
    expect(byLabel.selected.get()).toBe('Details')
})

// THE REVERT: focus the tab whatever the write to `selected` answered, and the refused ArrowRight
// takes focus to `notes`' tab.
test('a refused selection leaves focus on the tab it was on — 49.19', () => {
    const view = tabs({
        id: 'refused',
        items: ['details', 'notes'],
        selected: reactive<string | undefined>('details', {
            schema: jsonSchema<string | undefined>({ enum: ['details'] }),
        }),
    })
    for (const key of ['details', 'notes']) {
        const button = document.createElement('button')
        spread(button, view.tab(key).button)
        document.body.append(button)
    }
    ;(document.getElementById('refused-tab-details') as HTMLElement).focus()
    ;(view.list.onkeydown as (event: KeyboardEvent) => void)(
        new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    flushSync()
    expect([view.selected.get(), document.activeElement?.id]).toEqual([
        'details',
        'refused-tab-details',
    ])
})
