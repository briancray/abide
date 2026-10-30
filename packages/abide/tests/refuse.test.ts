// THE REFUSAL SURFACE. RULEBOOK 15, and most of it is about what does NOT happen:
// constructing a `Failed` refuses nothing (15.4), a message formatter that throws takes
// nothing down with it (15.13), and the framework declares no name an app did not ask for
// (15.9). None of those can be read off the value that comes back.

import { expect, test } from 'bun:test'

import {
    aborted,
    type Failed,
    flushSync,
    isFailed,
    jsonSchema,
    notFound,
    reactive,
    refuse,
    validationError,
    watch,
} from '#shared'

// 15.3. The status an app gets without asking, and it is the one that says "what you sent
// cannot be worked with" — which is what a declared refusal almost always is.
test('a declared refusal defaults to status 400', () => {
    const tooSlow = refuse.named('TooSlow')
    const refusal = tooSlow()
    expect(`${refusal.name} ${refusal.status}`).toBe('TooSlow 400')
})

// 15.4: INERT. Nothing is thrown, nothing is registered and no caller is told — which is
// what makes 15.5 meaningful: RETURNING one is the refusal, so building one has to be safe
// everywhere else. A constructor that threw would make `const refusal = mine()` a control
// flow change at the declaration site.
test('constructing a Failed is inert', () => {
    const mine = refuse.named('Mine')
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
    const mine = refuse.named('Mine')
    const yours = refuse.named('Yours')
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
    const tooBig = refuse.named(
        'TooBig',
        413,
        (data) => {
            ran += 1
            return `over ${data.limit}`
        },
        { schema: (value: unknown) => value as { limit: number } },
    )
    const refusal = tooBig({ limit: 10 })
    expect(refusal.message).toBe('over 10')
    // Read it twice: a formatter that ran per read would count again here.
    expect(`${refusal.message} ${refusal.message}`).toBe('over 10 over 10')
    expect(`formatter runs: ${ran}`).toBe('formatter runs: 1')
})

// 15.13. A formatter is cosmetic and a refusal is not, so a bug in the first must not cost
// the second — 15.4 has constructing inert and a throwing formatter is not an exception to
// it. The fallback is what no message at all would have been — the status's reason phrase, or
// the name for a status with none.
//
// THE REVERT: dropping the `try`/`catch` from `messageFor` reports the throw escaping
// construction, so the caller never gets the `Failed` at all.
test('a message function that throws falls back to the reason phrase, then the name', () => {
    const shape = { schema: (value: unknown) => value as { n: number } }
    const formatter = (data: { n: number }): string => {
        throw new Error(`formatter is wrong about ${data.n}`)
    }
    const broken = refuse.named('Broken', 400, formatter, shape)
    const unregistered = refuse.named('Unregistered', 599, formatter, shape)
    let threw: unknown
    let refusal: { name: string; message: string } | undefined
    try {
        refusal = broken({ n: 1 })
    } catch (thrown) {
        threw = thrown
    }
    expect(`threw: ${threw === undefined ? 'no' : 'yes'}`).toBe('threw: no')
    expect(`${refusal?.name} ${refusal?.message}`).toBe('Broken Bad Request')
    expect(unregistered({ n: 1 }).message).toBe('Unregistered')
})

// 15.13 — A DECLARED REFUSAL WITH NO MESSAGE IS ITS STATUS'S REASON PHRASE, and a status with none
// falls back to the name.
test('a named refusal with no message takes its reason phrase, or its name — 15.13', () => {
    expect(
        [
            refuse.named('Mine')().message,
            refuse.named('Mine', 409)().message,
            refuse.named('Mine', 599)().message,
        ].join(' | '),
    ).toBe('Bad Request | Conflict | Mine')
})

// 15.18 — DATA COMES OFF THE SCHEMA, so the name is written once and both are inferred. The
// `@ts-expect-error` is the assertion: typecheck fails if a refusal with no schema starts taking
// data, or if the message function stops being accepted only beside one.
test('a refusal carries data only through its schema, and infers both from it — 15.18', () => {
    const tooBig = refuse.named('TooBig', 413, (data) => `over ${data.limit}`, {
        schema: (value: unknown) => value as { limit: number },
    })
    const refusal: Failed<'TooBig', { limit: number }> = tooBig({ limit: 10 })
    expect(`${refusal.name} ${refusal.message}`).toBe('TooBig over 10')
    // @ts-expect-error no schema declares no data
    refuse.named('Plain')({ n: 1 })
    // @ts-expect-error a message function needs a schema to be typed by
    refuse.named('Plain', 400, (data: { n: number }) => `${data.n}`)
})

// 17.8 — no message is the status's reason phrase, and a status with none is still named.
test('refuse with no message takes the reason phrase for its status — 17.8', () => {
    expect(
        [refuse(404).message, refuse(503).message, refuse(599).message].join(
            ' | ',
        ),
    ).toBe('Not Found | Service Unavailable | HttpError')
})

// 15.7, 15.8 and 16.49 — the only three refusals the framework declares beyond the one 17.4
// names, and 15.9 caps it there. The statuses are not interchangeable: a 422 says the request
// parsed and its contents are wrong, which is what a schema that ran and refused found out.
test('abide declares four refusal names and no more', () => {
    const missing = notFound({ path: '/x', method: 'GET' })
    const invalid = validationError<{ email: string }>({
        email: ['required'],
    })
    const undeclared = refuse(418, 'no coffee')
    const abandoned = aborted()
    expect(
        [
            `${missing.name} ${missing.status}`,
            `${invalid.name} ${invalid.status}`,
            `${abandoned.name} ${abandoned.status}`,
            `${undeclared.name} ${undeclared.status}`,
        ].join(' | '),
    ).toBe('NotFound 404 | ValidationError 422 | Aborted 499 | HttpError 418')
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
    const tooBig = refuse.named<'TooBig', { limit: number }>(
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
    const mine = refuse.named<'Mine', { n: number }>(
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

// 15.4 IS UNCONDITIONAL, and `runSchema` has TWO exits: a report for a bad VALUE, and a THROW for
// a bad SCHEMA. The test above covers the one form `runSchema` catches inside itself — a plain
// function that throws — so it was green while all three of the throws `runSchema` raises ITSELF
// took the `Failed` with them.
//
// THE REVERT: remove the try/catch around `runSchema` in `make`. This test then reports
// `built: no` where `built: yes` is due for a predicate (19.3) and an async schema (19.12). A JSON
// Schema keyword the validator does not implement is the third case, and it is refused inside
// `jsonSchema`'s own `validate` rather than thrown past it.
test('a refusal survives a schema that is itself wrong', () => {
    const asyncSchema = {
        '~standard': {
            version: 1,
            vendor: 'test',
            validate: () => Promise.resolve({ value: 1 }),
        },
    }
    const schemas: [string, unknown][] = [
        ['predicate', (value: unknown) => typeof value === 'object'],
        ['async', asyncSchema],
        ['unknown keyword', jsonSchema({ type: 'object', format: 'x' })],
    ]
    const built: string[] = []
    for (const [what, schema] of schemas) {
        const mine = refuse.named<'Mine', { n: number }>(
            'Mine',
            400,
            undefined,
            {
                schema: schema as never,
            },
        )
        let refusal: { name: string; status: number } | undefined
        try {
            refusal = mine({ n: 1 })
        } catch {
            refusal = undefined
        }
        built.push(
            `${what}: ${refusal === undefined ? 'no' : `${refusal.name} ${refusal.status}`}`,
        )
    }
    expect(built).toEqual([
        'predicate: Mine 400',
        'async: Mine 400',
        'unknown keyword: Mine 400',
    ])
})

// 15.6 IS STRUCTURAL BECAUSE OF THIS TRIP, so the trip is what tests it. `new Error(m)` writes
// `message` as a NON-ENUMERABLE own property, and `JSON.stringify` walks enumerable ones.
//
// THE REVERT: drop the `Object.defineProperty` in `failed` and let the constructor's own
// `message` stand. Every line below then reports `message: undefined` and `isFailed: false` —
// the refusal crosses the wire and stops being one, for all three factories.
test('a refusal survives JSON and is still a refusal', () => {
    const made = [
        refuse(503, 'upstream is down'),
        notFound({ path: '/a', method: 'GET' }),
        validationError<{ email: string }>({ email: ['is required'] }),
    ]
    const seen: string[] = []
    for (const refusal of made) {
        const revived = JSON.parse(JSON.stringify(refusal)) as {
            message?: unknown
        }
        seen.push(
            `${refusal.name}: message: ${revived.message} isFailed: ${isFailed(revived)}`,
        )
    }
    expect(seen).toEqual([
        'HttpError: message: upstream is down isFailed: true',
        'NotFound: message: Not Found isFailed: true',
        'ValidationError: message: Unprocessable Content isFailed: true',
    ])
})

// 4.7 GOVERNS EVERY SCHEMA RUN, NOT THE TWO `Reactive.ts` OWNS. Cleared at the write path alone,
// a refusal built inside an effect subscribed that effect to whatever its schema read — a value
// the body never read, spliced into the body's cursor-ordered sources besides. THE REVERT: drop
// the save/restore from `runSchema` in `#shared/Schema.ts`; `runs` below reports 2.
test("a refusal's schema runs untracked", () => {
    const other = reactive(1)
    const mine = refuse.named<'Mine', { n: number }>('Mine', 400, undefined, {
        schema: (value: unknown) => {
            other()
            return value as { n: number }
        },
    })
    let runs = 0
    watch(() => {
        runs += 1
        mine({ n: 1 })
    })
    flushSync()
    expect(runs).toBe(1)
    other.set(2)
    flushSync()
    expect(runs).toBe(1)
})

// 15.5 — RETURNING A `Failed` REFUSES, from a body as much as from a `transform`. Only the
// `transform` had been checked, so a body answering `notFound(…)` STORED the refusal as its
// value: `ready()` true, `error()` empty, and the page rendering an error object as data. Both
// ways a body answers are asserted, and a write is the boundary — it is not an answer.
// THE REVERT: drop the `isFailed` arm in `run` and the `answered` test in `absorb`; the first
// body reports `error: none, ready: true` where `NotFound` is due, and the recompute below serves
// the refusal itself as its value.
test('a body that returns a refusal refuses — 15.5', async () => {
    const summary = (value: { error(): unknown; ready(): boolean }): string =>
        `error: ${isFailed(value.error()) ? (value.error() as Error).name : 'none'}, ready: ${value.ready()}`

    const settled = reactive(() => notFound())
    expect(summary(settled)).toBe('error: NotFound, ready: false')

    const loaded = reactive(async () => notFound())
    await loaded.catch(() => {})
    expect(summary(loaded)).toBe('error: NotFound, ready: false')

    const keyed = reactive(async ({ id }: { id: string }) =>
        id === '42' ? { id } : notFound(),
    )
    const missing = keyed({ id: 'nope' })
    await missing.catch(() => {})
    expect(summary(missing)).toBe('error: NotFound, ready: false')

    // 4.17 — A WRITE OF ONE IS DATA. `set` is not a producer's answer; a write refuses only where
    // its `transform` returned the refusal (4.6).
    const held = reactive<unknown>(0)
    held.set(notFound())
    expect(summary(held)).toBe('error: none, ready: true')
})

// 2.4 THROUGH 15.5 — a recompute that refuses leaves what was served standing, with the refusal
// beside it, exactly as a recompute that threw does.
test('a recompute that returns a refusal keeps serving what it had', () => {
    const id = reactive('42')
    const invoice = reactive(() => (id() === '42' ? 'INV-0042' : notFound()))
    const seen: string[] = []
    watch(() => {
        const error = invoice.error() as Error | undefined
        seen.push(`${invoice()} ${error?.name ?? 'none'}`)
    })
    id.set('nope')
    flushSync()
    expect(seen).toEqual(['INV-0042 none', 'INV-0042 NotFound'])
})
