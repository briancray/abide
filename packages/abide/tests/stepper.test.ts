// 56.29-56.33 and 51.141-51.144 — `stepper` and `wizard`, their parts read and pressed as a template
// and a browser would.

import { expect, test } from 'bun:test'

import { flushSync, reactive, stepper, wizard } from '#shared'

const key = (part: Record<string, unknown>, name: string) => {
    ;(part.onkeydown as (event: KeyboardEvent) => void)(
        new KeyboardEvent('keydown', { key: name, cancelable: true }),
    )
    flushSync()
}
const press = (part: Record<string, unknown>) => {
    ;(part.onclick as () => void)()
    flushSync()
}

// THE REVERT: step by one whatever `step` says, and PageUp moves 10 where 25 is due.
test('the keys step it, a page at a time by ten, and Home and End take it to its bounds — 56.29, 56.30', () => {
    const seats = stepper({ min: 0, max: 100, step: 2.5, label: 'Seats' })
    expect([
        seats.input.role,
        seats.input['aria-valuenow'],
        seats.input['aria-valuemin'],
        seats.input['aria-valuemax'],
    ]).toEqual(['spinbutton', 0, 0, 100])
    key(seats.input, 'ArrowUp')
    key(seats.input, 'ArrowUp')
    expect(seats.value()).toBe(5)
    key(seats.input, 'PageUp')
    expect(seats.value()).toBe(30)
    key(seats.input, 'End')
    key(seats.input, 'ArrowUp')
    expect(seats.value()).toBe(100)
    key(seats.input, 'Home')
    expect(seats.value()).toBe(0)
})

// THE REVERT: leave the buttons in the tab order, and Tab stops on each of them.
test('its buttons step it, out of the tab order, and are disabled at its bounds — 56.31', () => {
    const seats = stepper({ value: reactive(1), min: 0, max: 2 })
    expect([seats.decrement.tabindex, seats.decrement.disabled]).toEqual([
        '-1',
        false,
    ])
    press(seats.increment)
    expect([seats.value(), seats.increment.disabled]).toEqual([2, true])
    press(seats.increment)
    expect(seats.value()).toBe(2)
})

// THE REVERT: take the typed number as it is, and 7.3 stands where steps of 0.5 allow only 7.5.
test('a number typed is kept to its bounds and its step, and anything else is put back — 56.32', () => {
    const rate = stepper({ value: reactive(1), min: 0, max: 10, step: 0.5 })
    const field = document.createElement('input')
    field.addEventListener('change', rate.input.onchange as EventListener)
    const type = (text: string) => {
        field.value = text
        field.dispatchEvent(new Event('change'))
        flushSync()
        return [rate.value(), field.value]
    }
    expect(type('7.3')).toEqual([7.5, '7.5'])
    expect(type('40')).toEqual([10, '10'])
    expect(type('lots')).toEqual([10, '10'])
    const tenths = stepper({ step: 0.1 })
    key(tenths.input, 'ArrowUp')
    key(tenths.input, 'ArrowUp')
    key(tenths.input, 'ArrowUp')
    expect(tenths.value()).toBe(0.3)
})

// THE REVERT: keep every `input` that reads as a number, and the 60 still being typed is taken as 50 —
// which a mounted field then writes back over the text under the caret.
test('a number is taken as it is typed, where it already stands within its bounds and its step — 56.33', () => {
    const seats = stepper({ value: reactive(5), min: 5, max: 50 })
    const field = document.createElement('input')
    field.addEventListener('input', seats.input.oninput as EventListener)
    const type = (text: string) => {
        field.value = text
        field.dispatchEvent(new Event('input'))
        flushSync()
        return [seats.value(), field.value]
    }
    expect(type('1')).toEqual([5, '1'])
    expect(type('12')).toEqual([12, '12'])
    expect(type('012')).toEqual([12, '012'])
    expect(type('')).toEqual([12, ''])
    expect(type('60')).toEqual([12, '60'])
})

// THE REVERT: drop `valid` from `next`, and a step that is not done is left all the same.
test('a wizard goes on only where its step is valid, and back to any step done — 51.141, 51.142, 51.143', () => {
    const named = reactive(false)
    const signup = wizard({
        steps: ['account', 'plan', 'invite'],
        valid: (step) => step !== 'account' || named(),
    })
    expect([
        signup.current(),
        signup.next.disabled,
        signup.previous.disabled,
    ]).toEqual(['account', true, true])
    press(signup.next)
    expect(signup.current()).toBe('account')
    named.set(true)
    flushSync()
    press(signup.next)
    press(signup.next)
    expect([signup.current(), signup.last, signup.next.disabled]).toEqual([
        'invite',
        true,
        true,
    ])
    expect([
        signup.step('account')['data-done'],
        signup.step('invite')['aria-current'],
        signup.step('invite')['data-done'],
    ]).toEqual(['', 'step', undefined])
    press(signup.step('account'))
    expect(signup.current()).toBe('account')
    // A step ahead is not a way forward.
    press(signup.step('invite'))
    expect(signup.current()).toBe('account')
})

// THE REVERT: count the steps done as the meter's value, and the first step reads as none of the way.
test("a wizard's meter is of the step on among its steps — 51.144", () => {
    const signup = wizard({ steps: ['account', 'plan', 'invite', 'done'] })
    expect(signup.meter.meter['aria-valuenow']).toBe(1)
    signup.current.set('invite')
    flushSync()
    expect([
        signup.meter.meter['aria-valuenow'],
        signup.meter.fill.style,
    ]).toEqual([3, 'inline-size:75%'])
})
