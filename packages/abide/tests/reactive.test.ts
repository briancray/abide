// THE REACTIVE CORE'S GATES. Correctness tests cannot guard any of this: every claim
// here is about WORK — a reader that woke when nothing it reads changed still reads
// the right value, and a body that ran twice still produces the right answer. So the
// assertions count wake-ups and body runs, and the two that have an installable broken
// arm carry it, per CLAUDE.md's revert discipline.

import { expect, setSystemTime, test } from 'bun:test'
import { gate } from 'harness/gate'
import { handOnError, onError } from '#server/hooks.ts'
import {
    busy,
    flushSync,
    invalidate,
    isReactive,
    NotLanded,
    type Reactive,
    reactive,
    ready,
    refresh,
    refuse,
    structural,
    watch,
    writePath,
} from '#shared'
import { CELL } from '#shared/reactive/CELL.ts'
import { canonicalKey } from '#shared/reactive/canonicalKey.ts'
import { isKeyed } from '#shared/reactive/index.ts'
import { SCOPING } from '#shared/reactive/scoping.ts'
import { CLEAN } from '#shared/reactive/tracking.ts'
import { collectWatches } from '#shared/reactive/watch.ts'
import { UNEXPECTED } from '#shared/UNEXPECTED.ts'
import { WORK } from '#shared/WORK.ts'

// 12.6 — the `onError` hooks these tests file are handed what the core reports once a server wires
// them in (`installServer`), and this file is no server.
UNEXPECTED.report = handOnError

// THE RECORD A VALUE'S STATE LIVES ON. Every test that asserts a field rather than an
// answer reaches it through here — read off the callable itself, a field is `undefined`,
// and an invariant written as an equality between two of them passes on nothing.
function cellOf<Fields>(value: unknown): Fields {
    return (value as { [CELL]: Fields })[CELL]
}

// A wake counter that is not itself a reactive read — `watch` would re-enter the graph
// and the count would include its own subscription.
function wakes<Value>(value: {
    watch(effect: (value: Value) => void): () => void
}): {
    count(): number
    stop(): void
} {
    let woken = 0
    const stop = value.watch(() => {
        woken += 1
    })
    // The immediate run (12.2) is not a wake — it is the subscription.
    woken = 0
    // A WAKE IS BATCHED TO THE END OF THE TURN, so the count is taken after the turn is
    // ended rather than after the write. `flushSync` is the only way to observe an effect
    // in the same turn as the write that caused it.
    return {
        count: (): number => {
            flushSync()
            return woken
        },
        stop,
    }
}

test('a value form lands at construction and reads as ready', () => {
    const total = reactive(41)
    expect(total.ready()).toBe(true)
    expect(total.busy()).toBe(false)
    expect(total()).toBe(41)
    expect(total.peek()).toBe(41)
})

// RULEBOOK 2.7, move 6. The throw is what lets move 7 type the read as `Stored`.
test('a read throws NotLanded where nothing has landed, and peek does not', () => {
    const pending = reactive(new Promise<number>(() => {}))
    expect(pending.ready()).toBe(false)
    expect(pending.busy()).toBe(true)
    expect(() => pending()).toThrow(NotLanded)
    expect(pending.peek()).toBeUndefined()
})

// The trigger named by the state it produces: busy AND ready.
test('refresh keeps serving while it reloads', async () => {
    let answer = 1
    const held = reactive(() => Promise.resolve(answer))
    await held
    expect(held()).toBe(1)
    answer = 2
    held.refresh()
    expect(held.ready()).toBe(true)
    expect(held.busy()).toBe(true)
    expect(held()).toBe(1)
    await held
    expect(held()).toBe(2)
})

// SERVED UNTIL A READ OR A PROBE RUNS THE PRODUCER (7.16, 7.17). A probe answers about the value a
// read would serve (3.2), so asking runs the producer the mark owes — the held value stops being
// served (7.8) and, over an async body, the first load starts again — and the read agrees with it.
test('invalidate keeps serving until a probe or a read runs the producer', async () => {
    const answer = 1
    const held = reactive(() => Promise.resolve(answer))
    await held
    held.invalidate()
    expect(`busy: ${held.busy()}`).toBe('busy: true')
    expect(`ready: ${held.ready()}`).toBe('ready: false')
    expect(() => held()).toThrow(NotLanded)
    expect(`busy after the read: ${held.busy()}`).toBe(
        'busy after the read: true',
    )
    expect(`ready after the read: ${held.ready()}`).toBe(
        'ready after the read: false',
    )
})

// 2.14 THROUGH A RELOAD THAT LANDED WHAT IT ALREADY HELD. The invalidate's read unserves
// the source and aborts every body that reached it — those bodies are CLEAN, hold nothing,
// and nothing downstream will ever pull them, which is what makes the source's return to
// servable a move on the VALUE edge and not only the probe one. The identity gate's
// collapse arm restored `servable` and cascaded nothing, so a reload landing the figure
// already held stranded everything built from it at `ready()` false for the life of the
// page — the same split `refused` makes and for the same reason (5.1 over a value still
// being served, 2.3 over one holding nothing).
//
// THE REVERT is the collapse arm skipping the cascade: `read: NotLanded` on the first
// case and `ready: false` on the second, both of them permanent. A reload landing a
// DIFFERENT value passes either way, which is exactly why nothing caught this.
test('a reload that lands the value already held frees the bodies that aborted', async () => {
    const answer = 1
    const held = reactive(() => Promise.resolve(answer))
    const doubled = reactive(() => held() * 2)
    await held
    expect(doubled()).toBe(2)

    held.invalidate()
    // The read is what settles the debt: it unserves `held`, starts the reload, and
    // `doubled` aborts on the unlanded read.
    expect(() => doubled()).toThrow(NotLanded)
    await held
    flushSync()
    // The cascade is what left `doubled` marked. Without it the aborted body is CLEAN and
    // holding nothing, so the read resolves to no run and throws again.
    expect(`read: ${doubled()}`).toBe('read: 2')
})

// 2.14's own half of the same thing: a value nothing READS and only a guard asks about is
// the case push-pull cannot answer by waiting for a read, so `markReaders` queues an
// aborted body that something probes. That queueing hangs off the cascade the collapse arm
// was skipping, so the guard never came back either.
test('a guard over an aborted body comes back when the reload lands what was held', async () => {
    const answer = 1
    const held = reactive(() => Promise.resolve(answer))
    const doubled = reactive(() => held() * 2)
    const seen: boolean[] = []
    const stop = watch(() => {
        seen.push(doubled.ready())
    })
    await held
    flushSync()

    held.invalidate()
    expect(() => doubled()).toThrow(NotLanded)
    await held
    flushSync()
    expect(`ready: ${seen[seen.length - 1]}`).toBe('ready: true')
    stop()
})

// 11.20 on the truth-conditional premise: the derived value's data IS being refreshed
// when its source's is, so `busy` is true whether or not anything asks. Note the body
// never re-runs here — 7.4 keeps serving, the value does not change, 11.5 gives no
// recompute — so nothing but a walk of the source list can report it.
test('busy propagates through a derived value while its source refreshes', async () => {
    const answer = 1
    const invoice = reactive(() => Promise.resolve(answer))
    await invoice
    const doubled = reactive(() => invoice() * 2)
    expect(doubled()).toBe(2)
    expect(doubled.busy()).toBe(false)

    invoice.refresh()
    expect(invoice.busy()).toBe(true)
    expect(doubled.ready()).toBe(true)
    expect(doubled.busy()).toBe(true)
})

// THE ABORT. A body that reads an unlanded value is abandoned, mints nothing (11.53),
// and re-runs when the source lands. The count is what matters: a body run to
// completion against an unlanded read would have produced once with the wrong input.
test('a body reading an unlanded value mints nothing and re-runs on landing', async () => {
    let resolveSource: (value: number) => void = (): void => {}
    const source = reactive(
        new Promise<number>((resolve) => {
            resolveSource = resolve
        }),
    )
    let runs = 0
    const derived = reactive(() => {
        runs += 1
        return source() + 1
    })
    expect(runs).toBe(1)
    expect(derived.ready()).toBe(false)
    expect(derived.busy()).toBe(true)

    resolveSource(41)
    await source
    // THE READ IS WHAT RE-RUNS IT (11.5). Nothing watches this value, so the source
    // landing marks it and stops; under eager the body had already run again by the time
    // the `await` returned. The contract 2.13 and 11.53 state is unchanged either way — the
    // body is abandoned rather than completed against an absent value, and it mints
    // nothing on the run that aborted.
    expect(runs).toBe(1)
    expect(derived()).toBe(42)
    expect(runs).toBe(2)
})

// 2.14 FOR A READER THAT ONLY GUARDS, which is the case the two around this one cannot reach. A
// binding spelled `{#if unpaid.ready()}` subscribes to the PROBE and never to the value, so no
// read of its will ever pull an aborted body forward — and the body cannot answer `ready` until it
// has run for the value being probed (11.55). Left to push-pull the guard says "counting…" for as
// long as the page is open, and every number on it is right.
//
// THE REVERT is dropping the `aborted` queue from `markReaders`: `after: counting… | counting…`.
test('a body something only guards re-runs when the value it aborted on lands', async () => {
    let landRows: (rows: { paid: boolean }[]) => void = (): void => {}
    const pending = new Promise<{ paid: boolean }[]>((resolve) => {
        landRows = resolve
    })
    const rows = reactive(() => pending)
    let bodyRuns = 0
    const unpaid = reactive(() => {
        bodyRuns += 1
        return rows().filter((row) => !row.paid)
    })
    const painted: string[] = []
    const stop = watch(() => {
        painted.push(unpaid.ready() ? `ready:${unpaid().length}` : 'counting…')
    })
    flushSync()
    expect(`before: ${painted.join(' | ')}`).toBe('before: counting…')

    landRows([{ paid: false }, { paid: true }])
    await pending
    flushSync()
    expect(`after: ${painted.join(' | ')}`).toBe('after: counting… | ready:1')
    // The aborted run and the one that finished it, and no third: the guard's own read of the
    // value finds a body that has already run rather than pulling it a second time.
    expect(`body runs: ${bodyRuns}`).toBe('body runs: 2')
    stop()
})

// 11.5 THROUGH AN EFFECT, which is the case the one above cannot answer. A value
// something WATCHES is not lazy: the mark reaches the effect, the effect's read pulls the
// body forward, and it re-runs inside the write. This is the shape a template makes, so
// it is the one that decides whether push-pull is visible to an app at all.
test('a watched derived value re-runs on the write, not on a later read', async () => {
    let resolveSource: (value: number) => void = (): void => {}
    const source = reactive(
        new Promise<number>((resolve) => {
            resolveSource = resolve
        }),
    )
    let runs = 0
    const derived = reactive(() => {
        runs += 1
        return source() + 1
    })
    const seen: number[] = []
    const stop = derived.watch((value) => {
        seen.push(value as number)
    })
    runs = 0

    resolveSource(41)
    await source
    expect(runs).toBe(1)
    expect(seen).toEqual([42])
    stop()
})

// A READ IS UNAFFECTED BY RETENTION. `tail` says how many past productions are kept and
// nothing about what `s()` answers — 9.1 makes a room's production one complete `Message`
// and the REGISTRY's `Room` row makes its value the latest one. History is `s.history` (2.5)
// and is reached no other way.
test('a value declaring tail still reads as the latest production', () => {
    const room = reactive<string>(undefined, { history: 2 })
    room.publish('a')
    room.publish('b')
    room.publish('c')
    room.publish('d')
    expect(room()).toBe('d')
    // And the retention is the depth, trimmed from the front.
    expect([...room.history()]).toEqual(['b', 'c', 'd'])
})

// 9.6 generalised: the ordinal counts productions on every producer, not just a room.
test('publish returns the ordinal and mints on every call', () => {
    const room = reactive<string>(undefined, { history: 9 })
    expect(room.publish('ok')).toBe(1)
    expect(room.publish('ok')).toBe(2)
    expect(room()).toBe('ok')
    // Two productions, not one collapsed into one — which the read cannot show and the
    // retention can.
    expect([...room.history()]).toEqual(['ok', 'ok'])
})

// Arity is the discriminator. Getting the overload ORDER wrong is
// what makes this silently one type: keyed-first swallows the unkeyed form.
test('a body declaring a parameter is keyed, and one declaring none is not', () => {
    const unkeyed = reactive(() => 7)
    expect(unkeyed()).toBe(7)

    const keyed = reactive((args: { id: number }) => args.id * 2)
    expect(keyed({ id: 4 })()).toBe(8)
    // 11.24: members sorted, so two spellings of one key are one entry.
    expect(keyed.entries.size).toBe(1)
    expect(keyed({ id: 4 })).toBe(keyed({ id: 4 }))
})

// 11.65: WHAT THE CANONICAL WIRE FORM CANNOT WRITE IS REFUSED AT THE REACH. `JSON.stringify`
// fails on none of it — a `Set`, a `Map` and a class instance each have no own enumerable keys
// and canonicalise to `{}`, and a non-finite number is written `null` — so 1.8 joined the second
// reach to the first's standing work and served it a value computed from other arguments.
//
// THE BODY RUN IS THE ASSERTION, not the message: the collision is invisible in the VALUE, which
// is right for whoever reached first.
//
// THE REVERT: drop the prototype test and the finite test from `canonical`. This reports
// `runs: 1` for two distinct `Set`s, and `served: null` for the `NaN` reach — one entry, one body
// run, and the second caller handed the first caller's answer.
// 15.19, 15.20 — A 5xx REFUSAL AND A THROW ARE RUN AGAIN BY THE NEXT REACH; ANYTHING BELOW 500 IS HELD.
// A `global` entry with an hour's `ttl` is where holding one hurts: an outage the body reported
// once would be replayed to every caller until the hour ran out. THE REVERT: drop the
// `failedTransiently` test from `Keyed`'s reach; the 503 and the throw are each served again
// without a run — 3 runs where 5 are due.
test('a reach runs a body again after a 5xx refusal or a throw, and holds a 4xx — 15.19, 15.20', async () => {
    const runs: string[] = []
    const answers: Record<string, (() => unknown)[]> = {
        down: [() => refuse(503), () => 'up'],
        broken: [
            () => {
                throw new Error('boom')
            },
            () => 'fixed',
        ],
        missing: [() => refuse(404), () => 'found'],
    }
    const record = reactive(
        async ({ path }: { path: string }) => {
            runs.push(path)
            const next = answers[path]?.shift() as () => unknown
            return next()
        },
        { global: true, ttl: 3_600_000 },
    )
    const outcome = (path: string): Promise<unknown> =>
        Promise.resolve(record({ path })).then(
            (value) => value,
            (failure: { status?: number; message?: string }) =>
                failure.status ?? failure.message,
        )
    for (const path of ['down', 'broken', 'missing']) await outcome(path)
    expect(await outcome('down')).toBe('up')
    expect(await outcome('broken')).toBe('fixed')
    expect(await outcome('missing')).toBe(404)
    expect(runs).toEqual(['down', 'broken', 'missing', 'down', 'broken'])
})

test('an Args member the canonical key cannot carry is refused at the reach', () => {
    let runs = 0
    const bySet = reactive((args: { f: Set<string> }) => {
        runs += 1
        return [...args.f].join()
    })
    const refused: string[] = []
    for (const f of [new Set(['a']), new Set(['b'])]) {
        try {
            bySet({ f })
        } catch (thrown) {
            refused.push((thrown as Error).message.split(':')[0] ?? '')
        }
    }
    expect(`runs: ${runs}`).toBe('runs: 0')
    expect(refused).toEqual([
        'An Args key cannot carry a Set at "f"',
        'An Args key cannot carry a Set at "f"',
    ])

    // `Number(input)` that failed, against a member the app left null — `JSON.stringify` writes
    // both `null`, so the failed coercion reaches the entry the app asked for deliberately.
    const byPage = reactive((args: { page: number | null }) => args.page)
    byPage({ page: null })
    let nonFinite = 'accepted'
    let served = 'nothing'
    try {
        served = `${byPage({ page: Number.NaN })()}`
    } catch (thrown) {
        nonFinite = (thrown as Error).message.split(':')[0] ?? ''
    }
    expect(`served: ${served}`).toBe('served: nothing')
    expect(nonFinite).toBe('An Args key cannot carry NaN at "page"')
})

// 3.19: reaching an instance that exists joins the standing work rather than starting
// a second. Without it, `{#if user.busy()}` re-evaluating on every wake is a request
// per re-render.
test('reaching a key twice runs the body once', () => {
    let runs = 0
    const keyed = reactive((args: { id: number }) => {
        runs += 1
        return args.id
    })
    keyed({ id: 1 })
    keyed({ id: 1 })
    keyed({ id: 1 })
    expect(runs).toBe(1)
})

// 3.8 against 3.7: the static probe reads the map and allocates nothing, where
// reaching an entry creates and starts it. This is bought out of a
// shared get-or-create; here it is visible in the spelling.
test('a static probe over a keyed value allocates no entry', () => {
    const keyed = reactive((args: { id: number }) => args.id)
    expect(busy(keyed)).toBe(false)
    expect(keyed.entries.size).toBe(0)
    keyed({ id: 1 })
    expect(keyed.entries.size).toBe(1)
})

// A function in the value position is a body, so one the app wants to hold is wrapped.
test('a function held as data goes inside a record', () => {
    const handler = (): string => 'called'
    const held = reactive({ handler })
    expect(held().handler).toBe(handler)
})

test('an effect runs immediately and again on change, and its disposer runs first', () => {
    const count = reactive(1)
    const order: string[] = []
    const stop = watch(() => {
        order.push(`run:${count()}`)
        return () => order.push('dispose')
    })
    count.set(2)
    flushSync()
    stop()
    expect(order).toEqual(['run:1', 'dispose', 'run:2', 'dispose'])
})

// ── The two claims with an installable broken arm ────────────────────────────────

// THE DEFAULT IS THE REFERENCE. A fresh object with the same contents is a different
// value to `Object.is`, so it produces and wakes — which is what `===` means and what
// an author who has not read the rulebook will predict. The re-materialisation
// hazard is real and is now the APP's to declare against, not the framework's to
// charge every value for.
test('the default identity is the reference, so a re-materialised value wakes', () => {
    const invoice = reactive({ id: 1, total: 100 })
    const counter = wakes(invoice)
    invoice.set({ id: 1, total: 100 })
    const woken = counter.count()
    counter.stop()
    expect(woken).toBe(1)
})

// `Object.is` RATHER THAN `===`, AND THE TWO CASES THAT DIFFER. This is the whole of
// the difference: `NaN === NaN` is false and `+0 === -0` is true, and `Object.is`
// inverts both. The NaN half is why the default is `Object.is` — a value that lands on
// NaN (a failed parse, a division, an aggregate over nothing) would otherwise never
// compare equal to itself, so every write of it wakes every reader forever.
gate(
    'a repeated NaN wakes no reader',
    {
        revert: () => {
            ;(globalThis as { REVERT_NAN?: boolean | undefined }).REVERT_NAN =
                true
            return () => {
                ;(
                    globalThis as { REVERT_NAN?: boolean | undefined }
                ).REVERT_NAN = undefined
            }
        },
        worth: { wakes: 1 },
    },
    () => {
        const reverted = (globalThis as { REVERT_NAN?: boolean | undefined })
            .REVERT_NAN
        // The broken arm is the obvious spelling of "the reference": `===`.
        const measure = reactive(
            Number.NaN,
            reverted
                ? {
                      identity: (next: number, previous: number) =>
                          next === previous,
                  }
                : undefined,
        )
        const counter = wakes(measure)
        measure.set(Number.NaN)
        const woken = counter.count()
        counter.stop()
        expect(`wakes: ${woken}`).toBe('wakes: 0')
    },
)

// THE COST OF THE CHOICE, stated rather than hidden. `Object.is` separates the zeroes,
// so a value moving from +0 to -0 produces and wakes where `===` would have collapsed
// it. That is a spurious wake in the one case where the two numbers are almost always
// interchangeable — and it is the price of the NaN case above.
test('the signed zeroes are two values, which is what Object.is costs', () => {
    const measure = reactive(0)
    const counter = wakes(measure)
    measure.set(-0)
    const woken = counter.count()
    counter.stop()
    expect(woken).toBe(1)
})

// 5.2 through the OVERRIDE. A value whose producer re-materialises — a reload that
// fetched an equal payload and built a fresh object for it — declares `structural` and
// stops waking every reader on every reload. The output stays right either way and
// only the work moves, which is why this is a wake count and not a value assertion.
gate(
    'a set of a structurally equal value wakes no reader where the app declared structural',
    {
        revert: () => {
            // The broken arm is the app forgetting the option, which is the default.
            ;(
                globalThis as { REVERT_IDENTITY?: boolean | undefined }
            ).REVERT_IDENTITY = true
            return () => {
                ;(
                    globalThis as { REVERT_IDENTITY?: boolean | undefined }
                ).REVERT_IDENTITY = undefined
            }
        },
        worth: { wakes: 1 },
    },
    () => {
        const reverted = (
            globalThis as { REVERT_IDENTITY?: boolean | undefined }
        ).REVERT_IDENTITY
        const invoice = reactive(
            { id: 1, total: 100 },
            reverted ? undefined : { identity: structural },
        )
        const counter = wakes(invoice)
        // A FRESH OBJECT with the same contents — the re-materialisation every reload
        // produces, and the case the default cannot see.
        invoice.set({ id: 1, total: 100 })
        const woken = counter.count()
        counter.stop()
        expect(`wakes: ${woken}`).toBe('wakes: 0')
    },
)

// The other half of the same split: `publish` is UNGATED, so two identical messages
// are two events somebody sent on purpose. Gating it would hand the publisher back a
// delivery that did not happen.
gate(
    'a publish of an equal value mints every time',
    {
        revert: () => {
            ;(
                globalThis as { REVERT_PUBLISH_GATE?: boolean | undefined }
            ).REVERT_PUBLISH_GATE = true
            return () => {
                ;(
                    globalThis as { REVERT_PUBLISH_GATE?: boolean | undefined }
                ).REVERT_PUBLISH_GATE = undefined
            }
        },
        // MEASURED, not guessed: the gated arm still mints ONCE, because the first write
        // to a not-landed value has nothing to compare against. The claim this gate
        // protects is the SECOND message, which is the one a chat drops.
        worth: { retained: 1 },
    },
    () => {
        const reverted = (
            globalThis as { REVERT_PUBLISH_GATE?: boolean | undefined }
        ).REVERT_PUBLISH_GATE
        const room = reactive<string>(undefined, { history: 4 })
        // THE PRODUCTION IS THE CLAIM, NOT THE WAKE, and batching is what made the
        // difference visible. Two publishes in one turn reach a `watch` ONCE — 5.9 has a
        // window cap the wake and not the production, and 5.10 has the cursor deliver what
        // the window collapsed. So counting wakes here measured the batch; counting what
        // retention holds measures whether the second message existed at all.
        //
        // The broken arm routes the publish through the gated write, which is what "one
        // member, two spellings" would collapse to if `publish` were `set`.
        if (reverted) room.set('ok')
        else room.publish('ok')
        if (reverted) room.set('ok')
        else room.publish('ok')
        expect(`retained: ${[...room.history()].length}`).toBe('retained: 2')
    },
)

// ── Push-pull: the cases eager recompute got wrong, and the ones nothing covered ──

// THE DIAMOND. A -> B, A -> C, B + C -> D. Under eager synchronous recompute this
// produced TWICE on one write, and the first production carried `b_new + c_old` — a
// value the system was never logically in. That production was not internal: it set
// `value`, bumped `ordinal`, appended to the ring where `tail` was declared, and fired
// `watch`. Measured with eager in place: dRuns 2, seen [120, 220], wakes 2.
//
// Resolving DEPTH-FIRST from the read is what orders D after both B and C, so the
// intermediate cannot be observed and cannot be retained.
test('a diamond produces once, and never a value the system was not in', () => {
    const a = reactive(10)
    const b = reactive(() => a() * 10)
    const c = reactive(() => a() * 10 + 100)
    let runs = 0
    const d = reactive(() => {
        runs += 1
        return b() + c()
    })
    const seen: number[] = []
    const stop = d.watch((value) => {
        seen.push(value as number)
    })
    runs = 0
    seen.length = 0

    a.set(11)
    flushSync()
    expect(d()).toBe(11 * 10 + (11 * 10 + 100))
    expect(runs).toBe(1)
    expect(seen).toEqual([320])
    stop()
})

// 5.2 ON A DIAMOND, which is the contract eager claimed and broke. The source moves,
// the derived value does not, and nothing downstream may wake. The revert is `false` for the
// `Object.is(produced, previous)` in `produce`: `woken` is 1 against 0.
test('a diamond whose value does not change wakes nobody', () => {
    const a = reactive(1)
    const b = reactive(() => a() > 0)
    const c = reactive(() => a() < 100)
    const both = reactive(() => b() && c())
    const woken = wakes(both)

    a.set(2)
    expect(both()).toBe(true)
    a.set(3)
    expect(both()).toBe(true)
    expect(woken.count()).toBe(0)
    woken.stop()
})

// 11.58, AND THE WHOLE OF WHAT PUSH-PULL BUYS. A write MARKS every derived value that
// read the source and runs none of them; the one that is read runs, and the other
// forty-nine do not. A correctness test cannot see this — every one of the fifty serves
// the right value on the read that asks — so the assertion is the body-run count.
//
// THE REVERT IS STRUCTURAL and named here rather than installed: running the marked
// readers in the mark walk, which is what eager did, takes `runs` from 1 to 50 and takes
// the op from 202 ns to 2,385 ns at a fan of a hundred under bun's JSC. Measured the same
// way in the browsers a reader brings: 285 -> 2,185 ns under V8 and 250 -> 2,300 under
// WebKit. No engine inverts it.
//
// An earlier attempt at push-pull was reverted on a note saying it measured slower on the
// write path. The mechanism that note did not record: the effect queue was truncated with
// `PENDING.length = 0` after every drain, which hands the backing store back, so each
// write that reached an effect allocated one again. Holding the capacity and moving a
// cursor over it is worth 2.6 ns of the 3.5 ns that regression was.
test('a write runs no derived body, and the read runs one', () => {
    const source = reactive(0)
    let runs = 0
    const fan: (() => number)[] = []
    for (let index = 0; index < 50; index += 1)
        fan.push(
            reactive(() => {
                runs += 1
                return source() + index
            }) as unknown as () => number,
        )
    // 3.16: reaching an instance starts the work it is for, so construction runs each
    // body once. What a WRITE does is the claim.
    expect(runs).toBe(50)
    runs = 0

    source.set(1)
    expect(runs).toBe(0)
    expect((fan[0] as () => number)()).toBe(1)
    expect(runs).toBe(1)
    // And the other forty-nine still serve the right value, each running once, on the
    // read that asks for it.
    expect((fan[7] as () => number)()).toBe(8)
    expect(runs).toBe(2)
})

// A BODY THAT REORDERS ITS SOURCES, which is the one shape the cursor protocol cannot
// answer from the cursor alone — and nothing covered it. Every other test here either
// reads the same list in the same order or reads a strictly shorter one, and both of
// those agree with a `track` that never truncates. This one does not: the run matches
// two, diverges on the third, and then reads a value that is still sitting further down
// the list it is replacing.
//
// THE REVERT IS STRUCTURAL — it is the `at < sources.length` test in `track` — and this
// is what it is worth. Dropping the truncation leaves the run appending past a tail it
// has not dropped, `endRun` then trims a tail that now holds LIVE sources, and both
// reordered values come out unsubscribed: `runs` 3 -> 1 and the value 'ACB' -> 'Acb'.
// A SLOT IS NOT A SUBSCRIPTION, and the shorter run is what proved it. `sources` is
// POSITIONAL — one slot per read — where `source.readers` is a SET, so a body that reads
// one value twice holds two slots against one subscription. `truncate` dropped per slot,
// and the run that read it ONCE therefore unsubscribed a value its own surviving slot
// still listed: the value stopped recomputing, permanently, at the moment it looked
// right. The shape is the most ordinary one there is — a guard over the same value it
// then reads.
//
// THE REVERT is `truncate` dropping every slot past the cursor: `shown: anon` where the
// name is `bob`, and no wake behind it. Nothing about the first two reads moves, which is
// why the existing reorder case beside this one passes either way.
test('a body that reads one value twice keeps it when a later run reads it once', () => {
    const name = reactive<string>('ada')
    const shown = reactive(() => (name() ? name().toUpperCase() : 'anon'))
    expect(shown()).toBe('ADA')
    // The falsy run reads `name` ONCE, so it truncates the second slot.
    name.set('')
    expect(shown()).toBe('anon')
    name.set('bob')
    expect(`shown: ${shown()}`).toBe('shown: BOB')
})

// A SLOT IS NOT A SUBSCRIPTION, from the append side. `sources` is POSITIONAL — one slot
// per read — and `source.readers` is a SET, so the dedup on append is the only thing
// keeping a body that reads one value three times from holding three subscriptions of it.
//
// IT WAS UNGATED, and that is why this is here: with the dedup deleted outright, all 208
// tests in this file passed. Nothing about the OUTPUT moves — the propagation walk marks a
// reader already marked and skips it, so the wake count is 1 either way and the value is
// right either way. What moves is the work: every duplicate is an entry the mark walk loads
// and tests on every write, and one `dropReader` per duplicate at teardown.
//
// THE REVERT IS STRUCTURAL — it is the reader-side scan at the foot of `track`, and the
// broken arm is dropping it so the append is unconditional. Run: this reports `held: 3`
// against the `held: 1` below. Dropping only the LOOP and keeping the push reports the same
// 3, because the push is what the loop is guarding.
test('a body that reads one value three times holds one subscription of it', () => {
    const value = reactive(1)
    // A guard over the same value it then reads, twice over — the most ordinary shape there
    // is, and the one a row body written against a shared value has.
    const stop = watch(() => {
        value()
        value()
        value()
    })
    flushSync()
    const held = cellOf<{ readers: unknown[] }>(value).readers.length
    stop()
    expect(`held: ${held}`).toBe('held: 1')
})

test('a body that reorders its sources keeps every one of them subscribed', () => {
    const first = reactive('a')
    const second = reactive('b')
    const third = reactive('c')
    const swapped = reactive(false)
    let runs = 0
    const joined = reactive(() => {
        runs += 1
        return swapped()
            ? `${first()}${third()}${second()}`
            : `${first()}${second()}${third()}`
    }) as unknown as () => string
    expect(joined()).toBe('abc')

    // The reorder itself: matches `swapped` and `first`, diverges where `second` was,
    // and reads `second` again one slot later.
    swapped.set(true)
    expect(joined()).toBe('acb')
    runs = 0

    // Each of the three still wakes it exactly once, and the one that moved PAST the
    // divergence is the one a missing truncation loses.
    first.set('A')
    expect(joined()).toBe('Acb')
    second.set('B')
    expect(joined()).toBe('AcB')
    third.set('C')
    expect(joined()).toBe('ACB')
    expect(`runs: ${runs}`).toBe('runs: 3')
})

// PROPAGATION PAST DEPTH 1. The only probe test in the repo was depth 1, so a
// mis-memoising walk would have passed it.
test('busy propagates through three levels of derivation', async () => {
    const answer = 1
    const source = reactive(() => Promise.resolve(answer))
    await source
    const one = reactive(() => source() * 2)
    const two = reactive(() => one() * 2)
    const three = reactive(() => two() * 2)
    expect(three()).toBe(8)
    expect(three.busy()).toBe(false)

    source.refresh()
    expect(three.busy()).toBe(true)
    expect(three.ready()).toBe(true)
})

// THE CYCLE GUARD, which nothing anywhere exercised. `a` reads `b` and `b` reads `a`;
// a probe must terminate rather than recurse forever.
test('a probe over a cycle terminates', () => {
    let other: (() => number) | null = null
    const first = reactive(() => (other === null ? 1 : other()))
    const second = reactive(() => first() + 1)
    other = second as unknown as () => number
    first.refresh()
    expect(first.busy()).toBe(false)
    expect(second.busy()).toBe(false)
})

// ── What a value COSTS TO MAKE, asserted as a count ──────────────────────────────

// THE CONTRACT IS "CARRIES NEITHER ITS MEMBERS NOR ITS FIELDS", and a correctness test
// cannot see either half: the members answer identically whether they are own properties
// or inherited ones, and the fields do whether they sit on the function or on a record it
// captures — so only the count moves. `Object.assign(self, MEMBERS)` was 437 of the 501 ns
// a value cost to construct under bun's JSC and 855 of 985 under V8 — 87% of it — and a
// table builds one of these per cell per row.
//
// THE REVERTS ARE STRUCTURAL, so they are named here rather than installed. Putting
// `Object.assign(self, MEMBERS)` and the `defineProperty` brand back in `createReactive`
// takes this to 47 own names, and takes construction to 547 ns here, 1090 ns under V8 and
// 600 ns under WebKit — and a V8 write with one watcher from 12.1 ns back to 44.3, because
// 43 own properties on a function is past what V8 tracks with a map. Putting the 33 fields
// back on the function instead of on `Cell` takes this to 36 own names and 0 own symbols,
// and construction from 87 ns to 123 here and from 83 ns to 101 under V8.
//
// BUILT AS A BROWSER BUILDS IT. Where an earlier file in the same process installed a server's
// provider, a value built outside a request is the forwarder `scoped.ts` hands back, whose one own
// symbol is its filing — a different object, and not the one this prices.
test('a value carries its fields and not its members', () => {
    const provider = SCOPING.provider
    SCOPING.provider = null
    let value: ReturnType<typeof reactive<number>>
    try {
        value = reactive(1)
    } finally {
        SCOPING.provider = provider
    }
    // The three a function always has, and nothing of the value's own.
    expect(Object.getOwnPropertyNames(value).length).toBe(3)
    // The record, and only the record: the brand is inherited, so it is not one per value.
    expect(Object.getOwnPropertySymbols(value)).toEqual([CELL])
    expect(Object.hasOwn(value, 'peek')).toBe(false)
})

// WHAT THE EFFECT QUEUE KEEPS AFTER THE TURN, which is the third thing a correctness test
// cannot see: the effect ran, the value is right, and the subscriber is still in the slot.
// `PENDING` is never truncated on purpose — `PENDING.length = 0` hands the backing store
// back and costs an allocation on every write that reaches an effect — but a slot left
// pointing at a drained subscriber holds its `notify`, the effect body, and every value
// that body closed over, until another effect happens to land on that index. A disposed
// `watch` therefore lived to the next high-water mark, and on a page that is every node
// the torn-down component built.
//
// THE REVERT is dropping the `PENDING[pendingAt] = null` store from `drainPending`: the
// payload is still reachable after the disposer and two forced collections, so this reads
// `reachable: true`. It is asserted through a WeakRef because there is no counter for it —
// the wrong implementation runs the same effects the same number of times.
test('a disposed watch is collectable once the turn that queued it drained', async () => {
    const source = reactive(0)
    const probe = ((): WeakRef<object> => {
        const captured = { held: new Uint8Array(4_000_000) }
        const stop = watch(() => {
            source()
            if (captured.held.length < 0) throw new Error('unreachable')
        })
        // Queue it and drain it, which is what puts it in a slot.
        source.set(1)
        flushSync()
        stop()
        return new WeakRef(captured)
    })()
    // A TASK BETWEEN THE ROUNDS, not a microtask: JSC scans the stack conservatively, so
    // the frame that built the payload has to be gone before a collection can see it.
    for (let round = 0; round < 8 && probe.deref() !== undefined; round += 1) {
        await Bun.sleep(0)
        Bun.gc(true)
    }
    expect(`reachable: ${probe.deref() !== undefined}`).toBe('reachable: false')
})

// The three things the prototype must not have cost, because callability and the brand
// are what every other guard in the design is written over.
test('a value stays callable, thenable and branded through its prototype', async () => {
    const value = reactive(41)
    expect(typeof value).toBe('function')
    expect(value instanceof Function).toBe(true)
    expect(isReactive(value)).toBe(true)
    expect(value()).toBe(41)
    expect(value.peek()).toBe(41)
    expect(value.ready()).toBe(true)
    // 1.4: thenable, and reached through the prototype like every other member.
    expect(await value).toBe(41)
})

// THE READ'S FAST PATH, ASSERTED AS THE FLAG IT IS. `direct` is `state === CLEAN &&
// servable && tailDepth === 0` maintained by hand, and it is what makes a read one load
// and one branch instead of three of each — 2.39 -> 1.85 ns here, 4.03 -> 3.21 over a
// thousand values, and level with the hand-written arm under WebKit.
//
// IT FAILS ONE WAY SILENTLY. Set true where it should be false, a read serves a stale
// value and every other test here catches it. Left false where it could be true, nothing
// is wrong and every read afterwards takes the slow frame forever — so the restore after
// a mark is what this asserts, and it is a work claim rather than a value one.
//
// THE REVERT IS RUNNABLE and was run: dropping the `direct = ...` line from `resolve`'s
// no-change arm fails this test, and on the shape it governs — a diamond whose sources
// move but whose own value does not, read a hundred times between writes — takes a read
// from 2.88 ns to 3.68, because every read after the mark stays on the indirect frame.
test('a value is directly servable again after a mark that changed nothing', () => {
    const inner = (value: unknown): { direct: boolean; state: number } =>
        cellOf(value)

    const settled = reactive(41)
    settled()
    expect(inner(settled).direct).toBe(true)

    // A diamond whose value does not move: `both` is marked CHECK, resolves to no
    // change, and must go back to being served from the field.
    const source = reactive(1)
    const left = reactive(() => source() > 0)
    const right = reactive(() => source() < 100)
    const both = reactive(() => left() && right())
    expect(both()).toBe(true)
    expect(inner(both).direct).toBe(true)

    source.set(2)
    expect(inner(both).direct).toBe(false)
    expect(both()).toBe(true)
    expect(inner(both).direct).toBe(true)

    // Retention does not move it: a read serves the latest production whatever is kept.
    const room = reactive<string>(undefined, { history: 2 })
    room.publish('a')
    expect(room()).toBe('a')
    expect(inner(room).direct).toBe(true)
})

// ── The cursor: RULEBOOK 2.5, 2.6, 2.7, 5.10, 9.10 ───────────────────────────────

// Takes `count` turns and stops, so a live cursor cannot hang a test. `break` is also
// what exercises the iterator's `return` — the only thing that drops its subscriber.
async function take<Value>(
    over: AsyncIterable<Value>,
    count: number,
): Promise<Value[]> {
    const seen: Value[] = []
    if (count === 0) return seen
    for await (const value of over) {
        seen.push(value)
        if (seen.length === count) break
    }
    return seen
}

// 2.5: replays the retained snapshot and then continues live from where that snapshot
// ended, WITH NO GAP AND NO REPEAT. The join is where a cursor built out of a snapshot
// plus a subscription goes wrong in both directions at once — it repeats whatever landed
// between the two, and it drops whatever landed while the snapshot was being taken.
test('a tail cursor replays what is retained and then continues live', async () => {
    const room = reactive<string>(undefined, { history: 9 })
    room.publish('a')
    room.publish('b')
    const seen = take(room.history(), 4)
    room.publish('c')
    room.publish('d')
    expect(await seen).toEqual(['a', 'b', 'c', 'd'])
})

// 2.6: the argument is replay DEPTH alone, bounded above by what is retained. It says
// where a reader starts and nothing about what it goes on to receive.
test('the tail argument is replay depth, bounded by what is retained', async () => {
    const room = reactive<string>(undefined, { history: 9 })
    for (const message of ['a', 'b', 'c', 'd']) room.publish(message)

    expect([...room.history(2)]).toEqual(['c', 'd'])
    // Asking for more than is retained is answered with what is retained.
    expect([...room.history(99)]).toEqual(['a', 'b', 'c', 'd'])
    // And depth 0 replays nothing — it is a starting point, not a window size.
    expect([...room.history(0)]).toEqual([])
    const live = take(room.history(0), 1)
    room.publish('e')
    expect(await live).toEqual(['e'])
})

// 2.7: the bare cursor is the LIVE one. It yields the production in flight from its
// start — so the standing message, not the next one — and replays no past value at all.
// This is the whole difference from `s.history(n)`, and it is one ordinal wide.
test('a bare cursor yields the production in flight and then what follows', async () => {
    const room = reactive<string>(undefined, { history: 9 })
    room.publish('a')
    room.publish('b')
    const seen = take(room, 2)
    room.publish('c')
    // 'a' is past and is not replayed; 'b' is the production standing when the cursor
    // opened, and it is.
    expect(await seen).toEqual(['b', 'c'])
})

// A cursor over a value nothing has produced into MUST WAIT rather than hand over the
// `undefined` it is holding — the clamp at ordinal zero.
test('a bare cursor over a value with nothing produced waits', async () => {
    const room = reactive<string>(undefined, { history: 9 })
    const seen = take(room, 1)
    room.publish('first')
    expect(await seen).toEqual(['first'])
})

// 9.10: a cursor older than the ring MUST be answered with the whole ring rather than
// with a gap. It has missed productions either way; what it must not do is report the
// ones it missed as delivered, or stall on an index that is no longer there.
test('a cursor older than the ring is answered with the whole ring', async () => {
    const room = reactive<number>(undefined, { history: 2 })
    const seen = take(room.history(0), 4)
    // Ten productions with the consumer never getting a turn. Its first turn comes at the
    // END of the turn now that a drain is batched, by which time its position has run off
    // the front of the ring — where before batching it was resolved by the first publish
    // and saw a 1 that the other nine then buried.
    for (let index = 1; index <= 10; index += 1) room.publish(index)
    const taken = await seen
    // 1 to 6 are gone and retention does not hold them, so they are not delivered and —
    // the half that matters — not reported as delivered either: the cursor is answered
    // from the OLDEST the ring still has, in order, rather than stalling on an index that
    // is no longer there or repeating one that is.
    expect(taken).toEqual([7, 8, 9, 10])
})

// 5.10 IS A WORK CLAIM AND CANNOT BE SEEN IN A VALUE. A cursor driven by WAKES collapses
// two productions that land between two turns into one — the reader still sees a correct
// message, just not both. So the assertion is the COUNT of turns, and the distinguishing
// case is two publishes with no `await` between them.
//
// TWO IS NOT THE DISTINGUISHING NUMBER AND THREE IS, which is the whole reason this was
// run against its own revert rather than trusted for being green. Resolving a waiting
// cursor with `source.value` instead of indexing the ring by ordinal still answers two
// correctly — the cursor is woken by the first and reads the second on the turn after —
// so the case has to leave it MORE THAN ONE BEHIND. With three it gives ['a', 'c'] and
// then hangs on a turn that will never come, where the ring gives ['a', 'b', 'c'].
test('productions between two turns are each a turn, not one', async () => {
    const room = reactive<string>(undefined, { history: 9 })
    const seen = take(room.history(0), 3)
    room.publish('a')
    // No `await` between these, so the cursor gets no turn until all three have landed.
    room.publish('b')
    room.publish('c')
    expect(await seen).toEqual(['a', 'b', 'c'])
})

// The sync face is the window, now, and it stops — it cannot wait, so it is the snapshot
// rather than the cursor. Both faces come off one `Tail`.
test('the sync face of a tail is the retained window and ends', () => {
    const room = reactive<string>(undefined, { history: 2 })
    for (const message of ['a', 'b', 'c', 'd']) room.publish(message)
    const held = room.history()
    expect([...held]).toEqual(['b', 'c', 'd'])
    // Iterating it again gives the same window rather than draining it.
    expect([...held]).toEqual(['b', 'c', 'd'])
})

// A live cursor has no end of its own, so the consumer leaving is the only thing that
// drops its subscriber. A cursor per row of a list that never unsubscribed would grow
// the reader list for the life of the page — and nothing about the output would say so.
test('leaving a cursor drops its subscriber', async () => {
    const room = reactive<string>(undefined, { history: 9 })
    room.publish('a')
    await Promise.resolve()
    const before = cellOf<{ readers: unknown[] }>(room).readers.length
    await take(room.history(1), 1)
    expect(cellOf<{ readers: unknown[] }>(room).readers.length).toBe(before)
})

// 12.8 THROUGH `s.watch`, which is 12.9's whole point: `s.watch` is `watch` narrowed to
// one source, so it must answer a throwing effect the same way. It did not — it had no
// catch at all, so the reader stayed alive and re-ran into the same throw on every write,
// where `watch(…)` stops. Nothing about the values either one serves says so.
// 12.8 STOPS THE EFFECT THAT THREW AND NOTHING ELSE. The throw unwinds out of the drain,
// whose `finally` abandons the queue — and a reader abandoned at `DIRTY` takes
// `markReaders`' own `state >= wanted` short-circuit on every later write, so it is never
// queued again. One effect throwing left every sibling the drain had not yet reached
// permanently deaf, silently, while the value went on being right.
//
// THE REVERT is abandoning the queue without resetting the state: `ran: 0` against 2.
test('an effect that throws leaves its siblings alive for the next write', () => {
    const source = reactive(0)
    const ran: number[] = []
    watch(source, () => {
        if (source() === 1) throw new Error('boom')
    })
    const second = watch(source, () => {
        ran.push(1)
    })
    const third = watch(source, () => {
        ran.push(2)
    })
    try {
        source.set(1)
        flushSync()
    } catch {
        // 12.8: the throwing one is stopped, and it rethrows on the way out.
    }
    ran.length = 0
    source.set(2)
    flushSync()
    expect(`ran: ${ran.length}`).toBe('ran: 2')
    second()
    third()
})

test('an effect that throws stops its s.watch, as it stops a watch', () => {
    const count = reactive(1)
    let runs = 0
    expect(() =>
        count.watch(() => {
            runs += 1
            throw new Error('no')
        }),
    ).toThrow('no')
    expect(runs).toBe(1)

    // The revert is the missing `catch`: without it this is 2, and it keeps climbing —
    // one more run per write, for the life of the value.
    // `set` returns `void | Failures`, and bun's `not.toThrow` reads a RETURNED `Error` as a throw.
    let threw = false
    try {
        count.set(2)
    } catch {
        threw = true
    }
    expect(threw).toBe(false)
    expect(runs).toBe(1)
})

// 12.6's TWO WITNESSES, recorded around `body`: what `onError` was handed and what warned on
// `abide:watch`. `server` takes `document` away for the body — the test the core reads a server by —
// so 12.7's browser re-throw is out of it, and what reaches the caller is recorded too.
function effectReports(
    server: boolean,
    body: () => void,
): { handed: unknown[]; warned: string[]; threw: unknown[] } {
    const handed: unknown[] = []
    const warned: string[] = []
    const threw: unknown[] = []
    const unfile = onError((error) => {
        handed.push(error)
    })
    const warn = console.warn
    console.warn = (...args: unknown[]): void => {
        const line = args.join(' ')
        if (line.includes('abide:watch')) warned.push(line)
    }
    const document = Object.getOwnPropertyDescriptor(globalThis, 'document')
    if (server)
        Object.defineProperty(globalThis, 'document', {
            value: undefined,
            configurable: true,
        })
    try {
        body()
    } catch (thrown) {
        threw.push(thrown)
    } finally {
        if (server && document !== undefined)
            Object.defineProperty(globalThis, 'document', document)
        console.warn = warn
        unfile()
    }
    return { handed, warned, threw }
}

// 12.6 ON A SERVER: an effect's throw, and a read of a failed value inside one, reach `onError`
// and warn on `abide:watch` — and 12.7 being a browser's alone, the write that woke it is not what
// failed and does not throw. 12.8 still stops the watch.
//
// THE REVERT is `effectThrew` re-throwing and reporting nothing, as the catch did before:
// `handed: 0, warned: 0, threw: 1`.
test('on a server, an effect that throws reaches onError and warns on abide:watch — 12.6', () => {
    const source = reactive(0)
    const failing = reactive((): number => {
        throw new Error('unreadable')
    })
    let runs = 0
    const { handed, warned, threw } = effectReports(true, () => {
        watch(source, () => {
            runs += 1
            if (source() === 1) throw new Error('boom')
        })
        watch(() => {
            if (source() === 1) failing()
        })
        source.set(1)
        flushSync()
        source.set(2)
        flushSync()
    })
    expect(
        `handed: ${handed.length}, warned: ${warned.length}, threw: ${threw.length}`,
    ).toBe('handed: 2, warned: 2, threw: 0')
    expect(String(handed[0])).toContain('boom')
    expect(String(handed[1])).toContain('unreadable')
    expect(`runs: ${runs}`).toBe('runs: 2')
})

// 12.7 IN A BROWSER: the same report, and the throw goes on out to surface as an uncaught error.
//
// THE REVERT is `effectThrew` never re-throwing: `threw: 0`.
test('in a browser, an effect that throws warns on abide:watch and is re-thrown — 12.6, 12.7', () => {
    const source = reactive(0)
    const { handed, warned, threw } = effectReports(false, () => {
        watch(source, () => {
            if (source() === 1) throw new Error('boom')
        })
        source.set(1)
        flushSync()
    })
    expect(
        `handed: ${handed.length}, warned: ${warned.length}, threw: ${threw.length}`,
    ).toBe('handed: 1, warned: 1, threw: 1')
})

// 12.6 FOR A DISPOSER, before a rerun and at teardown alike. Neither stops the effect: 12.8 is an
// effect's, so the rerun its disposer was clearing the way for still runs.
//
// THE REVERT is calling the disposer bare: the rerun's throw escapes the write and the effect never
// reruns — `handed: 0, warned: 0, runs: 1`.
test('a disposer that throws reaches onError and warns, and its effect still reruns — 12.6', () => {
    const source = reactive(0)
    let runs = 0
    const { handed, warned } = effectReports(false, () => {
        const stop = watch(source, () => {
            runs += 1
            return (): void => {
                throw new Error('teardown')
            }
        })
        source.set(1)
        flushSync()
        stop()
    })
    expect(
        `handed: ${handed.length}, warned: ${warned.length}, runs: ${runs}`,
    ).toBe('handed: 2, warned: 2, runs: 2')
})

// ── `s.patch`, which nothing covered ─────────────────────────────────────────────

// 5.7: REPLACES THE HEAD PRODUCTION RATHER THAN APPENDING ONE. A mutation in place is not
// a new production, so retention does not grow and no sequence number is minted — and the
// reader still has to be woken, which is the cascade's job rather than the ordinal's.
//
// THE REVERT IS ONE LINE: putting `this.ordinal += 1` back into `patch`. Retention then
// reads 1 where the ordinal says 2, and since a cursor holds its place BY ordinal the next
// turn reads one past the end of the ring and hands over `undefined` — the assertion below
// that a cursor is not woken becomes a cursor woken with nothing in it.
test('a patch replaces the head production rather than appending one', async () => {
    // A ring, because retention past the standing production is what there is to count.
    const held = reactive<{ n: number }>(undefined, { history: 4 })
    held.publish({ n: 1 })
    let woken = 0
    const stop = held.watch(() => {
        woken += 1
    })
    woken = 0

    held.patch((value) => {
        value.n = 2
    })
    flushSync()
    // The reader is woken — a mutation in place is still something to re-render.
    expect(woken).toBe(1)
    expect(held().n).toBe(2)
    // And retention did not grow: one production, mutated, not two.
    expect([...held.history()].length).toBe(1)
    stop()

    // A cursor is not handed a turn for it, and above all is not handed `undefined`.
    const cursor = held.history(0)[Symbol.asyncIterator]()
    held.patch((value) => {
        value.n = 3
    })
    const turn = await Promise.race([
        cursor.next(),
        new Promise<{ done: true }>((resolve) =>
            setTimeout(() => resolve({ done: true }), 20),
        ),
    ])
    expect(turn.done).toBe(true)
    await cursor.return?.()
})

// 2.2 through `patch`: there is nothing to mutate where nothing has landed, and handing
// the callback `undefined` would fail inside the app's own code instead.
test('a patch of a value with nothing landed refuses', () => {
    const pending = reactive(new Promise<{ n: number }>(() => {}))
    expect(() =>
        pending.patch((value) => {
            value.n = 1
        }),
    ).toThrow(NotLanded)
})

// ── `watch` over named sources: RULEBOOK 12.3 ────────────────────────────────────

// 12.3: WHERE SOURCES ARE GIVEN, THE EFFECT RUNS ONLY WHEN THOSE CHANGE. The body is not
// a tracked context, so a read inside it subscribes to nothing — which is the whole point
// and the one thing a value assertion cannot see: the effect reads the right `b` either
// way, it just runs twice as often.
//
// The revert is the bare form — `watch(() => { runs += 1; b() })` — which discovers `b` by
// running and takes this from 0 to 1 on the first assertion.
test('a watch given sources runs only when those sources change', () => {
    const a = reactive(1)
    const b = reactive(10)
    let runs = 0
    const stop = watch(a, () => {
        runs += 1
        // Read, and deliberately not declared. A tracked body would subscribe here.
        void b()
    })
    expect(runs).toBe(1)
    runs = 0

    b.set(20)
    flushSync()
    expect(runs).toBe(0)
    a.set(2)
    flushSync()
    expect(runs).toBe(1)
    stop()
})

// THE SOURCES ARE ANY MIX OF VALUES, and that is a claim about the TYPE: with one `Stored` inferred
// for the whole list, sources of a number, a string and a boolean do not compile. THE REVERT: type
// `sources` as `Reactive<Stored>[]`; `bun run typecheck` refuses this file (TS2322) and the runtime
// never moved.
test('a watch over sources of different values runs for each of them', () => {
    const count = reactive(1)
    const label = reactive('one')
    const open = reactive(false)
    let runs = 0
    const stop = watch([count, label, open], () => {
        runs += 1
    })
    label.set('two')
    flushSync()
    open.set(true)
    flushSync()
    expect(runs).toBe(3)
    stop()
})

// The array form, and that every source in it is live — not just the first.
test('a watch over several sources runs for any of them', () => {
    const first = reactive(1)
    const second = reactive(2)
    let runs = 0
    const stop = watch([first, second], () => {
        runs += 1
    })
    runs = 0

    first.set(10)
    flushSync()
    expect(runs).toBe(1)
    second.set(20)
    flushSync()
    expect(runs).toBe(2)
    stop()
})

// Stopping it drops the reader from EVERY source it was given, not just the one that
// happened to wake it last. A watch that unsubscribed from one of three would keep
// running for the other two, and nothing about its output would say so.
test('stopping a watch drops it from every source it was given', () => {
    const first = reactive(1)
    const second = reactive(2)
    const readers = (value: unknown): number =>
        cellOf<{ readers: unknown[] }>(value).readers.length
    const beforeFirst = readers(first)
    const beforeSecond = readers(second)

    let runs = 0
    const stop = watch([first, second], () => {
        runs += 1
    })
    expect(readers(first)).toBe(beforeFirst + 1)
    expect(readers(second)).toBe(beforeSecond + 1)

    stop()
    expect(readers(first)).toBe(beforeFirst)
    expect(readers(second)).toBe(beforeSecond)
    first.set(9)
    second.set(9)
    expect(runs).toBe(1)
})

// 12.1 through the narrowed form: the disposer runs before each rerun and once at teardown.
test('a watch over sources runs its disposer before each rerun and at teardown', () => {
    const source = reactive(1)
    const order: string[] = []
    const stop = watch(source, () => {
        order.push(`run:${source.peek()}`)
        return () => order.push('dispose')
    })
    source.set(2)
    flushSync()
    stop()
    expect(order).toEqual(['run:1', 'dispose', 'run:2', 'dispose'])
})

// 14.10 — A DISPOSER DOES NOT TRACK, wherever its watch was stopped from. A stop called inside
// another watch's effect ran the disposer under that effect's reader, so the effect subscribed to
// what the disposer read and re-ran on a value it never read itself. THE REVERT: drop the
// `TRACKING.reader = null` from `runDisposer` — `outer` reads 3 runs where 2 are due.
test('a disposer run from inside another effect does not subscribe it — 14.10', () => {
    const read = reactive(0)
    const toggle = reactive(0)
    const inner = watch(() => () => {
        read()
    })
    let outer = 0
    watch(() => {
        toggle()
        outer += 1
        if (outer === 2) inner()
    })
    toggle.set(1)
    flushSync()
    read.set(1)
    flushSync()
    expect(outer).toBe(2)
})

// 12.14 FOR A DERIVED VALUE, AND FOR AN ADOPTION — what an owner built lets go of what it reads once
// the owner stops. The owner here is the collector a component's setup opens. Left wired, the
// derived value stayed on its source's reader list and the adopting one's mirror ran on every write
// to what it adopted, for as long as the source lived. THE REVERT: drop the
// `owned(() => orphan(cell))` in `createReactive` — the source keeps 2 readers where 0 are due.
test('a derived and an adopting value stop reading when their owner stops — 12.14', () => {
    const source = reactive(1)
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    const derived = reactive(() => source() + 1)
    const adopting = reactive(() => source)
    collectWatches(previous)
    expect(derived()).toBe(2)
    expect(adopting()).toBe(1)
    const readers = (source as unknown as { [CELL]: { readers: unknown[] } })[
        CELL
    ].readers
    expect(readers.length).toBe(2)

    for (const stop of stops) stop()
    expect(readers.length).toBe(0)
    const wakes = WORK.wakes
    source.set(2)
    flushSync()
    expect(WORK.wakes - wakes).toBe(0)

    // Read again, each derives afresh and is current.
    expect(derived()).toBe(3)
    expect(adopting()).toBe(2)
})

// ── Adoption: RULEBOOK 11.12 to 11.19 ────────────────────────────────────────────

// 11.12: A `Reactive` a body hands back is ADOPTED and MUST NOT be stored as a value. It
// used to be stored — `outer()` handed back the inner callable itself — which is the one
// case 1.6 names: a `Reactive` is thenable, so anything that tells a load from a value has
// to take it as a value, and anything that takes a body's RESULT has to take it as a
// producer. A `Reactive` held as data goes inside a record.
test('a body that hands back a Reactive adopts it rather than storing it', () => {
    const inner = reactive(1)
    const outer = reactive(() => inner)
    expect(outer()).toBe(1)
    // And it goes on serving what the adopted one serves.
    inner.set(2)
    expect(outer()).toBe(2)
})

// 11.13 and 11.14 together: the adopted productions mirror into the OUTER value, and the
// outer's own `transform` runs on the way in. Mirroring through `produce` rather than
// `accept` would skip the transform and is the obvious wrong spelling.
// 4.7: A `transform` RUNS UNTRACKED, and the reader it must not be attributed to is
// whatever happens to be on the stack — a write made from inside a `watch`, or from a
// recompute. Run tracked, the transform's own reads became that reader's, so it re-ran on
// a value it never read AND had those reads spliced into its cursor-ordered `sources`,
// where the next run's positions no longer line up. `gateInto` has always cleared this;
// `accept` and `acceptIntoStream` did not.
//
// THE REVERT is calling the transform without clearing `TRACKING.reader`: `wakes: 1`
// against 0. The VALUE is right on both arms — the transform computes the same figure
// either way — so only the count moves.
test('a transform runs untracked, whatever reader made the write', () => {
    const other = reactive(1)
    const target = reactive<number>(undefined, {
        transform: (value: number) => value + other(),
    })
    let woken = 0
    const stop = watch(() => {
        woken += 1
        target.set(1)
    })
    flushSync()
    woken = 0
    other.set(99)
    flushSync()
    expect(`wakes: ${woken}`).toBe('wakes: 0')
    stop()
})

// 11.13 OVER A DERIVED VALUE. What the walk reaches through an adopted derived value has only been
// MARKED, and still holds what it held — a mirror copying it there copies the old value and leaves
// the adopter clean, so neither a read nor a watch ever sees the change. THE REVERT: run the mirror
// in `markReaders` whatever the state of the cell being walked; the watch saw `3` once and the
// read says 3, where both are due 4.
test('an adopted derived value mirrors what it recomputes to — 11.13', () => {
    const cents = reactive(300)
    const dollars = reactive(() => cents() / 100)
    const watched = reactive(() => dollars)
    const seen: unknown[] = []
    const stop = watch(() => {
        seen.push(watched())
    })
    const read = reactive(() => dollars)
    read()
    cents.set(400)
    flushSync()
    expect(seen).toEqual([3, 4])
    expect(read()).toBe(4)
    stop()
})

// 11.13 FOR A PATCH, which is the one production that keeps its reference (5.7). The mirror copied
// the inner's value into the adopter through the identity gate, found the reference it already
// held, and woke nobody — so `reactive(() => getRows())` never showed a row a server patched.
// THE REVERT: drop the same-reference arm in `mirror`; the adopter's watch runs once, not twice.
test('a patch of an adopted value wakes the adopter — 11.13, 5.7', () => {
    const rows = reactive([{ id: 1, watched: false }])
    const adopter = reactive(() => rows)
    const seen: boolean[] = []
    const stop = watch(() => {
        seen.push((adopter() as { watched: boolean }[])[0]?.watched ?? false)
    })
    rows.patch((value) => {
        ;(value[0] as { watched: boolean }).watched = true
    })
    flushSync()
    expect(seen).toEqual([false, true])
    stop()
})

test('adopted productions mirror into the outer value, through its own transform', () => {
    const feed = reactive(1)
    const outer = reactive(() => feed, {
        transform: (value: number) => value * 10,
    })
    const seen: number[] = [outer()]
    const stop = outer.watch((value) => {
        seen.push(value)
    })
    feed.set(2)
    flushSync()
    feed.set(3)
    flushSync()
    stop()
    expect(outer()).toBe(30)
    expect(seen).toEqual([10, 10, 20, 30])
})

// 11.18: a recompute landing on the SAME adopted `Reactive` wakes nobody. A body that
// reads something unrelated and hands back the same value every time is the common shape —
// re-subscribing there would mint a production out of a recompute that decided nothing,
// and the value would be right every time.
//
// The revert is dropping the `standing.source === inner` test in `adopt`: this goes from 0
// to 1 at each write, one wake per recompute, for as long as the value lives.
test('a recompute onto the same adopted Reactive wakes no reader', () => {
    const trigger = reactive(0)
    const held = reactive(1)
    const outer = reactive(() => {
        trigger()
        return held
    })
    const woken = wakes(outer)

    trigger.set(1)
    expect(woken.count()).toBe(0)
    trigger.set(2)
    expect(woken.count()).toBe(0)
    expect(outer()).toBe(1)
    woken.stop()
})

// 11.16: on re-adoption the outer clears where the newly adopted has nothing to serve. It
// cannot go on serving the old one's value — that value belongs to a producer this is no
// longer adopting.
test('re-adopting something with nothing to serve clears the outer', () => {
    const pick = reactive(0)
    const landed = reactive(41)
    const pending = reactive(new Promise<number>(() => {}))
    const outer = reactive(() => (pick() === 0 ? landed : pending))
    expect(outer()).toBe(41)
    expect(outer.ready()).toBe(true)

    pick.set(1)
    expect(() => outer()).toThrow(NotLanded)
    expect(outer.ready()).toBe(false)
    // 11.19: and it reports busy for the one it now adopts.
    expect(outer.busy()).toBe(true)
})

// 3.2 — A PROBE ANSWERS ABOUT THE VALUE A READ WOULD SERVE. `x.ready() ? x() : fallback` is the guard
// every template and handler writes, and it has to mean what it says: a value whose inputs moved to a
// load since its last run is not ready, whatever that run held. Asked from a handler, with nothing
// subscribed to pull the body forward first.
//
// THE REVERT: drop `bringCurrent` from `isReady`; the probe answers `true` from the run before the
// switch and the read it admitted throws `NotLanded`.
test('a read a ready guard admitted does not throw — 3.2', () => {
    const playing = reactive(false)
    const pending = reactive(new Promise<number[]>(() => {}))
    const keyframes = reactive(() => (playing() ? pending : []))
    expect(keyframes()).toEqual([])
    playing.set(true)
    const guarded = (): unknown =>
        keyframes.ready() ? keyframes() : 'fallback'
    expect(guarded()).toBe('fallback')
    expect(keyframes.busy()).toBe(true)
})

// 3.2 AS A GUARD. `{#if keyframes.ready()}` subscribes to the probe alone, so nothing reads the value
// to pull the body forward — and what changed was an INPUT, which marks the body and moves no probe.
// The drain pulls a marked body a guard is asking about, and the guard wakes once, onto false.
//
// THE REVERT: queue only an ABORTED body in `markReaders` (the `below.aborted &&` it had); the guard
// reads `true` for the life of the page. Drop the `CLEAN` return from `resolveEffect` and the guard
// is woken a second time onto the `false` it already showed.
test('a guard on ready hears an input move the body to a load — 3.2', () => {
    const playing = reactive(false)
    const pending = reactive(new Promise<number[]>(() => {}))
    const keyframes = reactive(() => (playing() ? pending : []))
    const seen: boolean[] = []
    const stop = watch(() => {
        seen.push(keyframes.ready())
    })
    playing.set(true)
    flushSync()
    expect(seen).toEqual([true, false])
    stop()
})

// 11.17: the adopted value's `identity` is inherited where the outer declared none — so an
// adopting value collapses the repeats its producer would have collapsed, rather than
// waking on every one of them.
//
// The revert is dropping the inheritance: `woken` goes from 0 to 1.
// 11.16 IS BOTH EDGES. Losing what there was to serve is `unserve`, the one move a trigger
// and an abort make too — the readers hear it through the cascade and the GUARDS hear it
// through `probesMoved` — and the adoption once made only the first. The inner has been loading all
// along, so it moves no probe of its own: there is no upstream walk for the guard to hear
// through, and it never runs again.
//
// THE REVERT is the unserve arm cascading and stopping: `saw: true` while the truth is
// false, and `{#if outer.ready()}{outer()}{:else}spinner{/if}` renders the value branch
// over a read that throws.
test('re-adopting something with nothing to serve wakes the guards too', () => {
    const landed = reactive(1)
    const pending = reactive(new Promise<number>(() => {}))
    const flag = reactive(true)
    const outer = reactive(() => (flag() ? landed : pending))
    const seen: boolean[] = []
    const stop = watch(() => {
        seen.push(outer.ready())
    })
    flushSync()
    expect(`first: ${seen[seen.length - 1]}`).toBe('first: true')
    flag.set(false)
    // The recompute the write owes, pulled the way any read pulls it.
    outer.peek()
    flushSync()
    expect(`truth: ${outer.ready()}`).toBe('truth: false')
    expect(`saw: ${seen[seen.length - 1]}`).toBe('saw: false')
    stop()
})

// 11.17 IS ONLY VISIBLE ACROSS A RE-ADOPTION. A write to the adopted value is gated by the
// adopted value's own `identity` first, so a production the inherited comparator would collapse
// never reaches the mirror at all — the gate the outer inherits is the one that compares what the
// NEW inner serves against what the OLD one did. Two values holding equal contents in different
// objects: `structural` collapses the switch, the reference default would not.
//
// The revert is assigning `cell.declaredIdentityFn` alone in `adopt`, inheriting nothing: `woken`
// is 1 against 0.
test('an adopting value inherits the identity it did not declare', () => {
    const first = reactive({ id: 1 }, { identity: structural })
    const second = reactive({ id: 1 }, { identity: structural })
    const pick = reactive(true)
    const outer = reactive(() => (pick() ? first : second))
    const woken = wakes(outer)

    pick.set(false)
    expect(woken.count()).toBe(0)
    woken.stop()
})

// 11.17 INHERITS FOR THE LENGTH OF THE ADOPTION, NOT FOR THE LIFE OF THE VALUE. An inherited
// comparator left on the outer once it stops adopting gates the outer's OWN productions with a
// comparison it never declared: keyed on `.id`, every number reads as the same `undefined`, so the
// outer answers its first number forever and its watcher never wakes. Nothing else would tell.
//
// The revert is dropping the reset to `declaredIdentityFn` in `dropAdoption`: `outer()` stays 0
// and `seen` is `[0]` against `[0, 5]`.
test('a value that stops adopting goes back to the identity it declared', () => {
    const inner = reactive({ id: 1 }, { identity: (row) => row.id })
    const adopting = reactive(true)
    const count = reactive(0)
    const outer = reactive((): unknown => (adopting() ? inner : count()))
    expect(outer()).toEqual({ id: 1 })
    adopting.set(false)
    expect(outer()).toBe(0)

    const seen: unknown[] = []
    const stop = outer.watch((value) => {
        seen.push(value)
    })
    count.set(5)
    flushSync()
    expect(outer()).toBe(5)
    expect(seen).toEqual([0, 5])
    stop()
})

// The same, across a RE-ADOPTION: the inherited comparator is the adopted value's, so a second
// inner declaring none hands the outer the reference default rather than the first one's.
//
// The revert is `if (cell.identityFn === null)` in front of the assignment in `adopt`: the first
// inner's `.id` comparator stays, `{ id: 1 }` with a new `name` reads as unchanged, and `woken`
// is 0 against 1.
test('a re-adoption takes the identity of what it adopts now', () => {
    const keyed = reactive({ id: 1, name: 'a' }, { identity: (row) => row.id })
    const plain = reactive({ id: 1, name: 'a' })
    const pick = reactive(true)
    const outer = reactive(() => (pick() ? keyed : plain))
    expect(outer()).toEqual({ id: 1, name: 'a' })
    pick.set(false)
    expect(outer()).toEqual({ id: 1, name: 'a' })
    const woken = wakes(outer)
    plain.set({ id: 1, name: 'b' })
    expect(woken.count()).toBe(1)
    expect(outer()).toEqual({ id: 1, name: 'b' })
    woken.stop()
})

// 11.19 through a load: an adopting value reports busy only where the adopted one does,
// and the adopted is not in its tracked source list — the body read `pick`, not the value
// it handed back.
test('busy propagates from the adopted value', async () => {
    let settle: (value: number) => void = (): void => {}
    const loading = reactive(
        new Promise<number>((resolve) => {
            settle = resolve
        }),
    )
    const outer = reactive(() => loading)
    expect(outer.busy()).toBe(true)
    expect(outer.ready()).toBe(false)

    settle(7)
    await loading
    expect(outer()).toBe(7)
    expect(outer.busy()).toBe(false)
})

// A TRIGGER ON THE OUTER VALUE WAS A VALUE STUCK FOR THE LIFE OF THE PAGE. `invalidate`
// marks the outer unservable and re-runs its body, the body hands back the SAME inner value,
// and 11.18 makes that recompute decide nothing — so nothing ever made the outer servable
// again. `refresh` stuck `busy` the same way. The inner here has no producer, so 7.6 makes
// reaching it inert and the outer has to settle from what the inner already serves.
//
// THE REVERT is `adopt` returning on the same source without re-mirroring: `ready: false`,
// `busy: true`, and the read throws `NotLanded` with the value sitting in the inner.
test('a trigger on an adopting value settles it again over the same adoption', () => {
    const inner = reactive(1)
    const outer = reactive(() => inner)
    expect(outer()).toBe(1)

    outer.invalidate()
    expect(outer()).toBe(1)
    expect(`ready: ${outer.ready()}`).toBe('ready: true')
    expect(`busy: ${outer.busy()}`).toBe('busy: false')

    outer.refresh()
    expect(`busy: ${outer.busy()}`).toBe('busy: false')
    expect(outer()).toBe(1)
})

// 11.18 THROUGH THE SETTLE ABOVE. The re-mirror goes through the identity gate, so the
// same production arriving again wakes nobody — a refresh over an adoption whose inner did
// not move must not repaint what reads the outer. `invalidate` is not asked the same: it
// takes away what there was to serve, which is a move every value reader has to hear.
//
// THE REVERT is `mirror` calling `produce(cell, inner.value, false)` — ungated: `wakes: 1`.
test('refreshing over the same adoption wakes no reader', () => {
    const inner = reactive(1)
    const outer = reactive(() => inner)
    const counter = wakes(outer)
    outer.refresh()
    const woken = counter.count()
    counter.stop()
    expect(`wakes: ${woken}`).toBe('wakes: 0')
})

// 11.52: THE ADOPTED VALUE IS WHERE THE DATA IS. The outer's own body only hands back a
// reference, so re-running it reloads nothing — without the reach a `refresh` on the value
// an app holds is a spinner over a load that never happens.
//
// THE REVERT is dropping the reach from `eachAdopted`: `inner runs: 0`
// on both lines.
// 11.52 IS EVERY TRIGGER AND EVERY ADOPTER, including one that adopted through `s.set`
// (11.62) rather than through a body. Both triggers reached `cell.adoption` only PAST the
// "no producer" return, and an adopter made by a write has no body — so both were silent
// no-ops on it, with nothing in the output saying the reload never happened.
//
// THE REVERT is the adoption reach sitting after that return: `calls: 1` against 2.
test('a trigger on a value that adopted through set reaches the adopted one', async () => {
    let calls = 0
    const src = reactive(async () => {
        calls += 1
        return calls
    })
    const outer = reactive<number>()
    outer.set(src as never)
    await src
    flushSync()
    outer.refresh()
    await src
    expect(`calls: ${calls}`).toBe('calls: 2')
})

// 9.15 GOES ON DOWN. "MUST forward to the adopted `Reactive`" is recursive where the
// adopted one is itself adopting, and the unwrap stopped at one level — so a chain
// answered from the MIDDLE value, which retains nothing of its own and falls back to its
// standing production. `failureOf`, `walkBusy` and `walkReady` all walk the whole chain;
// this was the one that did not.
//
// THE REVERT is a single unwrap: `replayed: 2` — the last production alone, where the
// value at the bottom of the chain holds both.
test('the past of an adopting value reaches through a chain of adoptions', () => {
    const inner = reactive<number>(undefined, { history: 4 })
    inner.publish(1)
    inner.publish(2)
    const middle = reactive(() => inner)
    const outer = reactive(() => middle)
    flushSync()
    expect(`replayed: ${[...outer.history()].join(',')}`).toBe('replayed: 1,2')
})

test('a trigger on an adopting value reaches the adopted one', () => {
    // Counted apart from what the body produces, so every run mints a value the identity
    // gate cannot collapse and the outer serving it is proof the production arrived.
    let produced = 0
    let runs = 0
    const inner = reactive(() => {
        runs += 1
        produced += 1
        return produced
    })
    const outer = reactive(() => inner)
    expect(outer()).toBe(1)

    runs = 0
    outer.refresh()
    expect(`inner runs: ${runs}`).toBe('inner runs: 1')
    expect(outer()).toBe(2)

    // Lazily, so nothing runs until the outer value is read (7.12).
    runs = 0
    outer.invalidate()
    expect(`inner runs before a read: ${runs}`).toBe(
        'inner runs before a read: 0',
    )
    expect(outer()).toBe(3)
    expect(`inner runs: ${runs}`).toBe('inner runs: 1')
    expect(outer.ready()).toBe(true)
})

// 11.51 ON A PROBE-ONLY MOVE. A production of the adopted value reaches the adopter through
// the mirror and moves the adopter's probes with it — but a move that mints nothing (a load
// starting, a refresh landing an equal value, a stream closing) reached the mirror not at
// all. `outer.busy()` answered right whenever it was asked and nothing ever asked it again,
// which in a template is a spinner that does not appear, or one that never goes away.
//
// THE REVERT is `markProbes` not following an adoption's mirror: `saw: false`.
test('a guard on an adopting value hears the adopted value start and stop loading', async () => {
    let settle: (value: number) => void = (): void => {}
    let loads = 0
    const inner = reactive(() => {
        loads += 1
        if (loads === 1) return 1
        return new Promise<number>((resolve) => {
            settle = resolve
        })
    })
    const outer = reactive(() => inner)
    const saw: boolean[] = []
    const stop = watch(() => {
        saw.push(outer.busy())
    })
    inner.refresh()
    flushSync()
    settle(1)
    await inner
    flushSync()
    stop()
    expect(`saw: ${saw.join(',')}`).toBe('saw: false,true,false')
})

// 11.51 FOR `error`, AND WHAT A FAILURE DOES THROUGH AN ADOPTION. The adopted value is where
// the load is, so its failure is the adopter's to report: `error()` answers it, a read with
// nothing to serve throws it rather than `NotLanded` — "no", where `NotLanded` says "not yet"
// and a tracked body waits on it forever (2.2) — and an await rejects with it (2.9). Before,
// all three stopped at the adoption, and the await never settled at all.
//
// THE REVERT is `failureOf` answering the value's own `failure` alone: `error: undefined`.
test('a failure of the adopted value is the adopter error, its read throw and its await rejection', async () => {
    let fail: (error: unknown) => void = (): void => {}
    const inner = reactive(
        new Promise<number>((_resolve, reject) => {
            fail = reject
        }),
    )
    const outer = reactive(() => inner)
    const guard: unknown[] = []
    const stop = watch(() => {
        guard.push((outer.error() as unknown as Error | undefined)?.message)
    })
    const awaited = outer.then(
        () => 'resolved',
        (error: unknown) => `rejected: ${(error as Error).message}`,
    )
    fail(new Error('boom'))
    await inner.catch(() => undefined)
    flushSync()
    stop()

    expect(
        `error: ${(outer.error() as unknown as Error | undefined)?.message}`,
    ).toBe('error: boom')
    expect(`guard: ${guard[guard.length - 1]}`).toBe('guard: boom')
    let thrown: unknown
    try {
        outer()
    } catch (error) {
        thrown = error
    }
    expect(`read threw: ${(thrown as Error).message}`).toBe('read threw: boom')
    expect(await awaited).toBe('rejected: boom')
})

// 2.4 AND 11.51 TOGETHER: a revalidation of the adopted value that fails leaves the adopter
// serving what it held, with the failure standing beside it.
test('a failed revalidation of the adopted value leaves the adopter serving, with the error', async () => {
    let loads = 0
    let fail: (error: unknown) => void = (): void => {}
    const inner = reactive(() => {
        loads += 1
        if (loads === 1) return 1
        return new Promise<number>((_resolve, reject) => {
            fail = reject
        })
    })
    const outer = reactive(() => inner)
    inner.refresh()
    fail(new Error('revalidate failed'))
    await Bun.sleep(1)
    expect(outer()).toBe(1)
    expect(
        `error: ${(outer.error() as unknown as Error | undefined)?.message}`,
    ).toBe('error: revalidate failed')
})

// ── The probe floor: a value is no better than the worst it was built from ───────

// 11.20 AND 11.59. `busy` asks whether ANYTHING it reads is loading; `ready` whether
// EVERYTHING it reads has something to serve. Only that pairing makes `busy && !ready`
// one sentence, and only the second half was implemented.
//
// A VALUE ASSERTION CANNOT SEE THIS. The derived value goes on serving the figure it
// computed before — right by its own lights and a lie about the data, with nothing in the
// output to say so. The revert is `ready()` returning `this.servable`: the last assertion
// flips to true and no other test in this file moves.
test('a derived value is not ready while a value it read has nothing to serve', async () => {
    const answer = 1
    const source = reactive(() => Promise.resolve(answer))
    await source
    const derived = reactive(() => source() * 2)
    expect(derived()).toBe(2)
    expect(derived.ready()).toBe(true)

    // 7.4: a refresh keeps serving, so the floor is unmoved.
    source.refresh()
    expect(derived.busy()).toBe(true)
    expect(derived.ready()).toBe(true)
    await source

    // An invalidate does not: the source has nothing to serve, so neither has anything
    // built from it, whatever it happens to be holding. The probe runs the reload the mark owes
    // (3.2), and the floor follows the source there.
    source.invalidate()
    expect(derived.ready()).toBe(false)
    expect(() => source()).toThrow(NotLanded)
    expect(source.ready()).toBe(false)
    expect(derived.busy()).toBe(true)
    expect(derived.ready()).toBe(false)
})

// 11.59 THROUGH AN ABORT, where nothing upstream moved a probe. The write that re-points the body
// is a production on `flag`, and `pending` has never had anything to serve, so the only move a
// guard on `derived.ready()` can hear is the one the abort makes when it stops serving.
//
// THE REVERT: dropping `probesMoved` from `unserve` reports `seen: true` — the guard left on the
// value branch while the value it guards throws.
test('a derived value that aborts wakes the guard asking whether it is ready', () => {
    const flag = reactive(false)
    const pending = reactive<number>()
    const derived = reactive(() => (flag() ? pending() : 0))
    const seen: boolean[] = []
    const guard = watch(() => {
        seen.push(derived.ready())
    })
    // What pulls the body: a reader of the VALUE, apart from the guard.
    const painter = watch(() => {
        derived()
    })
    expect(seen).toEqual([true])
    flag.set(true)
    flushSync()
    expect(`seen: ${seen.at(-1)}`).toBe('seen: false')
    guard()
    painter()
})

// The floor reaches through the adoption too, which is not in the tracked source list —
// the body handed it back rather than reading it.
test('the floor reaches the adopted value as well as the read ones', async () => {
    const answer = 41
    // A producer, since `invalidate` is inert on a value with no body (7.x) — there is
    // nothing to re-run and nothing to be invalid against.
    const inner = reactive(() => Promise.resolve(answer))
    await inner
    const outer = reactive(() => inner)
    expect(outer()).toBe(41)
    expect(outer.ready()).toBe(true)

    inner.invalidate()
    expect(outer.ready()).toBe(false)
    expect(() => inner()).toThrow(NotLanded)
    expect(outer.busy()).toBe(true)
})

// ── 3.3: reading a probe subscribes ──────────────────────────────────────────────

// THE CANONICAL TEMPLATE SHAPE, and the one that could not come back. `{#if s.ready()}`
// renders the spinner branch, which never reads `s()` — so before 3.3 the effect subscribed
// to NOTHING and the value landing woke nobody. Stuck on the spinner for the life of the
// page, with the value sitting right there.
//
// A VALUE ASSERTION CANNOT SEE IT: every probe answers correctly the moment it is asked.
// What was missing was the wake, so the assertion is the render count and what it painted.
// The revert is dropping the `track(cell, reader)` from `isReady`: `renders` stays 1 and
// `painted` stays the spinner.
test('a guard on a probe comes back when the value lands', async () => {
    let settle: (value: number) => void = (): void => {}
    const value = reactive(
        new Promise<number>((resolve) => {
            settle = resolve
        }),
    )
    let renders = 0
    let painted: unknown
    const stop = watch(() => {
        renders += 1
        painted = value.ready() ? value() : 'spinner'
    })
    expect(painted).toBe('spinner')
    expect(renders).toBe(1)

    settle(41)
    await value
    expect(painted).toBe(41)
    expect(renders).toBe(2)
    stop()
})

// A PROBE MOVES WITHOUT A PRODUCTION. 7.4 has a refresh keep serving, so no value changes
// and 5.2 mints nothing — but `busy` went true, and a reader that asked about it has to
// hear so. Nothing carried that: the flip has to open the cascade itself.
//
// The revert is dropping the `if (!wasLoading) cascade(this)` from `refresh`: the effect
// runs once, at subscription, and never reports the load at all.
test('a refresh wakes a reader that asked whether it was busy', async () => {
    const answer = 1
    const source = reactive(() => Promise.resolve(answer))
    await source
    const seen: boolean[] = []
    const stop = watch(() => {
        seen.push(source.busy())
    })
    expect(seen).toEqual([false])

    source.refresh()
    flushSync()
    expect(seen).toEqual([false, true])
    await source
    // And again when it settles, since `busy` moved back.
    expect(seen.at(-1)).toBe(false)
    stop()
})

// The same for `ready` through the HIT that follows an invalidate: nothing to serve is a move a
// guard has to hear even though no value was minted — at the hit, where the value stops being
// served (7.17), and not at the mark (7.14).
test('the hit after an invalidate wakes a reader that asked whether it was ready', async () => {
    const answer = 1
    const source = reactive(() => Promise.resolve(answer))
    await source
    const derived = reactive(() => source() * 2)
    const seen: boolean[] = []
    const stop = watch(() => {
        seen.push(derived.ready())
    })
    expect(seen).toEqual([true])

    source.invalidate()
    flushSync()
    expect(seen).toEqual([true])
    expect(() => source()).toThrow(NotLanded)
    flushSync()
    expect(seen).toEqual([true, false])
    stop()
})

// A DERIVED BODY READING A PROBE, which is the reader half of the probe edge landing on a
// `Cell` rather than on a watch subscriber. It was broken and nothing here caught it —
// every probe test read from a `watch`, so the field a `Cell` needs to carry the edge was
// never initialised and the first such body threw on `undefined.length`.
test('a derived body may read a probe and wakes when it moves', async () => {
    const answer = 1
    const source = reactive(() => Promise.resolve(answer))
    await source
    const label = reactive(() => (source.busy() ? 'loading' : 'idle'))
    expect(label()).toBe('idle')

    source.refresh()
    expect(label()).toBe('loading')
    await source
    expect(label()).toBe('idle')
})

// The probe edge is rebuilt per run, so a guard that stops being taken stops waking. A
// cursored edge would keep the old one and the body would run for a probe it no longer
// asks about — which is a wake, and a wake is a DOM write.
test('a probe a body stops reading stops waking it', async () => {
    const answer = 1
    const watched = reactive(() => Promise.resolve(answer))
    await watched
    const use = reactive(true)
    let runs = 0
    const body = reactive(() => {
        runs += 1
        return use() ? watched.busy() : false
    })
    body()
    expect(runs).toBe(1)

    use.set(false)
    body()
    const settled = runs
    // The body no longer asks about `watched`, so a load starting there reaches nobody.
    watched.refresh()
    expect(runs).toBe(settled)
    await watched
})

// THE CAP (RULEBOOK 5.8-5.15). Every claim below is about WORK — the values these tests
// read are right whether or not a window exists, which is what makes a correctness test
// blind to the whole mechanism. So they count wakes, and they count PRODUCTIONS against
// them, because 5.9's "caps the wake, does not drop a production" is exactly a pair of
// counts moving apart.
//
// THE REVERTS, AND WHAT EACH REPORTS. Releasing every production instead of holding it
// (`capped` never called) reports: throttle 1 -> 10 wakes, debounce 0 -> 1, the
// cap/production split 0 -> 1, the held value 1 -> 2, and once-per-window 2 -> 1 wakes.
// The last two tests survive that revert and carry their own: comparing the gate against
// `cell.value` instead of `cap.minted` drops the third production, and removing the
// construction refusal leaves both options declared and nothing thrown. Dropping the
// debounce RESET reports 0 -> 5 wakes, and only against a run that outlasts a window.
//
// THE WINDOW IS 30 ms AND EVERY WAIT IS 3x IT. Contention can only make a timer LATE, so
// waiting longer is safe under `--parallel`; what would be fragile is asserting that a
// window had NOT closed yet, and nothing here does. The synchronous counts — ten writes
// reaching a reader once — involve no clock at all.
const WINDOW = 30
const AFTER_WINDOW = 90

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

test('a throttle lets the leading change through and holds the rest', () => {
    const query = reactive<number>(undefined, { throttle: WINDOW })
    const woken = wakes(query)
    for (let write = 1; write <= 10; write += 1) query.set(write)
    // 5.12: the first change immediately, and then at most once per window — so nine of
    // the ten reached nobody, and the one that did is the one that opened the window.
    expect(woken.count()).toBe(1)
    expect(query()).toBe(1)
    woken.stop()
})

test('a debounce holds every change after the first landing', () => {
    // The value has to have LANDED before a debounce has anything to do: the first
    // production goes straight out, having no held value to be held back from.
    const query = reactive<number>(0, { debounce: WINDOW })
    const woken = wakes(query)
    for (let write = 1; write <= 10; write += 1) query.set(write)
    // 5.13: the change waits for the changes to STOP, so nobody has been woken and what
    // a reader sees is still the value the run started from.
    expect(woken.count()).toBe(0)
    expect(query()).toBe(0)
    woken.stop()
})

test('a window caps the wake and drops no production', async () => {
    const feed = reactive<number>(undefined, { debounce: WINDOW, history: 19 })
    feed.publish(0)
    const woken = wakes(feed)
    for (let write = 1; write <= 10; write += 1) feed.publish(write)
    expect(woken.count()).toBe(0)
    await sleep(AFTER_WINDOW)
    // 5.9: ONE wake for ten productions. The counts moving apart is the mechanism —
    // equal counts would mean the window capped nothing, and ten against ten productions
    // retained would mean it had dropped nine.
    expect(woken.count()).toBe(1)
    expect(feed.peek()).toBe(10)
    // 5.10: the cursor is handed every production the window collapsed, retention having
    // held them. A reader watching the value saw one; a reader walking the ring sees all
    // ten, behind the opening value the ring also took.
    expect([...feed.history(20)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    woken.stop()
})

test('a held value goes on being served, and the window reads as busy', async () => {
    const query = reactive<number>(undefined, { throttle: WINDOW })
    query.set(1)
    query.set(2)
    // 5.15: what a reader sees is the value the window released, not the one it holds.
    expect(query()).toBe(1)
    expect(query.busy()).toBe(true)
    expect(query.ready()).toBe(true)
    await sleep(AFTER_WINDOW)
    expect(query()).toBe(2)
    expect(query.busy()).toBe(false)
})

test('the identity gate compares against the last production, not the last release', () => {
    const query = reactive<number>(undefined, { throttle: WINDOW, history: 9 })
    query.set(1)
    query.set(2)
    query.set(1)
    // Three productions. Comparing the third against the RELEASED 1 would collapse it,
    // and 5.9 forbids a window dropping a production — the reader would then settle on
    // 2 for a value whose last write was 1.
    expect([...query.history(10)]).toEqual([1, 2, 1])
})

// THE OTHER HALF OF 5.9, AND IT IS A CAP OVER A BODY. A window over a value form moves
// the last production MINTED apart from the last one RELEASED, which is what `cap.minted`
// carries; a window over a BODY caps the RUN instead (5.11), so the production it lets
// through goes straight out and `cap.minted` is never written on one. Read
// unconditionally, the gate compared every recompute against `undefined` — so 5.2
// collapsed nothing and a derived value that recomputed to the figure it already held woke
// every reader of it, five times over five writes.
//
// THE REVERT is `produce` reading `cap.minted` whatever the producer: `wakes: 5`. Nothing
// about the OUTPUT moves — the sanity case beside this one is what says the gate still
// wakes where the value really changed, which is the pairing that tells a fixed gate from
// a dead one.
// 5.23 — A PATCH IS CAPPED LIKE A PRODUCTION. The object changes at once, so what the window holds is
// the wake: ten patches inside one window reach a reader once, when it closes, carrying the last.
// THE REVERT: cascade unconditionally in `patchCell`; the reader is woken inside the window, 1 where
// 0 are due.
test('a throttle caps the wakes a run of patches makes', async () => {
    const rows = reactive([{ n: 0 }], { throttle: WINDOW })
    const woken = wakes(rows)
    for (let write = 1; write <= 10; write += 1)
        rows.patch((list) => {
            ;(list[0] as { n: number }).n = write
        })
    expect(woken.count()).toBe(0)
    // 5.15: the window is holding a change, so the value reads as busy while it does.
    expect(rows.busy()).toBe(true)
    await sleep(AFTER_WINDOW)
    expect(woken.count()).toBe(1)
    expect((rows()[0] as { n: number }).n).toBe(10)
    expect(rows.busy()).toBe(false)
    woken.stop()
})

// 5.24 — A REFRESH IS HELD LIKE A PRODUCTION: a throttle starts the first reload and holds the rest,
// and what it held is ONE reload when the window closes. THE REVERT: drop the window arm from
// `refreshOne`; three refreshes start 3 loads at once where 1 is due.
test('a throttle collapses a run of refreshes into one reload per window', async () => {
    let loads = 0
    const loaded = reactive(
        async () => {
            loads += 1
            return loads
        },
        { throttle: WINDOW },
    )
    await loaded
    await sleep(AFTER_WINDOW)
    const before = loads
    loaded.refresh()
    loaded.refresh()
    loaded.refresh()
    expect(loads - before).toBe(1)
    await sleep(AFTER_WINDOW)
    expect(loads - before).toBe(2)
})

// 5.24 AND 7.11 — a debounce holds every refresh until they stop, and the one reload it owes runs
// though nothing reads the value. THE REVERT: owe the run (`cap.owed`) instead of the reload; with
// no reader the run is never pulled, and 0 loads start where 1 is due.
test('a debounce holds refreshes until they stop, and reloads with nobody reading', async () => {
    let loads = 0
    const loaded = reactive(
        async () => {
            loads += 1
            return loads
        },
        { debounce: WINDOW },
    )
    await loaded
    const before = loads
    loaded.refresh()
    loaded.refresh()
    expect(loads - before).toBe(0)
    await sleep(AFTER_WINDOW)
    expect(loads - before).toBe(1)
})

test('a throttled derived value that recomputes to the same figure wakes nobody', async () => {
    const source = reactive(1)
    const derived = reactive(() => source() > 0, { throttle: WINDOW })
    let woken = 0
    const stop = watch(() => {
        derived()
        woken += 1
    })
    flushSync()
    woken = 0
    for (let write = 2; write <= 6; write += 1) {
        source.set(write)
        flushSync()
        await sleep(AFTER_WINDOW)
        derived()
        flushSync()
    }
    expect(`wakes: ${woken}`).toBe('wakes: 0')
    stop()
})

test('a throttled derived value that does move still wakes, once per window', async () => {
    const source = reactive(1)
    const derived = reactive(() => source() * 2, { throttle: WINDOW })
    let woken = 0
    const stop = watch(() => {
        derived()
        woken += 1
    })
    flushSync()
    woken = 0
    for (let write = 2; write <= 6; write += 1) {
        source.set(write)
        flushSync()
        await sleep(AFTER_WINDOW)
        derived()
        flushSync()
    }
    expect(`wakes: ${woken}`).toBe('wakes: 5')
    expect(derived()).toBe(12)
    stop()
})

test('a value declaring both throttle and debounce refuses, naming the value', () => {
    // 5.14 is a build error and there is no build, so it lands at construction. `toThrow`
    // rather than a returned refusal: this is not a value refusing a write, it is a value
    // that cannot be constructed.
    expect(() =>
        reactive<number>(undefined, { throttle: 10, debounce: 10 }),
    ).toThrow(/declares both throttle and debounce/)
})

test('a run of writes wakes once per window rather than twice at its edges', async () => {
    const query = reactive<number>(undefined, { throttle: WINDOW })
    const woken = wakes(query)
    query.set(1)
    query.set(2)
    expect(woken.count()).toBe(1)
    await sleep(AFTER_WINDOW)
    // The window closing released what it held — the second wake, and the last one. A
    // throttle that re-opened a window on an empty close would wake again here for
    // nothing, which is the shape a trailing-edge timer usually gets wrong.
    expect(woken.count()).toBe(2)
    expect(query()).toBe(2)
    woken.stop()
})

// 5.13'S DISTINGUISHING CASE, and it took two tries to find. Writes made in ONE turn
// cannot tell a window armed once at the first change from one pushed back by every
// change — both hold the LATEST production, and both release it when the first timer
// fires. Spreading the writes out does not do it either, so long as they are all in
// before that first timer: the release still carries the last of them.
//
// What tells them apart is a run that OUTLASTS a window. The armed-once arm fires in the
// middle of it and releases an intermediate value, and the writes still coming arm it
// again — so it wakes repeatedly where a debounce wakes once, at the end.
//
// THE MARGIN IS 7.5x — a 150 ms window against 20 ms between writes — and the direction
// that breaks it is contention stretching one gap past the whole window. A timing failure
// under `--parallel` is re-run with `test:serial` before it is believed.
test('a debounce waits for the changes to stop, not for the first of them', async () => {
    const LONG = 150
    const query = reactive<number>(0, { debounce: LONG })
    const woken = wakes(query)
    for (let write = 1; write <= 12; write += 1) {
        query.set(write)
        await sleep(20)
    }
    expect(woken.count()).toBe(0)
    await sleep(LONG * 3)
    expect(woken.count()).toBe(1)
    expect(query()).toBe(12)
    woken.stop()
})

test('a window does not hold back the first landing', () => {
    // 5.15 is what decides this: holding needs a held value to go on serving, and before
    // the first landing there is none — so a reader would get neither. A `debounce: 300`
    // left a value unreadable for 300 ms after construction, which is every form on a
    // page reading as not-ready on mount.
    const typed = reactive<string>('', { debounce: WINDOW })
    expect(typed.ready()).toBe(true)
    expect(typed()).toBe('')
    expect(typed.busy()).toBe(false)

    // 4.16: an opening `undefined` is a landing the window never saw, so it is ready at once and the
    // FIRST write is already a change the debounce holds, served over the `undefined` it replaces.
    const capped = reactive<number | undefined>(undefined, { debounce: WINDOW })
    expect(capped.ready()).toBe(true)
    capped.set(1)
    expect(capped()).toBeUndefined()
    expect(capped.busy()).toBe(true)
})

// A CAP ON THE KEY SPARES THE CALL. A key that was superseded inside the window is never
// reached, so the call behind it is never issued. A cap on the body that WRAPS the call
// spares it too, by holding the run rather than the key (5.11) — the `searchRig` tests
// below are that placement.
//
// THE WRITES ARE IN SEPARATE TURNS. Four writes in one turn reach a reader once whatever
// any cap says, the turn batch having collapsed them — an earlier version of this test
// wrote them together and reported one call against an implementation making four.
test('a cap on the key spares the call a superseded key would have made', async () => {
    const LONG = 100
    let calls = 0
    const region = reactive<string>('north', { debounce: LONG })
    const countOrders = reactive((args: { region: string }) => {
        calls += 1
        return `orders in ${args.region}`
    })
    const orders = reactive(() => countOrders({ region: region() }))
    const stop = watch(() => {
        orders()
    })
    // The opening value landed and was reached, which is the one call before any typing.
    expect(calls).toBe(1)
    for (const typed of ['n', 'no', 'nor', 'north']) {
        region.set(typed)
        flushSync()
        await sleep(20)
    }
    await sleep(LONG * 3)
    flushSync()
    // Four keystrokes, no new call: every intermediate key was superseded inside the
    // window and never reached, and the last one is the key already held.
    expect(calls).toBe(1)
    expect(orders()).toBe('orders in north')
    stop()
})

// 5.11, AND THE OTHER ARM OF THE CAP. A value's production has already been handed in
// when a window meets it, so the window holds it and retention keeps it (5.9). A BODY's
// work has not started, and 5.11 says not to start it — so the cap sits on the run rather
// than on what the run produced, and the load the body would have issued is never issued.
//
// THE COUNTS THAT MATTER ARE CALLS AND KEYS. A correctness test sees `n=south` whichever
// way this is built; what separates them is how many calls were made on the way there and
// which keys they were made with.
async function typeInto(
    value: { set(next: string): void },
    letters: string[],
): Promise<void> {
    // SEPARATE TURNS. Four writes in one turn wake once whatever any cap says, the turn
    // batch having collapsed them — which is not what is being measured here.
    for (const letter of letters) {
        value.set(letter)
        flushSync()
        await sleep(20)
    }
}

function searchRig(options: Record<string, number>): {
    region: { set(next: string): void }
    keys: string[]
    wakes: () => number
    stop: () => void
    orders: { peek(): string | undefined }
} {
    const keys: string[] = []
    let woken = 0
    const region = reactive<string>('north')
    const countOrders = reactive((args: { region: string }) => {
        keys.push(args.region)
        return `n=${args.region}`
    })
    const orders = reactive(() => countOrders({ region: region() }), options)
    const stop = watch(() => {
        try {
            orders()
            woken += 1
        } catch {
            // Nothing landed yet is not a wake worth counting.
        }
    })
    keys.length = 0
    woken = 0
    return { region, keys, wakes: () => woken, stop, orders }
}

test('a debounced body runs once for a burst, with the last key', async () => {
    const rig = searchRig({ debounce: 150 })
    await typeInto(rig.region, ['s', 'so', 'sou', 'south'])
    await sleep(450)
    flushSync()
    // ONE call, and the key it was made with is the one the typist stopped on. The three
    // intermediate keys were never reached, so no entry exists for them and no request
    // was issued — which is 5.11 rather than 5.9.
    expect(rig.keys).toEqual(['south'])
    // And the barrier held: nothing downstream woke while the window was open (5.8).
    expect(rig.wakes()).toBe(1)
    expect(rig.orders.peek()).toBe('n=south')
    rig.stop()
})

test('a throttled body runs the leading change and the trailing one', async () => {
    const rig = searchRig({ throttle: 150 })
    await typeInto(rig.region, ['s', 'so', 'sou', 'south'])
    await sleep(450)
    flushSync()
    // 5.12: the leading change goes straight through, and the window caps what follows —
    // so the two calls are the first key and the last, and neither middle key was reached.
    expect(rig.keys).toEqual(['s', 'south'])
    expect(rig.wakes()).toBe(2)
    rig.stop()
})

test('an uncapped body runs for every key, which is what the cap is against', async () => {
    const rig = searchRig({})
    await typeInto(rig.region, ['s', 'so', 'sou', 'south'])
    await sleep(450)
    flushSync()
    expect(rig.keys).toEqual(['s', 'so', 'sou', 'south'])
    expect(rig.wakes()).toBe(4)
    rig.stop()
})

// A LOAD THAT FAILS IS A PROBE MOVING AND NO VALUE MOVING, which is the one edge the
// failure path did not open. Going loading opens a probe cascade; the rejection that ends
// it opened only the VALUE one — and a spinner that read `s.busy()` alone is not a reader
// of the value, so it never woke. It stayed up for the life of the page with the refusal
// sitting right there, and nothing about any value the page shows says so.
//
// `s.error` IS A PROBE by the rulebook's own term (3.3), and it subscribed to nothing at
// all: `error()` read the field and registered no edge, so `{#if s.error()}` answered once
// and never again.
//
// THE REVERT is dropping `probesMoved(cell)` from `absorb`'s rejection arm: the first
// guard stops at one run and reports busy forever. Dropping `trackProbe` from `error()`
// instead leaves the second at `[undefined]`.
test('a failed load wakes the guards that asked about it', async () => {
    let refuse: ((reason: unknown) => void) | undefined
    const load = reactive(
        () =>
            new Promise<number>((_settle, reject) => {
                refuse = reject
            }),
    )
    const busySeen: boolean[] = []
    const errorSeen: (string | undefined)[] = []
    const stopBusy = watch(() => {
        busySeen.push(load.busy())
    })
    const stopError = watch(() => {
        errorSeen.push((load.error() as Error | undefined)?.message)
    })
    expect(busySeen).toEqual([true])

    refuse?.(new Error('boom'))
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
    expect(busySeen).toEqual([true, false])
    expect(errorSeen).toEqual([undefined, 'boom'])
    stopBusy()
    stopError()
})

// 11.12 IS ABOUT WHAT A BODY HANDS BACK, so a run that hands back something else is not
// adopting any more. The mirror outlived the recompute that ended it: the outer served the
// figure its body computed until the inner value produced, and then served the INNER's
// value — one its own body had not computed and its source list does not reach.
//
// THE REVERT is dropping the `dropAdoption` arm in `run`: the last assertion reads 5.
test('a body that stops handing back a Reactive stops mirroring it', () => {
    const inner = reactive(1)
    const adopting = reactive(true)
    const outer = reactive(() => (adopting() ? inner : 99))
    expect(outer()).toBe(1)

    adopting.set(false)
    expect(outer()).toBe(99)
    inner.set(5)
    flushSync()
    expect(outer()).toBe(99)
    // And the floor is its own again: it was reporting through a value it no longer reads.
    expect(outer.ready()).toBe(true)
})

// 12.3's NARROWED FORM IS UNTRACKED, and being given its sources is only half of that: the
// effect still RUNS wherever it was reached from. Opened inside a tracked body — a `watch`,
// or a `reactive` body — its reads were attributed to that outer reader, which then re-ran
// on a value it had never read. Nothing about either value says so; the outer just runs
// twice as often as its own body justifies.
//
// THE REVERT is dropping the `TRACKING.reader = null` pair in `watchOver`: the outer runs
// a second time.
test('a narrowed watch runs untracked inside a tracked body', () => {
    const read = reactive(1)
    const untouched = reactive(10)
    let outerRuns = 0
    const stop = watch(() => {
        outerRuns += 1
        read()
        untouched.watch(() => {
            untouched()
        })
    })
    expect(outerRuns).toBe(1)
    untouched.set(11)
    flushSync()
    expect(outerRuns).toBe(1)
    stop()
})

// ONE POSITION, TWO FACES. 2.5 has a cursor replay from where it was opened, and the sync
// face of the same `Tail` answered from a DEPTH captured when `tail()` was called — so a
// production landing between the call and the walk slid the window forward: the two faces
// of one object replayed different productions, the sync one dropping a production its own
// position says to hand over and including one that landed after the call.
//
// THE REVERT is indexing the window from the ring's end by that captured depth rather than
// from the ordinal: the sync face reads ['b', 'c'].
test('both faces of one tail answer from the same position', async () => {
    const room = reactive<string>(undefined, { history: 9 })
    room.publish('a')
    room.publish('b')
    const held = room.history(2)
    room.publish('c')
    expect([...held]).toEqual(['a', 'b', 'c'])
    expect(await take(held, 3)).toEqual(['a', 'b', 'c'])
})

// A CONSUMER MAY ASK TWICE BEFORE EITHER ANSWER ARRIVES. `for await` asks one turn at a
// time, which is why one resolver slot passed every test here — and a second `next()`
// overwrote the first's resolver, so that promise never settled at all. A `Promise.all`
// over two turns hung with the productions already retained.
//
// THE REVERT is replacing the queue in `openCursor` with a single `settle` slot: this test
// times out rather than failing.
test('two turns asked for before either lands are both answered', async () => {
    const room = reactive<string>(undefined, { history: 9 })
    const cursor = room.history(0)[Symbol.asyncIterator]()
    const first = cursor.next()
    const second = cursor.next()
    room.publish('a')
    room.publish('b')
    expect([(await first).value, (await second).value]).toEqual(['a', 'b'])
    await cursor.return?.()
})

// AND A TURN OUTSTANDING WHILE A PRODUCTION IS ALREADY RETAINED, which the test above
// cannot reach: it asks both turns before anything is published, so the first `next()`
// finds the cursor caught up and both go on the queue in order whatever the guard does.
// A cursor's reader is an EFFECT and is drained at the end of the turn, so a `publish`
// between the two `next()` calls leaves the first resolver still queued with its
// production already in the ring — and a `next()` that reads the ring there hands the
// LATER caller the EARLIER production.
//
// THE REVERT is dropping the `waiting.length === 0` test in `Cursor.next`: the two turns
// come back transposed, `second` holding 'a' and `first` holding 'b'.
test('a turn outstanding is answered before a later one takes from the ring', async () => {
    const room = reactive<string>(undefined, { history: 9 })
    const cursor = room.history(0)[Symbol.asyncIterator]()
    const first = cursor.next()
    room.publish('a')
    const second = cursor.next()
    room.publish('b')
    expect([(await first).value, (await second).value]).toEqual(['a', 'b'])
    await cursor.return?.()
})

// ── `ttl`: the life of a production (RULEBOOK 6.4 through 6.12) ──────────────────────

// A CLOCK READ IS WHAT AN EXPIRY COSTS, and counting them is the only assertion that can
// tell the mechanism from a no-op branch — the value reads the same either way. It is a
// performance contract rather than a tidiness one: `Date.now()` is several times a read of
// an already-served value, and the design has one read per template slot per row.
function clockReads(during: () => void): number {
    const realNow = Date.now
    let asked = 0
    Date.now = (): number => {
        asked += 1
        return realNow.call(Date)
    }
    try {
        during()
    } finally {
        Date.now = realNow
    }
    return asked
}

function timersArmed(during: () => void): number {
    const realSetTimeout = globalThis.setTimeout
    let armed = 0
    globalThis.setTimeout = ((
        handler: () => void,
        ms?: number,
    ): ReturnType<typeof setTimeout> => {
        armed += 1
        return realSetTimeout(handler, ms)
    }) as typeof globalThis.setTimeout
    try {
        during()
    } finally {
        globalThis.setTimeout = realSetTimeout
    }
    return armed
}

// THE REVERT: hoisting `Date.now()` out of the `expiry === null` test in `produce` — the
// spelling that reads as tidier, one clock read per production instead of a branch —
// reports 200 clock reads against 0. Two hundred rather than one hundred because the
// derived value's recompute is a production too, which is the point: the cost is per
// production in the graph, not per write an app makes.
test('a value that declares no ttl never asks what time it is', () => {
    const source = reactive(1)
    const derived = reactive(() => source() + 1)
    const asked = clockReads(() => {
        for (let index = 0; index < 100; index += 1) {
            source.set(index)
            derived()
        }
    })
    expect(`clock reads: ${asked}`).toBe('clock reads: 0')
})

// 6.8, AND IT IS AN ALLOCATION CLAIM AS MUCH AS A BEHAVIOUR ONE. A plain state's contents
// are what the app put there, so `ttl` on one does not merely answer the same — it builds
// no record, arms no timer and leaves `direct` alone, which is what keeps the clock off
// the read. Asserting the value survived would pass against a branch that expired it and
// had nothing to reload with.
//
// WHAT THE REVERT MOVES IS `direct`, NOT THE CLOCK, and the first spelling of this gate
// asserted the clock alone and passed with the mechanism out — a plain state is guarded
// twice over, by `expiryFor` here and by `expire`'s own test for a body, so dropping one
// of them still reaches no `Date.now()` on a read. What it does reach is `readIndirect`,
// on every read, for the life of the value.
//
// THE REVERT: dropping the `hasProducer` term from `expiryFor` reports `direct: false`
// against `direct: true`, and 1 clock read against 0.
test('ttl is inert on a value with no producer', () => {
    let held = reactive<number>(41, { ttl: 1 })
    const asked = clockReads(() => {
        held = reactive<number>(41, { ttl: 1 })
        held()
        held.peek()
    })
    expect(`clock reads: ${asked}`).toBe('clock reads: 0')
    // 6.8 is a claim about the READ PATH: a value with nothing to reload with must not
    // pay for a mechanism that could only ever answer "still 41".
    expect(`direct: ${cellOf<{ direct: boolean }>(held).direct}`).toBe(
        'direct: true',
    )
    const realNow = Date.now()
    setSystemTime(new Date(realNow + 60_000))
    try {
        expect(held()).toBe(41)
        expect(held.ready()).toBe(true)
    } finally {
        setSystemTime()
    }
})

// 6.11 AND 6.12 TOGETHER, which is what the user's ruling decided: past its `ttl` the
// held value is not served, and the producer is what answers instead. A SYNCHRONOUS body
// lands inside the read, so the expiry is never observable as an absence here — the read
// returns the new value rather than refusing.
//
// The clock is moved rather than slept through, which is what isolates the READ's half:
// `setSystemTime` does not move `setTimeout`, so 6.9's timer provably cannot have fired
// and nothing but `readIndirect` can have noticed.
//
// THE REVERT: removing the `expire` call from `readIndirect` reports 'first' against
// 'second', the producer never having been asked again.
test('a read past the ttl runs the producer instead of serving the cache', () => {
    let runs = 0
    let answer = 'first'
    const loaded = reactive(
        () => {
            runs += 1
            return answer
        },
        { ttl: 1_000 },
    )
    expect(loaded()).toBe('first')
    expect(loaded()).toBe('first')
    expect(`runs: ${runs}`).toBe('runs: 1')
    answer = 'second'
    const realNow = Date.now()
    setSystemTime(new Date(realNow + 1_001))
    try {
        expect(loaded()).toBe('second')
        expect(`runs: ${runs}`).toBe('runs: 2')
        // And the production that just landed restarts the life rather than leaving every
        // read after it expired.
        expect(loaded()).toBe('second')
        expect(`runs: ${runs}`).toBe('runs: 2')
    } finally {
        setSystemTime()
    }
})

// AN INFINITE RELOAD RATHER THAN A STALE READ, which is why it is a run count and not a
// value assertion — the value is right on every one of these reads and the producer is
// being called on every one of them.
//
// 6.13 IS WHAT MAKES IT SAFE, and it was not always: while an expiry only stopped the
// value being SERVED, a producer revalidating to the value already held minted nothing
// (5.2), so the deadline stayed at the previous production's and the next read expired
// again. Releasing the production clears `landed`, so there is nothing for the identity
// gate to collapse against and the reload is a real production that moves the deadline.
//
// THE REVERT: removing `expiry.at = mintedAt` from `produce` reports 4 runs against 2 —
// the reload lands but the deadline stays where it was, so the read after it expires
// again, and the one after that.
test('a producer that revalidates to the same value restarts the life', () => {
    let runs = 0
    const loaded = reactive(
        () => {
            runs += 1
            return 'steady'
        },
        { ttl: 1_000 },
    )
    expect(`runs: ${runs}`).toBe('runs: 1')
    const realNow = Date.now()
    setSystemTime(new Date(realNow + 1_001))
    try {
        expect(loaded()).toBe('steady')
        expect(`runs: ${runs}`).toBe('runs: 2')
        // The reload confirmed what was held, so the life restarts here — these two reads
        // are inside the new window and must call nothing.
        expect(loaded()).toBe('steady')
        expect(loaded()).toBe('steady')
        expect(`runs: ${runs}`).toBe('runs: 2')
    } finally {
        setSystemTime()
    }
})

// 1.7 AND 6.12 AFTER THE TIMER HAS DROPPED THE PRODUCTION: awaiting is reaching, and nothing is
// served and nothing is loading, so an await that starts no reload waits on a probe nothing moves.
//
// THE REVERT: removing the `expire` call from `settled` reports 'hung' with 1 run.
test('an await after the ttl dropped the production reloads it', async () => {
    let runs = 0
    const loaded = reactive(
        async () => {
            runs += 1
            return runs
        },
        { ttl: 20 },
    )
    expect(await loaded).toBe(1)
    await Bun.sleep(60)
    const answer = await Promise.race([
        loaded.then((value) => `loaded ${value}`),
        Bun.sleep(300).then(() => 'hung'),
    ])
    expect(`${answer} with ${runs} runs`).toBe('loaded 2 with 2 runs')
})

// 6.5 ON THE RING, with the timer deliberately out of reach — a `ttl` of a minute cannot
// fire inside this test, so what drops the productions is the read and nothing else.
// 6.9's timer is the common path and this is the backstop it needs: a clamped background
// tab or a blocked loop is a late fire, and the clause is about the READ.
//
// THE REVERT: removing the sweep from the `tail` member reports ['a', 'b', 'c'] against
// ['c'].
test('an expired production is dropped from the ring on the read that follows', () => {
    const room = reactive<string>(undefined, { history: 9, ttl: 60_000 })
    room.publish('a')
    room.publish('b')
    expect([...room.history()]).toEqual(['a', 'b'])
    const realNow = Date.now()
    setSystemTime(new Date(realNow + 60_001))
    try {
        room.publish('c')
        // `a` and `b` are past their life and `c` is not, and a read is what notices.
        expect([...room.history()]).toEqual(['c'])
        // 2.5: the LATEST production is what a read answers, whatever the retention did.
        expect(room()).toBe('c')
    } finally {
        setSystemTime()
    }
})

// 6.8: ON A VALUE WITH NO PRODUCER A DEADLINE REACHES THE PAST ALONE. What was published last is
// still served, so it is still what a cursor replays — a chat keeping an hour of messages keeps the
// latest however old it is.
//
// THE REVERT is `standingKept` answering 0: `retained: ` with nothing after it.
test('ttl on a value with no producer expires past productions and keeps the standing one', () => {
    const room = reactive<string>(undefined, { history: 9, ttl: 60_000 })
    room.publish('a')
    room.publish('b')
    const realNow = Date.now()
    setSystemTime(new Date(realNow + 60_001))
    try {
        expect(`retained: ${[...room.history()].join(',')}`).toBe('retained: b')
        expect(room()).toBe('b')
    } finally {
        setSystemTime()
    }
})

// 6.4, AND IT IS THE CLAIM A CORRECTNESS TEST CANNOT SEE: the room reads as `b` either
// way. A production falling out of retention is not something a reader is looking at —
// 2.5 puts everything before the latest behind `s.history` — so waking on it is a `.data`
// write per subscriber for a change none of them can observe.
//
// THE REVERT is structural: adding `cascade(cell)` to `dropExpired` reports 1 wake
// against 0.
test('an expiry wakes no reader', async () => {
    const room = reactive<string>(undefined, { history: 9, ttl: 20 })
    room.publish('a')
    room.publish('b')
    const counter = wakes(room)
    // Past the life of both, with the ring's own timer doing the dropping.
    await Bun.sleep(80)
    const woken = counter.count()
    counter.stop()
    expect(`wakes: ${woken}`).toBe('wakes: 0')
    // And it really did drop `a`, or the wake count above is zero for the wrong reason — `b` is
    // standing, and a value with no producer keeps that one (6.8).
    expect([...room.history()]).toEqual(['b'])
})

// 6.6 AND 6.9 ARE ONE MECHANISM SEEN TWICE: one timer for the ring, armed at the head,
// re-armed by its own fire. A timer per retained production is the obvious spelling and
// the one the clause exists to refuse — at `history: 500` it is 500 live timers per value,
// and the ring is the thing that already knows which is oldest.
//
// THE REVERT: arming inside the ring push rather than behind `expiry.timer === null`
// reports 40 timers against 1.
test('a ring holds one expiry timer however many productions it takes', () => {
    const armed = timersArmed(() => {
        const room = reactive<number>(undefined, { history: 19, ttl: 60_000 })
        for (let index = 0; index < 40; index += 1) room.publish(index)
    })
    expect(`timers: ${armed}`).toBe('timers: 1')
})

// 6.10. A room with a minute of retention left behind on a script that has finished is a
// process that does not exit, and a `ttl` is exactly the option an app declares on the
// long-lived ones. The browser half is inert — a number has no `unref` and a tab has no
// process to hold open — which is the uniform variant CLAUDE.md prefers to an exception.
test('an expiry timer does not hold the process open', () => {
    const realSetTimeout = globalThis.setTimeout
    let unreffed = 0
    globalThis.setTimeout = ((
        handler: () => void,
        ms?: number,
    ): ReturnType<typeof setTimeout> => {
        const timer = realSetTimeout(handler, ms)
        const held = timer as unknown as { unref: () => unknown }
        const realUnref = held.unref
        held.unref = (): unknown => {
            unreffed += 1
            return realUnref.call(timer)
        }
        return timer
    }) as typeof globalThis.setTimeout
    try {
        const room = reactive<string>(undefined, { history: 4, ttl: 60_000 })
        // Two, because the standing production of a value with no producer has no deadline (6.8).
        room.publish('a')
        room.publish('b')
    } finally {
        globalThis.setTimeout = realSetTimeout
    }
    expect(`unref calls: ${unreffed}`).toBe('unref calls: 1')
})

// 6.7, AND THE TURN COUNT IS THE WEAKER HALF OF IT. A caught-up cursor is parked on an
// unresolved `next()` and only a `notify` settles one, so the silence in `dropExpired`
// already covers it — and so does the ordinal, since an expiry moves no production. A
// gate on the turn count alone passes with the silence reverted, which is how this one
// was found to be worth nothing on its first spelling.
//
// WHAT AN EXPIRY CAN ACTUALLY CORRUPT IS THE POSITION. A cursor reads `ring[at -
// ringBase]`, so a trim that moves the ring without moving the base hands it a different
// production at the same ordinal — a gap or a repeat, which is precisely what 2.5 forbids
// and what a turn count cannot see.
//
// THE REVERT: dropping `ringed.ringBase += dropped` from `dropExpired` reports the cursor
// receiving `undefined` where it should receive 3.
test('a cursor across an expiry continues in order with no gap and no repeat', async () => {
    const room = reactive<number>(undefined, { history: 9, ttl: 20 })
    room.publish(1)
    room.publish(2)
    const cursor = room.history(10)[Symbol.asyncIterator]()
    expect((await cursor.next()).value).toBe(1)
    expect((await cursor.next()).value).toBe(2)
    // Caught up and parked, and the expiry takes `1` out of the ring underneath it.
    let turned = 0
    const parked = cursor.next().then((result) => {
        turned += 1
        return result
    })
    await Bun.sleep(80)
    expect(`turns: ${turned}`).toBe('turns: 0')
    expect([...room.history()]).toEqual([2])
    // The next turn is the next PRODUCTION, at the position the ordinal says, rather than
    // whatever the trim happened to leave at that index.
    room.publish(3)
    expect((await parked).value).toBe(3)
    await cursor.return?.()
})

// ── A keyed body does not track (RULEBOOK 14.4, 11.6, 11.23, 2.14) ─────────────────────

// 14.4 AND 11.6: AN ENTRY IS HELD, NOT DERIVED. It comes back through `ttl`, a trigger or
// eviction and through nothing else — so a value its body read changing leaves it alone. An
// entry is the answer to a call made with those args, and a call that re-issued itself
// whenever something it happened to read moved is a request per keystroke somewhere else.
//
// THE REVERT is `heldOnce` handing back the body unwrapped: `value: 30`, and the entry busy while
// the source it read reloads.
test('a keyed entry does not recompute when a value its body read changes', () => {
    const rate = reactive(2)
    let runs = 0
    const price = reactive((args: { amount: number }) => {
        runs += 1
        return args.amount * rate()
    })
    const entry = price({ amount: 10 })
    expect(entry()).toBe(20)
    rate.set(3)
    expect(`value: ${entry()}`).toBe('value: 20')
    expect(`runs: ${runs}`).toBe('runs: 1')
    entry.refresh()
    expect(`after refresh: ${entry()}`).toBe('after refresh: 30')
})

// 2.14 STILL HOLDS FOR AN ENTRY. An abort is not a completed run: the read that threw has
// subscribed, and that subscription is the only thing that brings the entry back when the value
// lands. What a keyed body gives up is the recompute AFTER it has an answer.
test('a keyed body aborted on a value that had not landed re-runs when it lands, and then holds', async () => {
    let settle: (value: number) => void = (): void => {}
    const rate = reactive(
        new Promise<number>((resolve) => {
            settle = resolve
        }),
    )
    let runs = 0
    const price = reactive((args: { amount: number }) => {
        runs += 1
        return args.amount * rate()
    })
    const entry = price({ amount: 10 })
    expect(`ready: ${entry.ready()}`).toBe('ready: false')
    settle(2)
    await rate
    expect(entry()).toBe(20)
    rate.set(5)
    expect(entry()).toBe(20)
    expect(`runs: ${runs}`).toBe('runs: 2')
})

// 11.23: AN ENTRY PROPAGATES NOTHING. Its floor is its own — a source it read going busy is not
// a load of this entry's, because nothing about this entry will be recomputed from it.
test('a keyed entry is not busy because a value its body read is', async () => {
    let answer = 1
    const source = reactive(() => Promise.resolve(answer))
    await source
    const keyed = reactive((args: { times: number }) => source() * args.times)
    const entry = keyed({ times: 3 })
    expect(entry()).toBe(3)
    answer = 2
    source.refresh()
    expect(`source busy: ${source.busy()}`).toBe('source busy: true')
    expect(`entry busy: ${entry.busy()}`).toBe('entry busy: false')
})

// ── `args`: the gate on a keyed value's args (RULEBOOK 9.9, 11.26, 11.28, 11.41, 11.42) ──

// THE BODY IS WHERE THE PRIVILEGED CALL IS, so a refused `Args` must never reach it — and the
// refusal is still an ENTRY, under the key taken before the gate ran (11.26), so a second reach
// of the same bad args joins it rather than refusing again (1.8).
//
// THE REVERT is building entries from the ungated body: `body runs: 1` and nothing refused.
test('an args gate refuses before the body runs, and the refusal is the entry for that key', () => {
    let runs = 0
    const invoice = reactive(
        (args: { id: number }) => {
            runs += 1
            return args.id * 2
        },
        {
            args: (value: unknown) => {
                if ((value as { id: number }).id < 0)
                    throw new Error('id must not be negative')
                return value as { id: number }
            },
        },
    )
    const refused = invoice({ id: -1 })
    expect(`body runs: ${runs}`).toBe('body runs: 0')
    expect(`error: ${(refused.error() as unknown as Error).name}`).toBe(
        'error: ValidationError',
    )
    let thrown: unknown
    try {
        refused()
    } catch (error) {
        thrown = error
    }
    expect(`read threw: ${(thrown as Error).name}`).toBe(
        'read threw: ValidationError',
    )
    expect(invoice({ id: -1 })).toBe(refused)
    expect(invoice({ id: 4 })()).toBe(8)
})

// 11.28 AND 11.69: THE GATE DOES NOT DECIDE THE ENTRY, AND THE BODY GETS WHAT IT RETURNED. Two
// args the gate would normalise to one are still two keys, and each body sees the normalised form.
//
// THE REVERT is handing the body the args the caller sent: `body saw: string`.
test("an args gate that normalises decides the body's args but not the entry", () => {
    const seen: string[] = []
    const keyed = reactive(
        (args: { id: string | number }) => {
            seen.push(typeof args.id)
            return args.id
        },
        {
            args: (value: unknown): { id: string | number } => ({
                id: Number((value as { id: string }).id),
            }),
        },
    )
    keyed({ id: '7' })
    keyed({ id: 7 })
    expect(`body saw: ${seen[0]}`).toBe('body saw: number')
    expect(`entries: ${keyed.entries.size}`).toBe('entries: 2')
})

// 11.42 AT CONSTRUCTION. The clause asks for a compile error and the checker cannot raise one —
// `() => 1` is assignable to the keyed overload's body, so the call type-checks as keyed — so
// the refusal lands on the first moment there is, naming the value, the way 5.14's does. What
// it stops is a gate that silently gates nothing.
//
// THE REVERT is dropping the `args` test from `createReactive`: the refusal is `undefined`.
test('args on a value with no parameter refuses at construction', () => {
    let refusal: unknown
    try {
        reactive(() => 1, { args: (value: unknown) => value } as never)
    } catch (thrown) {
        refusal = thrown
    }
    expect(`${(refusal as Error | undefined)?.message}`).toContain(
        'declares args with no parameter to gate',
    )
})

// A GATED STREAM IS STILL A STREAM. The stream is declared by the body's kind (9.20), so a gate
// wrapping the body in a plain function would quietly make every gated stream a value holding a
// generator.
//
// THE REVERT is `gated` wrapping every body in a plain function: `eu()` is the generator object
// rather than `['eu-1']`.
test('an args gate on a keyed stream keeps it a stream, and refuses before it starts', async () => {
    let started = 0
    const rows = reactive(
        async function* (args: { region: string }) {
            started += 1
            yield `${args.region}-1`
        },
        {
            args: (value: unknown) => {
                if ((value as { region: string }).region === '')
                    throw new Error('no region')
                return value as { region: string }
            },
        },
    )
    const eu = rows({ region: 'eu' })
    await turns()
    expect(eu()).toEqual(['eu-1'])
    const none = rows({ region: '' })
    await turns()
    expect(`started: ${started}`).toBe('started: 1')
    expect(`error: ${(none.error() as unknown as Error).name}`).toBe(
        'error: ValidationError',
    )
})

// 11.46: A KEYED `ttl` IS THE LIFE OF AN ENTRY, evicted whole with its ring, and the
// next reach of that key starts the work again from nothing. It is NOT the unkeyed
// mechanism forwarded down — that would expire productions INSIDE an entry the clause says
// should have been dropped, and leave the map holding every key ever reached.
//
// THE REVERT is forwarding `ttl` to `createReactive` in place of the lifetime: the entry
// carries an expiry of its own, which is the first assertion to fail, and past the deadline
// the map still reports `entries: 1`.
test('a keyed entry past its ttl is evicted whole, and the next reach starts again', async () => {
    let runs = 0
    const keyed = reactive(
        (args: { id: number }) => {
            runs += 1
            return args.id * 10
        },
        { ttl: 20 },
    )
    const first = keyed({ id: 1 })
    expect(first()).toBe(10)
    expect(cellOf<{ expiry: unknown }>(first).expiry).toBeNull()
    expect(keyed.entries.size).toBe(1)

    await Bun.sleep(80)
    expect(`entries: ${keyed.entries.size}`).toBe('entries: 0')
    expect(keyed({ id: 1 })).not.toBe(first)
    expect(`runs: ${runs}`).toBe('runs: 2')
})

// 11.70 — A LOAD IN FLIGHT OUTLIVES ITS TTL, AND ITS END STARTS THE LIFE AGAIN, however it ends. A
// reload that lands the value it already held makes no production, so only the probe edge hears it
// end; a load that fails leaves nothing to serve. THE REVERTS: drop `trackProbe` in
// `Lifetime.follow` and the equal landing reads `entries: 1` for good; drop the `!cell.loading`
// arm of its `notify` and so does the failure.
test('a keyed entry is kept while its load is in flight, and lives a ttl from its end — 11.70', async () => {
    let finish = (_: number): void => {}
    let loads = 0
    const equal = reactive(
        async (_args: { id: number }) => {
            loads += 1
            if (loads === 1) return 5
            return new Promise<number>((done) => {
                finish = done
            })
        },
        { ttl: 30 },
    )
    const entry = equal({ id: 1 })
    await entry
    entry.refresh()
    await Bun.sleep(60)
    expect(`in flight: ${equal.entries.size}`).toBe('in flight: 1')
    finish(5)
    await Bun.sleep(10)
    expect(`just landed: ${equal.entries.size}`).toBe('just landed: 1')
    await Bun.sleep(60)
    expect(`landed equal: ${equal.entries.size}`).toBe('landed equal: 0')

    let fail = (_: Error): void => {}
    const failing = reactive(
        (_args: { id: number }) =>
            new Promise<number>((_done, reject) => {
                fail = reject
            }),
        { ttl: 30 },
    )
    failing({ id: 1 }).catch(() => {})
    await Bun.sleep(60)
    expect(`in flight: ${failing.entries.size}`).toBe('in flight: 1')
    fail(new Error('down'))
    await Bun.sleep(10)
    expect(`just failed: ${failing.entries.size}`).toBe('just failed: 1')
    await Bun.sleep(60)
    expect(`failed: ${failing.entries.size}`).toBe('failed: 0')
})

// 11.50: A PRODUCTION MOVES AN ENTRY TO THE NEWEST POSITION, so a key that keeps producing
// outlives one reached at the same moment and left alone. The margins are wide because
// the deadlines are timers: `b` has been dead for 30 ms at the check and `a` has 30 ms left.
//
// THE REVERT is `touch` ignoring productions after the first: `a: false`.
test('an entry that produces takes the newest position and outlives one that does not', async () => {
    const keyed = reactive((args: { id: string }) => reactive(args.id), {
        ttl: 100,
    })
    const a = keyed({ id: 'a' })
    keyed({ id: 'b' })
    await Bun.sleep(60)
    a.set('a again')
    await Bun.sleep(70)
    expect(`a: ${keyed.entries.has('{"id":"a"}')}`).toBe('a: true')
    expect(`b: ${keyed.entries.has('{"id":"b"}')}`).toBe('b: false')
    await Bun.sleep(80)
    expect(`entries: ${keyed.entries.size}`).toBe('entries: 0')
})

// 11.49: ONE TIMER FOR THE WHOLE KEYED FACE, armed at the oldest entry. A timer per entry
// is a `setTimeout` per key a list reaches — per row — and every production would re-arm
// its own. The count is the claim; the eviction above cannot tell the two apart.
//
// THE REVERT is arming in `touch` without the `timer !== null` test: `timers armed: 50`.
test('a keyed ttl holds one timer however many entries it reaches', () => {
    const realSetTimeout = globalThis.setTimeout
    let armed = 0
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
        armed += 1
        return realSetTimeout(...args)
    }) as typeof setTimeout
    try {
        const keyed = reactive((args: { id: number }) => args.id, {
            ttl: 60_000,
        })
        for (let id = 0; id < 50; id += 1) keyed({ id })
    } finally {
        globalThis.setTimeout = realSetTimeout
    }
    expect(`timers armed: ${armed}`).toBe('timers armed: 1')
})

// 6.13, 6.14 AND 6.15 — WHAT THE DEADLINE ITSELF DOES, and all three are about a moment
// nothing reads. The producer must NOT have been called (that is 6.12's job, on the read
// that follows), the payload must be gone rather than merely unserved, and the two probes
// must agree with each other: nothing to serve, and nothing in flight to wait for.
//
// SLEPT THROUGH RATHER THAN CLOCK-MOVED, which is the opposite of the read gate above:
// what is under test here is the timer, so it has to actually fire.
//
// THE REVERT: dropping the `dropStanding` call from `sweepExpiry` reports
// `ready=true busy=false released=false` against `ready=false busy=false released=true`.
test('a deadline releases the value and starts nothing', async () => {
    let runs = 0
    const loaded = reactive(
        () => {
            runs += 1
            return { big: 'payload' }
        },
        { ttl: 20 },
    )
    expect(loaded.ready()).toBe(true)
    await Bun.sleep(80)
    // Read NOTHING before the probes: a read is what runs the producer, so touching the
    // value here would measure 6.12 and report it as 6.14.
    const ready = loaded.ready()
    const busy = loaded.busy()
    const released =
        (loaded as unknown as { value: unknown }).value === undefined
    expect(`ready=${ready} busy=${busy} released=${released}`).toBe(
        'ready=false busy=false released=true',
    )
    // 6.4 again, and it is the clause that makes the rest of this shape hold: waking here
    // would cause the read that runs the producer, and every `ttl` value in the design
    // would reload on its deadline whether or not anything wanted it.
    expect(`runs: ${runs}`).toBe('runs: 1')
    // 6.12: and now the read calls it.
    expect(loaded()).toEqual({ big: 'payload' })
    expect(`runs: ${runs}`).toBe('runs: 2')
})

// A DERIVED VALUE IS NO BETTER THAN WHAT IT WAS BUILT FROM, and 6.13 is what makes that
// free here: the drop moves `servable`, which is the field `walkReady` already reads. No
// clock enters the probe walk, which is what the alternative — testing the deadline per
// node — would have cost every graph in the design whether or not it declared a `ttl`.
test('a source past its ttl makes what derives from it unready', async () => {
    const source = reactive(() => 2, { ttl: 20 })
    const derived = reactive(() => source() * 3)
    expect(derived()).toBe(6)
    expect(derived.ready()).toBe(true)
    await Bun.sleep(80)
    expect(`derived ready: ${derived.ready()}`).toBe('derived ready: false')
    expect(`derived busy: ${derived.busy()}`).toBe('derived busy: false')
})

// A WRITE LANDING ON A RELEASED VALUE, which is the one path `expire` cannot clean up
// after itself: the timer released the production and marked the value as waiting for a
// producer, and then a `set` answered the question instead. Without the clear in
// `produce` the mark survives the write, and the next read calls the body anyway —
// discarding what was just written and reporting it as a reload.
//
// THE REVERT: removing `expiry.dropped = false` from `produce` reports 2 runs against 1.
test('a write landing on a released value stops the read reloading', async () => {
    let runs = 0
    const loaded = reactive(
        () => {
            runs += 1
            return 'from the body'
        },
        { ttl: 20 },
    )
    await Bun.sleep(80)
    // The deadline released it; a write answers before any read does.
    loaded.set('from the app')
    expect(loaded()).toBe('from the app')
    expect(`runs: ${runs}`).toBe('runs: 1')
})

// ── `servable` implies `landed`, the invariant nothing was checking ──────────────────

// THE LADDER THE READ PATH IS BUILT ON. `servable` says a read may answer with the held value,
// and `direct` caches `state === CLEAN && servable` on top of it — which is what makes a read
// one load and one branch. The sites that move the two fields do it by hand.
//
// IT FAILS SILENTLY, which is why it is a gate and not a comment. A site that releases the
// value and forgets `servable` leaves `s.ready()` answering true and `readIndirect` handing
// back `undefined` as though it were a production — a plausible value, with nothing throwing.
//
// WALKED RATHER THAN ENUMERATED. The transitions that exist today could be listed, and
// then the next one — the one this is for — would not be in the list. A sequence over the
// public surface reaches whatever paths exist, so a transition added later is covered by
// the operation that reaches it rather than by somebody remembering to extend a table.
//
// WHAT IT CANNOT SEE IS A STATE THAT DOES NOT SURVIVE ITS OWN OPERATION, and 6.13's is
// one: the read that discovers an expiry runs the producer in the same frame (6.12), so
// between two operations the value has always been put back. Removing `servable = false`
// from `dropStanding` passes this walk for that reason. The gate under it is where that
// transition is checked, and the split is the honest one rather than a slower fuzz that
// would have to sleep through a timer on every step.
function breachedBy(value: unknown): string | null {
    const cell = cellOf<{ landed: boolean; servable: boolean }>(value)
    if (!cell.servable || cell.landed) return null
    return `servable=${cell.servable} landed=${cell.landed}`
}

// Seeded so a failure names a reproducible sequence rather than one that has gone by the
// time it is read. xorshift32, which is four operations and needs no dependency.
function sequence(seed: number): () => number {
    let state = seed
    return (): number => {
        state ^= state << 13
        state ^= state >>> 17
        state ^= state << 5
        state >>>= 0
        return state
    }
}

// WHAT AN OPERATION'S OWN CLAUSE LETS IT DO SILENTLY, and nothing else is let off. 7.14 has an
// invalidate wake no guard, which goes on showing what it showed until the next hit. 5.7 has a patch
// mint over the same object, and an ungated publish mints a repeat,
// so a reader woken onto the value it already held is the clause working. 6.4 has an expiry wake
// no reader, so one holding the released production until the reload lands is the clause too.
type Allows =
    | 'a guard stands until the next hit'
    | 'the same value wakes'
    | 'an expiry wakes no reader'

type Subject = {
    name: string
    value: Reactive<unknown>
    ops: { op: () => void; allows?: Allows | Allows[] }[]
}

// THE VALUES BOTH WALKS TAKE, built fresh per walk. Every arm `run` has, the adoption arms, a
// retained value, and a `ttl` value both settled and loading — the loading one is the only way to
// a reload that starts from the read path and is not over by the end of the operation.
function walkSubjects(): Subject[] {
    const source = reactive(1)
    const unlanded = reactive(new Promise<number>(() => {}))
    let abortNow = false
    let failNow = false
    let adoptNow = false
    // Adopting something that has nothing to serve is 11.16's branch, and it is the only
    // adoption arm that LEAVES the adopting value unservable — adopting a settled one puts
    // it back inside the same operation, which is why adopting `source` cannot reach it.
    let adoptPendingNow = false
    let refuseNow = false
    let rejectNow = false

    const plain = reactive({ n: 1 })
    // The body reaches every arm `run` has: a production, the abort (11.53), a refusal,
    // and an adoption whose source stops being servable (11.16).
    const derived = reactive(() => {
        if (abortNow) return unlanded()
        if (failNow) throw new Error('refused')
        // 15.5: a refusal handed back rather than thrown, which `run` lands on its own arm.
        if (refuseNow) return refuse.named('Refused')() as unknown as number
        if (adoptPendingNow) return unlanded
        if (adoptNow) return source
        return source() + 1
    })
    const room = reactive<number>(undefined, { history: 3 })
    // 6.13's transition, reached through the read rather than the timer so the walk stays
    // contention-immune and runs in the parallel gate (CLAUDE.md, "counts run in bun test").
    let ttlRuns = 0
    const expiring = reactive(
        () => {
            ttlRuns += 1
            return { at: ttlRuns }
        },
        { ttl: 1_000 },
    )
    let loadRuns = 0
    const reloading = reactive(
        () => {
            loadRuns += 1
            return rejectNow
                ? Promise.reject(new Error('reload refused'))
                : Promise.resolve({ at: loadRuns })
        },
        { ttl: 1_000 },
    )
    const expireThenRead = (value: Reactive<unknown>) => (): void => {
        const now = Date.now()
        setSystemTime(new Date(now + 1_001))
        try {
            value.peek()
        } finally {
            setSystemTime()
        }
    }
    // 7.14: the mark wakes no guard, so a guard shows the probes from before it until the next hit
    // — and the walk's own probe IS a hit (3.2), which starts the reload the guard has not heard of.
    const invalidate = (value: Reactive<unknown>) => ({
        op: () => value.invalidate(),
        allows: [
            'a guard stands until the next hit',
            'the same value wakes',
        ] as Allows[],
    })

    return [
        {
            name: 'a value',
            value: plain as Reactive<unknown>,
            ops: [
                { op: () => plain.set({ n: 2 }) },
                { op: () => plain.publish({ n: 2 }) },
                {
                    op: () =>
                        plain.patch((held) => {
                            held.n += 1
                        }),
                    allows: 'the same value wakes',
                },
                invalidate(plain as Reactive<unknown>),
                { op: () => plain.refresh() },
            ],
        },
        {
            name: 'a body',
            value: derived as Reactive<unknown>,
            ops: [
                { op: () => source.set(source.peek() === 1 ? 2 : 1) },
                invalidate(derived as Reactive<unknown>),
                { op: () => derived.refresh() },
                { op: () => derived.set(99) },
                {
                    op: () => {
                        abortNow = !abortNow
                        derived.refresh()
                    },
                },
                {
                    op: () => {
                        failNow = !failNow
                        derived.refresh()
                    },
                },
                {
                    op: () => {
                        adoptNow = !adoptNow
                        derived.refresh()
                    },
                },
                {
                    op: () => {
                        refuseNow = !refuseNow
                        derived.refresh()
                    },
                },
                {
                    op: () => {
                        adoptPendingNow = !adoptPendingNow
                        derived.refresh()
                    },
                },
                { op: () => source.invalidate() },
            ],
        },
        {
            name: 'a room',
            value: room as Reactive<unknown>,
            ops: [
                { op: () => room.publish(1), allows: 'the same value wakes' },
                { op: () => room.publish(2), allows: 'the same value wakes' },
                invalidate(room as Reactive<unknown>),
            ],
        },
        {
            name: 'a ttl value',
            value: expiring as Reactive<unknown>,
            ops: [
                {
                    op: expireThenRead(expiring as Reactive<unknown>),
                    allows: 'an expiry wakes no reader',
                },
                invalidate(expiring as Reactive<unknown>),
                { op: () => expiring.refresh() },
            ],
        },
        {
            name: 'a ttl load',
            value: reloading as Reactive<unknown>,
            ops: [
                {
                    op: expireThenRead(reloading as Reactive<unknown>),
                    allows: 'an expiry wakes no reader',
                },
                invalidate(reloading as Reactive<unknown>),
                { op: () => reloading.refresh() },
                {
                    op: () => {
                        rejectNow = !rejectNow
                    },
                },
            ],
        },
    ]
}

function pick(
    subjects: Subject[],
    next: () => number,
): { subject: Subject; at: number } {
    const subject = subjects[next() % subjects.length] as Subject
    return { subject, at: next() % subject.ops.length }
}

// A read inside an op may refuse, which is the value working rather than a rule breaking — 2.2
// and 2.3 are what those throws are.
function attempt(op: () => void): void {
    try {
        op()
    } catch (thrown) {
        if (!(thrown instanceof Error)) throw thrown
    }
}

test('servable implies landed across every transition', async () => {
    const subjects = walkSubjects()
    const next = sequence(0x5eed)
    const walked: string[] = []
    for (let step = 0; step < 600; step += 1) {
        const { subject, at } = pick(subjects, next)
        walked.push(`${subject.name}[${at}]`)
        attempt((subject.ops[at] as Subject['ops'][0]).op)
        flushSync()
        for (const held of subjects) {
            const breach = breachedBy(held.value)
            if (breach !== null)
                throw new Error(
                    `${held.name} breached servable implies landed at step ${step} (${breach}). The sequence was: ${walked.slice(-8).join(' -> ')}`,
                )
        }
    }
    expect(`steps walked: ${walked.length}`).toBe('steps walked: 600')
})

// ── The wake contract, walked ──────────────────────────────────────────────────────────

// EVERY WAKE BUG THIS FILE HAS GATED WAS A DECISION MADE AT ONE SITE, and each was found by a
// test written after the fact for that site. What they break is one contract, stated at the
// public surface, so it can be walked rather than enumerated:
//
// A GUARD IS NEVER LEFT SHOWING A PROBE THAT HAS MOVED. A watch reading `busy`, `ready` and
// `error` must, once the turn is over, have last seen what they answer now (3.3). It is the
// OBSERVED state that is compared, never a wake count: `markProbes` wakes a guard it could have
// spared on purpose, and a count would call that a failure. The one move let off is the one a
// clause makes silent — an invalidate dropping `busy` (7.14, 7.16).
//
// A READER IS NEVER WOKEN ONTO WHAT IT ALREADY READ (5.1). A watch reading the value that re-runs
// and reads the same thing — the same identity, the same refusal, or not landed again — was woken
// for nothing, except where the operation's clause mints a repeat on purpose (5.7, an ungated
// publish), and where the operation settled a reload an invalidate left owing: 7.8 unserves
// ahead of that reload, and `reloadOwed` says why the order stands.
//
// A READER IS NEVER LEFT ON A READ THAT HAS MOVED. Over a value that is not being served, what the
// reader last read is what a read throws now — the standing refusal, or not landed.
//
// CHECKED TWICE A STEP: when the operation returns, which is where a load has STARTED and not yet
// ended — the only moment a missed `busy` edge is visible — and again once the loads it started
// have settled.
//
// THE REVERTS, each on its own: gating `refused`'s cascade on `landed` rather than `servable`,
// cascading unconditionally in either of `run`'s refusal arms, or setting `loading` in `expire`
// ahead of the reload — each walks to a named step and reports the rule, the subject and the
// sequence that reached it.
const NOT_LANDED = Symbol('not landed')
// What a reader has read before its first run, which no read can equal.
const NOT_READ = Symbol('not read')
// A reload an invalidate left owing — `Reactive.ts`'s `OWES_RELOAD`, which is not exported.
const OWES_RELOAD = 2

function readOf(value: Reactive<unknown>): unknown {
    try {
        return value()
    } catch (thrown) {
        return thrown instanceof NotLanded ? NOT_LANDED : thrown
    }
}

type Probes = { busy: boolean; ready: boolean; error: unknown }

function probesOf(value: Reactive<unknown>): Probes {
    return { busy: value.busy(), ready: value.ready(), error: value.error() }
}

test('the wake contract holds across every transition', async () => {
    const subjects = walkSubjects()
    const observers = subjects.map((subject) => {
        const seen = {
            probes: probesOf(subject.value),
            read: NOT_READ as unknown,
            repeats: 0,
        }
        const stops = [
            watch(() => {
                seen.probes = probesOf(subject.value)
            }),
            watch(() => {
                const read = readOf(subject.value)
                if (Object.is(read, seen.read)) seen.repeats += 1
                seen.read = read
            }),
        ]
        return { subject, seen, stops }
    })
    // What the construction started — the ttl load's first body — is over before the walk.
    for (let turn = 0; turn < 10; turn += 1) await null
    flushSync()

    const next = sequence(0x5eed)
    const walked: string[] = []
    const check = (
        step: number,
        when: string,
        allows: Set<Allows>,
        owner: Subject,
    ): void => {
        for (const { subject, seen } of observers) {
            const where = `${subject.name} at step ${step}, ${when}. The sequence was: ${walked.slice(-8).join(' -> ')}`
            const cell = cellOf<{
                direct: boolean
                state: number
                servable: boolean
                owes: number
            }>(subject.value)
            if (cell.direct && !(cell.state === CLEAN && cell.servable))
                throw new Error(`direct without CLEAN and servable: ${where}`)
            const now = probesOf(subject.value)
            if (
                subject === owner &&
                allows.has('a guard stands until the next hit')
            )
                seen.probes = now
            for (const probe of ['busy', 'ready', 'error'] as const)
                if (!Object.is(now[probe], seen.probes[probe]))
                    throw new Error(
                        `a guard still shows ${probe} ${String(seen.probes[probe])} where it is now ${String(now[probe])}: ${where}`,
                    )
            if (
                seen.repeats !== 0 &&
                !(subject === owner && allows.has('the same value wakes'))
            )
                throw new Error(
                    `a reader was woken onto the value it already read: ${where}`,
                )
            seen.repeats = 0
            // A READER IS NEVER LEFT ON A READ THAT HAS MOVED, told through the probe alone so the
            // check reads nothing that settles a debt or pulls a mark: where nothing is served and
            // nothing is owed or marked, a read throws the standing refusal, or not landed (2.2).
            if (
                !cell.servable &&
                cell.owes === 0 &&
                cell.state === CLEAN &&
                !(
                    subject === owner &&
                    (allows.has('an expiry wakes no reader') ||
                        allows.has('a guard stands until the next hit'))
                )
            ) {
                const error = subject.value.error()
                const throws = error === undefined ? NOT_LANDED : error
                if (!Object.is(seen.read, throws))
                    throw new Error(
                        `a reader still holds ${String(seen.read)} where a read now throws ${String(throws)}: ${where}`,
                    )
            }
        }
    }

    for (let step = 0; step < 600; step += 1) {
        const { subject, at } = pick(subjects, next)
        walked.push(`${subject.name}[${at}]`)
        const { op, allows: declared } = subject.ops[at] as Subject['ops'][0]
        const allows = new Set<Allows>()
        if (Array.isArray(declared))
            for (const each of declared) allows.add(each)
        else if (declared !== undefined) allows.add(declared)
        // `reloadOwed`'s stated cost, read off the record: the operation settles a reload an
        // invalidate left owing (`OWES_RELOAD`).
        if (cellOf<{ owes: number }>(subject.value).owes === OWES_RELOAD)
            allows.add('the same value wakes')
        attempt(op)
        flushSync()
        check(step, 'as the operation returns', allows, subject)
        for (let turn = 0; turn < 10; turn += 1) await null
        flushSync()
        check(step, 'once its loads settled', allows, subject)
    }
    for (const { stops } of observers) for (const stop of stops) stop()
    expect(`steps walked: ${walked.length}`).toBe('steps walked: 600')
})

// THE TRANSITION THE WALK ABOVE STRUCTURALLY CANNOT OBSERVE. Only 6.9's timer leaves a
// value sitting in the released state — every read that reaches it starts the producer on
// the way past — so this is the one place the three fields can be read while 6.13 holds.
//
// THE REVERT: removing `cell.servable = false` from `dropStanding` reports
// `servable=true landed=false`.
test('a released value still reads servable implies landed', async () => {
    const expiring = reactive(() => ({ n: 1 }), { ttl: 20 })
    expect(breachedBy(expiring)).toBeNull()
    await Bun.sleep(80)
    expect(`breach: ${breachedBy(expiring)}`).toBe('breach: null')
    // And it is genuinely sitting in the released state rather than having been put back
    // by something on the way here, or the line above holds for the wrong reason.
    expect(`ready: ${expiring.ready()}`).toBe('ready: false')
})

// ── A refused write (RULEBOOK 4.6, 4.9, 4.10, 4.11, 4.12) ───────────────────────────

// 4.9 IS A WORK CLAIM AND CANNOT BE READ OFF THE VALUE. "Stores nothing and mints no
// production" and "stores the refusal and wakes everyone" leave `s()` answering 1 either
// way — the ordinal and the wake count are the only places the difference shows.
//
// 4.6 is why the refusal is RETURNED rather than thrown: a throw from a `transform` is
// indistinguishable from the producer having failed, and those two must not be one case.
//
// THE REVERT: dropping the `isFailed(shaped)` test from `accept` reports
// `value: TooBig: Content Too Large` — the refusal stored as though it were the new value, minting a
// production for it and waking every reader with an `Error` where a number belongs.
test('a transform that refuses stores nothing and mints nothing', () => {
    const tooBig = refuse.named('TooBig', 413, undefined, {
        schema: (value: unknown) => value as { n: number },
    })
    // NO TYPE ARGUMENTS. The transform's return is inferred whole and split: the kept `number`
    // is what is stored, and the refusal is what `s.error()` is typed as.
    const bounded = reactive(1, {
        transform: (value) => (value > 10 ? tooBig({ n: value }) : value),
    })
    const ordinalOf = (): number => cellOf<{ ordinal: number }>(bounded).ordinal
    const before = ordinalOf()
    const counter = wakes(bounded)

    bounded.set(99)
    const woken = counter.count()
    counter.stop()
    // 4.9 both halves: nothing stored, and no production minted for it.
    expect(`value: ${bounded()}`).toBe('value: 1')
    expect(`ordinal moved: ${ordinalOf() - before}`).toBe('ordinal moved: 0')
    // 5.1: the value did not change, so nothing on the value edge may have woken.
    expect(`wakes: ${woken}`).toBe('wakes: 0')
    // 4.10: and the refusal is what it left behind.
    expect(`error: ${bounded.isError(bounded.error(), 'TooBig')}`).toBe(
        'error: true',
    )
    // And `Failures` is inferred from the transform, so this needs no cast at all. The annotation is
    // the gate, and it is the typecheck's: THE REVERT is the `<Accepted, Stored, Failures>` overload,
    // under which `data` is `unknown` and this line does not compile.
    const data: { n: number } | undefined = bounded.error()?.data
    expect(data).toEqual({ n: 99 })
})

// 4.11. A standing refusal that survives the write which superseded it is a value
// reporting a failure it has already recovered from — and a `{#if s.error()}` guard that
// never comes down.
//
// THE REVERT: dropping `cell.failure = undefined` from `produce` reports `error: TooBig`.
test('an accepted write clears the standing refusal', () => {
    const tooBig = refuse.named('TooBig', 413, undefined, {
        schema: (value: unknown) => value as { n: number },
    })
    const bounded = reactive(1, {
        transform: (value) => (value > 10 ? tooBig({ n: value }) : value),
    })
    bounded.set(99)
    expect(`error: ${bounded.error()?.name}`).toBe('error: TooBig')
    bounded.set(2)
    expect(`value: ${bounded()}`).toBe('value: 2')
    expect(
        `error: ${bounded.error() === undefined ? 'none' : 'standing'}`,
    ).toBe('error: none')
})

// 4.12: A FAILED REVALIDATION LEAVES THE HELD VALUE BEING SERVED, which is the case 2.3
// must NOT be applied to. With nothing landed a refusal is observable state moving and has
// to propagate; over a value still being served it changes nothing a reader can see, and
// waking there is a wake on an unchanged value (5.1).
//
// THE REVERT: cascading unconditionally in `refused` rather than behind `!cell.landed`
// reports 1 wake against 0.
test('a failed revalidation goes on serving and wakes nobody', async () => {
    let failNext = false
    const loaded = reactive(() =>
        failNext
            ? Promise.reject(new Error('the reload failed'))
            : Promise.resolve('held'),
    )
    expect(await loaded).toBe('held')
    const counter = wakes(loaded)
    failNext = true
    loaded.refresh()
    await Bun.sleep(10)
    const woken = counter.count()
    counter.stop()
    expect(`value: ${loaded()}`).toBe('value: held')
    expect(`ready: ${loaded.ready()}`).toBe('ready: true')
    expect(`wakes: ${woken}`).toBe('wakes: 0')
    // A CAST, AND IT IS HONEST RATHER THAN LAZY: this producer rejected with a plain
    // `Error`, which is outside anything it declared. `s.error()` is typed `Failures |
    // undefined` and a raw throw is neither — 16.42 is the clause that says what happens to
    // one, and nothing narrows it here.
    expect(`error: ${(loaded.error() as unknown as Error).message}`).toBe(
        'error: the reload failed',
    )
})

// 4.12 FOR A BODY THAT FAILS IN ITS OWN RUN, which reached `run`'s two private copies of the
// refusal rather than `refused` — a sync throw and a returned `Failed` — and those cascaded
// unconditionally, so the same revalidation that wakes nobody through a rejected load woke
// every value reader through a throw.
//
// THE REVERT: cascading unconditionally in `run`'s throw arm reports `wakes: 1` on the throw
// row; in its `Failed` arm, `wakes: 1` on the returned row.
test('a body that fails over a value still being served wakes nobody, thrown or returned', () => {
    for (const how of ['thrown', 'returned']) {
        let failNext = false
        const loaded = reactive(() => {
            if (!failNext) return 'held'
            if (how === 'thrown') throw new Error('the reload failed')
            return refuse.named('Reload')() as unknown as string
        })
        expect(loaded()).toBe('held')
        const counter = wakes(loaded)
        failNext = true
        loaded.refresh()
        const woken = counter.count()
        counter.stop()
        expect(`${how} value: ${loaded()}`).toBe(`${how} value: held`)
        expect(`${how} wakes: ${woken}`).toBe(`${how} wakes: 0`)
        expect(
            `${how} error: ${loaded.error() === undefined ? 'none' : 'standing'}`,
        ).toBe(`${how} error: standing`)
    }
})

// THE OTHER SIDE OF THE SAME TEST, and why it is `servable` rather than `landed`. An invalidated
// value has landed and is no longer served (7.8): its reader re-ran on the unserve and aborted on
// `NotLanded`. A reload that fails there is the reader's answer — it has nothing else coming — so
// it must wake, or the reader waits on a load that has already ended.
//
// THE REVERT: gating the cascade in `refused` on `!cell.landed` reports
// `answered: reactive has not landed` — the reader parked on the abort and never told.
test('a reload that fails over an invalidated value wakes the reader it left waiting', async () => {
    let failNext = false
    const loaded = reactive(() =>
        failNext
            ? Promise.reject(new Error('the reload failed'))
            : Promise.resolve('held'),
    )
    expect(await loaded).toBe('held')
    let answered = 'nothing'
    const stop = watch(() => {
        try {
            answered = loaded()
        } catch (thrown) {
            answered = (thrown as Error).message
        }
    })
    loaded.invalidate()
    failNext = true
    // The read that settles the debt (7.13): it unserves, the watch re-runs onto the abort,
    // and the reload is in flight.
    expect(() => loaded()).toThrow()
    flushSync()
    await Bun.sleep(10)
    flushSync()
    stop()
    expect(`answered: ${answered}`).toBe('answered: the reload failed')
})

// THE ARGUMENT SHIFT NOTHING TYPE-CHECKS. `MEMBERS` is assigned onto a prototype and is
// never matched against the `Reactive` type, so a member spelling its `this` annotation as
// a real parameter compiles clean and shifts every argument by one — `s.isError(error,
// name)` would then bind the error to `this` and the name to `error`. This was written
// that way on the first pass and the compiler said nothing.
//
// THE REVERT: spelling `isError`'s first parameter `_this: Cell` reports
// `narrows: false`, because the name arrives where the error is expected.
test('s.isError takes the error and the name, in that order', () => {
    const mine = refuse.named('Mine')
    const value = reactive(1)
    expect(`narrows: ${value.isError(mine(), 'Mine')}`).toBe('narrows: true')
    expect(`other: ${value.isError(mine(), 'Yours')}`).toBe('other: false')
})

// ── `schema`: the gate on the way in (RULEBOOK 4.3, 4.4, 4.5, 9.8, 19.3, 19.4, 19.5) ──

// 4.3 AND 4.4 ARE ONE CLAIM ABOUT ORDER: the schema runs FIRST and what it RETURNS is what
// `transform` receives. A transform reading the raw input where a schema had normalised it
// is a second answer to what the value holds, and the output looks right either way — the
// number reaching storage is the same whenever the trim happened.
//
// THE REVERT: passing `value` instead of `checked` to `transform` in `accept` reports
// `stored: 7` against `stored: 3` — the untrimmed string measured, spaces and all.
test('a schema runs before transform, and transform gets what it returned', () => {
    const order: string[] = []
    const trimmed = reactive<string, number>(undefined, {
        schema: (value: unknown) => {
            order.push('schema')
            return String(value).trim()
        },
        transform: (value) => {
            order.push('transform')
            return value.length
        },
    })
    trimmed.set('  abc  ')
    expect(order.join(', ')).toBe('schema, transform')
    expect(`stored: ${trimmed()}`).toBe('stored: 3')
})

// 4.5: THE THROW IS CAUGHT AND CONVERTED, and 15.8 says what into. A schema that threw past
// the write would take down whoever called `s.set` — a template expression or an event
// handler — and 4.10 already has a refused write leaving the failure on `s.error` instead.
//
// 19.5: the throw becomes the `''` entry, which is the key for "about the value itself".
//
// THE REVERT: dropping the `try`/`catch` around the call in `runSchema` reports the throw
// escaping `set`, so the test never reaches its assertion.
test('a schema refuses by throwing, and the throw becomes a ValidationError', () => {
    const positive = reactive<number, number>(1, {
        schema: (value: unknown) => {
            if (typeof value !== 'number' || value <= 0)
                throw new Error('must be positive')
            return value
        },
    })
    const counter = wakes(positive)
    positive.set(-5)
    const woken = counter.count()
    counter.stop()
    // 4.9: nothing stored, nothing minted.
    expect(`value: ${positive()}`).toBe('value: 1')
    expect(`wakes: ${woken}`).toBe('wakes: 0')
    const refusal = positive.error() as unknown as {
        name: string
        status: number
        data: string[]
    }
    expect(`${refusal.name} ${refusal.status}`).toBe('ValidationError 422')
    // A number has no path to key by, so `Issues<number>` is the bare list (`issuesOf`).
    expect(refusal.data).toEqual(['must be positive'])
})

// 19.4, AND IT CANNOT BE CAUGHT BY A TYPE. `Schema<boolean>` and a predicate are the same
// function type, so no annotation separates them — what separates them at RUNTIME is 19.3
// plus 19.7: a schema returns what it ACCEPTS and never coerces, so a function handed a
// number and answering `true` has answered a question rather than returned the value.
//
// It throws rather than refusing the write, because this is the author's mistake and not
// the data's: converting it to a `ValidationError` would report the app's own bug to the
// app's users as though they had typed something wrong.
//
// THE REVERT: dropping the boolean test from `runSchema` reports `stored: true` — the
// predicate's answer written into the value.
test('a predicate is refused as a schema', () => {
    // NO OPENING VALUE, or the predicate is caught at construction and the write below
    // never happens — 1.7 has reaching an instance start its work, and for the value form
    // that work is the initial write.
    const wrong = reactive<number, number>(undefined, {
        schema: ((value: unknown) => typeof value === 'number') as never,
    })
    let threw: unknown
    try {
        wrong.set(2)
    } catch (thrown) {
        threw = thrown
    }
    expect((threw as Error | undefined)?.message).toContain(
        'A predicate is not a Schema',
    )
})

// 9.8: THE GATE IS ON EVERY WAY IN, and `publish` is the one that is ungated for IDENTITY
// (5.5) — which is a different gate entirely. A room that accepted anything because the
// author had only pictured `set` is the failure this distinguishes.
//
// THE REVERT: testing `gated` before running the schema in `accept` reports the ring
// holding ['ok', 'no'] against ['ok'].
test('a schema gates publish as well as set', () => {
    const room = reactive<string>(undefined, {
        history: 4,
        schema: (value: unknown) => {
            if (value !== 'ok') throw new Error('only ok')
            return value as string
        },
    })
    room.publish('ok')
    room.publish('no')
    expect([...room.history()]).toEqual(['ok'])
    expect(`error: ${(room.error() as unknown as Error).name}`).toBe(
        'error: ValidationError',
    )
})

// 9.5: A REFUSED WRITE HANDS ITS REFUSAL BACK to the call that made it. `s.error` is where a
// refusal STANDS for whatever reads it later; the caller that just wrote holds the answer
// now, and handing it back a number was an ordinal the write never minted — indistinguishable
// from a publish that landed.
//
// THE REVERT is `refused` returning `cell.ordinal`: `publish refused: false` and
// `set refused: false`, with the ordinal unmoved behind both.
test('a refused write hands its refusal back, and an accepted one does not', () => {
    const tooBig = refuse.named('TooBig', 413, undefined, {
        schema: (value: unknown) => value as { n: number },
    })
    const bounded = reactive(1, {
        transform: (value) => (value > 10 ? tooBig({ n: value }) : value),
    })
    const published = bounded.publish(99)
    expect(`publish refused: ${bounded.isError(published, 'TooBig')}`).toBe(
        'publish refused: true',
    )
    const written = bounded.set(99)
    expect(`set refused: ${bounded.isError(written, 'TooBig')}`).toBe(
        'set refused: true',
    )
    expect(bounded.publish(2)).toBe(2)
    expect(bounded.set(3)).toBeUndefined()

    const gated = reactive<string, string>('ok', {
        schema: (value: unknown) => {
            if (value !== 'ok') throw new Error('only ok')
            return value as string
        },
    })
    expect(`schema: ${(gated.set('no') as Error | undefined)?.name}`).toBe(
        'schema: ValidationError',
    )
})

// 11.47: what a BODY produced is gated too, which is the way in an author never writes
// explicitly — there is no `set` call to look at. A body is where a value crosses in from
// a network, so it is the way in that most needs the gate.
test('a schema gates what a body produced', () => {
    let answer: unknown = 3
    const loaded = reactive(() => answer, {
        schema: (value: unknown) => {
            if (typeof value !== 'number') throw new Error('must be a number')
            return value
        },
    })
    expect(`value: ${loaded()}`).toBe('value: 3')
    answer = 'not a number'
    loaded.refresh()
    expect(`still: ${loaded()}`).toBe('still: 3')
    expect(`error: ${(loaded.error() as unknown as Error).name}`).toBe(
        'error: ValidationError',
    )
})

// 2.8 FOR EVERY VALUE, not only a stream: `then` resolves where `busy` becomes false. A
// caller awaiting a value mid-refresh wants what the refresh brings — resolving on
// `servable` alone handed it the figure the refresh was already replacing.
//
// THE REVERT is `settled` testing `servable` alone: `awaited: 1`.
//
// THE LOAD IS HELD OPEN BY HAND. `await` reaches `then` a microtask late, and a refresh over an
// already-resolved promise has landed by then — which passes with the revert in place.
test('awaiting a value mid-refresh resolves with what the refresh lands', async () => {
    let settle: (value: number) => void = (): void => {}
    let loads = 0
    const loaded = reactive(() => {
        loads += 1
        if (loads === 1) return 1
        return new Promise<number>((resolve) => {
            settle = resolve
        })
    })
    loaded.refresh()
    const awaited = loaded.then((value) => value)
    settle(2)
    expect(`awaited: ${await awaited}`).toBe('awaited: 2')
})

// ── Streams: an async generator body (RULEBOOK 3.7, 3.8, 9.2, 9.3, 9.20, 9.21, 9.22) ──

// ONE RUN OF A STREAM, DRIVEN BY HAND. Every chunk and the close are placed by the test, so
// a case asserts the state between two chunks rather than racing a timer to it. A run is
// recorded the moment its generator starts executing, which the first `next()` does
// synchronously — so `runs[0]` exists as soon as the value is constructed.
type Run<Chunk> = {
    push(chunk: Chunk): void
    close(): void
    fail(error: unknown): void
}

function streamOf<Chunk>(): {
    body: () => AsyncGenerator<Chunk>
    runs: Run<Chunk>[]
} {
    const runs: Run<Chunk>[] = []
    return {
        runs,
        body: async function* () {
            const queued: IteratorResult<Chunk>[] = []
            let failure: unknown
            let failed = false
            let wake: (() => void) | null = null
            const nudge = (): void => {
                const woken = wake
                wake = null
                woken?.()
            }
            runs.push({
                push: (chunk) => {
                    queued.push({ value: chunk, done: false })
                    nudge()
                },
                close: () => {
                    queued.push({ value: undefined, done: true })
                    nudge()
                },
                fail: (error) => {
                    failure = error
                    failed = true
                    nudge()
                },
            })
            for (;;) {
                while (queued.length === 0 && !failed)
                    await new Promise<void>((resolve) => {
                        wake = resolve
                    })
                if (failed) throw failure
                const next = queued.shift() as IteratorResult<Chunk>
                if (next.done === true) return
                yield next.value
            }
        },
    }
}

// Enough turns for a pushed chunk to cross the generator and the pump.
async function turns(): Promise<void> {
    await Bun.sleep(1)
}

// 9.20, 3.7, 3.8 AND 9.2 — the shape of a stream end to end. Nothing has landed until the
// first chunk, the value is the accumulation from then on, and `busy` holds until the close
// rather than dropping at the first chunk the way a single load's would.
test('an async generator body streams: ready from its first chunk, busy until it closes', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body)
    expect(`busy: ${rows.busy()}`).toBe('busy: true')
    expect(`ready: ${rows.ready()}`).toBe('ready: false')
    expect(rows.peek()).toBeUndefined()

    const run = feed.runs[0] as Run<number>
    run.push(1)
    await turns()
    expect(`ready: ${rows.ready()}`).toBe('ready: true')
    expect(`busy: ${rows.busy()}`).toBe('busy: true')
    expect(rows()).toEqual([1])

    run.push(2)
    run.push(3)
    await turns()
    expect(rows()).toEqual([1, 2, 3])

    run.close()
    await turns()
    expect(`busy: ${rows.busy()}`).toBe('busy: false')
    expect(rows()).toEqual([1, 2, 3])
})

// 9.20 BY WHAT THE RUN HANDS BACK. An arrow returning a generator types as a stream (the overload
// reads the return), and runs as one: the same shape end to end, and a refresh opens the body's next
// generator while the last accumulation stands (9.21). THE REVERT: drop the `isAsyncGenerator` arm in
// `run`; the value holds the generator, and `rows()` is no array at all.
test('a body handing back an async generator streams as one declared so — 9.20, 9.21', async () => {
    const feed = streamOf<number>()
    const rows = reactive(() => feed.body())
    expect(`busy: ${rows.busy()}`).toBe('busy: true')
    expect(`ready: ${rows.ready()}`).toBe('ready: false')

    const first = feed.runs[0] as Run<number>
    first.push(1)
    await turns()
    expect(rows()).toEqual([1])
    expect(`busy: ${rows.busy()}`).toBe('busy: true')
    first.close()
    await turns()
    expect(`busy: ${rows.busy()}`).toBe('busy: false')

    rows.refresh()
    expect(feed.runs.length).toBe(2)
    expect(rows()).toEqual([1])
    const second = feed.runs[1] as Run<number>
    second.push(2)
    await turns()
    expect(rows()).toEqual([2])
})

// 9.20 FROM THAT RUN ON, whichever run it is: a body that lands a plain value first and a generator
// once its input turns is a stream from the turn. THE REVERT: promote on a value's first run alone
// (`!cell.landed`); the recompute stores the generator, and `rows()` is no array.
test('a body that hands back a generator on a later run streams from that run — 9.20', async () => {
    const feed = streamOf<number>()
    const live = reactive(false)
    const rows = reactive(() => (live() ? feed.body() : 0))
    expect(rows()).toBe(0)
    live.set(true)
    rows()
    const run = feed.runs[0] as Run<number>
    run.push(1)
    await turns()
    expect(rows() as unknown).toEqual([1])
})

// 9.20 THROUGH A PROMISE: an async body resolving to a generator is a stream once it resolves, as a
// handler behind rungs is (16.33). THE REVERT: drop the `isAsyncGenerator` arm of `absorb`'s settle;
// the value holds the generator.
test('a body whose promise resolves to an async generator streams — 9.20', async () => {
    const feed = streamOf<number>()
    const rows = reactive(async () => feed.body())
    await turns()
    const run = feed.runs[0] as Run<number>
    run.push(1)
    await turns()
    expect(rows()).toEqual([1])
    expect(`busy: ${rows.busy()}`).toBe('busy: true')
    run.close()
    expect(await rows).toEqual([1])
})

// 9.3 AND 9.22, ASSERTED AS THE WORK. The accumulation is pushed into per chunk and
// materialised on the read — so a hundred chunks and one read are ONE run of the transform,
// and a second read with nothing new in between is none. The output cannot show this: a
// materialisation per chunk hands the reader the same array.
//
// THE REVERT is materialising in `acceptChunk` rather than in the read: `transforms: 100`.
test('a stream materialises its accumulation on the read, not per chunk', async () => {
    const feed = streamOf<number>()
    let transforms = 0
    const rows = reactive(feed.body, {
        transform: (chunks: number[]) => {
            transforms += 1
            return chunks
        },
    })
    const run = feed.runs[0] as Run<number>
    for (let chunk = 0; chunk < 100; chunk += 1) run.push(chunk)
    await turns()
    expect(rows().length).toBe(100)
    expect(rows().length).toBe(100)
    expect(`transforms: ${transforms}`).toBe('transforms: 1')
})

// A READ BETWEEN CHUNKS IS A NEW VALUE, and its identity is what says so. A reader that
// kept an earlier snapshot must still hold what it read, and a derived value comparing by
// reference must see the accumulation move — a live buffer handed out would collapse
// every production after the first at the identity gate.
test('each read of a moved stream is a snapshot of its own', async () => {
    const feed = streamOf<string>()
    const rows = reactive(feed.body)
    const count = reactive(() => rows().length)
    const run = feed.runs[0] as Run<string>
    run.push('a')
    await turns()
    const first = rows()
    expect(count()).toBe(1)
    run.push('b')
    await turns()
    expect(first).toEqual(['a'])
    expect(rows()).toEqual(['a', 'b'])
    expect(rows()).not.toBe(first)
    expect(count()).toBe(2)
})

// 9.21: A REFRESH SERVES WHAT IT HELD UNTIL THE NEW STREAM SAYS SOMETHING. Swapping at the
// refresh would blank a list the moment somebody asked for a newer one; swapping at the
// close would hold a stale list for the whole length of the new stream.
//
// THE REVERT is swapping the buffer in `startStream`: `during: ` reads an empty list.
test('refreshing a stream serves the old accumulation until the new first chunk', async () => {
    const feed = streamOf<string>()
    const rows = reactive(feed.body)
    const first = feed.runs[0] as Run<string>
    first.push('old')
    first.close()
    await turns()

    rows.refresh()
    expect(`busy: ${rows.busy()}`).toBe('busy: true')
    expect(`during: ${rows().join(',')}`).toBe('during: old')

    const second = feed.runs[1] as Run<string>
    second.push('new')
    await turns()
    expect(`after: ${rows().join(',')}`).toBe('after: new')
    second.close()
    await turns()
    expect(`busy: ${rows.busy()}`).toBe('busy: false')
})

// A superseded run must stop reaching the value. The old generator is told to return, and
// a chunk it had already queued lands nowhere.
test('a chunk from a superseded stream lands nowhere', async () => {
    const feed = streamOf<string>()
    const rows = reactive(feed.body)
    const first = feed.runs[0] as Run<string>
    first.push('a')
    await turns()
    rows.refresh()
    first.push('late')
    await turns()
    expect(rows()).toEqual(['a'])
})

// 2.7 OVER A STREAM: "the production in flight, from its start" is the stream in flight, so
// a cursor opened after three chunks hands over all three and then goes on live.
test('a cursor over a stream replays the run in flight from its first chunk', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body)
    const run = feed.runs[0] as Run<number>
    run.push(1)
    run.push(2)
    run.push(3)
    await turns()
    const cursor = rows[Symbol.asyncIterator]()
    const seen: number[] = []
    for (let step = 0; step < 3; step += 1)
        seen.push((await cursor.next()).value as number)
    const pending = cursor.next()
    run.push(4)
    seen.push((await pending).value as number)
    expect(seen).toEqual([1, 2, 3, 4])
    await cursor.return?.()
})

// 2.8: `await rows` HOLDS FOR THE WHOLE THING. The first chunk makes the value ready, and
// resolving there would hand an awaiting caller a list with most of it missing.
test('awaiting a stream holds until it closes', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body)
    const run = feed.runs[0] as Run<number>
    let settled: number[] | null = null
    rows.then((value) => {
        settled = value
    })
    run.push(1)
    await turns()
    expect(settled).toBeNull()
    run.push(2)
    run.close()
    await turns()
    expect(settled as number[] | null).toEqual([1, 2])
})

// A stream closing with nothing in it is a finished value, not one still waiting: the
// accumulation of no chunks is an empty list.
test('a stream that closes without a chunk lands an empty accumulation', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body)
    ;(feed.runs[0] as Run<number>).close()
    await turns()
    expect(`ready: ${rows.ready()}`).toBe('ready: true')
    expect(`busy: ${rows.busy()}`).toBe('busy: false')
    expect(rows()).toEqual([])
})

// 2.4 AND 2.2 ON A STREAM. A stream that fails after it said something leaves what it said
// being served, with the failure standing beside it; one that fails before its first chunk
// has nothing to serve and its read throws the failure.
test('a stream that fails keeps what it accumulated, and one with nothing throws', async () => {
    const partial = streamOf<number>()
    const rows = reactive(partial.body)
    const run = partial.runs[0] as Run<number>
    run.push(1)
    await turns()
    run.fail(new Error('socket closed'))
    await turns()
    expect(rows()).toEqual([1])
    expect(`busy: ${rows.busy()}`).toBe('busy: false')
    expect((rows.error() as unknown as Error).message).toBe('socket closed')

    const empty = streamOf<number>()
    const nothing = reactive(empty.body)
    ;(empty.runs[0] as Run<number>).fail(new Error('refused'))
    await turns()
    let thrown: unknown
    try {
        nothing()
    } catch (error) {
        thrown = error
    }
    expect((thrown as Error).message).toBe('refused')
})

// 9.20 PER ENTRY. A keyed body declared as an async generator streams each key on its own.
test('a keyed async generator body streams each entry', async () => {
    const keyed = reactive(async function* (args: { id: number }) {
        yield args.id
        yield args.id * 10
    })
    const one = keyed({ id: 1 })
    const two = keyed({ id: 2 })
    await turns()
    expect(one()).toEqual([1, 10])
    expect(two()).toEqual([2, 20])
    expect(`busy: ${one.busy()}`).toBe('busy: false')
})

// 9.23, ASSERTED AS THE WORK. A generator that yields a thousand chunks without awaiting
// anything in between lands all of them inside one task, and nothing can paint between two
// of them — so a reader woken per chunk did a thousand reads nobody could see, and a read of
// a stream is a copy of its accumulation. That was 61 ms for twenty thousand chunks.
//
// THE REVERT is `acceptChunk` calling `cascade` and `probesMoved` itself rather than
// `wakeLater`: `wakes: 1000`, `transforms: 1000`.
test('a burst of chunks in one task wakes a reader once', async () => {
    let transforms = 0
    const rows = reactive(
        async function* () {
            for (let chunk = 0; chunk < 1000; chunk += 1) yield chunk
        },
        {
            transform: (chunks: number[]) => {
                transforms += 1
                return chunks
            },
        },
    )
    let wakes = 0
    let seen = 0
    const stop = watch(() => {
        wakes += 1
        seen = rows().length
    })
    // The run at registration is the subscription, and it found nothing landed.
    wakes = 0
    await rows
    await turns()
    stop()
    expect(`seen: ${seen}`).toBe('seen: 1000')
    expect(`wakes: ${wakes}`).toBe('wakes: 1')
    expect(`transforms: ${transforms}`).toBe('transforms: 1')
})

// 9.24: `flushSync` IS HOW A TURN IS ENDED ON DEMAND, and a wake a stream is holding for the
// next task is exactly what a test, a measurement or a server render ending the turn has to
// see. The first assertion is what proves the wake WAS held: the chunks have landed and the
// effect has not heard.
//
// THE REVERT is `flushSync` not calling `wakeStreams`: `after flush: 0`.
test('flushSync delivers a stream wake held for the next task', async () => {
    const rows = reactive(async function* () {
        yield 'a'
        yield 'b'
    })
    let seen = 0
    const stop = watch(() => {
        seen = rows().length
    })
    for (let step = 0; step < 20; step += 1) await Promise.resolve()
    expect(`landed: ${rows.peek()?.length}`).toBe('landed: 2')
    expect(`before flush: ${seen}`).toBe('before flush: 0')
    flushSync()
    expect(`after flush: ${seen}`).toBe('after flush: 2')
    stop()
})

// ── Adopting a stream: RULEBOOK 11.15 forwarding what a stream declares ─────────────

// `reactive(() => salesByRegion(args))` IS HOW A PAGE HOLDS A STREAM, so the adopting value
// is the one a template reads, iterates and awaits — and it has to BE the stream to each of
// those, not a value holding copies of it. A cursor over it hands over chunks (1.2), it holds
// for the close when awaited (2.8), and a guard on its `busy` comes back when the stream ends.
//
// THE REVERT is `mirror` accepting `heldValue(inner)` for a stream as it does for a value. The
// first assertion to fail is the await, which resolves mid-stream with `[1, 2]`; past it, the
// cursor hands over whole accumulations where the chunks should be.
test('a value adopting a stream is that stream to a cursor, a guard and an await', async () => {
    const feed = streamOf<number>()
    const inner = reactive(feed.body)
    const rows = reactive(() => inner)
    const run = feed.runs[0] as Run<number>
    const guard: boolean[] = []
    const stop = watch(() => {
        guard.push(rows.busy())
    })
    let settled: number[] | null = null
    rows.then((value) => {
        settled = value
    })

    run.push(1)
    run.push(2)
    await turns()
    expect(rows()).toEqual([1, 2])
    expect(settled).toBeNull()

    const cursor = rows[Symbol.asyncIterator]()
    const taken: unknown[] = [
        (await cursor.next()).value,
        (await cursor.next()).value,
    ]
    const pending = cursor.next()
    run.push(3)
    taken.push((await pending).value)
    await cursor.return?.()
    expect(`cursor: ${taken.join('|')}`).toBe('cursor: 1|2|3')

    run.close()
    await turns()
    flushSync()
    stop()
    expect(settled as number[] | null).toEqual([1, 2, 3])
    expect(`guard: ${guard[guard.length - 1]}`).toBe('guard: false')
})

// 9.2 THROUGH THE ADOPTION, AS THE WORK. The adopter materialises on the read that asks, with
// its OWN gates (11.14) — and a mirror that copied the accumulation to hand it over did it
// once per wake with nothing reading at all.
//
// THE REVERT is the same as above: `outer transforms before a read: 3`.
test('a value adopting a stream materialises nothing until it is read, through its own transform', async () => {
    const feed = streamOf<number>()
    const inner = reactive(feed.body)
    let transforms = 0
    const total = reactive(() => inner, {
        transform: (chunks: number[]) => {
            transforms += 1
            return [chunks.reduce((sum, chunk) => sum + chunk, 0)]
        },
    })
    const run = feed.runs[0] as Run<number>
    for (let chunk = 1; chunk <= 3; chunk += 1) {
        run.push(chunk)
        await turns()
    }
    expect(`outer transforms before a read: ${transforms}`).toBe(
        'outer transforms before a read: 0',
    )
    expect(total()).toEqual([6])
    expect(total()).toEqual([6])
    expect(`outer transforms after two reads: ${transforms}`).toBe(
        'outer transforms after two reads: 1',
    )
})

// A body that stops handing back the stream stops being it: the adopter serves what its body
// computed, and reads straight from the field again.
//
// THE REVERT is `dropAdoption` leaving the forwarding in place: `stream` is still the
// forwarded record, and every read of the value goes on paying the indirect path.
test('a value that stops adopting a stream serves its own value again', async () => {
    const feed = streamOf<number>()
    const inner = reactive(feed.body)
    const flag = reactive(true)
    const outer = reactive(() => (flag() ? inner : [99]))
    ;(feed.runs[0] as Run<number>).push(1)
    await turns()
    expect(outer()).toEqual([1])
    flag.set(false)
    expect(outer()).toEqual([99])
    expect(cellOf<{ stream: unknown }>(outer).stream).toBeNull()
    expect(`direct: ${cellOf<{ direct: boolean }>(outer).direct}`).toBe(
        'direct: true',
    )
})

// ── Writes to a stream (RULEBOOK 9.25, 9.26, 9.27, 11.60) ───────────────────────────────

// 9.25: A WRITE OVER A STREAM LASTS UNTIL THE STREAM SAYS SOMETHING NEW. Nothing arriving leaves
// it standing; the next chunk puts the accumulation back, the write having been a value the
// producer never made.
//
// THE REVERT is `standWrite` not recording the version it stood at, and it is the PUBLISH that
// shows it: a gated `set` materialises what it compares against, which stamps the version as a
// side effect, where an ungated publish compares nothing — `after publish: 1,2,3,4`.
test('a set on a stream stands until the next chunk overwrites it', async () => {
    const feed = streamOf<string>()
    const rows = reactive(feed.body)
    const run = feed.runs[0] as Run<string>
    run.push('1')
    run.push('2')
    await turns()
    rows.set(['local'])
    expect(`after set: ${rows().join(',')}`).toBe('after set: local')
    await turns()
    expect(`still: ${rows().join(',')}`).toBe('still: local')
    run.push('3')
    await turns()
    expect(`after chunk: ${rows().join(',')}`).toBe('after chunk: 1,2,3')

    // Unread chunks, then an ungated write over them.
    run.push('4')
    await turns()
    rows.publish(['published'])
    expect(`after publish: ${rows().join(',')}`).toBe(
        'after publish: published',
    )
})

// 5.7 AND 2.5 ON A STREAM: a patch that grows or shrinks the accumulation mints no chunk, so the ring
// it reshaped still has to line up with the ordinal a cursor holds — and a read shows what it added.
//
// THE REVERT: drop the `ringBase`/`visible` move from `patchCell`'s stream branch; the push reads
// `1,2` after the patch and hands the cursor `x` as a chunk (3 is never delivered), and the splice
// hands it `undefined` from one past the end of the ring.
test('a patch that reshapes a stream keeps its cursors in step', async () => {
    const outcomes: string[] = []
    for (const reshape of [
        (chunks: string[]) => chunks.push('x'),
        (chunks: string[]) => chunks.splice(0, 1),
    ]) {
        const feed = streamOf<string>()
        const rows = reactive(feed.body)
        const run = feed.runs[0] as Run<string>
        run.push('1')
        run.push('2')
        await turns()
        const cursor = rows[Symbol.asyncIterator]()
        await cursor.next()
        await cursor.next()
        rows.patch((chunks) => {
            reshape(chunks)
        })
        const read = rows().join(',')
        const pending = cursor.next()
        run.push('3')
        const taken = await Promise.race([
            pending.then((step) => String(step.value)),
            Bun.sleep(200).then(() => 'nothing'),
        ])
        await cursor.return?.()
        outcomes.push(`read ${read}, cursor ${taken}`)
    }
    expect(outcomes).toEqual(['read 1,2,x, cursor 3', 'read 2, cursor 3'])
})

// 9.26: A CURSOR WALKS CHUNKS, and a write is not one. A write minting an ordinal with nothing in
// the ring behind it put the cursor one past the end, and its next turn handed over `undefined`.
//
// THE REVERT is `accept` sending a stream's write through `produce`: `cursor: 1|2|` — the third
// turn hands over `undefined`.
test('a set on a stream moves no cursor over it', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body)
    const run = feed.runs[0] as Run<number>
    run.push(1)
    run.push(2)
    await turns()
    const cursor = rows[Symbol.asyncIterator]()
    const taken: unknown[] = [
        (await cursor.next()).value,
        (await cursor.next()).value,
    ]
    rows.set([0])
    const pending = cursor.next()
    run.push(3)
    taken.push((await pending).value)
    await cursor.return?.()
    expect(`cursor: ${taken.join('|')}`).toBe('cursor: 1|2|3')
})

// 11.19 THROUGH 9.25: A WRITE FOLLOWING A CALL IN FLIGHT. A stream that failed before its first chunk
// is neither busy nor servable; a `Reactive` written over it that is still loading makes it busy by
// FOLLOWING, which mints nothing, and `unserve` finds nothing to lose — so a guard subscribed before
// the write hears it from `follow` itself, onto true, and back onto false when the call lands. Over a
// stream that had landed, `unserve` already woke the guard; that case never failed.
//
// THE REVERT is dropping the `probesMoved` at the end of `follow`: `seen: false,false`.
test('a busy guard on a stream hears a write that follows a call in flight', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body)
    const run = feed.runs[0] as Run<number>
    run.fail(new Error('the feed dropped'))
    await turns()
    const seen: boolean[] = []
    const stop = watch(() => {
        seen.push(rows.busy())
    })
    let settle: (value: number[]) => void = (): void => {}
    const call = reactive(
        new Promise<number[]>((resolve) => {
            settle = resolve
        }),
    )
    rows.set(call as never)
    flushSync()
    settle([2])
    await call
    flushSync()
    stop()
    expect(`seen: ${seen.join(',')}`).toBe('seen: false,true,false')
})

// 11.62 ON A STREAM IS 9.25's WRITE, FOLLOWING. A `Reactive` written over a stream is adopted, not
// stored — the read is the adopted value's, and a write to the adopted value wakes this one's readers
// — and it stands as any write over a stream does: the next chunk puts the accumulation back and lets
// go of what was adopted. Letting go is the WORK half and nothing in a value shows it, so the adopted
// value's reader list and the wakes after the chunk are what is asserted. No ordinal is minted for it
// (9.26), so a cursor walks straight from the chunk before to the chunk after.
//
// THE REVERT is `STREAM_PROTOTYPE.set` handing a `Reactive` to `writeStream` as a value: `stored: true`
// — the callable itself is served; `unfollow` in `wakeStreams` and `materialise` doing nothing:
// `adopted readers after: 1`; and `adoptedCellOf` walking on into what the stream follows:
// `history: [[7,8],[9]]` — the replay was the adopted value's.
test('a Reactive set on a stream is followed until the next chunk', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body)
    const run = feed.runs[0] as Run<number>
    run.push(1)
    run.push(2)
    await turns()
    const cursor = rows[Symbol.asyncIterator]()
    const taken: unknown[] = [
        (await cursor.next()).value,
        (await cursor.next()).value,
    ]
    const ordinal = cellOf<{ ordinal: number }>(rows).ordinal
    const past = JSON.stringify([...rows.history()])
    const other = reactive([7, 8], { history: 4 })
    const readersBefore = cellOf<{ readers: unknown[] }>(other).readers.length
    const woken = wakes(rows)

    rows.set(other as never)
    expect(`stored: ${isReactive(rows())}`).toBe('stored: false')
    expect(`followed: ${rows().join(',')}`).toBe('followed: 7,8')
    expect(`woken by the set: ${woken.count()}`).toBe('woken by the set: 1')

    other.set([9])
    expect(`after the adopted write: ${rows().join(',')}`).toBe(
        'after the adopted write: 9',
    )
    expect(`woken by the adopted write: ${woken.count() - 1}`).toBe(
        'woken by the adopted write: 1',
    )
    expect(
        `ordinal: ${cellOf<{ ordinal: number }>(rows).ordinal - ordinal}`,
    ).toBe('ordinal: 0')
    expect(`history: ${JSON.stringify([...rows.history()])}`).toBe(
        `history: ${past}`,
    )

    const pending = cursor.next()
    run.push(3)
    await turns()
    taken.push((await pending).value)
    expect(`after the chunk: ${rows().join(',')}`).toBe(
        'after the chunk: 1,2,3',
    )
    expect(`woken by the chunk: ${woken.count() - 2}`).toBe(
        'woken by the chunk: 1',
    )

    other.set([10])
    expect(`woken after the chunk: ${woken.count() - 3}`).toBe(
        'woken after the chunk: 0',
    )
    expect(`still: ${rows().join(',')}`).toBe('still: 1,2,3')
    expect(
        `adopted readers after: ${cellOf<{ readers: unknown[] }>(other).readers.length - readersBefore}`,
    ).toBe('adopted readers after: 0')
    expect(`cursor: ${taken.join('|')}`).toBe('cursor: 1|2|3')
    await cursor.return?.()
    woken.stop()
})

// A WRITE REPLACES A WRITE, and a followed `Reactive` is a write (9.25): a later `set` over the stream
// lands on the stream rather than reaching through to what it was following — the reach-through of
// 11.60 is an adopting value's, and a stream is not one — and lets go of it.
//
// THE REVERT is `writeStream` not calling `unfollow`: `woken by the adopted write: 1` — the stale
// follow overwrites the plain write the moment the adopted value moves.
test('a set over a followed Reactive on a stream replaces it', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body)
    const run = feed.runs[0] as Run<number>
    run.push(1)
    await turns()
    const other = reactive([7])
    const readersBefore = cellOf<{ readers: unknown[] }>(other).readers.length
    rows.set(other as never)
    expect(`followed: ${rows().join(',')}`).toBe('followed: 7')

    const woken = wakes(rows)
    rows.set([5])
    expect(`replaced: ${rows().join(',')}`).toBe('replaced: 5')
    expect(`adopted untouched: ${other().join(',')}`).toBe(
        'adopted untouched: 7',
    )
    expect(`woken by the write: ${woken.count()}`).toBe('woken by the write: 1')
    other.set([8])
    expect(`woken by the adopted write: ${woken.count() - 1}`).toBe(
        'woken by the adopted write: 0',
    )
    expect(`still: ${rows().join(',')}`).toBe('still: 5')
    expect(
        `adopted readers after: ${cellOf<{ readers: unknown[] }>(other).readers.length - readersBefore}`,
    ).toBe('adopted readers after: 0')

    // And a second `Reactive` replaces the first the same way.
    const third = reactive([3])
    rows.set(other as never)
    rows.set(third as never)
    other.set([0])
    expect(`re-pointed: ${rows().join(',')}`).toBe('re-pointed: 3')
    expect(
        `first let go: ${cellOf<{ readers: unknown[] }>(other).readers.length - readersBefore}`,
    ).toBe('first let go: 0')
    woken.stop()
})

// 11.19 AND 11.51 THROUGH A FOLLOW: while it stands, `busy`, `ready` and `error` answer as they would on
// a value adopting the same `Reactive` — the stream's own open run still counts for `busy` (3.7) — and a
// guard hears the adopted value's probes move. Once the stream closed, what `busy` reports is the
// adopted value's load alone.
//
// THE REVERT is the follow not setting `adoption`: `busy while the adopted loads: false`.
test('a followed Reactive on a closed stream reports its probes', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body)
    const run = feed.runs[0] as Run<number>
    run.push(1)
    run.close()
    await turns()
    expect(`closed busy: ${rows.busy()}`).toBe('closed busy: false')

    let settle: (value: number[]) => void = () => undefined
    const other = reactive(
        new Promise<number[]>((resolve) => {
            settle = resolve
        }),
    )
    let guardRuns = 0
    const stop = watch(() => {
        rows.busy()
        guardRuns += 1
    })
    guardRuns = 0
    rows.set(other as never)
    flushSync()
    expect(`busy while the adopted loads: ${rows.busy()}`).toBe(
        'busy while the adopted loads: true',
    )
    expect(`ready while the adopted loads: ${rows.ready()}`).toBe(
        'ready while the adopted loads: false',
    )
    settle([4])
    await turns()
    flushSync()
    expect(`busy after: ${rows.busy()}`).toBe('busy after: false')
    expect(`value after: ${rows().join(',')}`).toBe('value after: 4')
    expect(`guard heard it: ${guardRuns >= 2}`).toBe('guard heard it: true')

    const failing = reactive<number[]>(() => {
        throw new Error('nope')
    })
    rows.set(failing as never)
    expect(`error: ${String(rows.error())}`).toBe('error: Error: nope')
    stop()
})

// 9.27: `patch` MUTATES THE ACCUMULATION, not the copy a read was handed — so the change is there
// when the next chunk arrives, where a patched snapshot would be rebuilt from the untouched chunks.
//
// THE REVERT is `patch` mutating `cell.value` on a stream: `after chunk: 1,2,3`.
test('patch on a stream mutates its accumulation, and later chunks land after it', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body)
    const run = feed.runs[0] as Run<number>
    run.push(1)
    run.push(2)
    await turns()
    rows.patch((chunks) => {
        chunks[0] = 10
    })
    expect(`after patch: ${rows().join(',')}`).toBe('after patch: 10,2')
    run.push(3)
    await turns()
    expect(`after chunk: ${rows().join(',')}`).toBe('after chunk: 10,2,3')
})

// 11.60: THE ADOPTER HOLDS THE ADOPTED BUFFER BY REFERENCE, so a patch through it is a patch of
// the stream — and has to be told to the stream, or the stream goes on serving the snapshot it
// took before the buffer changed under it. A `set` reaches the stream too, and stands there until
// the accumulation next changes (9.25).
//
// THE REVERT is `patch` on a forwarding value mutating the shared buffer itself: `inner: 1`; and
// `forwardStream` not taking a write standing on the stream: `outer after set: 9`.
test('patch and set through a value adopting a stream reach the stream', async () => {
    const feed = streamOf<number>()
    const inner = reactive(feed.body)
    const outer = reactive(() => inner)
    const run = feed.runs[0] as Run<number>
    run.push(1)
    await turns()
    expect(inner()).toEqual([1])
    outer.patch((chunks) => {
        chunks[0] = 9
    })
    flushSync()
    expect(`inner: ${inner().join(',')}`).toBe('inner: 9')
    expect(`outer: ${outer().join(',')}`).toBe('outer: 9')

    outer.set([42])
    expect(`outer after set: ${outer().join(',')}`).toBe('outer after set: 42')
    expect(`inner after set: ${inner().join(',')}`).toBe('inner after set: 42')
    run.push(2)
    await turns()
    expect(`outer after chunk: ${outer().join(',')}`).toBe(
        'outer after chunk: 9,2',
    )
})

// `ttl` ON A STREAM IS THE LIFE OF A CLOSED RUN, and it needed no reading of its own: 6.17 makes
// the accumulation at close the production, so 6.11 and 6.12 are the same sentence they are
// everywhere else. The run IN FLIGHT has produced nothing, so it has no deadline — which is what
// stops a long stream expiring underneath the reader it is still filling.
//
// THE CLOCK IS MOVED RATHER THAN WAITED ON, and that tests the READ path (6.11) apart from the
// timer that normally does the work — `setSystemTime` moves neither.
//
// THE REVERT is `retainRun` not setting `expiry.at`: `after: 3` — the accumulation goes on being
// served past its life.
test('a closed streaming run is not served past its ttl', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body, { ttl: 50 })
    const first = feed.runs[0] as Run<number>
    first.push(1)
    first.push(2)
    first.close()
    await turns()
    expect(`closed: ${rows()?.length}`).toBe('closed: 2')

    const realNow = Date.now()
    setSystemTime(new Date(realNow + 500))
    try {
        // 6.11 AND 6.12: not served, and the read starts the producer — which on a stream is a
        // new RUN rather than a recompute, so what answers is the next run's accumulation.
        // `ready` is the TIMER's half of this (6.14) and the clock moved without firing it, so
        // what is asserted here is the read.
        expect(() => rows()).toThrow()
        const second = feed.runs[1] as Run<number>
        second.push(3)
        second.close()
        await turns()
        expect(`after: ${rows()?.join(',')}`).toBe('after: 3')
    } finally {
        setSystemTime()
    }
})

// THE RUN IN FLIGHT HAS NO DEADLINE, because nothing has been minted for one to run from. A
// stream open for longer than its own `ttl` — a socket, a token stream over a slow model — must
// go on being read, and only what it CLOSED with can expire.
//
// THE REVERT is `retainRun` setting `expiry.at` from `beginAccumulation` instead of the close:
// `during: ` throws, the run expiring while it is still being filled.
test('a streaming run in flight does not expire', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body, { ttl: 50 })
    const run = feed.runs[0] as Run<number>
    run.push(1)
    await turns()
    const realNow = Date.now()
    setSystemTime(new Date(realNow + 500))
    try {
        expect(`during: ${rows()?.join(',')}`).toBe('during: 1')
    } finally {
        setSystemTime()
    }
})

// 6.5 OVER THE RING OF CLOSED RUNS: a past run is dropped on the read that follows its deadline,
// and `s.history` is the read that reaches one (2.5). The two rings a stream carries are the
// point — the sweep trims the closed runs and never the chunk buffer.
//
// THE REVERT is `ringedOf` answering the cell rather than the view: the sweep splices the chunk
// buffer, and the replay still reads `1|2`.
test('a past streaming run is dropped on the read after its ttl', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body, { ttl: 50, history: 4 })
    const first = feed.runs[0] as Run<number>
    first.push(1)
    first.close()
    await turns()
    rows.refresh()
    const second = feed.runs[1] as Run<number>
    second.push(2)
    second.close()
    await turns()
    expect(
        `past: ${[...rows.history()].map((run) => run.join('')).join('|')}`,
    ).toBe('past: 1|2')

    const realNow = Date.now()
    setSystemTime(new Date(realNow + 500))
    try {
        expect(`swept: ${[...rows.history()].length}`).toBe('swept: 0')
    } finally {
        setSystemTime()
    }
})

// 6.17: A RUN ENTERS THE RING WHEN IT CLOSES, as the accumulation at close. The two buffers are
// the point: `chunks` is the run being built and a cursor over the VALUE walks it (2.7), where
// `history()` walks the runs that finished. A stream that has produced `a`,`b` and then `c` has
// one entry in its past and three chunks in its buffer, and neither number is the other.
//
// THE REVERT is `pump` not calling `retainRun`: `past: ` reads empty.
test('a streaming run enters the ring at its close', async () => {
    const feed = streamOf<string>()
    const rows = reactive(feed.body, { history: 4 })
    const first = feed.runs[0] as Run<string>
    first.push('a')
    first.push('b')
    await turns()
    expect(`mid-run past: ${[...rows.history()].length}`).toBe(
        'mid-run past: 0',
    )
    first.close()
    await turns()
    rows.refresh()
    const second = feed.runs[1] as Run<string>
    second.push('c')
    second.close()
    await turns()
    const past = [...rows.history()]
    expect(`past: ${past.map((run) => run.join('')).join('|')}`).toBe(
        'past: ab|c',
    )
})

// 6.20: A RUN THAT FAILED OR THAT A TRIGGER REPLACED ENTERS NOTHING. Both stop short of the close,
// and the close is the whole of what mints the entry — so this is one assertion about two paths
// through `pump`, neither of which reaches `retainRun`.
//
// THE REVERT is retaining on the failure arm as well as the close: `past: ab|c` gains the
// superseded and failed runs.
test('a failed or superseded streaming run enters nothing', async () => {
    const feed = streamOf<string>()
    const rows = reactive(feed.body, { history: 4 })
    const first = feed.runs[0] as Run<string>
    first.push('a')
    first.push('b')
    first.close()
    await turns()

    rows.refresh()
    const second = feed.runs[1] as Run<string>
    second.push('superseded')
    await turns()
    rows.refresh()
    const third = feed.runs[2] as Run<string>
    third.push('failed')
    third.fail(new Error('the stream broke'))
    await turns()

    rows.refresh()
    const fourth = feed.runs[3] as Run<string>
    fourth.push('c')
    fourth.close()
    await turns()
    const past = [...rows.history()]
    expect(`past: ${past.map((run) => run.join('')).join('|')}`).toBe(
        'past: ab|c',
    )
})

// 6.21: A REPLAY ENDS AT THE LAST RUN THAT CLOSED. The run in flight is what a READ answers with
// (9.2), and a cursor over the past must not hand over a half-built accumulation as though it
// were a result — the same sentence 6.17 makes, from the reader's end.
//
// THE REVERT is `retainRun` being called from `acceptChunk` rather than at the close: the
// in-flight `x` appears in the replay.
test('a replay over a stream ends at the last run that closed', async () => {
    const feed = streamOf<string>()
    const rows = reactive(feed.body, { history: 4 })
    const first = feed.runs[0] as Run<string>
    first.push('done')
    first.close()
    await turns()
    rows.refresh()
    const second = feed.runs[1] as Run<string>
    second.push('x')
    await turns()
    const past = [...rows.history()]
    expect(`past: ${past.map((run) => run.join('')).join('|')}`).toBe(
        'past: done',
    )
    expect(`read: ${rows()?.join('')}`).toBe('read: x')
})

// A LIVE CURSOR OVER THE PAST WAKES ON A CLOSE, and on nothing else. Its readers are the view's
// own, so the chunks landing in between move it not at all — which is also what keeps a close
// from waking every binding on the value a second time.
//
// THE REVERT is `retainRun` not notifying the view's readers: the `for await` never takes a turn.
test('a cursor over a stream past takes a turn per run that closes', async () => {
    const feed = streamOf<string>()
    const rows = reactive(feed.body, { history: 4 })
    const first = feed.runs[0] as Run<string>
    first.push('a')
    first.close()
    await turns()

    const cursor = rows.history(1)[Symbol.asyncIterator]()
    const seen: string[] = []
    const replayed = await cursor.next()
    seen.push((replayed.value as string[]).join(''))
    // RACED AGAINST A TURN OF THE LOOP rather than awaited bare: with the notify reverted this
    // promise never settles, and a gate that HANGS reports nothing at all.
    const live = Promise.race([
        cursor.next(),
        (async (): Promise<IteratorResult<unknown>> => {
            for (let step = 0; step < 50; step += 1) await turns()
            return { value: ['(no turn)'], done: false }
        })(),
    ])
    rows.refresh()
    const second = feed.runs[1] as Run<string>
    second.push('b')
    second.push('c')
    await turns()
    second.close()
    seen.push(((await live).value as string[]).join(''))
    expect(`seen: ${seen.join('|')}`).toBe('seen: a|bc')
    await cursor.return?.()
})

// 5.17: A WINDOW ON A STREAM CAPS THE WAKE. Chunks go on landing and a cursor is handed every one
// of them (5.10), but a reader of the value hears at most once per window — a table re-rendered per
// chunk of a fast stream is the cost `throttle` exists to cap.
//
// THE REVERT is `acceptChunk` releasing every chunk whatever the cap: `wakes: 6`.
test('throttle on a stream wakes readers once per window, and a cursor still gets every chunk', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body, { throttle: WINDOW })
    const run = feed.runs[0] as Run<number>
    let wakes = 0
    const stop = watch(() => {
        rows()
        wakes += 1
    })
    const cursor = rows[Symbol.asyncIterator]()
    run.push(0)
    await turns()
    wakes = 0
    for (let chunk = 1; chunk <= 6; chunk += 1) {
        run.push(chunk)
        await turns()
    }
    expect(`wakes: ${wakes}`).toBe('wakes: 0')
    await sleep(AFTER_WINDOW)
    flushSync()
    expect(`wakes: ${wakes}`).toBe('wakes: 1')
    const seen: unknown[] = []
    for (let step = 0; step < 7; step += 1)
        seen.push((await cursor.next()).value)
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6])
    await cursor.return?.()
    stop()
})

// 5.18: WHAT A READER SEES IS WHAT THE WINDOW RELEASED, not the chunks it is holding — the read
// agrees with the wake, so a value that has not been told of a chunk does not show it either.
//
// THE REVERT is `materialise` slicing the whole buffer: `during: 1,2`.
test('a read of a throttled stream serves the accumulation as the last release left it', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body, { throttle: WINDOW })
    const run = feed.runs[0] as Run<number>
    // No read until a chunk is held: a snapshot taken earlier would answer from its cache and prove
    // nothing about what the window has released.
    run.push(1)
    await turns()
    run.push(2)
    await turns()
    expect(`during: ${rows().join(',')}`).toBe('during: 1')
    await sleep(AFTER_WINDOW)
    expect(`after: ${rows().join(',')}`).toBe('after: 1,2')
})

// 5.13 ON A STREAM: a debounce releases once the chunks stop, and a close releases what it holds, so
// awaiting the stream is never handed a partial accumulation (2.8).
test('a debounced stream releases once the chunks stop, and its close releases what is held', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body, { debounce: WINDOW })
    const run = feed.runs[0] as Run<number>
    run.push(1)
    await turns()
    for (let chunk = 2; chunk <= 4; chunk += 1) {
        run.push(chunk)
        await turns()
    }
    expect(`held: ${rows().join(',')}`).toBe('held: 1')
    await sleep(AFTER_WINDOW)
    expect(`released: ${rows().join(',')}`).toBe('released: 1,2,3,4')
    run.push(5)
    run.close()
    expect(`awaited: ${(await rows).join(',')}`).toBe('awaited: 1,2,3,4,5')
})

// ── `tags` selections, process-wide (RULEBOOK 11.44, 11.45, 13.1, 13.2, 13.3, 13.7, 13.9, 13.11) ──

// Deferred loads, settled by hand, so a case can hold a set of values busy between two lines.
function deferredLoads(): {
    load: () => Promise<number>
    settleAll: (value: number) => void
} {
    const settles: ((value: number) => void)[] = []
    return {
        load: () =>
            new Promise<number>((resolve) => {
                settles.push(resolve)
            }),
        settleAll: (value) => {
            for (const settle of settles.splice(0)) settle(value)
        },
    }
}

// 13.2 AND 13.11 OVER TAGS, and 11.45's function form. A tag reaches across values — keyed
// entries of one memo and an unkeyed value elsewhere carrying the same tag answer as one set.
test('busy and ready over tags answer ANY and EVERY across the values carrying them', async () => {
    const loads = deferredLoads()
    // The parameter is the declaration that this is keyed; the body has no use for it.
    const orders = reactive((_args: { customer: number }) => loads.load(), {
        tags: (args) => [`customer:${args?.customer}`],
    })
    const profile = reactive(() => Promise.resolve(7), { tags: ['customer:1'] })
    const other = reactive(() => Promise.resolve(8), { tags: ['customer:2'] })
    orders({ customer: 1 })
    await profile
    await other
    expect(`busy: ${busy({ tags: ['customer:1'] })}`).toBe('busy: true')
    expect(`ready: ${ready({ tags: ['customer:1'] })}`).toBe('ready: false')
    expect(`other busy: ${busy({ tags: ['customer:2'] })}`).toBe(
        'other busy: false',
    )
    loads.settleAll(3)
    await Bun.sleep(1)
    expect(`busy after: ${busy({ tags: ['customer:1'] })}`).toBe(
        'busy after: false',
    )
    expect(`ready after: ${ready({ tags: ['customer:1'] })}`).toBe(
        'ready after: true',
    )
})

// 13.1: a tag selection is every entry carrying ANY of its tags, and nothing else is touched.
test('invalidate over tags reaches every value carrying any of them, and no other', () => {
    const runs = { a: 0, b: 0, c: 0 }
    const a = reactive(
        () => {
            runs.a += 1
            return 1
        },
        { tags: ['invoice'] },
    )
    const b = reactive(
        () => {
            runs.b += 1
            return 2
        },
        { tags: ['customer:1'] },
    )
    const c = reactive(
        () => {
            runs.c += 1
            return 3
        },
        { tags: ['elsewhere'] },
    )
    invalidate({ tags: ['invoice', 'customer:1'] })
    a()
    b()
    c()
    expect(`runs: ${runs.a},${runs.b},${runs.c}`).toBe('runs: 2,2,1')
})

// 13.7: A REFRESH THIS WIDE IS BOUNDED BY WHAT IS READ. Reloading two hundred entries nobody is
// looking at is two hundred requests for nothing; the unread ones are marked instead, and their
// next read is what reloads them.
//
// THE REVERT is refreshing every match: `unread runs before a read: 2`.
test('refresh over tags reloads what something reads and marks the rest', () => {
    let readRuns = 0
    let unreadRuns = 0
    const read = reactive(
        () => {
            readRuns += 1
            return readRuns
        },
        { tags: ['report'] },
    )
    const unread = reactive(
        () => {
            unreadRuns += 1
            return unreadRuns
        },
        { tags: ['report'] },
    )
    const stop = watch(() => {
        read()
    })
    refresh({ tags: ['report'] })
    expect(`read runs: ${readRuns}`).toBe('read runs: 2')
    expect(`unread runs before a read: ${unreadRuns}`).toBe(
        'unread runs before a read: 1',
    )
    expect(unread()).toBe(2)
    stop()
})

// 13.3 AND 13.9: ONE SIGNAL PER SELECTION. A guard over a tag selection subscribes to the
// selection, not to each entry in it — so a page spinner over a hundred entries holds one edge,
// and comes back when the loads end.
//
// THE REVERTS: answering a tracked `busy({ tags })` through each entry's own `busy` subscribes the
// guard to the first busy entry the ANY stopped at and to none of the others, `probe readers: 1`;
// and `markProbes` not marking the signals leaves the guard
// stuck on its first answer, `saw: true`.
test('a guard over a tag selection subscribes once and comes back when the loads end', async () => {
    const loads = deferredLoads()
    const values = []
    for (let index = 0; index < 10; index += 1)
        values.push(reactive(() => loads.load(), { tags: ['feed'] }))
    const saw: boolean[] = []
    const stop = watch(() => {
        saw.push(busy({ tags: ['feed'] }))
    })
    let probeReaders = 0
    for (const value of values)
        probeReaders += cellOf<{ probeReaders: unknown[] }>(value).probeReaders
            .length
    expect(`probe readers: ${probeReaders}`).toBe('probe readers: 0')
    loads.settleAll(1)
    await Bun.sleep(1)
    flushSync()
    stop()
    expect(`saw: ${saw.join(',')}`).toBe('saw: true,false')
})

// An entry evicted by its `ttl` is out of the map, and a sweep — by tag or bare — must not go on
// reaching it: that would be a reload for a key nothing can read any more. Its handle is what every
// selection index holds it by, so the handle being gone is the whole of it leaving.
//
// THE REVERT is the eviction not calling `leaveSelections`: `still in a selection: true`. The run
// count cannot tell — nothing reads the entry, so the sweep reaching it only marks it — and that
// was once the whole of this gate, green with the eviction reverted.
test('an evicted keyed entry leaves every selection', async () => {
    let runs = 0
    const keyed = reactive(
        async (args: { id: number }) => {
            runs += 1
            return args.id
        },
        { ttl: 20, tags: ['evictable'] },
    )
    const entry = keyed({ id: 1 })
    await entry
    await Bun.sleep(80)
    expect(keyed.entries.size).toBe(0)
    invalidate({ tags: ['evictable'] })
    refresh({ tags: ['evictable'] })
    expect(`runs: ${runs}`).toBe('runs: 1')
    expect(
        `still in a selection: ${cellOf<{ ref: unknown }>(entry).ref !== null}`,
    ).toBe('still in a selection: false')
})

// ── `store`: where a value lives when the process does not (RULEBOOK 8, 9.11, 11.43) ──────

// A store over a plain map, with every call recorded. `answer` decides what `get` hands back —
// a value, `undefined` for a miss, a promise, or a throw — and `slow` holds each `set` open until
// released, so a case can pile writes up behind one in flight.
function memoryStore<Stored>(initial?: {
    answer?: () => Stored | undefined | Promise<Stored | undefined>
    slow?: boolean
}): {
    store: {
        get: () => never
        set: (value: Stored, retention: { ttl: number }) => never
    }
    gets: number
    sets: { value: Stored; ttl: number }[]
    release: () => void
} {
    const record = {
        gets: 0,
        sets: [] as { value: Stored; ttl: number }[],
        releases: [] as (() => void)[],
    }
    const store = {
        get: () => {
            record.gets += 1
            return initial?.answer?.()
        },
        set: (value: Stored, retention: { ttl: number }) => {
            record.sets.push({ value, ttl: retention.ttl })
            if (initial?.slow !== true) return undefined
            return new Promise<void>((resolve) => {
                record.releases.push(resolve)
            })
        },
    }
    return {
        store: store as never,
        get gets() {
            return record.gets
        },
        get sets() {
            return record.sets
        },
        release: () => {
            for (const resolve of record.releases.splice(0)) resolve()
        },
    }
}

// 8.3, 8.4, 8.15 AND 8.17. A store answers before the initial value, a miss falls back to it, and
// a synchronous `get` is not a load — the value is there at construction with nothing pending.
test('a store answers before the initial value, and a miss falls back to it', () => {
    const hit = memoryStore<number>({ answer: () => 9 })
    const restored = reactive(4, { store: hit.store })
    expect(`restored: ${restored()}`).toBe('restored: 9')
    expect(`busy: ${restored.busy()}`).toBe('busy: false')

    const miss = memoryStore<number>({ answer: () => undefined })
    expect(`miss: ${reactive(4, { store: miss.store })()}`).toBe('miss: 4')

    const unreadable = memoryStore<number>({
        answer: () => {
            throw new Error('corrupt')
        },
    })
    const warn = console.warn
    console.warn = (): void => {}
    try {
        expect(
            `unreadable: ${reactive(4, { store: unreadable.store })()}`,
        ).toBe('unreadable: 4')
    } finally {
        console.warn = warn
    }
})

// An unsettled `get` IS a load: busy with nothing to serve until it answers.
test('an async get is a load until it answers', async () => {
    const slow = memoryStore<number>({ answer: () => Promise.resolve(9) })
    const value = reactive(4, { store: slow.store })
    expect(`busy: ${value.busy()}`).toBe('busy: true')
    expect(`ready: ${value.ready()}`).toBe('ready: false')
    expect(await value).toBe(9)
    expect(`busy after: ${value.busy()}`).toBe('busy after: false')
})

// 8.5: A RESTORE IS NOT A WRITE. The gates are for what goes IN, and a restore hands back what was
// already stored — a transform that stamps or narrows would re-apply to its own output.
test('a restore runs neither schema nor transform', () => {
    let gates = 0
    const hit = memoryStore<number>({ answer: () => 9 })
    const value = reactive(4, {
        store: hit.store,
        schema: (input: unknown) => {
            gates += 1
            return input as number
        },
        transform: (input: number) => {
            gates += 1
            return input * 100
        },
    })
    expect(`value: ${value()}`).toBe('value: 9')
    expect(`gates: ${gates}`).toBe('gates: 0')
})

// 8.8 AND 8.13: `set` RUNS PER PRODUCTION, handed the value's own `ttl`. A write `identity`
// collapsed is not a production and is not written, and neither is the restore — writing back what
// was just read is a round trip for nothing.
//
// THE REVERT is `persist` ignoring `restoring`: `sets: 9,5,6`.
test('set runs once per production, with the ttl, and never for the restore', () => {
    const memory = memoryStore<number>({ answer: () => 9 })
    const value = reactive(4, { store: memory.store, ttl: 60_000 })
    value.set(5)
    value.set(5)
    value.set(6)
    expect(`sets: ${memory.sets.map((write) => write.value).join(',')}`).toBe(
        'sets: 5,6',
    )
    expect(`ttl: ${memory.sets[0]?.ttl}`).toBe('ttl: 60000')
})

// 8.10 AND 8.11: WRITES COALESCE LATEST-WINS. One in flight, one pending, and every later write
// replaces the pending one — a slow store is handed the first and the last, never a queue of
// intermediates nobody can observe, and a read never waits on any of it.
//
// THE REVERT is `writeStore` sending every production: `in flight: 0,1,2,3,4`.
test('writes to a slow store coalesce latest-wins and never block a read', async () => {
    const memory = memoryStore<number>({ answer: () => undefined, slow: true })
    const value = reactive(0, { store: memory.store })
    for (let step = 1; step <= 4; step += 1) value.set(step)
    expect(value()).toBe(4)
    expect(
        `in flight: ${memory.sets.map((write) => write.value).join(',')}`,
    ).toBe('in flight: 0')
    memory.release()
    await Bun.sleep(1)
    memory.release()
    await Bun.sleep(1)
    expect(`sets: ${memory.sets.map((write) => write.value).join(',')}`).toBe(
        'sets: 0,4',
    )
})

// 8.12: A PERSISTER THAT SILENTLY STOPPED IS WORSE THAN NONE. A failed write warns and the store
// stays attached, so the next production is written like any other.
test('a failed store write warns, reaches onError, and the next production is still written', () => {
    let fail = true
    const written: number[] = []
    const store = {
        get: (): number | undefined => undefined,
        set: (value: number): void => {
            if (fail) {
                fail = false
                throw new Error('disk full')
            }
            written.push(value)
        },
    }
    const warnings: unknown[] = []
    const handed: unknown[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]): void => {
        warnings.push(args.join(' '))
    }
    const unfile = onError((error) => {
        handed.push(error)
    })
    try {
        // No opening value, so the first production is the first write and nothing precedes it.
        const value = reactive<number>(undefined, { store: store as never })
        value.set(1)
        value.set(2)
    } finally {
        console.warn = warn
        unfile()
    }
    expect(`written: ${written.join(',')}`).toBe('written: 2')
    expect(`warned: ${String(warnings[0])}`).toContain('abide:reactive')
    expect(`handed: ${handed.map(String).join(',')}`).toBe(
        'handed: Error: disk full',
    )
})

// A STORE IN FRONT OF A BODY IS A CACHE: `get` on a cold entry, the body on a miss, `set` on every
// production — and 8.16, a trigger reloads from the body, since re-reading the cache it would be
// refreshing could never fetch anything newer than itself.
test('a store in front of a body is read first, and the body runs on a miss and on a trigger', () => {
    let runs = 0
    const hit = memoryStore<number>({ answer: () => 41 })
    const cached = reactive(
        () => {
            runs += 1
            return 1
        },
        { store: hit.store },
    )
    expect(`cached: ${cached()}`).toBe('cached: 41')
    expect(`runs on a hit: ${runs}`).toBe('runs on a hit: 0')
    cached.refresh()
    expect(`after refresh: ${cached()}`).toBe('after refresh: 1')
    expect(`set: ${hit.sets.map((write) => write.value).join(',')}`).toBe(
        'set: 1',
    )

    const miss = memoryStore<number>({ answer: () => undefined })
    let missRuns = 0
    const computed = reactive(
        () => {
            missRuns += 1
            return 7
        },
        { store: miss.store },
    )
    expect(`miss: ${computed()}`).toBe('miss: 7')
    expect(`runs on a miss: ${missRuns}`).toBe('runs on a miss: 1')
})

// 8.2: `get` IS A PRODUCER, so the triggers stop being inert on a value that has one — a refresh
// re-reads the store, where another tab may have written.
test('refresh on a value with a store re-reads the store', () => {
    let stored = 1
    const memory = memoryStore<number>({ answer: () => stored })
    const theme = reactive(0, { store: memory.store })
    expect(theme()).toBe(1)
    stored = 2
    theme.refresh()
    expect(`after refresh: ${theme()}`).toBe('after refresh: 2')
    expect(`gets: ${memory.gets}`).toBe('gets: 2')
})

// 8.9, 8.6 AND 8.7 ON A STREAM. `set` runs once at the close, on the accumulation and never a
// partial; a restore seeds the ring with it, so a cursor replays it, and the value reads as
// finished — ready and not busy — with the body never started.
test('a stream is stored once at close, and a restore is a finished stream', async () => {
    const memory = memoryStore<number[]>({ answer: () => undefined })
    const feed = streamOf<number>()
    reactive(feed.body, { store: memory.store })
    const run = feed.runs[0] as Run<number>
    run.push(1)
    run.push(2)
    await turns()
    expect(`sets mid-stream: ${memory.sets.length}`).toBe('sets mid-stream: 0')
    run.close()
    await turns()
    expect(
        `stored: ${JSON.stringify(memory.sets.map((write) => write.value))}`,
    ).toBe('stored: [[1,2]]')

    const restoredFeed = streamOf<number>()
    const restoring = memoryStore<number[]>({ answer: () => [5, 6] })
    const restored = reactive(restoredFeed.body, { store: restoring.store })
    expect(`started: ${restoredFeed.runs.length}`).toBe('started: 0')
    expect(`ready: ${restored.ready()}, busy: ${restored.busy()}`).toBe(
        'ready: true, busy: false',
    )
    const cursor = restored[Symbol.asyncIterator]()
    const replayed = [(await cursor.next()).value, (await cursor.next()).value]
    await cursor.return?.()
    expect(`replayed: ${replayed.join(',')}`).toBe('replayed: 5,6')
})

// 8.6 SEEDS THE RING AND 8.7 KEEPS THE BODY OFF — and `retainRun`, which is what enters an
// accumulation into the past and stamps the mint, is reached only from `pump`. So a
// restored stream never became a CLOSED run: `standingLive` answered false for the life
// of the value, which takes the `ttl` out of `expire` and `sweepExpiry` silently — it never
// drops and never re-reads the store — and leaves 8.6's seeded window unreachable through
// `s.history`.
//
// THE REVERT is `restoreStream` stopping at the cascade: `past: ` with nothing after it.
// The value and the CURSOR are both right on either arm — `s()` reads the accumulation and
// `s[Symbol.asyncIterator]` replays it from the chunk buffer — which is why the case above
// passes with this broken.
test('a restored stream is a run that closed, not a run in flight', () => {
    const restoredFeed = streamOf<number>()
    const restoring = memoryStore<number[]>({ answer: () => [5, 6] })
    const restored = reactive(restoredFeed.body, {
        store: restoring.store,
        history: 3,
    })
    expect(`started: ${restoredFeed.runs.length}`).toBe('started: 0')
    expect(
        `past: ${[...restored.history()].map((run) => (run as number[]).join('')).join('|')}`,
    ).toBe('past: 56')
})

// 11.43: A KEYED STORE IS A FUNCTION OF THE ARGS. Closing over one key gives every entry the same
// store, and they clobber each other silently.
test('a keyed store is built per entry from its args', () => {
    const stores = new Map<number, ReturnType<typeof memoryStore<string>>>()
    const profile = reactive((args: { id: number }) => `computed ${args.id}`, {
        store: (args) => {
            const memory = memoryStore<string>({
                answer: () => (args?.id === 1 ? 'stored 1' : undefined),
            })
            stores.set(args?.id as number, memory)
            return memory.store
        },
    })
    expect(profile({ id: 1 })()).toBe('stored 1')
    expect(profile({ id: 2 })()).toBe('computed 2')
    expect(`entry 2 wrote: ${stores.get(2)?.sets[0]?.value}`).toBe(
        'entry 2 wrote: computed 2',
    )
    expect(`entry 1 wrote: ${stores.get(1)?.sets.length}`).toBe(
        'entry 1 wrote: 0',
    )
})

// 9.11: A STORE HOLDS THE LATEST PRODUCTION, never the ring.
test('a store on a value with history round-trips the latest production and not the ring', () => {
    const memory = memoryStore<string>({ answer: () => 'restored' })
    const room = reactive<string>(undefined, {
        history: 9,
        store: memory.store,
    })
    expect(room()).toBe('restored')
    room.publish('a')
    room.publish('b')
    expect(`sets: ${memory.sets.map((write) => write.value).join(',')}`).toBe(
        'sets: a,b',
    )
})

// 8.18: A WRITE THE APP HAS MADE IS NEWER THAN ANYTHING THE STORE CAN ANSWER, so the store is not
// asked while one is unconfirmed. THE CONTRACT IS THAT THE `get` DOES NOT HAPPEN — the value the
// read serves is right either way for one turn, and then the queued write lands and the two part
// company permanently. So the assertion is the WORK.
//
// THE REVERT: drop the `persisted.writing` arm from `rereadStore`. This reports `reads: 1` where 0
// is due and `value: 1` where 99 is — the cell reverted to what the store still held, the store
// then took 99, and nothing moved a probe to say the two disagree.
test('a store is not read behind a write it has not confirmed', () => {
    const slow = memoryStore<number>({ answer: () => 1, slow: true })
    const value = reactive<number, number>(0, { store: slow.store })
    expect(`restored: ${value()}`).toBe('restored: 1')

    const reads = slow.gets
    value.set(99)
    value.refresh()
    expect(`reads: ${slow.gets - reads}`).toBe('reads: 0')
    expect(`value: ${value()}`).toBe('value: 99')

    slow.release()
})

// 8.19: A MISS WITH NOTHING LEFT TO SERVE IS A FAILURE, not a state to sit in. 6.13 released the
// standing production and 6.12 ran the producer on the read that followed; on a value whose only
// producer is its store there is nothing to fall through to when that producer answers nothing.
//
// EVERY PROBE IS ASSERTED BECAUSE EVERY PROBE WAS SILENT: `{#if s.busy()}` and `{#if s.error()}`
// both rendered nothing while the value was gone, and the read threw `NotLanded` for the life of
// the page — `expire` returning at `dropped` meant nothing ever asked the store again.
//
// THE REVERT: put `settleMiss`'s restoration back behind `if (cell.landed)`. This reports
// `error: undefined` and `threw: NotLanded`.
test('a store miss after a ttl drop lands an error rather than going silent', async () => {
    let answer: number | undefined = 5
    const store = {
        get: () => answer,
        set: () => undefined,
    }
    const value = reactive<number, number>(undefined as never, {
        store: store as never,
        ttl: 20,
    })
    expect(`first: ${value()}`).toBe('first: 5')

    answer = undefined
    await Bun.sleep(80)
    let threw = 'nothing'
    try {
        value()
    } catch (thrown) {
        threw = (thrown as Error).name
    }
    expect(`threw: ${threw}`).toBe('threw: Error')
    expect(
        `error: ${(value.error() as Error | undefined)?.message.includes('RULEBOOK 8.19')}`,
    ).toBe('error: true')
    expect(`busy: ${value.busy()}`).toBe('busy: false')
    expect(`ready: ${value.ready()}`).toBe('ready: false')
})

// ── `invalidate` is lazy (RULEBOOK 7.3, 7.12, 7.13, 7.14, 7.15, 7.16) ─────────────────────

// 7.3 AND 7.12: A MARK, NOT A LOAD. Nothing runs at the call, subscribed or not, and the read
// that follows is what runs the producer — so an invalidate over values nobody reads again costs
// nothing, where the eager one sent a request for each.
//
// THE REVERT is `invalidateOne` starting the producer itself: `runs at the call: 2`.
test('invalidate runs nothing until the next read, which runs fresh', () => {
    let answer = 1
    let runs = 0
    const held = reactive(() => {
        runs += 1
        return answer
    })
    expect(held()).toBe(1)
    answer = 2
    held.invalidate()
    expect(`runs at the call: ${runs}`).toBe('runs at the call: 1')
    expect(`read: ${held()}`).toBe('read: 2')
    expect(`runs after the read: ${runs}`).toBe('runs after the read: 2')
})

// 7.14 AND 7.17: THE MARK WAKES NOBODY. What is on screen stays — the value and every guard over it
// — which is what lets a server say "yours is stale" without the page moving. The next hit is what
// reloads: here a read by hand, and a guard's own probe would do the same (3.2).
//
// THE REVERT is `invalidateOne` waking the probe readers: the guard runs at the mark, its probe
// pulls the reload, and the value readers wake 1 time where 0 are due.
test('invalidate wakes no reader, and the next hit reloads', () => {
    let answer = 1
    const held = reactive(() => answer)
    let valueWakes = 0
    const stopValue = watch(() => {
        held()
        valueWakes += 1
    })
    const guard: boolean[] = []
    const stopGuard = watch(() => {
        guard.push(held.ready())
    })
    valueWakes = 0
    answer = 2
    held.invalidate()
    flushSync()
    expect(`value wakes: ${valueWakes}`).toBe('value wakes: 0')
    expect(`guard: ${guard.join(',')}`).toBe('guard: true')
    expect(`read: ${held()}`).toBe('read: 2')
    stopValue()
    stopGuard()
})

// 7.13: A VALUE BUILT FROM AN INVALIDATED ONE IS NOT SERVED FROM ITS OWN FIELD. Its read reaches
// back and runs the producer that owes a reload first, and the ordinary cascade from what that
// producer mints does the rest — so a derived value read by hand after an invalidate is fresh.
//
// THE REVERT is `readIndirect` not pulling what is owed: `derived: 10`.
test('a read of a derived value runs the producer an invalidate marked upstream', () => {
    let answer = 1
    const source = reactive(() => answer)
    const derived = reactive(() => source() * 10)
    expect(derived()).toBe(10)
    answer = 2
    source.invalidate()
    expect(`derived: ${derived()}`).toBe('derived: 20')
})

// 7.15: A LOAD IN FLIGHT WHEN THE VALUE IS MARKED WRONG was started from what the mark says is
// wrong, so its answer lands nowhere; the read that follows starts the one that counts.
test('invalidate discards the load it finds in flight', async () => {
    const settles: ((value: number) => void)[] = []
    const held = reactive(
        () =>
            new Promise<number>((resolve) => {
                settles.push(resolve)
            }),
    )
    held.invalidate()
    ;(settles[0] as (value: number) => void)(1)
    await Bun.sleep(1)
    expect(`ready after the discarded load: ${held.ready()}`).toBe(
        'ready after the discarded load: false',
    )
    expect(() => held()).toThrow(NotLanded)
    ;(settles[1] as (value: number) => void)(2)
    expect(await held).toBe(2)
})

// 7.15 FOR A STREAM: the run in flight stops reaching the value, and the read after the mark
// starts a new one.
test('invalidate stops a stream in flight, and the next read starts a new run', async () => {
    const feed = streamOf<number>()
    const rows = reactive(feed.body)
    const first = feed.runs[0] as Run<number>
    first.push(1)
    await turns()
    rows.invalidate()
    first.push(2)
    await turns()
    expect(`runs before a read: ${feed.runs.length}`).toBe(
        'runs before a read: 1',
    )
    expect(() => rows()).toThrow(NotLanded)
    expect(`runs after a read: ${feed.runs.length}`).toBe(
        'runs after a read: 2',
    )
    ;(feed.runs[1] as Run<number>).push(9)
    await turns()
    expect(rows()).toEqual([9])
})

// 1.7 THROUGH `then`: awaiting a marked value is reaching it, so it runs the producer rather than
// waiting on a load nothing started.
test('awaiting an invalidated value runs its producer', async () => {
    let answer = 1
    const held = reactive(() => Promise.resolve(answer))
    await held
    answer = 2
    held.invalidate()
    expect(`awaited: ${await held}`).toBe('awaited: 2')
})

// 7.13 THROUGH AN ADOPTION: the adopter's read reaches the adopted value's owed reload.
test('reading a value adopting an invalidated one runs the adopted producer', () => {
    let answer = 1
    const inner = reactive(() => answer)
    const outer = reactive(() => inner)
    expect(outer()).toBe(1)
    answer = 2
    inner.invalidate()
    expect(`outer: ${outer()}`).toBe('outer: 2')
})

// 7.9: A WRITE OVER A MARKED VALUE SETTLES THE MARK. What the invalidate said was wrong has been
// replaced by the app's own answer, so that answer is served and ready, and the reload the mark
// owed is not run over it. Both write paths: the `simple` seat's short write and the gated one
// (`identity` declared) through `produce`.
//
// THE REVERT is `produce` and the short write leaving `owes` standing: `peek: undefined`, and the
// body reloads and `loaded` overwrites `written`.
test('a write over an invalidated value is served, and the owed reload is not run', async () => {
    for (const options of [undefined, { identity: structural }]) {
        let runs = 0
        const held = reactive(async () => {
            runs += 1
            return 'loaded'
        }, options)
        await held
        held.invalidate()
        held.set('written')
        expect(`peek: ${held.peek()}`).toBe('peek: written')
        expect(`ready: ${held.ready()}`).toBe('ready: true')
        expect(`read: ${held()}`).toBe('read: written')
        await Promise.resolve()
        expect(`runs: ${runs}, then: ${held()}`).toBe('runs: 1, then: written')
    }
})

// 7.9 OVER A STREAM, whose write stands over the accumulation through a path of its own.
//
// THE REVERT is `standWrite` leaving `owes` standing: `ready: false`.
test('a write over an invalidated stream is served, and the owed run is not started', async () => {
    let runs = 0
    const held = reactive(async function* () {
        runs += 1
        yield 'chunk'
    })
    await held
    held.invalidate()
    held.set(['written'])
    expect(`ready: ${held.ready()}`).toBe('ready: true')
    expect(`read: ${held.peek()}`).toBe('read: written')
    await Promise.resolve()
    expect(`runs: ${runs}`).toBe('runs: 1')
})

// ── `history` on every value (RULEBOOK 6.16, 9.15, 9.28, 11.39) ─────────────────────────────

// 6.16: WITH NO HISTORY THE STANDING PRODUCTION IS WHAT IS RETAINED, so `s.history` is a member of every
// value and replays that one before going live — a reader never has to know which kind it holds.
//
// THE REVERT is `retained` answering 0 where there is no ring: `replayed: ` with nothing after it.
test('tail on a value declaring no history replays the standing production, then goes live', async () => {
    const value = reactive(1)
    expect(`replayed: ${[...value.history(5)].join(',')}`).toBe('replayed: 1')
    const cursor = value.history(5)[Symbol.asyncIterator]()
    expect((await cursor.next()).value).toBe(1)
    value.set(2)
    expect((await cursor.next()).value).toBe(2)
    await cursor.return?.()
})

// 11.39 AND 9.28: A BODY AND A KEYED VALUE TAKE `history` TOO, and a keyed value retains it per entry.
//
// THE REVERT is `createKeyed` dropping `history` from what entries are built from:
// `a: a2` rather than `a: seed a,a1,a2`.
test('a keyed value declaring history retains it per entry', () => {
    const threads = reactive(({ id }: { id: string }) => `seed ${id}`, {
        history: 5,
    })
    const a = threads({ id: 'a' })
    const b = threads({ id: 'b' })
    a.publish('a1')
    b.publish('b1')
    a.publish('a2')
    expect(`a: ${[...a.history()].join(',')}`).toBe('a: seed a,a1,a2')
    expect(`b: ${[...b.history()].join(',')}`).toBe('b: seed b,b1')
    const derived = reactive(() => a().toUpperCase(), { history: 1 })
    expect(derived()).toBe('A2')
    a.publish('a3')
    expect(derived()).toBe('A3')
    expect(`derived: ${[...derived.history()].join(',')}`).toBe(
        'derived: A2,A3',
    )
})

// 6.16 AGAINST 6.1: `history: n` retains n past productions BESIDE the standing one.
//
// THE REVERT is a ring of `history` rather than `history + 1`: `retained: 3,4`.
test('history counts the productions before the standing one', () => {
    const value = reactive(0, { history: 2 })
    for (const next of [1, 2, 3, 4]) value.set(next)
    expect(`retained: ${[...value.history()].join(',')}`).toBe(
        'retained: 2,3,4',
    )
})

// 7.8 THROUGH A REFRESH. A refresh is the load an invalidate owed, and it is a load over a value
// marked wrong — so it does not serve what is held meanwhile the way a refresh over a good value
// does (7.4). `invalidate(); refresh()` blanks, which is the order the reload guide warns about.
//
// THE REVERT is `refreshOne` clearing the debt without unserving: `ready: true`.
test('a refresh over an invalidated value does not serve what the mark said was wrong', () => {
    const settled = reactive(() => 1)
    settled.invalidate()
    settled.refresh()
    expect(settled()).toBe(1)
    const loading = reactive(() => Promise.resolve(1))
    return loading.then(() => {
        loading.invalidate()
        loading.refresh()
        expect(`ready: ${loading.ready()}`).toBe('ready: false')
        expect(`busy: ${loading.busy()}`).toBe('busy: true')
    })
})

// 2.8 AND 1.7 THROUGH A DERIVED VALUE. Awaiting a value whose body aborted on a source still in flight
// has to pull it once the source lands: nothing else reads it, so it sits marked and unrun, and a waiter
// that only asked whether it was busy was asking the run that aborted — the await never settled.
//
// THE REVERT is the waiter asking `busyNow` without resolving first: the test times out.
test('awaiting a derived value settles once the source it aborted on lands', async () => {
    let settle: (value: number) => void = (): void => {}
    const source = reactive(
        new Promise<number>((resolve) => {
            settle = resolve
        }),
    )
    const doubled = reactive(() => source() * 2)
    const awaited = doubled.then((value) => value)
    settle(21)
    expect(`awaited: ${await awaited}`).toBe('awaited: 42')
})

// 9.15: AN ADOPTING VALUE'S PAST IS THE ADOPTED VALUE'S, by delegation to whatever it adopts now —
// and its own once its body stops handing one back.
//
// THE REVERT is `tail` reading the adopter's own ring: `forwarded: again`.
test('tail on an adopting value forwards to what it adopts', () => {
    const conversation = reactive<string>(undefined, { history: 4 })
    conversation.publish('hello')
    conversation.publish('again')
    const adopting = reactive(true)
    const outer = reactive(() => (adopting() ? conversation : 'plain'))
    expect(outer()).toBe('again')
    expect(`forwarded: ${[...outer.history()].join(',')}`).toBe(
        'forwarded: hello,again',
    )
    adopting.set(false)
    expect(outer()).toBe('plain')
    expect(`after: ${[...outer.history()].join(',')}`).toBe('after: plain')
})

// ── Writes through adoption, and `undefined` (RULEBOOK 11.60, 11.63, 4.14, 4.15, 6.18, 6.19) ────

// 11.62: A `Reactive` WRITTEN IS ADOPTED, which is 11.12's sentence about a body's return value,
// said once more about a write. Storing it instead is what 1.6 calls the hazard: the callable is
// thenable, so the value would settle to one snapshot of what it was holding and stop following it.
// After the write the two are one value — a production of the inner is a production of this, and a
// write here reaches the inner through 11.60.
//
// THE REVERT is `setThroughGates` accepting a `Reactive` as a value: `after: 1`, the outer frozen
// on the snapshot it took.
test('a Reactive written with set is adopted rather than stored', () => {
    const inner = reactive(1)
    const held = reactive<number | undefined>(undefined)
    held.set(inner)
    expect(`adopted: ${held()}`).toBe('adopted: 1')
    let woken = 0
    const stop = held.watch(() => {
        woken += 1
    })
    woken = 0
    inner.set(2)
    flushSync()
    expect(`after: ${held()}`).toBe('after: 2')
    expect(`woken: ${woken}`).toBe('woken: 1')
    // 11.60 from the other end: the adopter's own write is the adopted value's.
    held.set(9)
    flushSync()
    expect(`inner after a write to the adopter: ${inner()}`).toBe(
        'inner after a write to the adopter: 9',
    )
    stop()
})

// 11.19 THROUGH 11.62: `paid = payInvoice(…)` over a `reactive()` that holds nothing. The guard
// asking `paid.busy()` subscribed before the write, and the write moves the probe by ADOPTING —
// no production, and the mirror's `unserve` finds nothing to lose — so the guard has to be woken
// by the adoption itself, onto true, and again onto false when the call lands.
//
// THE REVERT is dropping the `probesMoved` at the end of `adopt`: `seen: false,false` — the
// guard never shows the load, and wakes only once it is over.
test('a busy guard hears a write that adopts a call in flight', async () => {
    const paid = reactive<number>()
    const seen: boolean[] = []
    const stop = watch(() => {
        seen.push(paid.busy())
    })
    let settle: (value: number) => void = (): void => {}
    const call = reactive(
        new Promise<number>((resolve) => {
            settle = resolve
        }),
    )
    paid.set(call as never)
    flushSync()
    settle(1)
    await call
    flushSync()
    stop()
    expect(`seen: ${seen.join(',')}`).toBe('seen: false,true,false')
})

// 11.60: AN ADOPTING VALUE IS THE VALUE IT ADOPTS, writes included. A write standing on the adopter
// alone was the one member that did not reach through, so a value built over a shared entry held a
// private copy of every edit made to it.
//
// THE REVERT is `ADOPTING_PROTOTYPE`'s `set` writing the adopter itself: `source after set: 1`.
test('set, publish and patch on an adopting value reach the adopted value', () => {
    const source = reactive({ n: 1 })
    const outer = reactive(() => source)
    expect(outer().n).toBe(1)
    outer.set({ n: 2 })
    expect(`source after set: ${source().n}`).toBe('source after set: 2')
    outer.publish({ n: 3 })
    expect(`source after publish: ${source().n}`).toBe(
        'source after publish: 3',
    )
    let woken = 0
    const stop = source.watch(() => {
        woken += 1
    })
    woken = 0
    outer.patch((value) => {
        value.n = 4
    })
    flushSync()
    stop()
    expect(`source woken by patch: ${woken}`).toBe('source woken by patch: 1')
    expect(outer().n).toBe(4)
})

// 11.63, 6.18 AND 4.16: A KEYED VALUE WITH NOTHING TO LOAD answers `undefined`, which is a value like
// any other — loaded, ready, read — and is never retained, so its history starts at the first publish.
// The opening `undefined` is not shaped either: the `transform` is for messages.
//
// THE REVERT is `produce` retaining an `undefined`: `retained: hello,,again`; and `run`
// sending a first `undefined` through the pipeline: `transformed: 1`.
test('a body answering undefined is loaded, and undefined never enters history', () => {
    type Turn = { speaker: string; text: string }
    let transformed = 0
    const turns = reactive(
        (_: { conversation: string }): Turn | undefined => undefined,
        {
            history: 50,
            transform: (turn) => {
                transformed += 1
                return turn
            },
        },
    )
    const onboarding = turns({ conversation: 'onboarding' })
    expect(`ready: ${onboarding.ready()}`).toBe('ready: true')
    expect(onboarding()).toBeUndefined()
    expect(`transformed: ${transformed}`).toBe('transformed: 0')
    expect(`replayed: ${[...onboarding.history()].length}`).toBe('replayed: 0')
    onboarding.publish({ speaker: 'ada', text: 'hello' })
    onboarding.publish(undefined)
    onboarding.publish({ speaker: 'ada', text: 'again' })
    expect(
        `retained: ${[...onboarding.history()].map((turn) => turn?.text).join(',')}`,
    ).toBe('retained: hello,again')
})

// 6.19 WITH NO HISTORY: the standing production is what a cursor takes, and an `undefined` standing is
// nothing to take — a cursor that fell behind a production and then an `undefined` waits for the next.
//
// THE REVERT is `take` handing over the standing value whatever it is: `turn: undefined`.
test('a cursor is never handed undefined', async () => {
    const selected = reactive<string | undefined>('a')
    const cursor = selected.history(1)[Symbol.asyncIterator]()
    expect((await cursor.next()).value).toBe('a')
    selected.set('b')
    selected.set(undefined)
    expect(`sync: ${[...selected.history(1)].length}`).toBe('sync: 0')
    let turn: unknown = 'none'
    const next = cursor.next().then((result) => {
        turn = result.value
    })
    await Promise.resolve()
    expect(`turn: ${turn}`).toBe('turn: none')
    selected.set('c')
    await next
    expect(`turn: ${turn}`).toBe('turn: c')
})

// 4.14 AGAINST 4.15: NO ARGUMENT IS EMPTY, AND `undefined` IS A VALUE.
//
// THE REVERT is the factory passing `first` whatever the arity: `empty ready: true`.
// AN OPENING VALUE THAT MAY BE `undefined` KEEPS IT IN ITS TYPE, which is 4.15 as the checker sees
// it. THE REVERT: make `initial` optional on the value overload; `Accepted` is inferred as `string`,
// and `bun run typecheck` refuses the `set(undefined)` below (TS2345).
test('reactive(initial) accepts the undefined its initial value may be', () => {
    const opening = ['ada'].find((name) => name.length > 9)
    const held = reactive(opening)
    expect(held()).toBe(undefined)
    held.set('grace')
    held.set(undefined)
    expect(held()).toBe(undefined)
})

// 11.2 — A BODY WHOSE PARAMETER IS OPTIONAL IS KEYED, in its type as it is at run time: called with
// the record or without it, and refused a record its parameter does not take. THE REVERT: drop the
// optional-parameter overload; the checker types `tags` unkeyed, and `bun run typecheck` refuses the
// call that passes a record (TS2554) — while at run time it was keyed all along.
test('a body with an optional parameter is typed keyed — 11.2', async () => {
    const tags = reactive(
        async (args?: { type?: 'genre' | 'mood' }) => args?.type ?? 'all',
    )
    expect(isKeyed(tags)).toBe(true)
    expect(await tags()).toBe('all')
    expect(await tags({ type: 'mood' })).toBe('mood')
    // @ts-expect-error — a type the parameter does not take.
    void tags({ type: 'colour' })
    const count = reactive(() => 1)
    const counted: number = count()
    const invoice = reactive(({ id }: { id: number }) => id)
    // @ts-expect-error — a required parameter stays required.
    void invoice()
    expect({ counted, keyed: isKeyed(invoice) }).toEqual({
        counted: 1,
        keyed: true,
    })
})

// 11.2 — AND WHATEVER DECLARES THE PARAMETER: a stream's optional one, a defaulted one and a rest
// one, none of which `length` counts. THE REVERT: tell the forms apart by `length` in
// `isKeyedBody`; the defaulted and the rest bodies are built unkeyed — `isKeyed` answers false for
// both where true is due.
test('a defaulted, a rest and a streaming optional parameter are all keyed — 11.2', async () => {
    const paged = reactive(
        (args: { page: number } = { page: 1 }) => `page ${args.page}`,
    )
    const forwarded = reactive(
        (...given: [{ n: number }?]) => `rest ${given.length}`,
    )
    const streamed = reactive(async function* (args?: { from: number }) {
        yield args?.from ?? 0
    })
    expect([isKeyed(paged), isKeyed(forwarded), isKeyed(streamed)]).toEqual([
        true,
        true,
        true,
    ])
    expect([await paged({ page: 2 }), await forwarded({ n: 1 })]).toEqual([
        'page 2',
        'rest 1',
    ])
    const chunks: number[] = await streamed({ from: 3 })
    expect(chunks).toEqual([3])
    expect(await streamed()).toEqual([0])
})

test('reactive() is empty and reactive(undefined) is loaded', () => {
    const empty = reactive<string>()
    const loaded = reactive<string | undefined>(undefined)
    expect(`empty ready: ${empty.ready()}`).toBe('empty ready: false')
    expect(() => empty()).toThrow(NotLanded)
    expect(`loaded ready: ${loaded.ready()}`).toBe('loaded ready: true')
    expect(loaded()).toBeUndefined()
})

// ── A window on a keyed value holds back starting a key (RULEBOOK 5.19, 5.20, 5.21) ─────────

// 5.19 AND 5.20: A DEBOUNCE STARTS THE KEY THE REACHES STOPPED AT. A search box typing `n`, `no`,
// `nor` reaches three keys, and the two superseded before the window closed never make their call
// — 5.11's "don't start work a window would discard", across keys. They are not held either, so a
// later reach of one of them goes through the window again.
//
// THE REVERT is the factory starting each entry as it is reached: `calls: n,no,nor`.
test('a debounce on a keyed value starts only the key the reaches stopped at', async () => {
    const calls: string[] = []
    const search = reactive(
        (args: { query: string }) => {
            calls.push(args.query)
            return args.query.length
        },
        { debounce: WINDOW },
    )
    const first = search({ query: 'n' })
    search({ query: 'no' })
    const last = search({ query: 'nor' })
    expect(`calls: ${calls.join(',')}`).toBe('calls: ')
    // 5.21: held back is busy, with nothing to serve yet.
    expect(`busy: ${last.busy()}, ready: ${last.ready()}`).toBe(
        'busy: true, ready: false',
    )
    expect(`held: ${search.entries.size}`).toBe('held: 1')
    await sleep(AFTER_WINDOW)
    expect(`calls: ${calls.join(',')}`).toBe('calls: nor')
    expect(last()).toBe(3)
    expect(`superseded busy: ${first.busy()}`).toBe('superseded busy: false')
})

// 5.12 ACROSS KEYS: a throttle starts the first key at once, holds what is reached inside its
// window, and starts the latest of those when the window ends.
test('a throttle on a keyed value starts the first key at once and the latest at the window end', async () => {
    const calls: string[] = []
    const region = reactive(
        (args: { name: string }) => {
            calls.push(args.name)
            return args.name
        },
        { throttle: WINDOW },
    )
    region({ name: 'north' })
    region({ name: 'south' })
    region({ name: 'east' })
    expect(`calls: ${calls.join(',')}`).toBe('calls: north')
    await sleep(AFTER_WINDOW)
    expect(`calls: ${calls.join(',')}`).toBe('calls: north,east')
})

// A KEYED STREAM IS WHERE THIS PAYS MOST: a started key is a connection, not one request.
test('a debounce on a keyed stream opens one stream for a burst of reaches', async () => {
    const opened: string[] = []
    const rows = reactive(
        async function* (args: { region: string }) {
            opened.push(args.region)
            yield args.region
        },
        { debounce: WINDOW },
    )
    rows({ region: 'n' })
    rows({ region: 'no' })
    const settled = rows({ region: 'nor' })
    await sleep(AFTER_WINDOW)
    expect(`opened: ${opened.join(',')}`).toBe('opened: nor')
    expect(await settled).toEqual(['nor'])
})

// 31.8 — A WRITE THROUGH A MEMBER PATH COPIES DOWN THE PATH AND THEN WRITES, AND THE COPY IS NOT
// OPTIMISED AWAY. The copy is the whole of the clause: a `Reactive` wakes its readers on IDENTITY,
// so the value being right says nothing about whether anything saw it change. THE REVERT: have
// `copyOf` in `writePath` hand the value back instead of copying it. Every assertion about the
// VALUE below still passes — the page renders the right text on load — and the reader wakes 1 time
// where 2 are due, which is the page never moving again.
test('a write through a member path mints a new identity', () => {
    const user = reactive({ name: 'ada', tags: ['pascal'] })
    let woke = 0
    const stop = watch(() => {
        user()
        woke += 1
    })
    expect(woke).toBe(1)

    const before = user()
    // What `Lowering` emits for `user.name = 'grace'`.
    user.set(writePath(user(), ['name'], 'grace') as typeof before)
    flushSync()
    expect(woke).toBe(2)
    expect(user().name).toBe('grace')
    expect(user()).not.toBe(before)
    // THE COPY IS ONE LEVEL DEEP PER STEP. What the path did not walk keeps its identity, which is
    // what stops a write costing a copy of everything the value holds.
    expect(user().tags).toBe(before.tags)
    expect(before.name).toBe('ada')
    stop()
})

// 31.15 — AN OBJECT WITH ITS OWN BEHAVIOUR IS WRITTEN, NOT COPIED. `video.currentTime = t` over a
// `bind:element` ref is a seek: the element's setter is the whole point, and a spread of it is a
// plain object holding a few own fields. THE REVERT: drop the `isPlain` walk from `writePath`; the
// setter never runs (seeked reads undefined where 5 is due), the `Reactive` holds a husk rather than
// the player, and the reader wakes 2 times where 1 is due.
test('a write through a path into an object that is not plain data lands on it', () => {
    class Player {
        seeked: number | undefined = undefined
        set currentTime(time: number) {
            this.seeked = time
        }
    }
    const element = new Player()
    const video = reactive(element)
    let woke = 0
    const stop = watch(() => {
        video()
        woke += 1
    })
    // What `Lowering` emits for `video.currentTime = 5`.
    video.set(writePath(video(), ['currentTime'], 5) as Player)
    flushSync()
    expect(element.seeked).toBe(5)
    expect(video()).toBe(element)
    expect(woke).toBe(1)
    // And below plain data: the plain levels above it are not copied either.
    const holder = { player: element }
    expect(writePath(holder, ['player', 'currentTime'], 7)).toBe(holder)
    expect(element.seeked).toBe(7)
    stop()
})

// AN ARRAY STAYS AN ARRAY, which is why the copy is a helper rather than a spread the compiler
// writes: `rows[0] = v` spread as `{ ...rows() }` hands back an object, and `length`, `map` and
// every `{#for}` over it go with it.
test('a write through a path keeps the shape of every level it copies', () => {
    const rows = writePath([1, 2, 3], [0], 9) as number[]
    expect(Array.isArray(rows)).toBe(true)
    expect(rows).toEqual([9, 2, 3])

    const nested = writePath({ a: { b: 1, c: 2 } }, ['a', 'b'], 7) as {
        a: { b: number; c: number }
    }
    expect(nested.a).toEqual({ b: 7, c: 2 })

    const deep = writePath(
        { rows: [{ done: false }] },
        ['rows', 0, 'done'],
        true,
    )
    expect(deep).toEqual({ rows: [{ done: true }] })
    expect(Array.isArray((deep as { rows: unknown }).rows)).toBe(true)

    // An EMPTY path is the whole value, and a level that was never there is a fresh object rather
    // than a throw.
    expect(writePath({ a: 1 }, [], 2)).toBe(2)
    expect(writePath(undefined, ['a'], 1)).toEqual({ a: 1 })
})

// 11.24's key is a STRING, and `__proto__` is a setter on `Object.prototype` rather than a member:
// assigned onto a plain accumulator it created no own property, so it vanished from the wire form
// and two different `Args` canonicalised to one key — 1.8 then joined the second reach to the
// first's standing work. The revert is the accumulator's prototype: `{}` in place of
// `Object.create(null)` reports `'{"id":1}'` for both lines below.
test('an Args member named __proto__ keeps its own key', () => {
    expect(
        canonicalKey(JSON.parse('{"id":1,"__proto__":{"role":"admin"}}')),
    ).not.toBe(canonicalKey({ id: 1 }))
    expect(canonicalKey(JSON.parse('{"__proto__":{"admin":true}}'))).not.toBe(
        canonicalKey({}),
    )
})

// 31.8's copy-down write, through a path whose segments are runtime values. `__proto__` assigned
// rather than defined lost the write entirely, and a two-step path re-pointed the state object so
// the value read back while `JSON.stringify` had never heard of it.
test('a write through a __proto__ segment lands as a member', () => {
    const one = writePath({ a: 1 }, ['__proto__'], 'v') as Record<
        string,
        unknown
    >
    expect(Object.hasOwn(one, '__proto__')).toBe(true)
    expect(JSON.stringify(one)).toBe('{"a":1,"__proto__":"v"}')
    const two = writePath({ a: 1 }, ['__proto__', 'p'], 42) as Record<
        string,
        unknown
    >
    expect(Object.getPrototypeOf(two)).toBe(Object.prototype)
    expect(JSON.stringify(two)).toBe('{"a":1,"__proto__":{"p":42}}')
})

// The shape of an absent level is decided by the STEP that indexes it — `{}` for every miss handed
// back an object where an array was, and `length`, `map` and every later `{#for}` went with it.
test('a numeric step onto an absent level builds an array', () => {
    const rows = (
        writePath({ rows: undefined }, ['rows', 0], 5) as { rows: unknown }
    ).rows
    expect(Array.isArray(rows)).toBe(true)
    expect(rows).toEqual([5])
    expect(writePath({}, ['a', 'b'], 7)).toEqual({ a: { b: 7 } })
})

// 11.60 and 11.62 make an adoption cycle constructible from ordinary app code, and every walk of
// the chain — the write members, the triggers, the probes, `history` — is a plain loop to its end.
// THE REVERT is dropping the walk from `adopt`: `b.set(a)` returns, and the first write through
// either value hangs the process with the event loop blocked and nothing reported at all.
test('an adoption that would close a cycle is refused where it forms', () => {
    const a = reactive(1)
    const b = reactive(2)
    a.set(b as never)
    let thrown: unknown
    try {
        b.set(a as never)
    } catch (error) {
        thrown = error
    }
    expect((thrown as Error | undefined)?.message).toContain('cycle')
    // Refused, not half-made: `b` still holds its own value and `a` still reaches it.
    a.set(7 as never)
    expect(b()).toBe(7)
    expect(a()).toBe(7)
    try {
        a.set(a as never)
        thrown = undefined
    } catch (error) {
        thrown = error
    }
    expect((thrown as Error | undefined)?.message).toContain('cycle')
})

test('a body answering with a value that adopts it fails with the refusal', () => {
    let other: unknown = 1
    const a = reactive(() => other)
    const b = reactive(2)
    b.set(a as never)
    other = b
    a.refresh()
    expect(String(a.error())).toContain('cycle')
})

// 4.7 governs the SCHEMA as much as the transform, and only the transform was cleared. Run
// tracked, the gate's own reads were attributed to whatever reader stood on the stack. The revert
// is dropping the save/restore from `runSchema` in `#shared/Schema.ts`: the body then runs twice.
// The clearing is there rather than at the call site because `refuse.named` and `Keyed`'s
// argument gate reach `runSchema` without passing through `accept` at all.
test('a schema runs untracked', () => {
    const other = reactive(1)
    const source = reactive(0)
    const target = reactive(0, {
        schema: (value: unknown) => {
            other()
            return value
        },
    })
    let bodyRuns = 0
    watch(() => {
        bodyRuns += 1
        target.set(source() as never)
    })
    flushSync()
    const settled = bodyRuns
    other.set(2)
    flushSync()
    expect(bodyRuns).toBe(settled)
})

// 12.14 OVER A STREAM FOLLOWING A WRITE (9.25, 11.62). An own stream's `adoption` is the
// `Reactive` its standing write follows, not a stream it forwards — and releasing the orphan
// read it as a forward, nulled the stream's own record and left a wake already queued for it to
// read a field off `null` on the next task. The revert is dropping the `stream.source === null`
// return from `dropAdoption`: `stream` reads `null` against a record, and the queued
// `wakeStreams` throws `null is not an object`.
test('releasing an orphaned stream that follows a write keeps the stream its own', async () => {
    let push: (value: number) => void = (): void => {}
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    const s = reactive(async function* () {
        yield 1
        yield await new Promise<number>((resolve) => {
            push = resolve
        })
    })
    collectWatches(previous)
    await Bun.sleep(5)
    // The chunk lands and its wake is queued for the next task …
    push(2)
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
    // … and before that task the stream follows a write, and its owner stops.
    s.set(reactive(7) as never)
    for (const stop of stops) stop()
    expect(
        `stream: ${cellOf<{ stream: unknown }>(s).stream === null ? 'null' : 'own'}`,
    ).toBe('stream: own')
    let thrown: unknown
    const reported = (error: unknown): void => {
        thrown = error
    }
    process.on('uncaughtException', reported)
    await Bun.sleep(5)
    process.off('uncaughtException', reported)
    expect(String(thrown)).toBe('undefined')
})

// 2.4 PAST `next()`. The pump caught only the generator's own throw, so one raised while it lands
// or closes a run — here a `transform` the close reads through — rejected a promise nobody held:
// an unhandled rejection, and a value that went on reporting no error. The revert is dropping the
// `.then(undefined, …)` from `pumpRun`: `error` reads `undefined` and the rejection escapes.
test('a stream whose close throws refuses the run rather than rejecting into nothing', async () => {
    let escaped: unknown
    const reported = (error: unknown): void => {
        escaped = error
    }
    process.on('unhandledRejection', reported)
    const s = reactive(
        async function* () {
            yield 1
        },
        {
            transform: (): never => {
                throw new Error('bad transform')
            },
        } as never,
    )
    await Bun.sleep(5)
    process.off('unhandledRejection', reported)
    expect(String(s.error())).toBe('Error: bad transform')
    expect(String(escaped)).toBe('undefined')
})

// 13.2 AND 13.11 OVER KEYS NOT YET REACHED. `k.busy` subscribed to the probes of the entries there
// were, so a guard asked before the first search — search-as-you-type — never heard the key that
// started loading next, and went on saying idle over a load in flight. The revert is dropping the
// `signalMoved(membership)` from `reach` in `Keyed.ts`: the guard runs 1 time against 2, and
// reads `[false]` while `search.busy()` is true.
test('a keyed guard asked before a key is reached wakes when that key starts loading', () => {
    const search = reactive(
        (_args: { q: string }) => new Promise<string>(() => {}),
    )
    const sawBusy: boolean[] = []
    const sawReady: boolean[] = []
    const stopBusy = watch(() => {
        sawBusy.push(search.busy())
    })
    const stopReady = watch(() => {
        sawReady.push(search.ready())
    })
    flushSync()
    search({ q: 'a' })
    flushSync()
    expect(search.busy()).toBe(true)
    expect(sawBusy).toEqual([false, true])
    expect(sawReady).toEqual([true, false])
    // A key already reached is not a membership move, so reaching it again wakes nobody.
    search({ q: 'a' })
    flushSync()
    expect(sawBusy).toEqual([false, true])
    stopBusy()
    stopReady()
})

// The other half of membership: an entry RELEASED takes its answer with it. A refused entry holds
// `ready` false, and its eviction (11.46) moves no probe of its own — so a guard over the keyed
// value goes on saying not-ready over a map that no longer holds anything unready. The revert is
// dropping the `signalMoved(membership)` from `release` in `Keyed.ts`: `seen` ends `false` against
// `true`.
test('a keyed guard wakes when an entry it was answering from is released', async () => {
    const lookup = reactive(
        (_args: { id: number }): number => {
            throw new Error('no')
        },
        { ttl: 5 },
    )
    lookup({ id: 1 })
    const seen: boolean[] = []
    const stop = watch(() => {
        seen.push(lookup.ready())
    })
    flushSync()
    expect(seen).toEqual([false])
    await Bun.sleep(20)
    flushSync()
    expect(lookup.entries.size).toBe(0)
    expect(seen).toEqual([false, true])
    stop()
})

// THE DEDUP IN `track` MUST NOT BE QUADRATIC IN THE BODY. A body reading a thousand rows' values
// that diverges near its front — a row inserted at index 0 — asked the whole kept prefix about
// every read for the rest of the run. Counted as what it is, loads from the reader's `sources`:
// the right output either way, so the count is the gate. The revert is the scan alone in `track`
// (the `at < SET_OVER_SCAN` arm for every read): 504,503 loads against 3,822 at n=1000.
test('a body that diverges near its front dedups its reads in linear work', () => {
    const width = 1000
    const rows = Array.from({ length: width }, (_, index) => reactive(index))
    const list = reactive(rows)
    const sum = reactive(() => {
        let total = 0
        for (const row of list()) total += row()
        return total
    })
    expect(sum()).toBe((width * (width - 1)) / 2)
    const record = cellOf<{ sources: unknown[] }>(sum)
    let loads = 0
    record.sources = new Proxy(record.sources, {
        get(target, key, receiver) {
            if (typeof key === 'string' && key.charCodeAt(0) <= 57) loads += 1
            return Reflect.get(target, key, receiver)
        },
    })
    list.set([reactive(width), ...rows])
    expect(sum()).toBe((width * (width + 1)) / 2)
    expect(loads).toBeLessThan(width * 10)
    // Every value is still subscribed once: one more write to a row recomputes the sum.
    ;(rows[500] as Reactive<number>).set(0)
    expect(sum()).toBe((width * (width + 1)) / 2 - 500)
    expect(cellOf<{ readers: unknown[] }>(rows[500]).readers.length).toBe(1)
})

// The set `track` dedups a long body against must still dedup: a value read again and again past
// the scan's threshold, before and after the set is built, holds one subscription. The revert is
// dropping the `has` test on the set in `track`: `repeated` holds 82 subscriptions against 1.
test('a long body that reads one value many times holds one subscription of it', () => {
    const rows = Array.from({ length: 100 }, (_, index) => reactive(index))
    const repeated = reactive(0)
    const one = reactive(1)
    const flip = reactive(false)
    // The flip puts `one` at the second slot, so the run diverges there and every read after it
    // is deduped by `track`.
    const total = reactive(() => {
        let sum = flip() ? one() : 0
        for (const row of rows) sum += row() + repeated()
        return sum
    })
    total()
    flip.set(true)
    expect(total()).toBe(4951)
    expect(cellOf<{ readers: unknown[] }>(repeated).readers.length).toBe(1)
    expect(cellOf<{ readers: unknown[] }>(rows[99]).readers.length).toBe(1)
    repeated.set(1)
    expect(total()).toBe(5051)
})
