// 49.15 — a button its own click disables hands focus on, in `pagination`, `wizard` and `spinbutton`, their
// parts spread on real buttons and clicked as a browser clicks them. `carousel`'s is its own test's.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, pagination, reactive, spinbutton, wizard } from '#shared'

afterEach(() => document.body.replaceChildren())

// Each part on an element of `tag` inside one holder, every attribute and listener spread on it.
function spread<Name extends string>(
    parts: Record<Name, Record<string, unknown>>,
    tag = 'button',
): Record<Name, HTMLElement> {
    const holder = document.createElement('div')
    const made = {} as Record<Name, HTMLElement>
    for (const [name, part] of Object.entries(parts) as [
        Name,
        Record<string, unknown>,
    ][]) {
        const element = document.createElement(name === 'input' ? 'input' : tag)
        for (const [key, value] of Object.entries(part))
            if (key.startsWith('on'))
                element.addEventListener(key.slice(2), value as EventListener)
            else if (typeof value === 'string') element.setAttribute(key, value)
        holder.append(element)
        made[name] = element
    }
    document.body.append(holder)
    return made
}
const click = (element: HTMLElement) => {
    element.focus()
    element.click()
    flushSync()
}

// THE REVERT: drop the hand-off from `pagination`'s `next`, and focus stays on a disabled button.
test("pages' next stepping to the last page hands focus to previous — 49.15", () => {
    const list = pagination({ count: 2 })
    const nav = document.createElement('nav')
    nav.setAttribute('data-pagination', 'nav')
    document.body.append(nav)
    const { previous, next } = spread({
        previous: list.previous,
        next: list.next,
    })
    nav.append(previous as HTMLElement, next as HTMLElement)
    click(next as HTMLElement)
    expect([list.page.get(), document.activeElement]).toEqual([2, previous])
})

// THE REVERT: drop the hand-off from `wizard`'s `next`, and the last step leaves focus nowhere.
test("wizard's next onto the last step hands focus to previous, and previous onto the first to next — 49.15", () => {
    const steps = wizard({ steps: ['account', 'plan'] })
    const { previous, next } = spread({
        previous: steps.previous,
        next: steps.next,
    })
    click(next as HTMLElement)
    expect([steps.current.get(), document.activeElement]).toEqual([
        'plan',
        previous,
    ])
    click(previous as HTMLElement)
    expect([steps.current.get(), document.activeElement]).toEqual([
        'account',
        next,
    ])
})

// THE REVERT: drop the hand-off from `spinbutton`'s buttons, and reaching a bound leaves the field's keys
// unheard.
test("spinbutton's button reaching its bound hands focus to its input — 49.15", () => {
    const seats = spinbutton({ id: 'seats', value: reactive(1), max: 2 })
    const { input, increment } = spread({
        input: seats.input,
        increment: seats.increment,
    })
    click(increment as HTMLElement)
    expect([seats.value.get(), document.activeElement]).toEqual([2, input])
})
