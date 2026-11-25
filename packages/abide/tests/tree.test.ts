// 51.77-51.84, 51.98-51.103 — `tree`'s parts, driven directly: a listener called with the event a
// browser would send, and focus read off the document. What a template does with them is the CRM's
// tests'.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, jsonSchema, reactive, tree } from '#shared'

afterEach(() => document.body.replaceChildren())

// THE REVERT: focus the next item whatever `extend` answered, and the refused Shift+ArrowDown takes
// focus to `b`; focus the clicked item whatever `press` answered, and the refused click takes it to `c`.
test('a refused selection leaves focus on the item it was on — 49.19', () => {
    const view = tree({
        id: 'refused',
        roots: ['a', 'b', 'c'],
        key: (letter) => letter,
        label: (letter) => letter,
        children: () => undefined,
        multiple: true,
        selected: reactive<readonly string[]>(['a'], {
            schema: jsonSchema<readonly string[]>({
                type: 'array',
                maxItems: 1,
            }),
        }),
    })
    for (const letter of ['a', 'b', 'c']) {
        const item = document.createElement('div')
        item.id = view.node(letter).item.id as string
        item.setAttribute('role', 'treeitem')
        item.tabIndex = -1
        document.body.append(item)
    }
    const first = document.getElementById('refused-a') as HTMLElement
    first.focus()
    const keydown = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        shiftKey: true,
        cancelable: true,
    })
    first.addEventListener('keydown', (event) =>
        (view.tree.onkeydown as (event: KeyboardEvent) => void)(event),
    )
    first.dispatchEvent(keydown)
    flushSync()
    expect([view.selected(), document.activeElement?.id]).toEqual([
        ['a'],
        'refused-a',
    ])
    const last = document.getElementById('refused-c') as HTMLElement
    ;(view.node('c').item.onclick as (event: MouseEvent) => void)(
        Object.defineProperty(
            new MouseEvent('click', { shiftKey: true }),
            'target',
            { value: last },
        ),
    )
    flushSync()
    expect([view.selected(), document.activeElement?.id]).toEqual([
        ['a'],
        'refused-a',
    ])
})
