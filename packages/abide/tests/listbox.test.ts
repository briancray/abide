// `listbox`, the keyboard over a list of keyed options (RULEBOOK 51.1-51.12). What `Combobox`
// renders over it is the CRM's tests', which mount it.

import { expect, test } from 'bun:test'

import { flushSync, listbox, reactive } from '#shared'

function press(handler: (event: KeyboardEvent) => void, key: string) {
    const event = new KeyboardEvent('keydown', { key, cancelable: true })
    handler(event)
    flushSync()
    return event
}

// THE REVERT: answer the first key from `active` whatever was moved to, and the narrowed list
// lights `b` rather than keeping `c`.
test('the active key stays on its option while the list changes — 51.1, 51.2, 51.3', () => {
    const options = reactive(['a', 'b', 'c'])
    const list = listbox({ id: 'letters', options, key: (letter) => letter })
    expect(list.active()).toBe('a')
    press(list.keydown, 'End')
    expect(list.active()).toBe('c')
    options.set(['b', 'c'])
    flushSync()
    expect(list.active()).toBe('c')
    options.set(['a', 'b'])
    flushSync()
    expect(list.active()).toBe('a')
    options.set([])
    flushSync()
    expect([list.active(), list.activeId()]).toEqual([undefined, undefined])
})

test('the arrows go round the ends unless `wrap` is off — 51.4, 51.5, 51.6', () => {
    const letters = ['a', 'b', 'c']
    const round = listbox({
        id: 'round',
        options: () => letters,
        key: (letter) => letter,
    })
    press(round.keydown, 'ArrowUp')
    expect(round.active()).toBe('c')
    press(round.keydown, 'ArrowDown')
    expect(round.active()).toBe('a')
    const held = listbox({
        id: 'held',
        options: () => letters,
        key: (letter) => letter,
        wrap: false,
    })
    press(held.keydown, 'ArrowUp')
    expect(held.active()).toBe('a')
    press(held.keydown, 'End')
    press(held.keydown, 'ArrowDown')
    expect(held.active()).toBe('c')
    press(held.keydown, 'Home')
    expect(held.active()).toBe('a')
})

// THE REVERT: cancel Enter whether or not `onpick` is given, and the form a list sits in
// never submits.
test('Enter picks and Escape calls `onescape`, cancelling only what they act on — 51.7, 51.8, 51.9', () => {
    const picked: string[] = []
    let escaped = 0
    const list = listbox({
        id: 'letters',
        options: () => ['a', 'b'],
        key: (letter) => letter,
        onpick: (letter) => picked.push(letter),
        onescape: () => {
            escaped += 1
        },
    })
    expect(press(list.keydown, 'ArrowDown').defaultPrevented).toBe(true)
    const enter = press(list.keydown, 'Enter')
    press(list.keydown, 'Escape')
    expect([picked, escaped, enter.defaultPrevented]).toEqual([['b'], 1, true])
    const bare = listbox({
        id: 'bare',
        options: () => ['a'],
        key: (letter) => letter,
    })
    expect(press(bare.keydown, 'Enter').defaultPrevented).toBe(false)
    expect(press(bare.keydown, 'Escape').defaultPrevented).toBe(false)
    expect(press(bare.keydown, 'a').defaultPrevented).toBe(false)
})

test('each key has its own id, and the active one’s is `activeId` — 51.10, 51.11', () => {
    const list = listbox({
        id: 'letters',
        options: () => ['a b', 'a-b'],
        key: (letter) => letter,
    })
    expect(list.idOf('a b')).not.toBe(list.idOf('a-b'))
    expect(list.idOf('a b')).toBe('letters-option-a%20b')
    press(list.keydown, 'End')
    expect(list.activeId()).toBe(list.idOf('a-b'))
})
