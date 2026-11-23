// 51.145-51.151 — `sortableList`, a `listbox` reordered: its list keyed and its grips dragged as a
// browser would, the emulator's missing layout answered with each item's box, and what it reads out
// heard through `said`.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, reactive, sortableList } from '#shared'
import { said } from '#shared/announce.ts'
import type { SortableListOptions } from '#shared/sortableList.ts'

import { bindPart } from './bindPart.ts'

const bound: (() => void)[] = []
afterEach(() => {
    for (const release of bound.splice(0)) release()
    document.body.replaceChildren()
})

const BOOKS = ['Dune', 'Emma', 'Ulysses', 'Beloved']

// The list and an item per book, each 40px tall from the top, every listener added as a spread adds it.
function standing(
    options: Omit<SortableListOptions<string, boolean>, 'items'> = {},
) {
    const ranks = sortableList<string, boolean>({ items: BOOKS, ...options })
    const list = document.createElement('ol')
    const listen = (element: Element, part: Record<string, unknown>) => {
        for (const [name, value] of Object.entries(part))
            if (name === 'bind:element') bound.push(bindPart(part, element))
            else if (name.startsWith('on'))
                element.addEventListener(name.slice(2), value as EventListener)
    }
    listen(list, ranks.list)
    const items = new Map<string, { item: HTMLElement; grip: HTMLElement }>()
    BOOKS.forEach((book, at) => {
        const item = document.createElement('li')
        item.getBoundingClientRect = () =>
            ({ top: at * 40, height: 40 }) as DOMRect
        const grip = document.createElement('span')
        listen(item, ranks.item(book).item)
        listen(grip, ranks.item(book).handle)
        item.append(grip)
        list.append(item)
        items.set(book, { item, grip })
    })
    document.body.append(list)
    const key = (name: string, held: KeyboardEventInit = {}) => {
        list.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: name,
                cancelable: true,
                ...held,
            }),
        )
        flushSync()
    }
    const click = (book: string, held: MouseEventInit = {}) => {
        items
            .get(book)
            ?.item.dispatchEvent(
                new MouseEvent('click', { bubbles: true, ...held }),
            )
        flushSync()
    }
    const drag = (book: string, toY: number) => {
        const grip = items.get(book)?.grip as HTMLElement
        grip.dispatchEvent(
            new PointerEvent('pointerdown', { button: 0, bubbles: true }),
        )
        flushSync()
        grip.dispatchEvent(
            new PointerEvent('pointermove', { clientY: toY, bubbles: true }),
        )
        flushSync()
        grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        flushSync()
    }
    return { ranks, key, click, drag }
}

// THE REVERT: list the items as given, and `sorted` ignores the order put.
test('sorted is the items in the order put, any it does not name after them — 51.145', () => {
    const { ranks } = standing({
        order: reactive<readonly string[]>(['Ulysses', 'Dune']),
    })
    expect(ranks.sorted).toEqual(['Ulysses', 'Dune', 'Emma', 'Beloved'])
})

// THE REVERT: count only the middles a whole item above the pointer, and a drag past two items lands
// one place short.
test('a grip dragged places its item among the others by the pointer, marked while it moves — 51.146', () => {
    const { ranks, drag } = standing()
    // Past the middles of Emma (60) and Ulysses (100), short of Beloved's (140).
    drag('Dune', 110)
    expect(ranks.sorted).toEqual(['Emma', 'Ulysses', 'Dune', 'Beloved'])
    expect(ranks.item('Dune').item['data-grabbed']).toBeUndefined()
    expect(said.peek()?.text).toBe('Dune moved, 3 of 4.')
})

// THE REVERT: answer Alt with an arrow as the listbox does, and the active option moves where the
// item is due to.
test('Alt with an arrow moves the active item, and the arrows alone move what is active — 51.148, 51.149', () => {
    const { ranks, key } = standing()
    key('ArrowDown')
    expect(ranks.list['aria-activedescendant']).toBe(ranks.item('Emma').item.id)
    key('ArrowDown', { altKey: true })
    key('ArrowDown', { altKey: true })
    expect(ranks.sorted).toEqual(['Dune', 'Ulysses', 'Beloved', 'Emma'])
    expect(said.peek()?.text).toBe('Emma moved, 4 of 4.')
    key('ArrowDown', { altKey: true })
    expect(ranks.sorted).toEqual(['Dune', 'Ulysses', 'Beloved', 'Emma'])
    key('ArrowUp', { altKey: true })
    expect(ranks.sorted).toEqual(['Dune', 'Ulysses', 'Emma', 'Beloved'])
})

// THE REVERT: move the item taken alone whatever is selected, and a selection drags apart.
test('picking many, the selection moves as one, by the keys or a drag — 51.147, 51.149, 51.150', () => {
    const { ranks, key, click, drag } = standing({ multiple: true })
    expect(ranks.list['aria-multiselectable']).toBe('true')
    click('Dune')
    click('Ulysses', { metaKey: true, ctrlKey: true })
    expect(ranks.selected()).toEqual(['Dune', 'Ulysses'])
    expect(ranks.item('Ulysses').item['aria-selected']).toBe('true')
    // Ulysses is active: Alt+ArrowDown moves both, gathered, a place on.
    key('ArrowDown', { altKey: true })
    expect(ranks.sorted).toEqual(['Emma', 'Dune', 'Ulysses', 'Beloved'])
    expect(said.peek()?.text).toBe('2 items moved, 2 to 3 of 4.')
    // A drag of a selected item's grip takes the selection with it.
    drag('Dune', 170)
    expect(ranks.sorted).toEqual(['Emma', 'Beloved', 'Dune', 'Ulysses'])
    // A drag of an item outside the selection moves it alone.
    drag('Emma', 170)
    expect(ranks.sorted).toEqual(['Beloved', 'Dune', 'Ulysses', 'Emma'])
})

// THE REVERT: put the grip in the tab order, and a keyboard stops on a grip that does nothing for it.
test('each grip is hidden from the keyboard and from a screen reader — 51.151', () => {
    const { ranks } = standing()
    expect([
        ranks.item('Dune').handle['aria-hidden'],
        ranks.item('Dune').handle.tabindex,
    ]).toEqual(['true', undefined])
    expect([ranks.list.role, ranks.list.tabindex]).toEqual(['listbox', '0'])
})
