// 49.7 — A PARTS FUNCTION CHECKS THE MARKUP IT WAS SPREAD ON, while developing: a reference naming an
// element that is not there, and a part outside the role WAI-ARIA requires around it, each warn once
// on `abide:parts` — and a build carries none of it. 49.14 — and a closed popover among the parts that
// is drawn all the same.

import { afterEach, expect, test } from 'bun:test'

import { menu } from '#shared/menu.ts'
import { tabs } from '#shared/tabs.ts'
import { host } from '#shared/tooltip/host.ts'
import { tree } from '#shared/tree.ts'

// THE EMULATOR HAS NO HIDING OF ITS OWN FOR A CLOSED POPOVER, which a browser writes as a rule an
// author's `display` outranks — so the browser's is put in under the inline style a test sets.
const drawn = HTMLElement.prototype.checkVisibility
HTMLElement.prototype.checkVisibility = function (options) {
    if (
        this.matches('[popover]:not(:popover-open)') &&
        this.style.display === ''
    )
        return false
    return drawn.call(this, options)
}

// A part spread as the template does: every attribute its record carries, read through its getters.
function element(tag: string, parts: Record<string, unknown>): HTMLElement {
    const made = document.createElement(tag)
    for (const [name, value] of Object.entries(parts)) {
        if (name.startsWith('on') || value === undefined || value === false)
            continue
        made.setAttribute(name, value === true ? '' : String(value))
    }
    return made
}

async function warnings(body: () => void): Promise<string[]> {
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]): void => {
        const line = args.join(' ')
        if (line.includes('abide:parts')) warned.push(line)
    }
    try {
        body()
        await new Promise((settle) => setTimeout(settle, 1))
    } finally {
        console.warn = warn
    }
    return warned
}

afterEach(() => {
    document.body.replaceChildren()
})

test('tabs spread whole warn of nothing', async () => {
    const warned = await warnings(() => {
        const view = tabs({ keys: ['notes'] })
        const list = element('div', view.list)
        list.append(element('button', view.tab('notes').button))
        document.body.append(list, element('div', view.tab('notes').panel))
    })
    expect(warned).toEqual([])
})

// THE REVERT: drop the check from `tabs`, and a tab naming a panel nobody rendered is said nothing of.
test('a tab whose panel is not there warns once, however many tabs name one', async () => {
    const warned = await warnings(() => {
        const view = tabs({ keys: ['notes', 'calls'] })
        const list = element('div', view.list)
        list.append(
            element('button', view.tab('notes').button),
            element('button', view.tab('calls').button),
        )
        document.body.append(list)
    })
    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain(
        'tabs: aria-controls names an element that is not there',
    )
})

// THE REVERT: drop the role check from `partsProblems`, and an item rendered outside its tree passes.
test('a tree item spread outside any tree warns', async () => {
    const warned = await warnings(() => {
        const accounts = tree<string>({
            roots: ['Acme'],
            children: () => undefined,
            key: (name) => name,
            label: (name) => name,
        })
        document.body.append(element('li', accounts.node('Acme').item))
    })
    expect(warned).toEqual([
        expect.stringContaining('tree: a treeitem stands outside any tree'),
    ])
})

test('a closed menu the browser hides warns of nothing', async () => {
    const warned = await warnings(() => {
        const actions = menu()
        const list = element('div', actions.menu)
        list.append(element('button', { role: 'menuitem' }))
        document.body.append(element('button', actions.trigger), list)
    })
    expect(warned).toEqual([])
})

// THE REVERT: drop the popover loop from `partsProblems`, and a menu a `display` keeps on the page
// after it closes is said nothing of.
test('a closed menu drawn by a display of its own warns', async () => {
    const warned = await warnings(() => {
        const actions = menu()
        const list = element('div', actions.menu)
        list.style.display = 'flex'
        list.append(element('button', { role: 'menuitem' }))
        document.body.append(element('button', actions.trigger), list)
    })
    expect(warned).toEqual([
        expect.stringContaining('menu: a closed popover is drawn'),
    ])
})

// THE REVERT: drop `checkPopover` from the host's binding, and a hint drawn while closed passes.
test('a closed tooltip host drawn by a display of its own warns', async () => {
    const warned = await warnings(() => {
        const shown = host()
        const hint = element('span', shown.hint)
        hint.style.display = 'block'
        document.body.append(hint)
        ;(shown.hint['bind:element'] as (element: HTMLElement) => void)(hint)
    })
    expect(warned).toEqual([
        expect.stringContaining('tooltip.host: a closed popover is drawn'),
    ])
})

// THE REVERT: guard the call with a test made as it runs (`typeof document !== 'undefined'`) rather
// than `NODE_ENV`, and the build keeps the check, since no bundler can fold that.
test('a build carries no check', async () => {
    const built = await Bun.build({
        entrypoints: [
            new URL('../src/shared/tabs.ts', import.meta.url).pathname,
        ],
        target: 'browser',
        define: { 'process.env.NODE_ENV': '"production"' },
        minify: { whitespace: true, syntax: true, identifiers: true },
    })
    const source = await (built.outputs[0] as Blob).text()
    expect(source).toContain('tablist')
    expect(source).not.toContain('abide:parts')
})
