import { expect, test } from 'bun:test'

import { gate, inAFreshProcess } from '@abide/harness/gate'

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

// How many times the handler ran, so a wait that ran the write again shows.
let recorded = 0

const recordBalance = POST(
    async ({ account, amount }: Balance) => {
        recorded += 1
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
    // `toStrictEqual`: `toEqual` passes an array short of its trailing `undefined`s.
    expect(errors).toStrictEqual([
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

// 2.7, 2.8 — AFTER THE CALL LANDS IS `then` ON THE KEPT VALUE, with no second wait to keep: the call
// runs once whatever waits on it, the follow-up runs once per call that answered, and a refusal is
// handed to the second argument while it stands on `error` as before. A `then` made before a second
// submit is answered by the call the form keeps when it settles, which is that second one: the form
// has one call, and its answer is the one after-success is for. 11.16 is what makes it so: a call
// adopted with nothing to serve leaves the form nothing to serve, so a `then` waits for it. THE
// REVERT: have `mirror` in `Reactive.ts` return where the adopted has nothing to serve, without
// unserving — the refused submit's `then` is answered with the last call's 5: `[5, 5, 7, 7]`.
test('then on a kept call follows each answer once, and leaves a refusal on error — 2.7, 2.8', async () => {
    const saving = reactive<typeof recordBalance>()
    const saved: (number | undefined)[] = []
    const refused: string[] = []
    const before = recorded
    const after = (balance: Balance): void => {
        saved.push(balance.amount)
    }
    const otherwise = (failure: unknown): void => {
        refused.push((failure as Error).name)
    }
    let release = held()
    saving.set(recordBalance({ account: 'savings', amount: 5 }))
    saving.then(after, otherwise)
    release()
    await settled(saving)

    release = held()
    saving.set(recordBalance({ account: 'closed', amount: 5 }))
    saving.then(after, otherwise)
    release()
    await settled(saving)
    expect(saving.error()?.name).toBe('AccountClosed')

    release = held()
    saving.set(recordBalance({ account: 'savings', amount: 6 }))
    saving.then(after, otherwise)
    saving.set(recordBalance({ account: 'savings', amount: 7 }))
    saving.then(after, otherwise)
    release()
    await settled(saving)
    expect(saved).toEqual([5, 7, 7])
    expect(refused).toEqual(['AccountClosed'])
    expect(recorded - before).toBe(4)

    // A `then` arm answering anything types: one result type per arm, as `PromiseLike` has.
    const closed: Promise<boolean> = saving.then(
        () => true,
        () => false,
    )
    expect(await closed).toBe(true)
})

// 11.61, 11.16, 11.50 — KEEPING NO CALL IS ADOPTING A VALUE NOTHING HAS WRITTEN: `saving =
// reactive<typeof save>()` drops the standing refusal, reads not ready, and writes nothing into the
// call it stops keeping — where `saving = undefined` is a write, which 11.59 hands to that call.
// The `error` reader hears the drop once, after the call's `busy` move and its refusal. THE REVERT:
// drop the `failureOf(cell) !== wasFailure` arm from `adopt` in `Reactive.ts`; the reader never
// hears the refusal leave — 3 entries, the last `'AccountClosed'`, where a fourth is owed.
test('a kept call is let go by keeping one nothing has written — 11.16, 11.50, 11.61', async () => {
    const saving = reactive<typeof recordBalance>()
    const errors: (string | undefined)[] = []
    using _error = {
        [Symbol.dispose]: watch(() => {
            errors.push(saving.error()?.name)
        }),
    }
    flushSync()
    const release = held()
    const call = recordBalance({ account: 'closed', amount: 5 })
    saving.set(call)
    release()
    await settled(saving)
    saving.set(reactive<typeof recordBalance>())
    flushSync()
    expect(errors).toStrictEqual([
        undefined,
        undefined,
        'AccountClosed',
        undefined,
    ])
    expect([saving.ready(), saving.busy()]).toEqual([false, false])
    expect(call.error()?.name).toBe('AccountClosed')
})

const closeAccount = POST(async ({ account }: { account: string }) => {
    await answer
    if (account === 'closed') return AccountClosed({ account })
    return undefined
})

// 4.19 FOR A UNION — ONE BUSY AND ONE ERROR FOR A FLOW CALLING ONE OF SEVERAL HANDLERS: the value is
// typed over every call it may keep, its failures the union of theirs, and each call is adopted as
// any one is. Checked by `bun run typecheck` as much as by the run.
test('reactive<typeof a | typeof b>() keeps a call of either — 4.19', async () => {
    const removing = reactive<typeof recordBalance | typeof closeAccount>()
    removing.set(closeAccount({ account: 'closed' }))
    await settled(removing)
    const failure = removing.error()
    if (removing.isError(failure, 'AccountClosed')) {
        const account: string = failure.data.account
        expect(account).toBe('closed')
    }
    removing.set(recordBalance({ account: 'checking', amount: 5 }))
    await settled(removing)
    const kept: Balance | undefined = removing.peek()
    expect(kept).toEqual({ account: 'checking', amount: 5 })
    const refusal = removing.error()
    if (removing.isError(refusal, 'ValidationError')) {
        // Either call's issues: `account` is in both, and `amount` only in `recordBalance`'s.
        const account: string[] | undefined = refusal.data.account
        expect(account).toBeUndefined()
    }
})

// 2.15 — AFTER-SUCCESS IS `then` WITH ONE ARGUMENT. A refusal the kept value holds on `error` is not
// reported unhandled by a `then` given no `onFailed`; an `await` still rejects, and a throw from the
// follow-up is still reported. Counted in a child: `bun test` fails a test an unhandled rejection
// lands in before any listener the test adds can count it. Four submits, three refused, each
// followed by `then(onDone)`, then a follow-up that throws. THE REVERT: hand the kept value's `then`
// an `onFailed` that rethrows, which is the member without 2.15 — `reported` reads 4 where 1 is owed.
let thenReverted = false
gate(
    'then with no onFailed leaves a refusal on error, and reports a throw from the follow-up — 2.15',
    {
        revert: () => {
            thenReverted = true
            return () => {
                thenReverted = false
            }
        },
        worth: { reported: 'reported=4' },
    },
    async () => {
        const run = await inAFreshProcess(`
import { POST } from '${import.meta.dir}/../src/server/index.ts'
import { reactive, refuse } from '${import.meta.dir}/../src/shared/index.ts'

let reported = 0
process.on('unhandledRejection', () => {
    reported += 1
})
const Closed = refuse.named('Closed', 409)
const save = POST(async ({ ok }) => (ok ? { ok } : Closed()))
const saving = reactive()
const keep = (call) => {
    saving.set(call)
    ${thenReverted ? 'const then = saving.then; saving.then = (onSettled, onFailed) => then.call(saving, onSettled, onFailed ?? ((error) => { throw error }))' : ''}
}
let landed = 0
let refused = 0
for (const ok of [false, true, false, false]) {
    keep(save({ ok }))
    saving.then(() => {
        landed += 1
    })
    await saving.then(undefined, () => {
        refused += 1
    })
}
let awaited = 'resolved'
try {
    await saving
} catch (error) {
    awaited = error.name
}
keep(save({ ok: true }))
saving.then(() => {
    throw new Error('follow-up broke')
})
await Bun.sleep(20)
console.log('reported=' + reported, 'landed=' + landed, 'refused=' + refused, 'awaited=' + awaited)`)
        expect(run.output).toContain(
            'reported=1 landed=1 refused=3 awaited=Closed',
        )
    },
)

// 4.1, 4.2, 11.61 — ONE BUSY AND ONE ERROR OVER A STEP THAT IS NOT A CALL. A promise chain is a load
// like any other, so `saving = locate().then((place) => recordBalance(place))` keeps both steps: the
// call the chain's handler returns is a thenable the chain settles with. `busy` moves once each way
// across both steps, where two kept calls in a row would move it twice; whichever step failed is
// the one `error` holds, a plain `Error` as much as a refusal. THE REVERT: keep the two steps one
// after the other — `saving = locate()` and then `saving = recordBalance(…)` — and the reader reads
// `[false, true, false, true, false]` where `[false, true, false]` is owed.
test('a promise chain keeps a step that is not a call under the same busy and error — 4.1, 4.2', async () => {
    const saving = reactive<typeof recordBalance>()
    const busy: boolean[] = []
    using _busy = {
        [Symbol.dispose]: watch(() => {
            busy.push(saving.busy())
        }),
    }
    flushSync()
    const located = Promise.withResolvers<string>()
    const release = held()
    saving.set(
        located.promise.then((account) =>
            recordBalance({ account, amount: 5 }),
        ),
    )
    flushSync()
    located.resolve('checking')
    await Bun.sleep(0)
    flushSync()
    release()
    await settled(saving)
    expect(saving()).toEqual({ account: 'checking', amount: 5 })
    expect(busy).toEqual([false, true, false])

    saving.set(
        Promise.reject(new Error('no fix')).then(() =>
            recordBalance({ account: 'checking', amount: 5 }),
        ),
    )
    await settled(saving)
    expect(String(saving.error())).toBe('Error: no fix')

    saving.set(
        Promise.resolve('x').then((account) =>
            recordBalance({ account, amount: 5 }),
        ),
    )
    await settled(saving)
    expect(Object.keys(saving.issues() ?? {})).toEqual(['account'])
})

// 11.16 — PRESSED ONCE: a form that moves on after its call (a navigation, a parent's callback) is
// disabled on `busy() || ready()`. `ready` holds from the answer until the next call is kept, and a
// refusal leaves it false, so the press comes back for a retry and only for one. Each press is the
// state the button reads after it.
test('busy or ready is true from a press to a refusal, and stays true past an answer — 11.16', async () => {
    const saving = reactive<typeof recordBalance>()
    const pressed = (): boolean => saving.busy() || saving.ready()
    const read: boolean[] = [pressed()]
    let release = held()
    saving.set(recordBalance({ account: 'closed', amount: 5 }))
    read.push(pressed())
    release()
    await settled(saving)
    read.push(pressed())
    release = held()
    saving.set(recordBalance({ account: 'checking', amount: 5 }))
    read.push(pressed())
    release()
    await settled(saving)
    read.push(pressed())
    expect(read).toEqual([false, true, false, true, true])
})
