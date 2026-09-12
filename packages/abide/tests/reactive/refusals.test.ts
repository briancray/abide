// GROUP 15 — the one spelling for every refusal, and the four clauses about what
// happens at CONSTRUCTION, which is the part a reader assumes is deferred.

import { expect, test } from 'bun:test'
import { isFailed } from '#shared/guards.ts'
import { refuse, validationError } from '#shared/index.ts'

// 15.4 — a refusal declared through `refuse.typed` defaults to status 400, and D12 is
// why that rather than 500.
test('a typed refusal defaults to status 400', () => {
    const tooBig = refuse.typed('TooBig')
    const failed = tooBig()
    expect(failed.status).toBe(400)
    expect(failed.name).toBe('TooBig')
    expect(tooBig.is(failed)).toBe(true)
    expect(tooBig.is(new Error('other'))).toBe(false)
})

// 15.5 — constructing a `Failed` is INERT and does not throw. It is a value, and the
// one spelling for every refusal is `return myError(data)` rather than a throw.
test('constructing a Failed is inert', () => {
    const broken = refuse.typed<'Broken', number>('Broken', 418, () => {
        throw new Error('formatter exploded')
    })
    // Spelled with a `try` rather than `.not.toThrow()`: the matcher inspects what
    // the body hands BACK, and what this one hands back is an `Error` — so the
    // assertion read as a throw and failed against a function that had returned.
    let threw = false
    try {
        broken(1)
    } catch {
        threw = true
    }
    expect(threw).toBe(false)
    expect(broken(1).name).toBe('Broken')
})

// 15.7 — `Failed` is STRUCTURAL, in-process and over a wire alike, which is why the
// guard is a shape test rather than an `instanceof`.
test('Failed is recognised structurally', () => {
    const failed = refuse.typed('Nope')()
    expect(isFailed(failed)).toBe(true)
    // What arrived over a wire: no prototype in common with the one above.
    expect(
        isFailed(
            JSON.parse(
                JSON.stringify({
                    name: 'Nope',
                    status: 400,
                    message: 'Nope',
                    data: null,
                }),
            ),
        ),
    ).toBe(true)
    expect(isFailed({ name: 'Nope' })).toBe(false)
    expect(isFailed(new Error('plain'))).toBe(false)
})

// 15.13 — a `message` given as a function runs AT CONSTRUCTION, on the data. D57.
test('a message function runs at construction on the data', () => {
    const tooBig = refuse.typed<'TooBig', number>(
        'TooBig',
        400,
        (data) => `${data} is too big`,
    )
    expect(tooBig(99).message).toBe('99 is too big')
})

// 15.14 — a throw from that function is caught, the `message` falls back to the name,
// and it warns on `abide:refuse`.
test('a message function that threw falls back to the name', () => {
    const broken = refuse.typed<'Broken', number>('Broken', 400, () => {
        throw new Error('formatter exploded')
    })
    expect(broken(1).message).toBe('Broken')
})

// 15.12, 15.15 and 15.16 together — the schema runs synchronously at construction, it
// runs BEFORE the message function, and its refusal warns rather than stopping the
// `Failed` being built.
test('a schema on a typed refusal checks at construction without stopping it', () => {
    const order: string[] = []
    const checked = refuse.typed<'Checked', number>(
        'Checked',
        400,
        (data) => {
            order.push('message')
            return `checked ${data}`
        },
        {
            schema: (value: unknown) => {
                order.push('schema')
                if (typeof value !== 'number') throw new Error('not a number')
                return value
            },
        },
    )
    const failed = checked('no' as never)
    expect(order).toEqual(['schema', 'message'])
    // 15.16 — built anyway.
    expect(failed.name).toBe('Checked')
    expect(failed.message).toBe('checked no')
})

// 15.9 — `validationError` is what a `schema` refusing answers with, at 422.
test('validationError carries status 422', () => {
    // `Issues<T>` is a conditional: keyed by path on a composite and a bare list on a
    // primitive, so the type argument is what decides which shape the data is.
    const failed = validationError<{ field: string }>({ '': ['bad'] })
    expect(failed.status).toBe(422)
    expect(failed.name).toBe('ValidationError')
    expect(failed.data).toEqual({ '': ['bad'] })
})
