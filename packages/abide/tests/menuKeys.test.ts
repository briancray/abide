import { afterEach, expect, test } from 'bun:test'

import { menu } from '#shared/menu.ts'

afterEach(() => {
    document.body.replaceChildren()
})

// THE REVERT: step back by `(at - 1 + length) % length`, as the menu once did — from no focused item
// (`at` -1) that lands on the item before the last, and this reports `b`.
test('ArrowUp with no item focused moves focus to the last item — 50.30', () => {
    const parts = menu()
    const list = document.createElement('div')
    list.id = parts.menu.id as string
    for (const text of ['a', 'b', 'c']) {
        const item = document.createElement('button')
        item.setAttribute('role', 'menuitem')
        item.textContent = text
        list.append(item)
    }
    document.body.append(list)
    ;(document.activeElement as HTMLElement | null)?.blur()
    ;(parts.menu.onkeydown as (event: KeyboardEvent) => void)(
        new KeyboardEvent('keydown', { key: 'ArrowUp' }),
    )
    expect(document.activeElement?.textContent).toBe('c')
})
