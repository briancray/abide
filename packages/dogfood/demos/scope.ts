// The caller scope — what makes a module-level `memo` safe to put on a server.
//
// A memo declared at module scope is created ONCE, at import, and its cache lives as long as the
// process. On a client that is exactly right: there is one caller, forever. On a server it means the
// answer computed for one request is served to the next one, and that is not a stale cache, it is
// the wrong person's data. So the cache is per-caller by default, and `{ global }` is how something
// that genuinely belongs to the process says so.
//
// `isolate` is the plain-variable form — a client, a test, a script. `serve(request, fn)` in
// `abide/server` is the async-local form a server needs, because requests interleave across every
// await and one variable cannot tell two of them apart.

import { memo, online, state, watch } from 'abide'
import { serve } from 'abide/server/internal'
import { suite } from 'harness'
import { tick } from 'harness/measure'
import { isolate } from '$shared/internal/scopes.ts'
import { readTwice as onePerProcess } from '../server/rpc/docs/scope/opt-into-one-cache.ts'
import { readTwice as onePerCaller } from '../server/rpc/docs/scope/per-caller-by-default.ts'
import { button, row, stage } from './dom.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

/** One press of a rung's button, in process: the same `respond` the wire goes through. */
async function press(endpoint: { raw(args: Record<string, never>): Promise<Response> }): Promise<{
    status: number
    answer: { first: number; second: number; ranSoFar: number }
}> {
    const answered = await serve(new Request('https://example.test/press'), () => endpoint.raw({}))
    return { status: answered.status, answer: await answered.json() }
}

export default suite({
    ...META.scope,
    cases: [
        {
            title: 'the default is per-caller — two callers, two caches',
            note: 'Same memo, same key, two isolates: the body runs once per caller and neither sees the other’s value.',
            run({ is }) {
                let bodyRuns = 0
                const profile = memo(({ id }: { id: number }) => {
                    bodyRuns++
                    return { id, seat: bodyRuns }
                })

                const first = isolate(() => profile({ id: 1 })())
                const second = isolate(() => profile({ id: 1 })())

                is('the body ran once per caller', bodyRuns, 2)
                is('first caller', first, { id: 1, seat: 1 })
                is('second caller sees its OWN load', second, { id: 1, seat: 2 })
            },
        },

        {
            title: 'a caller’s cache is its own, and coalesces within the caller',
            note: 'Per-caller is not per-read: inside one caller the slot behaves exactly as it always did.',
            run({ is }) {
                let bodyRuns = 0
                const profile = memo(({ id }: { id: number }) => {
                    bodyRuns++
                    return id * 2
                })

                const seen = isolate(() => [profile({ id: 3 })(), profile({ id: 3 })(), profile({ id: 3 })()])

                is('three reads of one key', seen, [6, 6, 6])
                is('one body run', bodyRuns, 1)
            },
        },

        {
            title: '{ global } is one cache for every caller',
            note: 'For what belongs to the process rather than to whoever asked — a config file, a currency table.',
            run({ is }) {
                let bodyRuns = 0
                const rates = memo(
                    ({ pair }: { pair: string }) => {
                        bodyRuns++
                        return `${pair}:${bodyRuns}`
                    },
                    { global: true },
                )

                const first = isolate(() => rates({ pair: 'usd' })())
                const second = isolate(() => rates({ pair: 'usd' })())

                is('the body ran once in total', bodyRuns, 1)
                is('both callers got the same value', [first, second], ['usd:1', 'usd:1'])
            },
        },

        {
            title: 'the argless form is per-caller too',
            note: 'It has no args to key a cache by, so the CELL is what varies — a `GET(() => …)` with no arguments is exactly the leaky case.',
            run({ is }) {
                const who = state('nobody')
                let bodyRuns = 0
                const greeting = memo(() => {
                    bodyRuns++
                    return `hello ${who()}`
                })

                who.set('ada')
                const first = isolate(() => greeting())
                who.set('grace')
                const second = isolate(() => greeting())

                is('the body ran once per caller', bodyRuns, 2)
                is('first caller', first, 'hello ada')
                is('second caller', second, 'hello grace')
            },
        },

        {
            title: 'the cache goes away with the caller',
            note: 'A scope is torn down when its body settles, so nothing a request loaded outlives it.',
            run({ is }) {
                let bodyRuns = 0
                const thing = memo(({ id }: { id: number }) => {
                    bodyRuns++
                    return id
                })

                isolate(() => thing({ id: 1 })())
                isolate(() => thing({ id: 1 })())
                isolate(() => thing({ id: 1 })())

                is('three callers, three loads', bodyRuns, 3)
            },
        },

        {
            title: 'no caller scope means one cache — which is a client',
            note: 'Read outside any isolate and the memo behaves exactly as it did before scoping existed. This is the client’s whole story.',
            run({ is }) {
                let bodyRuns = 0
                const doubled = memo(({ n }: { n: number }) => {
                    bodyRuns++
                    return n * 2
                })

                is('first read', doubled({ n: 4 })(), 8)
                is('second read', doubled({ n: 4 })(), 8)
                is('one body run', bodyRuns, 1)

                const argless = memo(() => {
                    bodyRuns++
                    return 'once'
                })
                is('argless reads', [argless(), argless()], ['once', 'once'])
                is('and ran once', bodyRuns, 2)
            },
        },

        {
            title: 'a caller’s scope survives its awaits',
            note: 'A handler is async, so the cache has to follow the continuation and not just the synchronous call.',
            async run({ is }) {
                let bodyRuns = 0
                const load = memo(async ({ id }: { id: number }) => {
                    bodyRuns++
                    return id * 10
                })

                const value = await isolate(async () => {
                    const before = await load({ id: 2 })
                    // The read AFTER the await must still be this caller's.
                    const after = load({ id: 2 }).peek()
                    return [before, after]
                })

                is('both reads landed in one cache', value, [20, 20])
                is('one body run', bodyRuns, 1)
            },
        },

        {
            title: 'overlapping callers are refused, not approximated',
            note: 'While an async isolate is in flight, another is indistinguishable from one nested inside it — so both are refused rather than guessed at. A server uses `serve`, which is async-local and allows both.',
            async run({ is, throws }) {
                let release = (): void => {}
                const gate = new Promise<void>((resolve) => {
                    release = resolve
                })
                const first = isolate(async () => {
                    await gate
                    return 'first'
                })

                throws(
                    'a second isolate while one is in flight',
                    () => isolate(() => 'second'),
                    'still in flight',
                )

                release()
                is('the first still finishes', await first, 'first')
            },
        },

        {
            title: 'a caller going away WAKES whoever read its instance',
            note: 'A memo is a facade over one instance per caller, so which instance a read gets is decided by the scope installed AT THE READ — and an async `isolate` holds its scope across an await, which is a window somebody else’s flush can land in. A reader that binds to a caller’s instance and is then handed nothing when that caller drops it is stuck on a dead node forever: `mark` cannot wake what is already DEAD, so the reader goes on serving the last value it saw while the cell under it moves. That is not a stale cache, it is a page that stops. So disposal wakes the readers, and the re-read binds to the instance the reader’s own scope answers with. Found on `/tests`, where every page-level memo froze the moment this suite’s case above held a scope open across one flush — 370 rows going on changing under a table that had stopped listening.',
            async run({ is }) {
                const cell = state(0)
                const doubled = memo(() => cell() * 2)
                let seen = -1
                const stop = watch(() => {
                    seen = doubled()
                })
                await tick()
                is('the reader starts where the cell is', seen, 0)

                let release = (): void => {}
                const gate = new Promise<void>((resolve) => {
                    release = resolve
                })
                const first = isolate(async () => {
                    await gate
                    return 'first'
                })

                // The read that binds. Nothing inside the isolate touches this memo — the reader is
                // simply flushed while that caller's scope is the one installed.
                cell.set(1)
                await tick()
                is('the reader saw the write made inside the window', seen, 2)

                release()
                await first
                await tick()

                // And the caller is gone. Without the wake this is still 2, forever.
                cell.set(2)
                await tick()
                is('the reader is still live after the caller dropped', seen, 4)
                stop()
            },
        },

        {
            title: 'online() is an ambient that WAKES',
            note: 'Connectivity changes without a new caller arriving, which is the same reason `route()` is reactive: a probe that only answered on the next ask would leave an offline banner up after the network came back, and take one down nobody had noticed go up. So it is a cell behind a call, fed by the two events the platform already fires — the browser’s own answer, which is a lower bound and says so. A server is always online in the only sense the question has: it is not asking whether the process can reach the internet, it is asking whether the caller can reach the thing it is talking to, and a server IS that thing.',
            async run({ is }) {
                let runs = 0
                let seen = false
                const stop = watch(() => {
                    runs++
                    seen = online()
                })

                is('online to start', seen, true)
                is('and the effect ran once', runs, 1)

                if (typeof dispatchEvent !== 'function' || navigator?.onLine === undefined) {
                    // No platform events to fire — a lane with no DOM at all. The constant answer IS
                    // the claim there, and it is the one a server makes.
                    stop()
                    return
                }

                dispatchEvent(new Event('offline'))
                await Promise.resolve()
                is('going offline woke the reader', runs, 2)
                is('…with the new answer', seen, false)

                dispatchEvent(new Event('online'))
                await Promise.resolve()
                is('and coming back woke it again', runs, 3)
                is('…with that answer', seen, true)

                stop()
            },
        },

        {
            title: 'the two rungs, pressed — a handler AWAITS a memo rather than reading it',
            note: 'The rungs on `/docs/memo` are the only place this capability is stated over a real request, and both answered 500 for as long as the page existed: `await basket()` reads the cell, and a handler is not a position anything re-runs, so a first load still in flight hands back `undefined` and the member access under it throws. `bun test` could not see it — nothing here drove the endpoints — and neither could the rung proofs, which mount a view rather than press its button. So the claim is made where the failure was: two presses through `respond`, which is what the wire does.',
            async server({ is }) {
                const first = await press(onePerCaller)
                const second = await press(onePerCaller)

                is('the endpoint answered', [first.status, second.status], [200, 200])
                is('the second read inside a request is the cache', first.answer.first, first.answer.second)
                is('and the next request brought its own', second.answer.first, first.answer.first + 1)

                const shared = await press(onePerProcess)
                const again = await press(onePerProcess)

                is('{ global } answered too', [shared.status, again.status], [200, 200])
                is('and the next request found the cache the last one filled', again.answer, shared.answer)
            },
        },

        {
            title: 'interact — two callers, one memo',
            interact({ host, log }) {
                let bodyRuns = 0
                const profile = memo((_: { id: number }) => {
                    bodyRuns++
                    return `loaded #${bodyRuns}`
                })
                const shared = memo(
                    (_: { id: number }) => {
                        bodyRuns++
                        return `loaded #${bodyRuns}`
                    },
                    { global: true },
                )

                host.append(
                    stage(
                        row(
                            button('call as a new caller', () => {
                                const value = isolate(() => profile({ id: 1 })())
                                log.live('per-caller (default)', value)
                                log.live('body runs', bodyRuns)
                            }),
                            button('call { global } as a new caller', () => {
                                const value = isolate(() => shared({ id: 1 })())
                                log.live('{ global }', value)
                                log.live('body runs', bodyRuns)
                            }),
                        ),
                    ),
                )
                log('per-caller (default)', '—')
                log('{ global }', '—')
                log('body runs', bodyRuns)
            },
        },

        {
            title: 'what the facade costs when there is no caller scope',
            note:
                'The argless form has no args key, so scoping it means handing back a facade over “whichever cell belongs to the caller”. ' +
                'The `{ global }` arm is the raw cell with no facade at all, so the gap between the first two arms IS the added cost, ' +
                'and on a client the branch always goes the same way. The third arm is the floor both sit on: a memoised read by hand ' +
                'is a closure handing back a captured value, so two arms of abide alone could move together and still read as free.',
            bench: {
                kind: 'time',
                arms: [
                    {
                        label: 'memo() — per-caller facade, no scope active',
                        run: (): unknown => SCOPED_READ(),
                    },
                    {
                        label: 'memo({ global }) — the raw cell',
                        run: (): unknown => GLOBAL_READ(),
                    },
                    {
                        label: 'vanilla — a memoised read, no scope to consult',
                        run: (): unknown => PLAIN_READ.get(),
                    },
                ],
            },
        },

        {
            title: 'what a CALLER costs — the scope a request opens and drops',
            note: 'The other half of the facade’s price, and the one every request pays whether or not it reads anything: a scope is a `Map` and an array, and dropping it runs whatever derivations the caller made. Three arms rather than two, because the scope and the read it wraps are separate costs and one number cannot tell them apart — and because every caller’s cache starts EMPTY, so the read inside is necessarily cold. That is what per-caller means, not an artefact of the arm. Bench only: a synchronous `isolate` is refused while the async one two cases up is still in flight, and on the page every case starts at once.',
            bench: {
                kind: 'time',
                arms: (() => {
                    const lookup = memo(({ id }: { id: number }) => id * 2)
                    return [
                        {
                            // The scope ALONE, so the two costs are not read as one. A caller that
                            // never touches a memo still opens and drops one of these.
                            label: 'abide — isolate() around nothing',
                            run: (): unknown => isolate(() => 0),
                        },
                        {
                            // What a request actually does. Every caller's cache starts empty, so
                            // this read is necessarily COLD — that is what per-caller means, not an
                            // artefact of the arm.
                            label: 'abide — isolate() + one keyed read, cold in a fresh cache',
                            run: (): unknown => isolate(() => lookup({ id: 7 })()),
                        },
                        {
                            label: 'vanilla — a fresh Map per caller, one miss, no disposal',
                            run: (): unknown => {
                                const cache = new Map<number, number>()
                                const held = cache.get(7)
                                if (held !== undefined) return held
                                const made = 14
                                cache.set(7, made)
                                return made
                            },
                        },
                    ]
                })(),
            },
        },
    ],
})

// Built once, outside the arms: a bench measures the READ, not the construction.
const SOURCE_CELL = state(1)
const SCOPED_READ = memo(() => SOURCE_CELL() * 2)
const GLOBAL_READ = memo(() => SOURCE_CELL() * 2, { global: true })
const PLAIN_SOURCE = vanilla.cell(1)
const PLAIN_READ = vanilla.derivedMemoised([PLAIN_SOURCE], () => PLAIN_SOURCE.get() * 2)
