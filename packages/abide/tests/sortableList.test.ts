// 51.145-51.149 — `sortableList`: its handles dragged and keyed as a browser would, the emulator's
// missing layout answered with each item's box, and what it reads out heard through `said`.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, reactive, sortableList } from '#shared'
import { said } from '#shared/announce.ts'

import { bindPart } from './bindPart.ts'

const bound: (() => void)[] = []
afterEach(() => {
    for (const release of bound.splice(0)) release()
    document.body.replaceChildren()
})

const BOOKS = ['Dune', 'Emma', 'Ulysses', 'Beloved']

// Each book an item 40px tall, stacked from the top, with its handle listening as a spread listens.
function standing(order = reactive<readonly string[]>([])) {
    const ranks = sortableList({ items: BOOKS, order })
    const handles = new Map<string, HTMLButtonElement>()
    BOOKS.forEach((book, at) => {
        const item = document.createElement('li')
        item.getBoundingClientRect = () =>
            ({ top: at * 40, height: 40 }) as DOMRect
        bound.push(bindPart(ranks.item(book).item, item))
        const handle = document.createElement('button')
        for (const [name, listener] of Object.entries(ranks.item(book).handle))
            if (name.startsWith('on'))
                handle.addEventListener(
                    name.slice(2),
                    listener as EventListener,
                )
        item.append(handle)
        document.body.append(item)
        handles.set(book, handle)
    })
    const send = (book: string, event: Event) => {
        handles.get(book)?.dispatchEvent(event)
        flushSync()
    }
    const key = (book: string, name: string) =>
        send(
            book,
            new KeyboardEvent('keydown', { key: name, cancelable: true }),
        )
    return { ranks, send, key, order }
}

// THE REVERT: list the items as given, and `sorted` ignores the order put.
test('sorted is the items in the order put, any it does not name after them — 51.145', () => {
    const { ranks } = standing(reactive<readonly string[]>(['Ulysses', 'Dune']))
    expect(ranks.sorted).toEqual(['Ulysses', 'Dune', 'Emma', 'Beloved'])
})

// THE REVERT: count only the middles a whole item above the pointer, and a drag past two items lands
// one place short.
test('a handle dragged places its item among the others by the pointer, marked while it moves — 51.146', () => {
    const { ranks, send } = standing()
    send('Dune', new PointerEvent('pointerdown', { button: 0, clientY: 20 }))
    expect(ranks.item('Dune').item['data-grabbed']).toBe('')
    // Past the middles of Emma (60) and Ulysses (100), short of Beloved's (140).
    send(
        'Dune',
        new PointerEvent('pointermove', { clientY: 110, bubbles: true }),
    )
    expect(ranks.sorted).toEqual(['Emma', 'Ulysses', 'Dune', 'Beloved'])
    send('Dune', new PointerEvent('pointerup', { bubbles: true }))
    expect(ranks.item('Dune').item['data-grabbed']).toBeUndefined()
    expect(said.peek()?.text).toBe('Dune dropped, 3 of 4.')
})

// THE REVERT: drop the Escape arm, and a move the person backs out of stays.
test('Space grabs an item, the arrows move it, and Escape puts every item back — 51.147, 51.148, 51.149', () => {
    const { ranks, key } = standing()
    key('Emma', ' ')
    expect(ranks.item('Emma').handle['aria-pressed']).toBe('true')
    expect(said.peek()?.text).toBe('Emma grabbed, 2 of 4.')
    key('Emma', 'ArrowDown')
    key('Emma', 'ArrowDown')
    expect(ranks.sorted).toEqual(['Dune', 'Ulysses', 'Beloved', 'Emma'])
    expect(said.peek()?.text).toBe('Emma moved, 4 of 4.')
    key('Emma', 'Escape')
    expect(ranks.sorted).toEqual(BOOKS)
    expect([
        ranks.item('Emma').handle['aria-pressed'],
        said.peek()?.text,
    ]).toEqual(['false', 'Emma put back, 2 of 4.'])
    key('Beloved', 'Enter')
    key('Beloved', 'ArrowUp')
    key('Beloved', 'Enter')
    expect(ranks.order()).toEqual(['Dune', 'Emma', 'Beloved', 'Ulysses'])
    expect(ranks.item('Beloved').handle['aria-label']).toBe('Move Beloved')
})
