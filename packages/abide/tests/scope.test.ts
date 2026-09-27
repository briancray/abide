// 11.32, 11.38, 13.8 AND 22.1 — A SERVER FILES A VALUE UNDER THE REQUEST THAT REACHED IT. A
// module's `reactive` is built once at import and reached by every request after, so what is gated
// here is the WORK: how many times a body ran, and which request's value a body read. Every one of
// these reads the right-looking value with the scoping taken out — the first request's.

import { expect, test } from 'bun:test'
import { inScope, request, response } from '#server/requestScope.ts'
import { flushSync, reactive, refresh, watch } from '#shared'
import { GET } from '#shared/rpc.ts'
import { socket } from '#shared/socket.ts'

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

// 11.32 — A BODY BUILT AT IMPORT RUNS ONCE PER REQUEST, and a request sees its own answer. THE
// REVERT: have `outsideScope` answer false; the value is process-wide again, and the second request
// reads the first one's `set` — 5 where 0 is due.
test('a value built outside every request is one value per request — 11.32', async () => {
    let runs = 0
    const visits = reactive(() => {
        runs += 1
        return 0
    })
    expect(runs).toBe(1)

    await inScope(new Request('http://app/a'), async () => {
        visits.set(visits() + 5)
        await tick()
        expect(visits()).toBe(5)
    })
    await inScope(new Request('http://app/b'), async () => {
        expect(visits()).toBe(0)
    })
    expect(runs).toBe(3)
    // Outside a request it is the value built at import, which neither request wrote.
    expect(visits()).toBe(0)
})

// 11.38 — COALESCED WITHIN A SCOPE: two reaches of one key in one request share one load, and two
// requests load twice. THE REVERT: the same as above; the second request joins the first one's
// entry and the body runs 1 time where 2 are due.
test('a keyed load coalesces within a request and not across two — 11.38', async () => {
    let loads = 0
    const invoice = reactive(async ({ id }: { id: string }) => {
        loads += 1
        return { id }
    })
    for (const path of ['a', 'b'])
        await inScope(new Request(`http://app/${path}`), async () => {
            const first = invoice({ id: '42' })
            expect(invoice({ id: '42' })).toBe(first)
            expect(await first).toEqual({ id: '42' })
        })
    expect(loads).toBe(2)
})

// A request that builds what `setup` builds, then waits at a gate, then does `after` — still inside
// itself, because a continuation carries the request it was awaiting in. A closure called later
// does not, which is why the write is made here rather than handed out.
function held(
    path: string,
    setup: () => void,
    after: () => void,
): { open: () => void; done: Promise<void> } {
    let open = (): void => {}
    const gate = new Promise<void>((release) => {
        open = release
    })
    const done = inScope(new Request(`http://app/${path}`), async () => {
        setup()
        await gate
        after()
    })
    return { open, done }
}

// 11.32 — A BODY RUNS UNDER THE SCOPE IT WAS BUILT IN, not the one that happened to schedule the
// drain. B writes first, so the one drain that reruns both derivations was scheduled from B; A's
// derivation reads the module-level `quantity`, and run under B's scope it reads B's. THE REVERT:
// call `body(cell.args)` directly in `run` rather than through `provider.run`; A's total reads 20
// where 30 is due, with nothing thrown.
test('a body reruns under its own request, whichever request drained it — 11.32', async () => {
    const quantity = reactive(1)
    const totals: Record<string, number> = {}
    const derive = (name: string) => (): void => {
        const total = reactive(() => quantity() * 10)
        watch(() => {
            totals[name] = total()
        })
    }
    const a = held('a', derive('a'), () => quantity.set(3))
    const b = held('b', derive('b'), () => quantity.set(2))
    expect(totals).toEqual({ a: 10, b: 10 })

    // B's continuation is queued first, so its write is the one that schedules the drain, and A's
    // write lands before the drain runs.
    b.open()
    a.open()
    await Promise.all([a.done, b.done])
    await tick()
    expect(totals).toEqual({ a: 30, b: 20 })
})

// 13.8 — A TAG IS SCOPE-BOUNDED. A refresh by tag inside one request reloads that request's value
// and never another's. THE REVERT: drop the `cell.scope === scope` test in `carrying`; B's body runs
// again for A's refresh — 2 loads where 1 is due.
test('a refresh by tag reaches the request it was made in and no other — 13.8', async () => {
    let loads = 0
    const stock = reactive(
        () => {
            loads += 1
            return 3
        },
        { tags: ['stock'] },
    )
    const subscribe = (): void => {
        watch(() => {
            stock()
        })
    }
    const a = held('a', subscribe, () => {
        loads = 0
        refresh({ tags: ['stock'] })
        flushSync()
    })
    const b = held('b', subscribe, () => {})
    // The home's run at import, and one per request.
    expect(loads).toBe(3)
    b.open()
    await b.done
    a.open()
    await a.done
    expect(loads).toBe(1)
})

// 13.13 — A `global` VALUE IS IN EVERY SCOPE, so a selection made inside a request reaches it — the
// value built at import, and an entry of a `global` keyed value that another request made. THE
// REVERT: drop `|| cell.global` from `carrying`; neither body runs again — 0 loads where 2 are due.
test('a refresh by tag inside a request reaches a global value and its entries — 13.13', () => {
    let loads = 0
    const prices = reactive(
        () => {
            loads += 1
            return 3
        },
        { tags: ['prices'], global: true },
    )
    const price = reactive(
        (args: { id: number }) => {
            loads += 1
            return args.id
        },
        { tags: ['prices'], global: true },
    )
    prices()
    inScope(new Request('http://app/a'), () => price({ id: 1 })())
    loads = 0
    inScope(new Request('http://app/b'), () => refresh({ tags: ['prices'] }))
    prices()
    price({ id: 1 })()
    expect(loads).toBe(2)
})

// 11.34 — `global` IS ONE VALUE FOR THE PROCESS. THE REVERT: drop the `global` test from
// `outsideScope`; the second request reads 0 where the first wrote 7.
test('a global value is shared by every request — 11.34', async () => {
    const hits = reactive(0, { global: true })
    inScope(new Request('http://app/a'), () => hits.set(7))
    inScope(new Request('http://app/b'), () => {
        expect(hits()).toBe(7)
    })
})

// 22.1 — THE AMBIENTS THROW OUTSIDE A REQUEST, and 42.8's scope made without one is outside one.
// Inside, the request survives an `await`, which is the whole reason the scope is carried rather
// than set and cleared.
test('request and response read the request being served, and throw outside one — 22.1', async () => {
    expect(() => request()).toThrow(/RULEBOOK 22\.1/)
    expect(() => response()).toThrow(/RULEBOOK 22\.1/)
    inScope(undefined, () => {
        expect(() => request()).toThrow(/RULEBOOK 22\.1/)
    })
    const url = await inScope(new Request('http://app/invoices'), async () => {
        await tick()
        response().status = 201
        expect(response().status).toBe(201)
        return request().url
    })
    expect(url).toBe('http://app/invoices')
})

// 9.16, 18.18 — A SOCKET CARRIES A PROCESS-WIDE VALUE, and one built without `global` is refused where
// it is declared rather than quietly filed per request. THE REVERT: drop the refusal from `socket`;
// the request-local value is carried, and a publish inside a request reaches none of its subscribers.
test('socket refuses a value built without global — 18.18', () => {
    let refusal: unknown
    try {
        socket(reactive<string>(undefined))
    } catch (thrown) {
        refusal = thrown
    }
    expect(String(refusal)).toContain('RULEBOOK 9.16, 18.18')
    expect(socket(reactive<string>(undefined, { global: true }))).toBeDefined()
})

// 11.26, 11.69 — A HANDLER WITH RUNGS KEYS ITS VALUE BY THE ARGS AS SENT, and its body gets what the
// gate made of them, as one with no rungs does. THE REVERT: reach the value with `ctx.args()` at
// the onion's centre; the two spellings land on 1 entry rather than 2.
test('a handler with rungs keys its value by the args as sent — 11.26, 11.69', async () => {
    const seen: string[] = []
    const invoice = reactive(
        (args: { id: string }) => {
            seen.push(args.id)
            return args.id
        },
        {
            args: (given: unknown) => ({
                id: (given as { id: string }).id.toLowerCase(),
            }),
        },
    )
    const getInvoice = GET(invoice, { middleware: [async (next) => next()] })
    const entries = await inScope(new Request('http://app/'), async () => {
        await getInvoice({ id: 'ABC' })
        await getInvoice({ id: 'abc' })
        return invoice.entries.size
    })
    expect(`entries: ${entries}`).toBe('entries: 2')
    expect(seen).toEqual(['abc', 'abc'])
})

// 16.19, 16.20 — `ctx.args()` ASKED AGAIN AFTER A REFUSAL IS REFUSED AGAIN, not handed nothing. A rung
// may catch the refusal and ask a second time, and the answer kept for later asks is only one the
// gate accepted. THE REVERT: mark the ask asked before validating, in `argsOnce`; the second ask
// hands back `undefined` rather than throwing — 1 refusal where 2 are due. And the value is built
// outside every request, so it is `scoped`'s keyed face that carries the gate: dropped there, 0.
test('a rung that caught the args refusal and asks again is refused again — 16.19, 16.20', async () => {
    const refusals: string[] = []
    const invoice = reactive((args: { id: string }) => args.id, {
        args: (given: unknown) => {
            if (typeof (given as { id: unknown }).id !== 'string')
                throw new Error('id is text')
            return given as { id: string }
        },
    })
    const getInvoice = GET(invoice, {
        middleware: [
            async (next, ctx) => {
                for (let ask = 0; ask < 2; ask += 1)
                    try {
                        ctx.args()
                    } catch (refusal) {
                        refusals.push((refusal as { name: string }).name)
                    }
                return next()
            },
        ],
    })
    await inScope(new Request('http://app/'), async () => {
        await getInvoice({ id: 7 } as never).catch(() => {})
    })
    expect(refusals).toEqual(['ValidationError', 'ValidationError'])
})
