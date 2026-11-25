// 51.145-51.151, 51.178-51.183 — `sortableList`, a `listbox` reordered: its list keyed and its grips
// dragged as a browser would, the emulator's missing layout answered with each item's box, and what it
// reads out heard through `said`.

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

// Two lists of one group side by side, a hundred pixels wide and four hundred tall, `Ranked` left of
// `Pool`, each item 40px tall from the top. A test names its own group, so no list another test left
// standing joins it.
function grouped(
    group: string,
    multiple = false,
    keyed: (book: string) => string = (book) => book,
) {
    const make = (label: string, books: string[], left: number) => {
        const ranks = sortableList<string, boolean>({
            items: books,
            group,
            multiple,
            key: keyed,
        })
        const list = document.createElement('ol')
        list.setAttribute('aria-label', label)
        list.tabIndex = 0
        list.getBoundingClientRect = () =>
            ({ left, right: left + 100, top: 0, bottom: 400 }) as DOMRect
        bound.push(bindPart(ranks.list, list))
        list.addEventListener('keydown', ranks.list.onkeydown as EventListener)
        const grips = new Map<string, HTMLElement>()
        books.forEach((book, at) => {
            const item = document.createElement('li')
            item.getBoundingClientRect = () =>
                ({ top: at * 40, height: 40 }) as DOMRect
            const parts = ranks.item(book)
            bound.push(bindPart(parts.item, item))
            const grip = document.createElement('span')
            grip.addEventListener(
                'pointerdown',
                parts.handle.onpointerdown as EventListener,
            )
            item.append(grip)
            list.append(item)
            grips.set(book, grip)
        })
        document.body.append(list)
        const key = (name: string, held: KeyboardEventInit = {}) => {
            const event = new KeyboardEvent('keydown', {
                key: name,
                cancelable: true,
                ...held,
            })
            list.dispatchEvent(event)
            flushSync()
            return event.defaultPrevented
        }
        return { ranks, list, grips, key }
    }
    return {
        ranked: make('Ranked', ['Dune', 'Emma'], 0),
        pool: make('Pool', ['Ulysses', 'Beloved'], 100),
    }
}

const press = (grip: HTMLElement) => {
    grip.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, bubbles: true }),
    )
    flushSync()
}
const move = (clientX: number, clientY: number) => {
    globalThis.dispatchEvent(
        new PointerEvent('pointermove', { clientX, clientY }),
    )
    flushSync()
}
const letGo = () => {
    globalThis.dispatchEvent(new PointerEvent('pointerup'))
    flushSync()
}

// THE REVERT: leave a key no item of the list's own answers out of `sorted`, and an item moved in
// from another list is in neither.
test("a list of a group finds a key it names among its group's items, and leaves an item another list names to it — 51.179", () => {
    const { ranked, pool } = grouped('found')
    ranked.ranks.order.set(['Ulysses'])
    flushSync()
    expect(ranked.ranks.sorted).toEqual(['Ulysses', 'Dune', 'Emma'])
    expect(pool.ranks.sorted).toEqual(['Beloved'])
})

// THE REVERT: write the order of the list the items enter and not of the one they leave, and an item
// moved stands in both.
test('Alt with ArrowLeft and ArrowRight carries the active item into the list beside, and past the end moves nothing — 51.178, 51.180, 51.182, 51.183', () => {
    const { ranked, pool } = grouped('keys')
    pool.list.focus()
    expect(pool.key('ArrowLeft', { altKey: true })).toBe(true)
    expect([ranked.ranks.order(), pool.ranks.order()]).toEqual([
        ['Ulysses', 'Dune', 'Emma'],
        ['Beloved'],
    ])
    expect(pool.ranks.sorted).toEqual(['Beloved'])
    expect(document.activeElement).toBe(ranked.list)
    expect(ranked.ranks.list['aria-activedescendant']).toBe(
        ranked.ranks.item('Ulysses').item.id,
    )
    expect(said.peek()?.text).toBe('Ulysses moved to Ranked, 1 of 3.')
    // Ranked stands first: a step left of it moves nothing, and is kept from the browser.
    expect(ranked.key('ArrowLeft', { altKey: true })).toBe(true)
    expect(ranked.ranks.sorted).toEqual(['Ulysses', 'Dune', 'Emma'])
    ranked.key('ArrowDown')
    ranked.key('ArrowRight', { altKey: true })
    expect(ranked.ranks.sorted).toEqual(['Ulysses', 'Emma'])
    expect(pool.ranks.sorted).toEqual(['Beloved', 'Dune'])
    expect([ranked.ranks.selected(), pool.ranks.selected()]).toEqual([
        undefined,
        'Dune',
    ])
    expect(said.peek()?.text).toBe('Dune moved to Pool, 2 of 2.')
})

// THE REVERT: hand the list entered no selection, and the items moved together scatter on the next
// move.
test('the items selected move into another list as one, selected there — 51.182', () => {
    const { ranked, pool } = grouped('selected', true)
    ranked.list.focus()
    ranked.key('ArrowDown', { shiftKey: true })
    expect(ranked.ranks.selected()).toEqual(['Dune', 'Emma'])
    ranked.key('ArrowRight', { altKey: true })
    expect(pool.ranks.sorted).toEqual(['Dune', 'Emma', 'Ulysses', 'Beloved'])
    expect([ranked.ranks.selected(), pool.ranks.selected()]).toEqual([
        [],
        ['Dune', 'Emma'],
    ])
    expect(said.peek()?.text).toBe('2 items moved to Pool, 1 to 2 of 4.')
})

// THE REVERT: hit-test no list's box, and the item dragged over Pool stays in Ranked.
test("a grip dragged into another list of its group moves its item there, among that list's items — 51.181, 51.146", () => {
    const { ranked, pool } = grouped('drag')
    press(ranked.grips.get('Dune') as HTMLElement)
    // Over Pool, past the middle of Ulysses (20) and short of Beloved's (60).
    move(150, 50)
    expect(pool.ranks.sorted).toEqual(['Ulysses', 'Dune', 'Beloved'])
    expect(ranked.ranks.sorted).toEqual(['Emma'])
    expect(pool.ranks.item('Dune').item['data-grabbed']).toBe('')
    expect(ranked.ranks.item('Dune').item['data-grabbed']).toBeUndefined()
    // Over neither list, the item stays in the list it was last in.
    move(500, 90)
    expect(pool.ranks.sorted).toEqual(['Ulysses', 'Beloved', 'Dune'])
    letGo()
    expect(pool.ranks.item('Dune').item['data-grabbed']).toBeUndefined()
    expect(said.peek()?.text).toBe('Dune moved to Pool, 3 of 3.')
})

// THE REVERT: count the others ahead of the item on every move, as the place was once found, and a
// pointer held over one place reads every key on every frame: 20 keys over 10 frames of two items.
test('a drag held over one place reads no key and writes no order', () => {
    let read = 0
    const { ranked } = grouped('still', false, (book) => {
        read += 1
        return book
    })
    press(ranked.grips.get('Dune') as HTMLElement)
    move(50, 50)
    const written = ranked.ranks.order()
    read = 0
    for (let frame = 0; frame < 10; frame += 1) move(50, 50 + frame)
    expect(read).toBe(0)
    letGo()
    expect(ranked.ranks.order()).toBe(written)
})
