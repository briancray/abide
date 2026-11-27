// 50.30, 51.4-51.6, 51.36, 51.37 — ONE ROVING KEYBOARD under `listbox`, `menu` and `tabs`: the same
// keys walked over three items land each of the three on the same item, step for step. The menu's own
// step back once landed one short of the last from no focused item (menuKeys.test.ts); a copy per
// widget is a copy that drifts.
//
// THE REVERT: give `tabs` its own step forward that stops at the last tab rather than going round, and
// its walk reads `c` where the others read `a`.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, listbox, reactive, tabs, tree } from '#shared'
import { menu } from '#shared/menu.ts'

import { bindPart } from './bindPart.ts'

afterEach(() => document.body.replaceChildren())

const ITEMS = ['a', 'b', 'c']
// Forward past the end, back past the start, then the ends: every rule the three share.
const WALK = [
    'forward',
    'forward',
    'forward',
    'back',
    'back',
    'End',
    'Home',
] as const

function keyOf(step: (typeof WALK)[number], vertical: boolean): string {
    if (step === 'forward') return vertical ? 'ArrowDown' : 'ArrowRight'
    if (step === 'back') return vertical ? 'ArrowUp' : 'ArrowLeft'
    return step
}

function press(handler: (event: KeyboardEvent) => void, key: string): void {
    handler(new KeyboardEvent('keydown', { key, cancelable: true }))
    flushSync()
}

function walkListbox(): string[] {
    const list = listbox({
        id: 'walk',
        options: reactive(ITEMS),
        key: (each: string) => each,
    })
    const landed: string[] = []
    for (const step of WALK) {
        press(list.onkeydown, keyOf(step, true))
        landed.push(list.active ?? '')
    }
    return landed
}

function walkMenu(): string[] {
    const parts = menu()
    const list = document.createElement('div')
    list.id = parts.menu.id as string
    for (const text of ITEMS) {
        const item = document.createElement('button')
        item.setAttribute('role', 'menuitem')
        item.textContent = text
        list.append(item)
    }
    document.body.append(list)
    ;(list.firstElementChild as HTMLElement).focus()
    const landed: string[] = []
    for (const step of WALK) {
        press(
            parts.menu.onkeydown as (event: KeyboardEvent) => void,
            keyOf(step, true),
        )
        landed.push(document.activeElement?.textContent ?? '')
    }
    document.body.replaceChildren()
    return landed
}

function walkTabs(): string[] {
    const view = tabs({ items: ITEMS })
    for (const key of ITEMS) {
        const tab = document.createElement('button')
        tab.id = view.tab(key).button.id as string
        document.body.append(tab)
    }
    const landed: string[] = []
    for (const step of WALK) {
        press(
            view.list.onkeydown as (event: KeyboardEvent) => void,
            keyOf(step, false),
        )
        landed.push(view.selected.get() ?? '')
    }
    document.body.replaceChildren()
    return landed
}

test('listbox, menu and tabs land on the same item for the same keys — 50.30, 51.4-51.6, 51.36, 51.37', () => {
    // From the first item: on to b, c, round to a, back round to c, b, then the ends.
    const expected = ['b', 'c', 'a', 'c', 'b', 'c', 'a']
    expect(walkListbox()).toEqual(expected)
    expect(walkMenu()).toEqual(expected)
    expect(walkTabs()).toEqual(expected)
})

// 50.28, 51.14 — THE KEYS THAT OPEN A SHUT LIST ARE THE ARROWS IT ROVES BY: a shut list opened by a key
// lands where `roving` steps from no item, and Home, End and every other key open nothing. `menu`'s
// trigger and `Combobox`'s input both ask `openingEnd`.
//
// THE REVERT: let `openingEnd` open on Home, and Home's row reads `first` where roving's reads none.
test('a key opens a shut list exactly where roving steps from no item', async () => {
    const { openingEnd, roving } = await import('#shared/roving.ts')
    for (const orientation of ['vertical', 'horizontal'] as const)
        for (const key of [
            'ArrowDown',
            'ArrowUp',
            'ArrowLeft',
            'ArrowRight',
            'Home',
            'End',
            'Enter',
            'a',
        ]) {
            const stepped = roving(key, orientation, () => [-1, 3])
            const opened = openingEnd(key, orientation)
            const fromNone =
                stepped === -1 || key === 'Home' || key === 'End'
                    ? undefined
                    : stepped === 0
                      ? 'first'
                      : 'last'
            expect([orientation, key, opened]).toEqual([
                orientation,
                key,
                fromNone,
            ])
        }
})

// 50.28 — a menu's trigger opens on ArrowUp at its last item, and on Home not at all.
test("a menu's trigger opens on the arrows openingEnd names, and at that end", () => {
    const parts = menu()
    const list = document.createElement('div')
    list.id = parts.id
    list.setAttribute('popover', 'manual')
    list.addEventListener('toggle', parts.menu.ontoggle as EventListener)
    for (const text of ITEMS) {
        const item = document.createElement('button')
        item.setAttribute('role', 'menuitem')
        item.textContent = text
        list.append(item)
    }
    const button = document.createElement('button')
    button.id = parts.trigger.id as string
    document.body.append(button, list)
    // Let go at the end, or the open popover stays a layer on `dismissible`'s stack for the next file.
    using _bound = { [Symbol.dispose]: bindPart(parts.menu, list) }
    const keydown = parts.trigger.onkeydown as (event: KeyboardEvent) => void
    press(keydown, 'Home')
    expect(parts.open.get()).toBe(false)
    press(keydown, 'ArrowUp')
    expect(parts.open.get()).toBe(true)
    expect(document.activeElement?.textContent).toBe('c')
})

// 50.40, 51.82 — ONE TYPE-AHEAD under `menu` and `tree`: a letter typed again walks the items that
// start with it, round the end, and letters typed together are one word. THE REVERT: give `menu` back
// a type-ahead of its own that starts the search at the item on now rather than past it, and B typed
// twice stays on the first B.
test('a letter walks the items that start with it, in a menu as in a tree — 50.40, 51.82', () => {
    const NAMES = ['Ada', 'Babbage', 'Byron', 'Boole']
    const parts = menu()
    const list = document.createElement('div')
    list.id = parts.menu.id as string
    for (const text of NAMES) {
        const item = document.createElement('button')
        item.setAttribute('role', 'menuitem')
        item.textContent = text
        list.append(item)
    }
    document.body.append(list)
    ;(list.firstElementChild as HTMLElement).focus()
    const keydown = parts.menu.onkeydown as (event: KeyboardEvent) => void
    // A second apart, so each letter is a search of its own rather than a word.
    const typed = (key: string, at: number) => {
        const event = new KeyboardEvent('keydown', { key, cancelable: true })
        Object.defineProperty(event, 'timeStamp', { value: at * 1000 })
        Object.defineProperty(event, 'target', {
            value: document.activeElement,
        })
        return event
    }
    const inMenu: string[] = []
    for (const [at, key] of ['b', 'b', 'b', 'b'].entries()) {
        keydown(typed(key, at))
        inMenu.push(document.activeElement?.textContent ?? '')
    }
    document.body.replaceChildren()

    const view = tree({
        roots: NAMES,
        children: () => undefined,
        key: (name: string) => name,
        label: (name: string) => name,
    })
    const root = document.createElement('ul')
    for (const name of NAMES) {
        const item = document.createElement('li')
        item.id = view.node(name).item.id as string
        item.textContent = name
        item.tabIndex = -1
        root.append(item)
    }
    document.body.append(root)
    ;(root.firstElementChild as HTMLElement).focus()
    const inTree: string[] = []
    for (const [at, key] of ['b', 'b', 'b', 'b'].entries()) {
        ;(view.tree.onkeydown as (event: KeyboardEvent) => void)(typed(key, at))
        flushSync()
        inTree.push(document.activeElement?.textContent ?? '')
    }
    expect(inMenu).toEqual(['Babbage', 'Byron', 'Boole', 'Babbage'])
    expect(inTree).toEqual(inMenu)
})
