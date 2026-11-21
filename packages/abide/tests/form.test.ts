// 56.2-56.12 — A FORM OVER A HANDLER, in process: a handler held to the document its build would read,
// a `<form>` with the parts spread onto it by hand, and the calls the handler's body is reached by
// counted — what a page cannot see, since a refusal the check finds and one the handler answers read
// the same once shown.

import { expect, test } from 'bun:test'

import { POST } from '#server'
import { addressed } from '#server/addressed.ts'
import { flushSync, form, refuse } from '#shared'
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

// 49.11, 56.9 — A FIELD'S PARTS AND WHAT IS WRONG WITH IT ARE ONE GROUP: its message and whether it is
// invalid read beside the attributes it spreads, live as the check changes them. THE REVERT: hand back
// `message` as a value read once rather than an accessor — the field reads no message after the submit.
test("a field's group carries its message and whether it is invalid — 49.11, 56.9", async () => {
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
