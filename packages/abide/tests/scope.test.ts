// 11.32, 11.38, 13.8 AND 22.1 — A SERVER FILES A VALUE UNDER THE REQUEST THAT REACHED IT. A
// module's `reactive` is built once at import and reached by every request after, so what is gated
// here is the WORK: how many times a body ran, and which request's value a body read. Every one of
// these reads the right-looking value with the scoping taken out — the first request's.

import { expect, test } from 'bun:test'

import { installServer } from '#server/installServer.ts'
import {
    currentRequestScope,
    holdScope,
    inScope,
    releaseScope,
    request,
    type RequestScope,
    response,
} from '#server/requestScope.ts'
import { flushSync, invalidate, reactive, refresh, watch } from '#shared'
import { CELL } from '#shared/reactive/CELL.ts'
import { GET, POST } from '#shared/rpc.ts'

installServer()

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

// 11.71 — A STORE BUILT AT IMPORT ON A SERVER IS NOT READ UNTIL ITS VALUE IS REACHED, so a store
// reading the request is read first inside one. THE REVERT: have `reactive` pass `lazy` false to
// `scoped` — the store's `get` runs at import, 1 read where 0 is due, and throws on the `request()`
// it reads.
test('a value with a store built outside every request reads it where it is reached — 11.71', async () => {
    let storeReads = 0
    const session = reactive<string | undefined>(undefined, {
        store: {
            get: () => {
                storeReads += 1
                return new URL(request().url).pathname
            },
            set: () => {},
        },
    })
    expect(`store reads at import: ${storeReads}`).toBe(
        'store reads at import: 0',
    )
    await inScope(new Request('http://app/a'), async () => {
        expect(session()).toBe('/a')
    })
    expect(storeReads).toBe(1)
})

// 12.5 — A REQUEST'S WATCHES STOP AT ITS TEARDOWN, AND A STREAMED BODY HOLDS IT OPEN. `App.fetch`
// releases the scope once it has answered; a body still streaming has taken a hold of its own and
// the watches it reads through stay up until it closes. THE REVERT: have `releaseScope` tear down
// whatever `holds` reads — the watch is stopped while the body still holds, `disposed` 1 where 0
// is due.
test("a watch stops at its request's teardown, which a held body defers — 12.5", async () => {
    const level = reactive(0, { global: true })
    let runs = 0
    let disposed = 0
    let release = (): void => {}
    await inScope(new Request('http://app/a'), async () => {
        watch(() => {
            level()
            runs += 1
            return () => {
                disposed += 1
            }
        })
        release = holdScope()
        releaseScope(currentRequestScope() as RequestScope)
    })
    expect(disposed).toBe(0)
    level.set(1)
    flushSync()
    expect(runs).toBe(2)

    release()
    level.set(2)
    flushSync()
    expect({ runs, disposed }).toEqual({ runs: 2, disposed: 2 })
})

// 12.14 — A VALUE DERIVED IN A REQUEST lets go of a global it read at the request's
// teardown, as its watches do. Left wired, every render left its derived values on the global's
// reader list for the life of the process. THE REVERT: drop the `owned(() => orphan(cell))` in
// `createReactive` — the global keeps 1 reader per request, 2 where 0 are due.
test("a value derived in a request lets go of a global at the request's teardown — 12.14", async () => {
    const level = reactive(0, { global: true })
    for (const path of ['a', 'b'])
        await inScope(new Request(`http://app/${path}`), async () => {
            const plus = reactive(() => level() + 1)
            expect(plus()).toBe(1)
            releaseScope(currentRequestScope() as RequestScope)
        })
    const readers = (level as unknown as { [CELL]: { readers: unknown[] } })[
        CELL
    ].readers
    expect(readers.length).toBe(0)
})

// 16.64 — A HANDLER DECLARING NO PARAMETER IS NOT RUN WHERE IT IS DECLARED. Its value is unkeyed, and
// building one starts its body (1.7), so the home is left unbuilt until a call outside every
// request reaches it. THE REVERT: have `declare` build its value with `reactive`; the body has run
// 1 time before anything called it, where 0 are due.
test('a handler declaring no parameter does not run at its declaration — 16.64', async () => {
    let runs = 0
    const visit = GET(() => {
        runs += 1
        return runs
    })
    await tick()
    expect(runs).toBe(0)
    await inScope(new Request('http://app/a'), async () => {
        expect(await visit()).toBe(1)
    })
    expect(runs).toBe(1)
    // Outside a request the call builds the home, which no request reached.
    expect(await visit()).toBe(2)
})

// 11.34 THROUGH 16.6 — A HANDLER DECLARING `global` IS ONE VALUE FOR EVERY REQUEST, and still not run
// where it is declared (16.64). THE REVERT: file the handler's value without `global` in
// `handlerValue`; each request builds its own and the body runs 2 times where 1 is due.
test('a plain handler declaring global is built once, on its first call — 11.34, 16.64', async () => {
    let runs = 0
    const visit = GET(
        () => {
            runs += 1
            return runs
        },
        { global: true },
    )
    await tick()
    expect(runs).toBe(0)
    for (const path of ['a', 'b'])
        await inScope(new Request(`http://app/${path}`), async () => {
            expect(await visit()).toBe(1)
        })
    expect(await visit()).toBe(1)
    expect(`body runs: ${runs}`).toBe('body runs: 1')
})

// 13.19, 16.64 — A HANDLER NO CALL HAS REACHED ANSWERS AS ONE WITH NO ENTRIES, and asking builds
// nothing: building an unkeyed value starts its body (1.7), so a `disabled={save.busy()}` ran the
// write on every server render and painted it in flight. Asked outside every request and inside one,
// for a mutation and a read alike. THE REVERT: have `faceHere` in `declare` answer `built` always;
// the never-called `POST` reports busy true and ready false, and the probes have run 4 bodies where
// 0 are due — each handler's, once outside every request and once inside one.
test('a handler no call has reached is not busy, and asking runs nothing — 13.19, 16.64', async () => {
    let runs = 0
    let release = (): void => {}
    const save = POST(async () => {
        runs += 1
        await new Promise<void>((done) => {
            release = done
        })
        return runs
    })
    const feed = GET(() => {
        runs += 1
        return runs
    })
    const probes = (): string =>
        `${save.busy()} ${save.ready()} ${save.synced()} ${feed.busy()}`
    const outside = probes()
    await inScope(new Request('http://app/a'), async () => {
        const inside = probes()
        await tick()
        expect(`${outside} | ${inside} | body runs: ${runs}`).toBe(
            'false true true false | false true true false | body runs: 0',
        )
        const call = save()
        expect(save.busy()).toBe(true)
        release()
        await call
        expect(save.busy()).toBe(false)
    })
    expect(`body runs: ${runs}`).toBe('body runs: 1')
})

// 3.3, 13.19 — A READER THAT PROBED BEFORE THE FIRST CALL IS WOKEN BY IT: the unreached answer
// subscribes it to the build of the value in its own scope, and from then it follows the value's
// probes. Outside every request and inside one, as a `disabled={save.busy()}` reads it. THE REVERT:
// have `builtHere` subscribe nothing — each reader stays at its first run and reads `busy` false
// through the whole call, 1 run each where 3 are due ("false, probing ran 0" twice).
test('a reader that probed before the first call wakes when it starts and settles — 3.3, 13.19', async () => {
    let runs = 0
    let release = (): void => {}
    const slow = () =>
        POST(async () => {
            runs += 1
            await new Promise<void>((done) => {
                release = done
            })
        })
    const watched = async (save: ReturnType<typeof slow>): Promise<string> => {
        const seen: boolean[] = []
        const stop = watch(() => {
            seen.push(save.busy())
        })
        await tick()
        const probing = runs
        const call = save()
        await tick()
        release()
        await call
        await tick()
        stop()
        return `${seen.join(' ')}, probing ran ${probing}`
    }
    // Both declared outside every request, as a module's handlers are.
    const home = slow()
    const perRequest = slow()
    const outside = await watched(home)
    runs = 0
    const inside = await inScope(new Request('http://app/a'), () =>
        watched(perRequest),
    )
    expect(`${outside} | ${inside}`).toBe(
        'false true false, probing ran 0 | false true false, probing ran 0',
    )
})

// 3.14, 13.16 — A PROBE OVER A MUTATION A SWEEP INVALIDATED DOES NOT SEND THE WRITE AGAIN. THE REVERT:
// have `probe` bring a mutation's cell current as it does any other; the `busy` after the `refresh`
// reruns the handler and reads true, 2 writes where 1 is due.
test('a probe over a mutation a sweep invalidated runs nothing — 3.14', async () => {
    let writes = 0
    const save = POST(async () => {
        writes += 1
        return writes
    })
    await inScope(new Request('http://app/a'), async () => {
        await save()
        refresh()
        const busy = save.busy()
        await tick()
        expect(`busy: ${busy}, writes: ${writes}`).toBe(
            'busy: false, writes: 1',
        )
    })
})

// 16.1 THROUGH 16.6 — A HANDLER THAT IS A VALUE IS FILED AS A BODY IS: one value per request, and one
// for every request where it declares `global`. THE REVERT: have `handlerValue` hand a value to
// `reactive` unfiled — request b reads request a's write, 5 where 0 is due.
test('a value handler is one value per request, and one value under global — 16.1, 16.6', async () => {
    const count = GET(0)
    const shared = GET(0, { global: true })
    await inScope(new Request('http://app/a'), async () => {
        count().set(5)
        shared().set(5)
    })
    await inScope(new Request('http://app/b'), async () => {
        expect(await count()).toBe(0)
        expect(await shared()).toBe(5)
    })
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

// 11.63, 11.32 — AN EFFECT A LOAD ABORTED RERUNS UNDER ITS OWN REQUEST, whichever request's landing
// drained it. Each request's `watch` reads the module-level `tenant` and then `profile`, a load still
// in flight, so its first run aborts. B lands first and schedules the one drain that reruns both, and
// A's effect run under B's scope reads B's `tenant` and B's `profile` — and SUBSCRIBES to them, so
// B's next write wakes A's watch too. Both forms are gated: the tracked one and the narrowed one,
// whose effect reads untracked but reads through the scope all the same. THE REVERT: call `effect()`
// directly in `watchTracked` rather than through `runInScope`; A's rerun reads `a:b:b` where `a:a:a`
// is due, and B's later write wakes A's watch — 2 runs where 1 is due. The same in `watchOver`: its
// rerun reads `a:b:b`.
test('an effect a load aborted reruns under its own request, whichever request drained it — 11.63', async () => {
    const tenant = reactive('none')
    const opens: Record<string, (answer: string) => void> = {}
    const profile = reactive(
        () =>
            new Promise<string>((open) => {
                opens[new URL(request().url).pathname.slice(1)] = open
            }),
    )
    const seen: string[] = []
    const narrowed: string[] = []
    let finish = (): void => {}
    const finished = new Promise<void>((release) => {
        finish = release
    })
    const serve = (name: string): Promise<void> =>
        inScope(new Request(`http://app/${name}`), async () => {
            tenant.set(name)
            watch(() => {
                const who = tenant()
                seen.push(`${name}:${who}:${profile()}`)
            })
            watch([profile], () => {
                narrowed.push(`${name}:${tenant()}:${profile()}`)
            })
            flushSync()
            await finished
            // B's next write reaches B's watches alone.
            if (name === 'b') {
                tenant.set('b2')
                flushSync()
            }
        })
    const a = serve('a')
    const b = serve('b')
    expect(seen).toEqual([])
    expect(narrowed).toEqual([])

    ;(opens.b as (answer: string) => void)('b')
    ;(opens.a as (answer: string) => void)('a')
    await tick()
    const landed = { seen: [...seen].sort(), narrowed: [...narrowed].sort() }
    const later = { seen: [] as string[], narrowed: [] as string[] }
    seen.length = 0
    narrowed.length = 0
    finish()
    await Promise.all([a, b])
    later.seen = seen
    later.narrowed = narrowed
    expect({ landed, later }).toEqual({
        landed: { seen: ['a:a:a', 'b:b:b'], narrowed: ['a:a:a', 'b:b:b'] },
        later: { seen: ['b:b2:b'], narrowed: [] },
    })
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

// 13.8 — THE BARE SELECTION IS SCOPE-BOUNDED, as a tag is: a bare refresh inside one request reloads
// that request's values and never another's. THE REVERT: drop the `cell.scope === scope` test from
// `inReach`'s bare branch; B's body runs again for A's refresh — 2 loads where 1 is due.
test('a bare refresh reaches the request it was made in and no other — 13.8', async () => {
    let loads = 0
    const stock = reactive(async () => {
        loads += 1
        return 3
    })
    // SUBSCRIBED ONCE LANDED: a watch that reads a load still out aborts and is rerun by the drain,
    // under whichever request's continuation ran it rather than its own.
    const reach = (): void => {
        stock.peek()
    }
    const subscribe = (): void => {
        watch(() => {
            stock()
        })
    }
    const a = held('a', reach, () => {
        subscribe()
        loads = 0
        refresh()
        flushSync()
    })
    const b = held('b', reach, subscribe)
    expect(loads).toBe(3)
    await tick()
    b.open()
    await b.done
    a.open()
    await a.done
    expect(loads).toBe(1)
})

// 13.10 — ON A SERVER A BARE `invalidate()` AND A BARE `refresh()` EACH REACH EVERY `global` VALUE IN
// THE PROCESS: the one built at import and the entry of a `global` keyed value another request made,
// from inside a request and from outside every one. Nothing subscribes, so the refresh marks (13.7)
// and each read after it is the load — a `peek`, which pulls as a read does and throws nothing while
// the load is out. THE REVERT: drop `|| cell.global` from `inReach`'s bare branch;
// inside request B neither is reached — 0 loads where 2 are due.
test('a bare invalidate and a bare refresh reach every global load in the process — 13.10', () => {
    let loads = 0
    const rates = reactive(
        async () => {
            loads += 1
            return 3
        },
        { global: true },
    )
    const rate = reactive(
        async (args: { id: number }) => {
            loads += 1
            return args.id
        },
        { global: true },
    )
    rates.peek()
    inScope(new Request('http://app/a'), () => rate({ id: 1 }).peek())
    loads = 0
    inScope(new Request('http://app/b'), () => invalidate())
    expect(`loads before a read: ${loads}`).toBe('loads before a read: 0')
    rates.peek()
    rate({ id: 1 }).peek()
    expect(`loads after an invalidate inside a request: ${loads}`).toBe(
        'loads after an invalidate inside a request: 2',
    )
    loads = 0
    refresh()
    rates.peek()
    rate({ id: 1 }).peek()
    expect(`loads after a refresh outside every request: ${loads}`).toBe(
        'loads after a refresh outside every request: 2',
    )
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

// 11.26, 11.68 — A HANDLER WITH RUNGS KEYS ITS VALUE BY THE ARGS AS SENT, and its body gets what the
// gate made of them, as one with no rungs does. THE REVERT: reach the value with `ctx.args()` at
// the onion's center; the two spellings land on 1 entry rather than 2.
test('a handler with rungs keys its value by the args as sent — 11.26, 11.68', async () => {
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

// 16.18, 16.19 — `ctx.args()` ASKED AGAIN AFTER A REFUSAL IS REFUSED AGAIN, not handed nothing. A rung
// may catch the refusal and ask a second time, and the answer kept for later asks is only one the
// gate accepted. THE REVERT: mark the ask asked before validating, in `argsOnce`; the second ask
// hands back `undefined` rather than throwing — 1 refusal where 2 are due. And the value is built
// outside every request, so it is `scoped`'s keyed face that carries the gate: dropped there, 0.
test('a rung that caught the args refusal and asks again is refused again — 16.18, 16.19', async () => {
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
