// 51.36-51.42 — `tabs`'s parts, spread by hand as 32.11 spreads them: an attribute per string or
// boolean read at the spread, a listener per `on<event>`. What a template does with them is the
// CRM's tests'.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, reactive, tabs, watch } from '#shared'

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
test('a panel per tab is hidden while another is selected, and kept — 51.36, 51.42', () => {
    const selected = reactive<string | undefined>('nowhere')
    const view = tabs({ keys: ['details', 'notes'], selected })
    const panels = new Map<string, HTMLElement>()
    for (const key of ['details', 'notes']) {
        const tab = document.createElement('button')
        const panel = document.createElement('div')
        spread(tab, view.tab(key))
        spread(panel, view.panel(key))
        panels.set(key, panel)
        document.body.append(tab, panel)
    }
    const hidden = () =>
        [...panels.values()].map((panel) => panel.hasAttribute('hidden'))
    expect(view.current()).toBe('details')
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
