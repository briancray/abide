// `listbox`, the keyboard over a list of keyed options (RULEBOOK 51.1-51.12, 51.94, 51.98-51.105).
// What `Combobox` renders over it is the CRM's tests', which mount it.

import { expect, test } from 'bun:test'

import { flushSync, listbox, reactive } from '#shared'
import { isApplePlatform } from '#shared/isApplePlatform.ts'

function press(
    handler: (event: KeyboardEvent) => void,
    key: string,
    held: KeyboardEventInit = {},
) {
    const event = new KeyboardEvent('keydown', {
        key,
        cancelable: true,
        ...held,
    })
    handler(event)
    flushSync()
    return event
}

// The platform's `mod`, as `hotkeys` reads it: ⌘ on an Apple platform, Ctrl on any other.
const MOD = isApplePlatform() ? { metaKey: true } : { ctrlKey: true }

function click(part: Record<string, unknown>, held: MouseEventInit = {}) {
    ;(part.onclick as (event: MouseEvent) => void)(
        new MouseEvent('click', held),
    )
    flushSync()
}

// THE REVERT: answer the first key from `active` whatever was moved to, and the narrowed list
// lights `b` rather than keeping `c`.
test('the active key stays on its option while the list changes — 51.1, 51.2, 51.3', () => {
    const options = reactive(['a', 'b', 'c'])
    const list = listbox({ id: 'letters', options, key: (letter) => letter })
    expect(list.active).toBe('a')
    press(list.onkeydown, 'End')
    expect(list.active).toBe('c')
    options.set(['b', 'c'])
    flushSync()
    expect(list.active).toBe('c')
    options.set(['a', 'b'])
    flushSync()
    expect(list.active).toBe('a')
    options.set([])
    flushSync()
    expect([list.active, list.activeId]).toEqual([undefined, undefined])
})

test('the arrows go round the ends unless `wrap` is off — 51.4, 51.5, 51.6', () => {
    const letters = ['a', 'b', 'c']
    const round = listbox({
        id: 'round',
        options: () => letters,
        key: (letter) => letter,
    })
    press(round.onkeydown, 'ArrowUp')
    expect(round.active).toBe('c')
    press(round.onkeydown, 'ArrowDown')
    expect(round.active).toBe('a')
    const held = listbox({
        id: 'held',
        options: () => letters,
        key: (letter) => letter,
        wrap: false,
    })
    press(held.onkeydown, 'ArrowUp')
    expect(held.active).toBe('a')
    press(held.onkeydown, 'End')
    press(held.onkeydown, 'ArrowDown')
    expect(held.active).toBe('c')
    press(held.onkeydown, 'Home')
    expect(held.active).toBe('a')
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
    expect(press(list.onkeydown, 'ArrowDown').defaultPrevented).toBe(true)
    const enter = press(list.onkeydown, 'Enter')
    press(list.onkeydown, 'Escape')
    expect([picked, escaped, enter.defaultPrevented]).toEqual([['b'], 1, true])
    const bare = listbox({
        id: 'bare',
        options: () => ['a'],
        key: (letter) => letter,
    })
    expect(press(bare.onkeydown, 'Enter').defaultPrevented).toBe(false)
    expect(press(bare.onkeydown, 'Escape').defaultPrevented).toBe(false)
    expect(press(bare.onkeydown, 'a').defaultPrevented).toBe(false)
})

test('each key has its own id, and the active one’s is `activeId` — 51.10, 51.11', () => {
    const list = listbox({
        id: 'letters',
        options: () => ['a b', 'a-b'],
        key: (letter) => letter,
    })
    expect(list.idOf('a b')).not.toBe(list.idOf('a-b'))
    expect(list.idOf('a b')).toBe('letters-option-a%20b')
    press(list.onkeydown, 'End')
    expect(list.activeId).toBe(list.idOf('a-b'))
})

// THE REVERT: read `data-active` off the key the part was built for rather than the active one, and
// every option reads active; let the pointer move to the key, as the arrows do, and `selected` and
// `aria-selected` follow it — b reads selected.
test('an option’s part carries its id and whether it is active, and a pointer on it activates it without selecting it — 51.94', () => {
    const list = listbox({ id: 'letters', options: () => ['a', 'b', 'c'] })
    const a = list.option('a')
    const b = list.option('b')
    const c = list.option('c')
    expect([a.id, a.role, a['data-listbox'], list.listbox.role]).toEqual([
        'letters-option-a',
        'option',
        'option',
        'listbox',
    ])
    expect([a['aria-selected'], a['data-active'], b['data-active']]).toEqual([
        'false',
        '',
        undefined,
    ])
    press(list.onkeydown, 'ArrowDown')
    ;(c.onpointermove as () => void)()
    flushSync()
    // Read again, not rebuilt: the part's getters answer what is active now (49.9).
    expect([
        b['aria-selected'],
        c['aria-selected'],
        b['data-active'],
        c['data-active'],
    ]).toEqual(['true', 'false', undefined, ''])
    expect([list.active, list.selected()]).toEqual(['c', 'b'])
    // The arrows step on from where the pointer rests, and the step selects.
    press(list.onkeydown, 'ArrowUp')
    expect([list.active, list.selected()]).toEqual(['b', 'b'])
    ;(a.onpointermove as () => void)()
    // A key written to `selected` takes over from the pointer's.
    list.selected.set('c')
    expect(list.active).toBe('c')
})

// THE REVERT: extend from the active option rather than the anchor, and Shift on `a` after Shift on `d`
// selects `a`..`d` rather than the run from `c`, the option last toggled.
test('a click selects one, `mod` toggles, and Shift selects the run from the anchor — 51.98, 51.99, 51.100', () => {
    const list = listbox({
        id: 'stages',
        options: () => ['a', 'b', 'c', 'd'],
        multiple: true,
    })
    expect(list.listbox['aria-multiselectable']).toBe('true')
    click(list.option('b'))
    expect(list.selected()).toEqual(['b'])
    click(list.option('c'), MOD)
    expect(list.selected()).toEqual(['b', 'c'])
    click(list.option('d'), { shiftKey: true })
    expect(list.selected()).toEqual(['c', 'd'])
    click(list.option('a'), { shiftKey: true })
    expect(list.selected()).toEqual(['a', 'b', 'c'])
    click(list.option('c'), MOD)
    expect(list.selected()).toEqual(['a', 'b'])
    const [a, d] = [list.option('a'), list.option('d')]
    expect([a['aria-selected'], a['data-selected']]).toEqual(['true', ''])
    expect([d['aria-selected'], d['data-selected']]).toEqual([
        'false',
        undefined,
    ])
})

// THE REVERT: extend on every arrow rather than on a shifted one, and a bare ArrowDown selects `c`.
test('Space toggles, Shift with an arrow extends, and `mod+a` selects all — 51.101, 51.102, 51.103', () => {
    const selected = reactive<readonly string[]>([])
    const list = listbox({
        id: 'stages',
        options: () => ['a', 'b', 'c', 'd'],
        multiple: true,
        selected,
    })
    expect(press(list.onkeydown, ' ').defaultPrevented).toBe(true)
    expect(selected()).toEqual(['a'])
    press(list.onkeydown, 'ArrowDown')
    expect([list.active, selected()]).toEqual(['b', ['a']])
    press(list.onkeydown, 'ArrowDown', { shiftKey: true })
    expect(selected()).toEqual(['a', 'b', 'c'])
    press(list.onkeydown, 'End', { shiftKey: true })
    expect(selected()).toEqual(['a', 'b', 'c', 'd'])
    press(list.onkeydown, ' ')
    expect(selected()).toEqual(['a', 'b', 'c'])
    selected.set([])
    expect(press(list.onkeydown, 'a', MOD).defaultPrevented).toBe(true)
    expect(selected()).toEqual(['a', 'b', 'c', 'd'])
})

// THE REVERT: hold the key moved to apart from `selected`, and the key written there makes nothing
// active; write `data-selected` only where it selects many, and the option picked carries none.
test('selecting one, the selection is the key last moved to, and a click picks it — 51.104, 51.105', () => {
    const picked: string[] = []
    const selected = reactive<string | undefined>('c')
    const list = listbox({
        id: 'stages',
        options: () => ['a', 'b', 'c'],
        selected,
        onpick: (stage) => picked.push(stage),
    })
    expect(list.active).toBe('c')
    expect(list.listbox['aria-multiselectable']).toBe(undefined)
    press(list.onkeydown, 'ArrowUp')
    expect(selected()).toBe('b')
    click(list.option('a'))
    expect([list.active, selected(), picked]).toEqual(['a', 'a', ['a']])
    // Space and `mod+a` are left alone: a list picking one is often a field's, where they type.
    expect(press(list.onkeydown, ' ').defaultPrevented).toBe(false)
    expect(press(list.onkeydown, 'a', MOD).defaultPrevented).toBe(false)
    // 49.1 — the selection is styled by `data-selected`, as where it selects many.
    expect([
        list.option('a')['data-selected'],
        list.option('c')['data-selected'],
    ]).toEqual(['', undefined])
})
