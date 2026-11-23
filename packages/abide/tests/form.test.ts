// 56.2-56.12 — A FORM OVER A HANDLER, in process: a handler held to the document its build would read,
// a `<form>` with the parts spread onto it by hand, and the calls the handler's body is reached by
// counted — what a page cannot see, since a refusal the check finds and one the handler answers read
// the same once shown.

import { expect, test } from 'bun:test'

import { POST } from '#server'
import { addressed } from '#server/addressed.ts'
import { flushSync, form, refuse, watch } from '#shared'
import { ARGS_DOCUMENT } from '#shared/ARGS_DOCUMENT.ts'
import type { StandardSchemaV1 } from '#shared/Schema.ts'

const DOCUMENT = {
    type: 'object',
    required: ['company', 'amount'],
    properties: {
        company: { type: 'string', minLength: 2 },
        amount: { type: 'number', minimum: 1 },
    },
}

// The parts as a template spreads them: a handler for each `on…`, an attribute for the rest.
function spread(element: Element, part: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(part)) {
        if (name.startsWith('on'))
            element.addEventListener(name.slice(2), value as EventListener)
        else if (value === false || value === undefined)
            element.removeAttribute(name)
        else element.setAttribute(name, value === true ? '' : String(value))
    }
}

/** A `<form>` of one field per name, its parts spread, and the fields given values. */
function rendered(
    parts: ReturnType<typeof form>,
    values: Record<string, string>,
): HTMLFormElement {
    document.body.innerHTML = ''
    const element = document.createElement('form')
    spread(element, parts.form)
    for (const [name, value] of Object.entries(values)) {
        const input = document.createElement('input')
        spread(input, parts.field(name as never).input)
        input.value = value
        element.append(input)
    }
    document.body.append(element)
    return element
}

const submitted = async (element: HTMLFormElement): Promise<void> => {
    element.requestSubmit()
    await Bun.sleep(10)
    flushSync()
}

// The handler as a browser's copy holds it (19.29): the document, and no gate of its own here, so
// whatever the form sends reaches the body.
function holding<Handler extends object>(handler: Handler): Handler {
    ;(handler as Record<symbol, unknown>)[ARGS_DOCUMENT] = DOCUMENT
    return handler
}

// 56.2 — A SUBMIT THE CHECK REFUSES CALLS NOTHING; one that passes calls once, with the fields coerced
// as a post would carry them (56.1). THE REVERT: have `check` answer `null` — the empty company
// reaches the body.
test('a submit the check refuses makes no call, and one it passes calls with the fields coerced — 56.1, 56.2', async () => {
    const reached: unknown[] = []
    const add = holding(
        POST((args: { company: string; amount: number }) => {
            reached.push(args)
            return args
        }),
    )
    addressed(add, '/deals/add')
    const deal = form(add)
    const element = rendered(deal, { company: '', amount: '0' })
    await submitted(element)
    expect(reached).toEqual([])
    expect(deal.field('company').message).toBe('must be at least 2 characters')
    ;(element.elements.namedItem('company') as HTMLInputElement).value =
        'Hopper & Co'
    ;(element.elements.namedItem('amount') as HTMLInputElement).value = '4000'
    await submitted(element)
    expect(reached).toEqual([{ company: 'Hopper & Co', amount: 4000 }])
    expect(deal.issues).toBeUndefined()
})

// A gate the build cannot read: another library's schema, here spelled by hand.
const needsCompany: StandardSchemaV1<{ company: string }> = {
    '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) =>
            (value as { company?: string }).company
                ? { value: value as { company: string } }
                : {
                      issues: [
                          { message: 'needs a company', path: ['company'] },
                      ],
                  },
    },
}

// 56.3, 56.4, 56.6 — A HANDLER WITH NO DOCUMENT IS CALLED UNCHECKED, and what it refuses shows as the
// check's findings would, focus landing on the field once the call is refused. THE REVERT: drop the
// `watch` over the call's issues; the message shows and focus stays on the body.
test('a handler with no document is called unchecked, and its refusal shows and takes focus — 56.3, 56.4, 56.6', async () => {
    const save = POST((args: { company: string }) => args, {
        args: needsCompany,
    })
    addressed(save, '/companies/save')
    const company = form(save)
    const element = rendered(company, { company: '' })
    await submitted(element)
    expect(company.field('company').message).toBe('needs a company')
    expect(document.activeElement).toBe(
        element.elements.namedItem('company') as HTMLInputElement,
    )
})

// 56.5, 56.11 — WHILE ITS CALL IS IN FLIGHT THE FORM'S SUBMIT IS DISABLED, and a second submit calls
// nothing, its fields changed since. THE REVERT: drop the `busy` guard from the submit; the body is
// reached twice. (A second submit of the same fields joins the first call by its args either way.)
test('a submit while the call is in flight calls nothing, and the button says so — 56.5, 56.11', async () => {
    let answer: (value: unknown) => void = () => undefined
    let calls = 0
    const slow = POST((_args: { company: string }) => {
        calls += 1
        return new Promise((resolve) => {
            answer = resolve
        })
    })
    addressed(slow, '/companies/slow')
    const company = form(slow)
    const element = rendered(company, { company: 'Hopper & Co' })
    await submitted(element)
    expect(company.submit.disabled).toBe(true)
    ;(element.elements.namedItem('company') as HTMLInputElement).value =
        'Analytical Engines'
    await submitted(element)
    expect(calls).toBe(1)
    answer({ company: 'Hopper & Co' })
    await Bun.sleep(10)
    expect(company.submit.disabled).toBe(false)
})

// 56.12 — A FILE IN A FIELD IS REFUSED BY NAME rather than sent as the `{}` JSON makes of it. THE
// REVERT: drop the file check from `argsOf`; the call goes out with `contract: {}`.
test('a field holding a file throws at the submit, naming it — 56.12', () => {
    const attach = POST((args: { contract: string }) => args)
    addressed(attach, '/deals/attach')
    const deal = form(attach)
    const element = rendered(deal, {})
    const file = document.createElement('input')
    file.type = 'file'
    file.name = 'contract'
    element.append(file)
    const onsubmit = deal.form.onsubmit as (event: Event) => void
    expect(() =>
        onsubmit({
            preventDefault() {},
            currentTarget: element,
        } as unknown as Event),
    ).toThrow("the field 'contract' holds a file")
})

// 49.9, 56.9 — A FIELD'S PARTS AND WHAT IS WRONG WITH IT ARE ONE GROUP: its message and whether it is
// invalid read beside the attributes it spreads, live as the check changes them. THE REVERT: hand back
// `message` as a value read once rather than an accessor — the field reads no message after the submit.
test("a field's group carries its message and whether it is invalid — 49.9, 56.9", async () => {
    const add = holding(
        POST((args: { company: string; amount: number }) => args),
    )
    addressed(add, '/deals/grouped')
    const deal = form(add)
    const company = deal.field('company')
    expect(company.message).toBeUndefined()
    expect(company.invalid).toBe(false)
    await submitted(rendered(deal, { company: '', amount: '4' }))
    expect(company.message).toBe('must be at least 2 characters')
    expect(company.invalid).toBe(true)
    expect(company.input['aria-invalid']).toBe('true')
    expect(company.error.hidden).toBe(false)
    expect(deal.field('amount').invalid).toBe(false)
})

// 56.4 — A REFUSAL NO FIELD OWNS IS THE WHOLE FORM'S: the server's `''` message shows as the form's
// `message`, its element shown, while every field reads none. THE REVERT: have the form's `message`
// answer nothing — `deal.message` reads `undefined` where the server's message is due.
test("a refusal no field owns shows as the form's own message — 56.4", async () => {
    const book = POST((args: { company: string }) =>
        args.company === 'open'
            ? args
            : refuse.validation<{ company: string }>({
                  '': ['the books are closed'],
              }),
    )
    addressed(book, '/deals/closed')
    const deal = form(book)
    expect(deal.error.hidden).toBe(true)
    await submitted(rendered(deal, { company: 'Hopper & Co' }))
    expect(deal.message).toBe('the books are closed')
    expect(deal.error.hidden).toBe(false)
    expect(deal.field('company').message).toBeUndefined()
})

/** A `<form>` as a page renders it over a record: each field's `value` attribute is its baseline (56.14). */
function opened(
    parts: ReturnType<typeof form>,
    values: Record<string, string | undefined>,
): HTMLFormElement {
    document.body.innerHTML = ''
    const element = document.createElement('form')
    spread(element, parts.form)
    for (const [name, value] of Object.entries(values)) {
        const input = document.createElement('input')
        spread(input, parts.field(name as never).input)
        if (value !== undefined) input.setAttribute('value', value)
        element.append(input)
    }
    document.body.append(element)
    return element
}

/** Types `value` into the field named `name` as a person does: the value, then the `input` event. */
function typed(element: HTMLFormElement, name: string, value: string): void {
    const field = element.elements.namedItem(name) as HTMLInputElement
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

const valueOf = (element: HTMLFormElement, name: string): string =>
    (element.elements.namedItem(name) as HTMLInputElement).value

const EDITED = { company: 'Hopper & Co', amount: '4000' }

// 56.14, 56.16, 56.20, 56.21 — AN EDIT AGAINST THE RECORD AS OPENED: the field typed into reads
// changed and the form dirty, each on its part, and typing the opened value back reads clean again.
// THE REVERT: compare `value` against `''` rather than `defaultValue` — the untouched amount reads
// changed.
test('a field typed into reads changed, and typed back reads clean — 56.14, 56.16, 56.20, 56.21', () => {
    const edit = POST((args: { company: string; amount: number }) => args)
    addressed(edit, '/deals/edit')
    const deal = form(edit)
    const element = opened(deal, EDITED)
    expect(deal.dirty).toBe(false)
    typed(element, 'company', 'Hopper and Co')
    expect(deal.dirty).toBe(true)
    expect(deal.form['data-dirty']).toBe('')
    expect(deal.field('company').changed).toBe(true)
    expect(deal.field('company').input['data-changed']).toBe('')
    expect(deal.field('amount').changed).toBe(false)
    expect(deal.field('amount').input['data-changed']).toBeUndefined()
    typed(element, 'company', 'Hopper & Co')
    expect(deal.dirty).toBe(false)
    expect(deal.form['data-dirty']).toBeUndefined()
})

// 56.15 — A FIELD RENDERED WITH NO VALUE IS BLANK: cleared after an edit, it reads as it opened. And a
// `<select>` marking no option opens on its first, which is its baseline. THE REVERT: compare a single
// `<select>` option by option — the select reads changed before anyone touched it.
test('a field opened with no value and one cleared compare equal — 56.15', () => {
    const edit = POST((args: { company: string; stage: string }) => args)
    addressed(edit, '/deals/blank')
    const deal = form(edit)
    const element = opened(deal, { company: undefined })
    const stage = document.createElement('select')
    stage.name = 'stage'
    for (const name of ['lead', 'won']) {
        const option = document.createElement('option')
        option.textContent = name
        stage.append(option)
    }
    element.append(stage)
    typed(element, 'company', 'Hopper & Co')
    expect(deal.field('company').changed).toBe(true)
    typed(element, 'company', '')
    expect(deal.field('company').changed).toBe(false)
    expect(deal.field('stage').changed).toBe(false)
    stage.selectedIndex = 1
    stage.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(deal.field('stage').changed).toBe(true)
    expect(deal.dirty).toBe(true)
})

// 56.17 — WHAT CHANGED, AS A SUBMIT WOULD SEND IT: the amount typed, coerced to the number the document
// declares, and not the company left as it opened. THE REVERT: hand back every arg — the company is
// in it.
test("a form's changes are the args a submit sends, narrowed to the fields that differ — 56.17", () => {
    const edit = holding(
        POST((args: { company: string; amount: number }) => args),
    )
    addressed(edit, '/deals/changes')
    const deal = form(edit)
    expect(deal.changes).toEqual({})
    const element = opened(deal, EDITED)
    typed(element, 'amount', '5200')
    expect(deal.changes).toEqual({ amount: 5200 })
})

// 56.18, 56.22 — A RESET PUTS THE RECORD BACK: the reset button is enabled only while something
// differs, and the `<form>`'s reset takes every field to its baseline and reads clean. THE REVERT:
// drop `onreset` from the form's part — the form reads dirty after the reset.
test('a reset puts every field back and reads clean — 56.18, 56.22', () => {
    const edit = POST((args: { company: string; amount: number }) => args)
    addressed(edit, '/deals/reset')
    const deal = form(edit)
    const element = opened(deal, EDITED)
    expect(deal.reset.type).toBe('reset')
    expect(deal.reset.disabled).toBe(true)
    typed(element, 'company', 'Babbage Ltd')
    expect(deal.reset.disabled).toBe(false)
    element.reset()
    flushSync()
    expect(valueOf(element, 'company')).toBe('Hopper & Co')
    expect(deal.dirty).toBe(false)
    expect(deal.field('company').changed).toBe(false)
    expect(deal.reset.disabled).toBe(true)
})

// 56.19 — WHAT WAS SAVED IS THE NEW BASELINE: once the call answers, the field it carried reads clean,
// and a reset goes back to the saved company rather than the one the form opened with. An edit made
// while the call was in flight is not what it sent, and stays changed. THE REVERT: drop the watch
// over the call — the company reads changed after the save.
test('a call answered moves the baseline to what it sent — 56.19', async () => {
    let answer: () => void = () => undefined
    const edit = POST(
        (args: { company: string; amount: number }) =>
            new Promise((resolve) => {
                answer = () => resolve(args)
            }),
    )
    addressed(edit, '/deals/save')
    const deal = form(edit)
    const element = opened(deal, EDITED)
    typed(element, 'company', 'Babbage Ltd')
    await submitted(element)
    typed(element, 'amount', '5200')
    answer()
    await Bun.sleep(10)
    flushSync()
    expect(deal.field('company').changed).toBe(false)
    expect(deal.field('amount').changed).toBe(true)
    element.reset()
    flushSync()
    expect(valueOf(element, 'company')).toBe('Babbage Ltd')
    expect(valueOf(element, 'amount')).toBe('4000')
})

// 56.19 — A REFUSED CALL SAVED NOTHING, and the edit it carried stays changed. THE REVERT: move the
// baseline whatever the call answers — the company reads clean.
test('a refused call leaves the baseline where it was — 56.19', async () => {
    const edit = POST((args: { company: string }) =>
        args.company === 'Hopper & Co'
            ? args
            : refuse.validation<{ company: string }>({ company: ['is taken'] }),
    )
    addressed(edit, '/deals/taken')
    const deal = form(edit)
    const element = opened(deal, { company: 'Hopper & Co' })
    typed(element, 'company', 'Babbage Ltd')
    await submitted(element)
    expect(deal.field('company').message).toBe('is taken')
    expect(deal.field('company').changed).toBe(true)
})

// 56.23 — AN EDIT WAKES ONLY THE FIELD IT MOVED: typing into the company twice wakes a reader of the
// amount's `changed` not once. THE REVERT: hold the changed names in one `reactive` set every field
// reads — the amount's reader wakes at each of the company's keystrokes (2 wakes, not 0).
test("an edit of one field wakes no reader of another's changed — 56.23", () => {
    const edit = POST((args: { company: string; amount: number }) => args)
    addressed(edit, '/deals/wakes')
    const deal = form(edit)
    const element = opened(deal, EDITED)
    let woken = -1
    const stop = watch(() => {
        deal.field('amount').changed
        woken += 1
    })
    flushSync()
    typed(element, 'company', 'Babbage Ltd')
    typed(element, 'company', 'Babbage & Co')
    stop()
    expect(`wakes: ${woken}`).toBe('wakes: 0')
})
