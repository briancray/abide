import { expect, test } from 'bun:test'

import { POST } from '#server'
import {
    flushSync,
    type Issues,
    jsonSchema,
    type Reactive,
    reactive,
    refuse,
    watch,
} from '#shared'

// KEEP THE CALL: a form keeps the `Reactive` its write's call handed back rather than awaiting it in
// a `try` and copying the outcome out by hand. 16.4 issues the request at the call, 11.61 adopts the
// call's value and 11.50 forwards every probe; 3.15 and 4.19 are the two this form adds.

type Balance = { account: string; amount: number }

const AccountClosed = refuse.named('AccountClosed', 409, undefined, {
    schema: jsonSchema<{ account: string }>({ type: 'object' }),
})

// What each call waits on before it answers, so `busy` has a window to be read in. `held` hands
// back the release of the call made next.
let answer = Promise.resolve()

function held(): () => void {
    const gate = Promise.withResolvers<void>()
    answer = gate.promise
    return gate.resolve
}

const recordBalance = POST(
    async ({ account, amount }: Balance) => {
        await answer
        if (account === 'closed') return AccountClosed({ account })
        return { account, amount }
    },
    {
        args: jsonSchema<Balance>({
            type: 'object',
            required: ['account', 'amount'],
            properties: {
                account: { type: 'string', minLength: 2 },
                amount: { type: 'number', minimum: 1 },
            },
        }),
    },
)

async function settled(
    value: Reactive<unknown, never, unknown>,
): Promise<void> {
    await value.then(
        () => undefined,
        () => undefined,
    )
    flushSync()
}

// 11.61, 11.50 — THE CALL'S PROBES ARE THE FORM'S, and each reader wakes once per probe move: four
// over two submits, `busy` true and false for each. `error` is filled by the refusal and dropped when
// the second submit is adopted, since the probes are the call being kept; its reader also wakes on
// the `busy` moves, which 3.3 subscribes it to together. Each reader records what it read, so a
// fifth wake would show as a fifth entry. THE REVERT: drop `probe(cell)` from the `error` member in
// `Reactive.ts`; the error reader reads `undefined` once and never wakes — 1 entry where 5 are owed.
test('a kept call is busy in flight, refused, and dropped for the next call — 11.61, 11.50', async () => {
    const saving = reactive<typeof recordBalance>()
    const busy: boolean[] = []
    const errors: (string | undefined)[] = []
    using _busy = {
        [Symbol.dispose]: watch(() => {
            busy.push(saving.busy())
        }),
    }
    using _error = {
        [Symbol.dispose]: watch(() => {
            errors.push(saving.error()?.name)
        }),
    }
    flushSync()

    let release = held()
    saving.set(recordBalance({ account: 'closed', amount: 5 }))
    flushSync()
    expect(saving.busy()).toBe(true)
    release()
    await settled(saving)
    expect(saving.isError(saving.error(), 'AccountClosed')).toBe(true)

    release = held()
    saving.set(recordBalance({ account: 'checking', amount: 5 }))
    flushSync()
    expect(saving.error()).toBeUndefined()
    release()
    await settled(saving)
    expect(saving()).toEqual({ account: 'checking', amount: 5 })
    expect(busy).toEqual([false, true, false, true, false])
    expect(errors).toEqual([
        undefined,
        undefined,
        'AccountClosed',
        undefined,
        undefined,
    ])
})

// 11.61, 16.7 — A SECOND SUBMIT IS A SECOND CALL, and the form follows it: the same args twice is a
// mutation run twice (16.7), and the kept value adopts the call the second submit made. THE REVERT:
// have `adopt` in `Reactive.ts` return early where an adoption already stands — the form reads
// `busy()` false at the second submit, still holding the first answer.
test('a second submit is adopted, and the form follows the new call — 11.61', async () => {
    const saving = reactive<typeof recordBalance>()
    const busy: boolean[] = []
    using _busy = {
        [Symbol.dispose]: watch(() => {
            busy.push(saving.busy())
        }),
    }
    flushSync()
    for (const amount of [5, 7]) {
        const release = held()
        saving.set(recordBalance({ account: 'savings', amount }))
        flushSync()
        expect(saving.busy()).toBe(true)
        release()
        await settled(saving)
        expect(saving()).toEqual({ account: 'savings', amount })
    }
    expect(busy).toEqual([false, true, false, true, false])
})

// 3.15 — `issues` IS THE STANDING `ValidationError`'s DATA, and `undefined` beside any other refusal
// and beside none. Typed from the call's args, so `issues.amount` needs no cast. THE REVERT: answer
// `failure?.data` whatever its name — the `AccountClosed` refusal's `{ account }` is handed back as
// issues, where `undefined` is owed.
test('issues reads the standing ValidationError, and nothing else — 3.15', async () => {
    const saving = reactive<typeof recordBalance>()
    expect(saving.issues()).toBeUndefined()

    saving.set(recordBalance({ account: 'x', amount: 0 }))
    await settled(saving)
    const issues: Issues<typeof recordBalance> | undefined = saving.issues()
    expect(Object.keys(issues ?? {}).sort()).toEqual(['account', 'amount'])
    expect(issues?.amount?.length).toBe(1)

    let release = held()
    saving.set(recordBalance({ account: 'closed', amount: 5 }))
    release()
    await settled(saving)
    expect(saving.error()?.name).toBe('AccountClosed')
    expect(saving.issues()).toBeUndefined()

    release = held()
    saving.set(recordBalance({ account: 'checking', amount: 5 }))
    release()
    await settled(saving)
    expect(saving.issues()).toBeUndefined()
})

// 3.3 and 11.50 for 3.15 — `issues` SUBSCRIBES as `error` does, and ADOPTING A CALL ALREADY REFUSED
// moves it: the `args` gate refuses at the call, so the adopted value is failed before the form
// holds it and produces nothing afterwards. Two refusals in a row, the second with one field put
// right, then an accepted call. THE REVERT: drop the `failureOf(cell) !== wasFailure` arm from
// `adopt` in `Reactive.ts`; the reader never hears either refusal — `[[], [], []]` where three
// different answers are owed.
test('a reader of issues alone hears each refusal, as the call is adopted — 3.3, 3.15, 11.50', async () => {
    const saving = reactive<typeof recordBalance>()
    const fields: string[][] = []
    using _issues = {
        [Symbol.dispose]: watch(() => {
            fields.push(Object.keys(saving.issues() ?? {}).sort())
        }),
    }
    flushSync()
    saving.set(recordBalance({ account: 'x', amount: 0 }))
    await settled(saving)
    saving.set(recordBalance({ account: 'checking', amount: 0 }))
    await settled(saving)
    const release = held()
    saving.set(recordBalance({ account: 'checking', amount: 5 }))
    release()
    await settled(saving)
    expect(fields).toEqual([[], ['account', 'amount'], ['amount'], [], []])
})

// 4.19 — THE TYPE OF A KEPT CALL, read off the `Rpc`. Each line is checked by `bun run typecheck`:
// the failures narrow with no cast, the value is the call's, and a union type argument stays one
// value rather than distributing.
test('reactive<typeof rpc>() is typed as the call — 4.19', () => {
    const saving = reactive<typeof recordBalance>()
    const failure = saving.error()
    if (saving.isError(failure, 'AccountClosed')) {
        const account: string = failure.data.account
        expect(account).toBeString()
    }
    if (saving.isError(failure, 'ValidationError')) {
        const amount: string[] | undefined = failure.data.amount
        expect(amount).toBeArray()
    }
    const kept: Balance | undefined = saving.peek()
    expect(kept).toBeUndefined()
    const plain = reactive<Balance | undefined>()
    const one: Reactive<Balance | undefined> = plain
    expect(one).toBe(plain)
    const none: undefined = reactive<number>().issues()
    expect(none).toBeUndefined()
})
