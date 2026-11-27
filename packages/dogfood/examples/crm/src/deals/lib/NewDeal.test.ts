import { afterEach, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import { DEALS } from '../../pipeline/lib/DEALS.server.ts'
import { createDeal } from '../createDeal.server.ts'
import NewDeal from './NewDeal.abide'

// One list for the app: take back the deals these add
const before = DEALS.length
afterEach(() => {
    DEALS.splice(before)
})

// Each field shown with a message, and its first message.
const shown = () =>
    [...document.querySelectorAll('li:not([hidden])')].map((field) => [
        field.querySelector('span')?.textContent,
        field.querySelector('strong')?.textContent,
    ])
const field = (name: string) =>
    document.querySelector(`input[name=${name}]`) as HTMLInputElement
// The form's own message and the line saying what was added, as shown.
const statuses = () =>
    [...document.querySelectorAll<HTMLElement>('p.status')].map((line) =>
        line.hidden ? undefined : line.textContent,
    )
const submit = async () => {
    ;(document.querySelector('form') as HTMLFormElement).requestSubmit()
    await Bun.sleep(20)
    flushSync()
}

// 56.2, 56.4, 56.10 — A DEAL THAT DOES NOT FIT SHOWS, FIELD BY FIELD, WHAT THE HANDLER'S REFUSAL SAYS:
// the company and the amount, each with the message the handler answers for the same values, and the
// name, which fits, with none. THE REVERT: never hide `error`'s element — the name shows too.
test("a deal that does not fit shows field by field what the handler's refusal says", async () => {
    using _form = await mount(NewDeal({}))
    const before = DEALS.length
    await submit()
    let refusal: unknown
    try {
        await createDeal({ name: 'Ledger audit', company: '', amount: 0 })
    } catch (thrown) {
        refusal = thrown
    }
    const issues = createDeal.isError(refusal, 'ValidationError')
        ? refusal.data
        : {}
    expect(shown()).toEqual([
        ['company', issues.company?.[0]],
        ['amount', issues.amount?.[0]],
    ])
    expect(DEALS.length).toBe(before)
})

// 56.6 — FOCUS LANDS ON THE FIRST FIELD WITH A MESSAGE, in the form's order: the company, not the
// amount. THE REVERT: drop `focusFirst` from the submit; focus stays where it was.
test('a refused submit moves focus to the first field with a message', async () => {
    using _form = await mount(NewDeal({}))
    await submit()
    expect(document.activeElement).toBe(field('company'))
    expect(field('company').getAttribute('aria-invalid')).toBe('true')
    expect(field('company').getAttribute('aria-describedby')).toBe(
        document.querySelectorAll('li')[1]?.id ?? '',
    )
    expect(field('name').hasAttribute('aria-invalid')).toBe(false)
})

// 56.7 — AN EDIT CHECKS AGAIN: a company typed in takes its message away, and the amount keeps its.
// THE REVERT: drop `oninput` from the form's element part; the company's message stands.
test('an edit checks the form again', async () => {
    using _form = await mount(NewDeal({}))
    await submit()
    field('company').value = 'Hopper & Co'
    field('company').dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(shown().map(([name]) => name)).toEqual(['amount'])
})

// 56.8, 16.38 — WITH NO SCRIPT THE FORM POSTS TO THE HANDLER ITSELF.
test('the form posts to the handler where no script runs', async () => {
    using _form = await mount(NewDeal({}))
    const element = document.querySelector('form') as HTMLFormElement
    expect(element.getAttribute('method')).toBe('post')
    expect(element.getAttribute('action')).toEndWith('/deals/createDeal')
})

test('a deal that fits is added', async () => {
    using _form = await mount(NewDeal({}))
    field('company').value = 'Hopper & Co'
    field('amount').value = '4000'
    await submit()
    expect(shown()).toEqual([])
    expect(DEALS.at(-1)?.company).toBe('Hopper & Co')
    expect(DEALS.at(-1)?.amount).toBe(4000)
})

// 56.34, 56.35 — AN ADDED DEAL STARTS THE FORM OVER for the next one: each field back as it rendered,
// and the answer handed on, so the page says which deal was added. THE REVERT: drop `resetOnSuccess`
// — the company still reads 'Hopper & Co'.
test('an added deal starts the form over and says what it added', async () => {
    using _form = await mount(NewDeal({}))
    field('company').value = 'Hopper & Co'
    field('amount').value = '4000'
    await submit()
    expect([
        field('name').value,
        field('company').value,
        field('amount').value,
    ]).toEqual(['Ledger audit', '', '0'])
    expect(statuses()).toEqual([undefined, 'Added Ledger audit'])
})

// 56.13 — A REFUSAL THAT NAMES NO FIELD IS THE FORM'S OWN MESSAGE: a name another deal holds is a 409
// with no issues, shown under the form rather than beside a field. THE REVERT: answer only the issues
// under `''` — the form's message stays hidden.
test("a name another deal holds is refused as the form's own message", async () => {
    using _form = await mount(NewDeal({}))
    const taken = DEALS[0]?.name ?? ''
    field('name').value = taken
    field('company').value = 'Hopper & Co'
    field('amount').value = '4000'
    await submit()
    expect(shown()).toEqual([])
    expect(statuses()).toEqual(['A deal of that name is open.', ''])
    expect(field('name').value).toBe(taken)
    expect(DEALS.length).toBe(before)
})
