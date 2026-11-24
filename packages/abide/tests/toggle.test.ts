// 51.108-51.115 — `toggle` and `toggleGroup`, their parts read as a template reads them: an attribute
// through its getter, a listener called with the event a browser would send.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, reactive, toggle, toggleGroup } from '#shared'

afterEach(() => document.body.replaceChildren())

const click = (part: Record<string, unknown>): void => {
    ;(part.onclick as (event: MouseEvent) => void)(new MouseEvent('click'))
    flushSync()
}

// THE REVERT: drop the `onclick` from `toggle`'s button, and a press leaves `pressed` false.
test('a toggle flips pressed on a click, and says so as a toggle button or a switch — 51.108, 51.109', () => {
    const pin = toggle()
    expect([pin.button['aria-pressed'], pin.button['data-pressed']]).toEqual([
        'false',
        undefined,
    ])
    click(pin.button)
    expect(pin.pressed()).toBe(true)
    expect([pin.button['aria-pressed'], pin.button['data-pressed']]).toEqual([
        'true',
        '',
    ])
    const alerts = toggle({ role: 'switch', pressed: reactive(true) })
    expect([
        alerts.button.role,
        alerts.button['aria-checked'],
        alerts.button['aria-pressed'],
    ]).toEqual(['switch', 'true', undefined])
})

// THE REVERT: build each key's button as a `toggle` of its own `pressed`, and a press on one changes
// nothing in `value`.
test('a group picking many is a toggle per key, pressed while value holds it — 51.110', () => {
    const value = reactive<readonly string[]>(['won'])
    const chips = toggleGroup({
        items: ['lead', 'proposal', 'won'],
        multiple: true,
        value,
    })
    expect(chips.item('won')['aria-pressed']).toBe('true')
    expect(chips.item('lead')['aria-pressed']).toBe('false')
    click(chips.item('lead'))
    expect(value()).toEqual(['won', 'lead'])
    click(chips.item('won'))
    expect(value()).toEqual(['lead'])
    // The app writing `value` presses the buttons it names.
    value.set(['proposal'])
    flushSync()
    expect(
        ['lead', 'proposal', 'won'].map(
            (key) => chips.item(key)['aria-pressed'],
        ),
    ).toEqual(['false', 'true', 'false'])
    // A key's part is built once: a render asking for it again gets the same one.
    expect(chips.item('lead')).toBe(chips.item('lead'))
})

// THE REVERT: hand a group picking one the toggles a group picking many hands out, and its buttons
// carry `aria-pressed` where `role="radio"` and `aria-checked` are due.
test('a group picking one is a radio group, and a press on the key picked keeps it — 51.111, 51.112, 51.115', () => {
    const view = toggleGroup({ items: ['list', 'board'], label: 'View' })
    expect([view.group.role, view.group['aria-label']]).toEqual([
        'radiogroup',
        'View',
    ])
    expect([view.item('list').role, view.item('list')['aria-checked']]).toEqual(
        ['radio', 'false'],
    )
    click(view.item('board'))
    expect(view.value()).toBe('board')
    click(view.item('board'))
    expect(view.value()).toBe('board')
    expect(view.item('board')['data-pressed']).toBe('')
    expect(toggleGroup({ items: ['a'], multiple: true }).group.role).toBe(
        'group',
    )
})

// THE REVERT: move focus on an arrow without picking, and the arrows leave `value` where it was.
test('in a group picking one, the arrows move the pick and focus together, going round — 51.113', () => {
    const view = toggleGroup({ id: 'view', items: ['list', 'board', 'chart'] })
    for (const key of ['list', 'board', 'chart']) {
        const button = document.createElement('button')
        button.id = view.item(key).id as string
        document.body.append(button)
    }
    const press = (key: string) => {
        ;(view.group.onkeydown as (event: KeyboardEvent) => void)(
            new KeyboardEvent('keydown', { key, cancelable: true }),
        )
        flushSync()
        return [view.value(), document.activeElement?.id]
    }
    expect(press('ArrowRight')).toEqual(['board', 'view-board'])
    expect(press('ArrowDown')).toEqual(['chart', 'view-chart'])
    expect(press('ArrowRight')).toEqual(['list', 'view-list'])
    expect(press('ArrowUp')).toEqual(['chart', 'view-chart'])
    expect(press('Home')).toEqual(['list', 'view-list'])
    expect(press('End')).toEqual(['chart', 'view-chart'])
})

// THE REVERT: put every radio in the tab order, and Tab stops on each of them.
test('in a group picking one, only the key picked, or the first, is in the tab order — 51.114', () => {
    const view = toggleGroup({ items: ['list', 'board'] })
    const order = () => ['list', 'board'].map((key) => view.item(key).tabindex)
    expect(order()).toEqual(['0', '-1'])
    view.value.set('board')
    flushSync()
    expect(order()).toEqual(['-1', '0'])
})
