// THE REFUSAL SURFACE. RULEBOOK 15, and most of it is about what does NOT happen:
// constructing a `Failed` refuses nothing (15.4), a message formatter that throws takes
// nothing down with it (15.13), and the framework declares no name an app did not ask for
// (15.9). None of those can be read off the value that comes back.

import { expect, test } from 'bun:test'
import { isFailed, notFound, refuse, validationError } from '#shared'

// 15.3. The status an app gets without asking, and it is the one that says "what you sent
// cannot be worked with" — which is what a declared refusal almost always is.
test('a declared refusal defaults to status 400', () => {
    const tooSlow = refuse.typed('TooSlow')
    const refusal = tooSlow()
    expect(`${refusal.name} ${refusal.status}`).toBe('TooSlow 400')
})

// 15.4: INERT. Nothing is thrown, nothing is registered and no caller is told — which is
// what makes 15.5 meaningful: RETURNING one is the refusal, so building one has to be safe
// everywhere else. A constructor that threw would make `const refusal = mine()` a control
// flow change at the declaration site.
test('constructing a Failed is inert', () => {
    const mine = refuse.typed('Mine')
    let threw: unknown
    try {
        mine()
        mine()
        mine()
    } catch (thrown) {
        threw = thrown
    }
    expect(`threw: ${threw === undefined ? 'no' : String(threw)}`).toBe(
        'threw: no',
    )
})

// 15.6, AND IT IS THE CLAUSE THE WHOLE TYPE TURNS ON. A refusal that crossed a wire was
// rebuilt from JSON by whatever revived it: not `instanceof Error`, no prototype this side
// put on it, no brand. A nominal check answers false for exactly the case the one type
// exists to serve — in-process and over a wire ALIKE.
//
// THE REVERT: making `isFailed` test `value instanceof Error` reports `narrows: false`.
test('a refusal that crossed a wire is still one', () => {
    const missing = notFound({ path: '/invoices/7', method: 'GET' })
    const overWire: unknown = JSON.parse(
        JSON.stringify({
            name: missing.name,
            status: missing.status,
            message: missing.message,
            data: missing.data,
        }),
    )
    expect(`instanceof Error: ${overWire instanceof Error}`).toBe(
        'instanceof Error: false',
    )
    expect(`isFailed: ${isFailed(overWire)}`).toBe('isFailed: true')
    expect(`narrows: ${notFound.is(overWire)}`).toBe('narrows: true')
})

// `.is` IS THE NAME COMPARISON THE DECLARATION SITE OWNS. An app writing
// `error.name === 'NotFound'` by hand is a string literal nothing checks, and the one that
// matters is the NEGATIVE: a refusal of some other name must not narrow.
test('a declared refusal narrows on its own name and no other', () => {
    const mine = refuse.typed('Mine')
    const yours = refuse.typed('Yours')
    expect(`mine: ${mine.is(mine())} ${mine.is(yours())}`).toBe(
        'mine: true false',
    )
    // And an ordinary Error is not a refusal, having no status.
    expect(`plain Error: ${mine.is(new Error('Mine'))}`).toBe(
        'plain Error: false',
    )
})

// 15.12: the formatter runs AT CONSTRUCTION, on the data, so the message is fixed by the
// time anything can read it. Running at read would let one `Failed` answer two different
// strings, which is the thing a refusal crossing a wire cannot afford.
test('a message function runs at construction on the data', () => {
    let ran = 0
    const tooBig = refuse.typed<'TooBig', { limit: number }>(
        'TooBig',
        413,
        (data) => {
            ran += 1
            return `over ${data.limit}`
        },
    )
    const refusal = tooBig({ limit: 10 })
    expect(refusal.message).toBe('over 10')
    // Read it twice: a formatter that ran per read would count again here.
    expect(`${refusal.message} ${refusal.message}`).toBe('over 10 over 10')
    expect(`formatter runs: ${ran}`).toBe('formatter runs: 1')
})

// 15.13. A formatter is cosmetic and a refusal is not, so a bug in the first must not cost
// the second — 15.4 has constructing inert and a throwing formatter is not an exception to
// it. The fallback is the NAME, which is the one string that is always right.
//
// THE REVERT: dropping the `try`/`catch` from `messageFor` reports the throw escaping
// construction, so the caller never gets the `Failed` at all.
test('a message function that throws falls back to the name', () => {
    const broken = refuse.typed<'Broken', { n: number }>(
        'Broken',
        400,
        (data) => {
            throw new Error(`formatter is wrong about ${data.n}`)
        },
    )
    let threw: unknown
    let refusal: { name: string; message: string } | undefined
    try {
        refusal = broken({ n: 1 })
    } catch (thrown) {
        threw = thrown
    }
    expect(`threw: ${threw === undefined ? 'no' : 'yes'}`).toBe('threw: no')
    expect(`${refusal?.name} ${refusal?.message}`).toBe('Broken Broken')
})

// 15.7 and 15.8 — the only two refusals the framework declares beyond the one 17.4 names,
// and 15.9 caps it there. The statuses are not interchangeable: a 422 says the request
// parsed and its contents are wrong, which is what a schema that ran and refused found out.
test('abide declares three refusal names and no more', () => {
    const missing = notFound({ path: '/x', method: 'GET' })
    const invalid = validationError<{ email: string }>({
        email: ['required'],
    })
    const undeclared = refuse(418, 'no coffee')
    expect(
        [
            `${missing.name} ${missing.status}`,
            `${invalid.name} ${invalid.status}`,
            `${undeclared.name} ${undeclared.status}`,
        ].join(' | '),
    ).toBe('NotFound 404 | ValidationError 422 | HttpError 418')
    // 15.7: the refusal carries where it was looking, which is what a log needs and what a
    // caller must not be able to tell apart from an address it is not allowed to see.
    expect(missing.data).toEqual({ path: '/x', method: 'GET' })
    // 17.5: the undeclared form carries no data, and has no way to be given any.
    expect(`data: ${undeclared.data}`).toBe('data: undefined')
})

// 15.15, AND IT IS THE CLAUSE MOST LIKELY TO BE WRITTEN THE OTHER WAY. The schema here is
// the app checking its own refusal PAYLOAD, so getting it wrong is a bug in the error path
// — and stopping the `Failed` being built means the caller receives nothing at all, the
// original failure disappearing behind a second one. 15.4 has constructing inert and this
// is the case that tests whether it really is.
//
// THE REVERT: letting `runSchema`'s throw escape `make` reports `built: no`.
test('a refusal schema that refuses still builds the Failed', () => {
    const tooBig = refuse.typed<'TooBig', { limit: number }>(
        'TooBig',
        413,
        undefined,
        {
            schema: (value: unknown) => {
                throw new Error(
                    `the payload is wrong: ${JSON.stringify(value)}`,
                )
            },
        },
    )
    let refusal: { name: string; status: number } | undefined
    try {
        refusal = tooBig({ limit: 10 })
    } catch {
        refusal = undefined
    }
    expect(`built: ${refusal === undefined ? 'no' : 'yes'}`).toBe('built: yes')
    expect(`${refusal?.name} ${refusal?.status}`).toBe('TooBig 413')
})

// 15.14: THE SCHEMA RUNS BEFORE THE MESSAGE FUNCTION, and the order is not cosmetic — a
// formatter reading data the schema was about to refuse is a message about a value that
// never existed. The order is what the counters report, not the result.
//
// THE REVERT: swapping the two statements in `make` reports `schema, message` as
// `message, schema`.
test('a refusal schema runs before the message function', () => {
    const order: string[] = []
    const mine = refuse.typed<'Mine', { n: number }>(
        'Mine',
        400,
        (data) => {
            order.push('message')
            return `about ${data.n}`
        },
        {
            schema: (value: unknown) => {
                order.push('schema')
                return value as { n: number }
            },
        },
    )
    mine({ n: 1 })
    expect(order.join(', ')).toBe('schema, message')
})
