// `watch` — the effect. Its RETURN is the lifecycle hook: a returned function is the teardown, run
// before every re-run and once on disposal. That is why there is no onMount/onDestroy.

import { channel, memo, state, watch } from 'abide'
import { reader, sleep, suite } from 'harness'
import { keep, tick } from 'harness/measure'
import { scopedEffect } from 'abide/runtime'
import { isolate, scope, untrack } from 'abide/internal'
import { button, el, row } from './dom.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

/**
 * A deliberate throw inside an effect is rethrown from a FRESH microtask, which is the whole point —
 * the failure stays observable to the host instead of being swallowed by the scheduler. That also
 * means it lands on whatever is hosting the case: the browser's error overlay, or the test runner's
 * uncaught-exception reporter. Both are intercepted for the duration of the case, so what the case
 * asserts is the ISOLATION, not the reporting.
 *
 * `preventDefault` on the DOM `error` event is not enough under Bun — the rethrow reaches the
 * process before any window listener sees it — so the process handler is the one that matters and
 * the window listener is what covers the browser. Read off `globalThis`, because a browser bundle
 * has no `process` at all: the bare name threw a ReferenceError before the window listener it was
 * paired with could cover anything, and the card failed on the one line meant to keep it alive.
 */
async function whileSwallowingUncaught(fn: () => Promise<void>): Promise<void> {
    const swallowEvent = (event: Event): void => event.preventDefault()
    const swallowProcess = (): void => undefined
    const host = globalThis.process as typeof process | undefined
    globalThis.addEventListener?.('error', swallowEvent)
    host?.on('uncaughtException', swallowProcess)
    try {
        await fn()
        await tick() // let the deliberate rethrow land while the handlers are still installed
    } finally {
        globalThis.removeEventListener?.('error', swallowEvent)
        host?.off('uncaughtException', swallowProcess)
    }
}

export default suite({
    ...META.watch,
    cases: [
        {
            title: 'the read is the subscription',
            note: 'And the dependency set is re-collected on every run, so a branch that stops reading a cell stops waking for it.',
            async run({ is }) {
                const useLeft = state(true)
                const left = state('L1')
                const right = state('R1')
                let runs = 0
                watch(() => {
                    runs++
                    void (useLeft() ? left() : right())
                })
                is('the first, synchronous run', runs, 1)

                right.set('R2') // the branch it did NOT read
                await tick()
                is('writing the unread branch moves nothing', runs, 1)

                left.set('L2')
                await tick()
                is('writing the branch it DID read wakes it', runs, 2)

                useLeft.set(false) // re-collects: now it reads `right`, not `left`
                await tick()
                is('the branch flipped', runs, 3)
                left.set('L3')
                await tick()
                is('and the old dependency is gone', runs, 3)
                right.set('R3')
                await tick()
                is('while the new one is live', runs, 4)
            },
            interact({ host, log }) {
                const useLeft = state(true)
                const left = state('L1')
                const right = state('R1')
                let runs = 0
                watch(() => {
                    runs++
                    log.live('watch saw', `${useLeft() ? left() : right()} (run ${runs})`)
                })
                const rand = (): string => Math.random().toString(36).slice(2, 5)
                host.append(
                    row(
                        button('left.set(random)', () => left.set(`L${rand()}`)),
                        button('right.set(random)', () => right.set(`R${rand()}`)),
                        button('toggle the branch', () => useLeft.set(!useLeft.peek())),
                    ),
                )
                log('try it', 'writing to the branch it did NOT read moves nothing')
            },
        },

        {
            title: 'effects are BATCHED onto a microtask',
            note: 'Three writes in one turn are one run. A framework that ran the effect per write would paint two frames nobody asked for.',
            async run({ is }) {
                const a = state(1)
                const b = state(1)
                let runs = 0
                watch(() => {
                    runs++
                    void a()
                    void b()
                })

                a.set(2)
                a.set(3)
                b.set(9)
                is('immediately after three writes', runs, 1)
                await tick()
                is('one flush for the whole batch', runs, 2)
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    // What a component mount and unmount costs, per binding. A template slot creates
                    // exactly one of these.
                    const cell = state(1)
                    const plain = vanilla.cell(1)
                    return [
                        {
                            label: 'abide — watch() then dispose()',
                            run: () => {
                                const dispose = watch(() => void cell())
                                dispose()
                            },
                        },
                        {
                            label: 'vanilla — subscribe(), run once, then off()',
                            run: () => {
                                // RUN ONCE, because `watch` runs its body on creation and this
                                // suite's own `run` face asserts it. `subscribe` is a `Set.add`, so
                                // without the call the denominator never mounts anything and the
                                // per-binding number above is priced against a `Set.add`.
                                const listener = (): void => void plain.get()
                                const off = plain.subscribe(listener)
                                listener()
                                off()
                            },
                        },
                    ]
                })(),
            },
        },

        {
            title: 'the teardown is the RETURN value',
            note: 'Run before every re-run and once on disposal. No second registration function to remember, and it is untracked — a teardown must not subscribe the effect to whatever it touches.',
            async run({ is }) {
                const id = state(0)
                const events: string[] = []
                const dispose = watch(() => {
                    const current = id()
                    events.push(`up:${current}`)
                    return () => events.push(`down:${current}`)
                })

                id.set(1)
                await tick()
                dispose()
                is('the order', events, ['up:0', 'down:0', 'up:1', 'down:1'])

                // "it is untracked" is the other half of the note, and the order above is blind to
                // it: the teardown here reads no cell, so a tracked teardown would produce the same
                // four events. This one reads one. A teardown that subscribed its effect to what it
                // touched would re-run the BODY on the next write to `touched` — right value, work
                // nobody asked for, which is the shape only a counter sees.
                const touched = state(0)
                const trigger = state(0)
                let runs = 0
                const stop = watch(() => {
                    void trigger()
                    runs++
                    return () => void touched()
                })
                trigger.set(1)
                await tick()
                is('the body ran once per write to what it reads', runs, 2)
                touched.set(1)
                await tick()
                is('and a cell only the TEARDOWN read wakes it not at all', runs, 2)
                stop()
            },
        },

        {
            title: 'a throwing effect does not strand the flush batch',
            note: 'Without per-node isolation one throw abandons every later effect in the batch PERMANENTLY, and the thrower stays DIRTY forever — dead for the life of the page. The throw is rethrown from a fresh microtask, so it stays observable: the "boom — this one is deliberate" stack in the test output is that rethrow, and its absence would be the bug.',
            async run({ is }) {
                await whileSwallowingUncaught(async () => {
                    const n = state(0)
                    const after: number[] = []
                    let runs = 0

                    watch(() => {
                        runs++
                        if (n() === 1) throw new Error('boom — this one is deliberate')
                    })
                    watch(() => {
                        after.push(n())
                    })
                    is('both ran once', after, [0])

                    n.set(1)
                    await tick()
                    is('the later effect still ran', after, [0, 1])

                    n.set(2)
                    await tick()
                    // Initial, throw, recovered — not dead forever.
                    is('and the thrower RECOVERS on the next write', runs, 3)
                    is('the batch carried on', after, [0, 1, 2])
                })
            },
            interact({ host, log }) {
                host.append(
                    row(
                        button('throw inside an effect', async () => {
                            const n = state(1)
                            const after: number[] = []
                            let thrown = 0
                            // The rethrow comes out of a fresh microtask, so it reaches
                            // `window.onerror` and never this handler — catching it here is the only
                            // way the card can show the failure stayed OBSERVABLE rather than being
                            // swallowed by the scheduler. (The dev server runs with HMR off and pops
                            // no overlay, so there is nothing else on screen to point at.)
                            const rethrown = new Promise<string>((resolve) => {
                                const onError = (event: ErrorEvent): void => {
                                    window.removeEventListener('error', onError)
                                    resolve(event.message)
                                }
                                window.addEventListener('error', onError)
                                void sleep(400).then(() => {
                                    window.removeEventListener('error', onError)
                                    resolve('(nothing reached window.onerror)')
                                })
                            })
                            watch(() => {
                                if (n() === 2) {
                                    thrown++
                                    throw new Error('boom — this one is deliberate')
                                }
                            })
                            watch(() => {
                                after.push(n())
                            })
                            n.set(2)
                            await tick()
                            log('the thrower threw', thrown)
                            log('the later effect still ran', after)
                            n.set(3)
                            await tick()
                            log('and the thrower RECOVERS on the next write', after)
                            log('the rethrow stayed observable', await rethrown)
                        }),
                    ),
                )
            },
        },

        {
            title: 'watch(source, handler) — the dependency DECLARED instead of discovered',
            note: 'The source is the only thing read under tracking, so the handler is free to read whatever it likes without subscribing to it. Same effect, same teardown, same disposer — one body, two ways of saying what wakes it.',
            async run({ is }) {
                const count = state(0)
                const other = state('a')
                const seen: number[] = []
                let teardowns = 0

                const stop = watch(count, (value) => {
                    void other() // read freely — it is NOT a dependency
                    seen.push(value)
                    return () => {
                        teardowns++
                    }
                })
                is('it runs immediately, like every effect', seen, [0])

                count.set(1)
                await tick()
                is('and again when the declared source moved', seen, [0, 1])
                is('the teardown ran before the re-run', teardowns, 1)

                other.set('b')
                await tick()
                is('a read inside the HANDLER wakes nothing', seen, [0, 1])

                stop()
                is('and disposal runs the last teardown', teardowns, 2)
            },
            bench: {
                kind: 'wake',
                arms: [
                    {
                        label: 'abide — watch(source, handler)',
                        run: async () => {
                            const declared = state(0)
                            const noise = state(0)
                            let runs = 0
                            watch(declared, () => {
                                void noise()
                                runs++
                            })
                            await tick()
                            // A TURN PER WRITE, the shape `memo.ts` uses for the same question:
                            // 100 writes in one turn are batched into one flush, so the arm below
                            // reported 1 and the card read 0-vs-1 for a gap that is 0-vs-100.
                            for (let i = 0; i < 100; i++) {
                                noise.set(i)
                                await tick()
                            }
                            return {
                                count: runs - 1,
                                of: 're-runs from 100 writes to what the HANDLER reads',
                            }
                        },
                    },
                    {
                        label: 'abide — watch(handler), same two reads',
                        run: async () => {
                            const declared = state(0)
                            const noise = state(0)
                            let runs = 0
                            watch(() => {
                                void declared()
                                void noise()
                                runs++
                            })
                            await tick()
                            // A turn per write, as the arm above — this is the one the batching was
                            // hiding, and 100 is what the discovered form actually costs.
                            for (let i = 0; i < 100; i++) {
                                noise.set(i)
                                await tick()
                            }
                            return { count: runs - 1, of: 're-runs from 100 writes to what the BODY reads' }
                        },
                    },
                    // The floor the declared form is claiming to match. A hand-declared subscription
                    // never had auto-tracking to opt out of, so it wakes zero times — without this
                    // arm the card can only say the declared spelling beats the discovered one, not
                    // that it costs what declaring the dependency by hand costs.
                    {
                        label: 'vanilla — subscribe(declared), handler reads the other cell freely',
                        run: async () => {
                            const declared = vanilla.cell(0)
                            const noise = vanilla.cell(0)
                            let runs = 0
                            const off = declared.subscribe(() => {
                                void noise.get()
                                runs++
                            })
                            for (let i = 0; i < 100; i++) noise.set(i)
                            off()
                            return {
                                count: runs,
                                of: 're-runs from 100 writes to what the HANDLER reads',
                            }
                        },
                    },
                ],
            },
        },

        {
            title: 'x.watch(handler) — the same effect, spelled off the source',
            note: 'Every source carries it, so a caller holding one cell does not have to reach for the effect to react to it. The handler is untracked for the same reason: which source you asked IS the declaration.',
            async run({ is }) {
                const name = state('ada')
                const seen: string[] = []
                const stop = name.watch((value) => {
                    seen.push(value)
                })
                name.set('grace')
                await tick()
                is('seen', seen, ['ada', 'grace'])

                stop()
                name.set('lovelace')
                await tick()
                is('the disposer unsubscribes for good', seen, ['ada', 'grace'])

                // …and a channel carries it too, over messages rather than values.
                const feed = channel<string>()
                const heard: (string | undefined)[] = []
                const off = feed.watch((message) => {
                    heard.push(message)
                })
                feed.publish('one')
                await tick()
                is('on a channel', heard, [undefined, 'one'])
                off()
            },
        },

        {
            title: 'untrack — read without subscribing',
            note: 'The same thing `peek()` does for one cell, for a whole region.',
            async run({ is }) {
                const tracked = state(1)
                const ignored = state(1)
                let runs = 0
                let lastSum = 0
                watch(() => {
                    runs++
                    lastSum = tracked() + untrack(() => ignored())
                })

                ignored.set(100)
                await tick()
                is('writing the untracked cell wakes nothing', runs, 1)

                tracked.set(2)
                await tick()
                is('writing the tracked one does', runs, 2)
                is('…and it re-read the fresh 100', lastSum, 102)
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    // Swap the current node out and back. The vanilla equivalent is not reading the
                    // cell at all, which is why the comparison is against a bare call.
                    const cell = state(1)
                    return [
                        {
                            label: 'abide — untrack(() => x())',
                            run: () => keep(untrack(() => cell())),
                        },
                        { label: 'abide — x.peek()', run: () => keep(cell.peek()) },
                        { label: 'vanilla — a bare read', run: () => keep(1) },
                    ]
                })(),
            },
        },

        {
            title: 'scope — one handle tears a subtree down',
            note: 'A `watch` created inside a scope REGISTERS with it automatically. There is deliberately no second opt-in spelling: an ownership rule that only applies when you remember the other function is not a rule, and the failure mode is a leak nobody sees.',
            async run({ is }) {
                const n = state(0)
                const runs = { insideA: 0, insideB: 0, outside: 0 }

                const held = scope(() => {
                    watch(() => {
                        void n()
                        runs.insideA++
                    })
                    watch(() => {
                        void n()
                        runs.insideB++
                    })
                    return 'the scope value'
                })
                // Created OUTSIDE the scope, so it survives the teardown.
                watch(() => {
                    void n()
                    runs.outside++
                })
                is('the scope hands back its body’s value', held.value, 'the scope value')
                is('all three ran', runs, { insideA: 1, insideB: 1, outside: 1 })

                n.set(1)
                await tick()
                is('all three woke', runs, { insideA: 2, insideB: 2, outside: 2 })

                held.dispose()
                n.set(2)
                await tick()
                is('only the one outside the scope survived', runs, { insideA: 2, insideB: 2, outside: 3 })
            },
            bench: {
                kind: 'time',
                per: { n: 50, label: 'effect' },
                arms: (() => {
                    // The hand-written version is an array of unsubscribes you have to remember to
                    // build, and the failure mode when you forget is a leak nobody sees.
                    const cell = state(1)
                    const plain = vanilla.cell(1)
                    return [
                        {
                            label: 'abide — scope()',
                            run: () => {
                                const held = scope(() => {
                                    for (let i = 0; i < 50; i++) watch(() => void cell())
                                })
                                held.dispose()
                            },
                        },
                        {
                            label: 'vanilla — an array of unsubscribes',
                            run: () => {
                                const offs: (() => void)[] = []
                                for (let i = 0; i < 50; i++) {
                                    // Run once each, for the reason the single-binding arm above
                                    // carries: 50 `watch` bodies run, so 50 subscribes that never
                                    // fire is not the same fifty.
                                    const listener = (): void => void plain.get()
                                    offs.push(plain.subscribe(listener))
                                    listener()
                                }
                                for (const off of offs) off()
                            },
                        },
                    ]
                })(),
            },
            interact({ host, log }) {
                const n = state(0)
                const runs = { insideA: 0, insideB: 0, outside: 0 }
                const held = scope(() => {
                    watch(() => {
                        void n()
                        runs.insideA++
                    })
                    watch(() => {
                        void n()
                        runs.insideB++
                    })
                    return 'the scope value'
                })
                watch(() => {
                    void n()
                    runs.outside++
                })
                const report = (): void => log.live('runs — two in scope, one outside', runs)
                host.append(
                    row(
                        button('n.set(n + 1)', async () => {
                            n.set(n.peek() + 1)
                            await tick()
                            report()
                        }),
                        button('held.dispose()', async () => {
                            held.dispose()
                            log('disposed', held.value)
                            await tick()
                            report()
                        }),
                    ),
                )
                report()
            },
        },

        {
            title: 'a derivation between two effects',
            note: 'The memo is pull-recomputed once and both effects read the same answer. Neither wakes when the memo re-runs to the same value.',
            async run({ is }) {
                const celsius = state(20)
                let derivations = 0
                const fahrenheit = memo(() => {
                    derivations++
                    return Math.round((celsius() * 9) / 5 + 32)
                })
                const first = reader(() => fahrenheit())
                const second = reader(() => fahrenheit())

                celsius.set(25)
                await tick()
                is('both effects saw the move', [first.seen.length, second.seen.length], [2, 2])

                celsius.set(25.2) // rounds to the same integer
                await tick()
                is('the rounding collapse woke neither', [first.seen.length, second.seen.length], [2, 2])
                is('…though the body did re-run', derivations, 3)
                is('one recompute serves both readers', first.seen, second.seen)
                first.dispose()
                second.dispose()
            },
        },

        {
            title: 'a source this run MOVED wakes it again',
            note: 'A body that asks an invalidated slot anything KICKS its load, and the load flips `pending` on the way — a source this same body asked a line earlier, in this same run. The run is answering from BEFORE the flip, but the node is DIRTY for the whole of it, so absorbing that mark as "the one this run is already answering" left the effect sitting on the stale answer with no second flip coming. Only the run counts can see it: the gate produces nothing at all, and the next thing to wake it is the settle 20ms later — the right value, from a reader that never once showed the load. A derivation recomputed by a read INSIDE the run is the case this must NOT catch, and it is the ordinary one: that value is consumed in place, by the read that pulled it. The FIRST pass is the other half, and it is what changed when probes began kicking: `pending()` starts the load it is asked about, so the gate is true and the placeholder is shown — where before the probe reported `false` on a load nobody had begun, the body fell through to the read, and the reader never once showed what it was written to show.',
            async run({ is }) {
                let loads = 0
                const quote = memo(async ({ symbol }: { symbol: string }) => {
                    // A real delay: a resolved promise settles before anything can observe a load.
                    await sleep(20)
                    return `${symbol} @ ${++loads}`
                })
                const shown: string[] = []
                // The `{#if x.pending()}` shape, in one effect: the gate is what STARTS the load it
                // then reports, so the placeholder shows on the first pass rather than never.
                const stop = watch(() => {
                    const slot = quote({ symbol: 'ABC' })
                    if (slot.pending()) {
                        shown.push('loading…')
                        return
                    }
                    shown.push(String(slot()))
                })
                await sleep(40)
                is('the gate started the load and showed it', shown, ['loading…', 'ABC @ 1'])

                quote({ symbol: 'ABC' }).invalidate()
                await tick()
                // ONCE, not twice: the gate kicked the load and reported it in the same call, so the
                // flip is already in this run's answer and re-marking it would repaint the identical
                // arm. Only the count says so — both runs push the same string.
                is('the flip its own ask caused wakes it', shown, ['loading…', 'ABC @ 1', 'loading…'])

                await sleep(40)
                is('…and then the settle does', shown, ['loading…', 'ABC @ 1', 'loading…', 'ABC @ 2'])
                stop()
            },
        },

        {
            title: 'the subscription LEDGER — every shape that a re-collect can get wrong',
            note: 'A run detaches from every source and the body re-collects them, so the observer list of a hot cell is torn down and rebuilt on every wake. What that list IS — a Set, an array with back-pointers — is an implementation detail with no output to show for it: get the bookkeeping wrong and a reader stops waking, or wakes twice, and the value it reads is still right either way. So the shapes that can break are enumerated here as WAKE COUNTS rather than left to be discovered. A source read twice in one run is the one that separates a container which dedupes from one that does not; a dependency dropped between runs is the one that separates detaching from pretending to.',
            async run({ is }) {
                // 1. Fan-out. Every reader wakes, each exactly once.
                const shared = state(0)
                const runs: number[] = [0, 0, 0]
                const stops = runs.map((_, i) =>
                    watch(() => {
                        shared()
                        runs[i] = (runs[i] as number) + 1
                    }),
                )
                await tick()
                shared.set(1)
                await tick()
                is('every reader of one cell woke exactly once', runs, [2, 2, 2])

                // 2. The same source read TWICE in one run, and then ONCE. The list holds one entry
                // per read, so the run that drops to a single read has to give exactly one of them
                // back — and a container that cannot hold a duplicate gives back BOTH, leaving the
                // reader unsubscribed from a cell it is still reading. It then goes silent for good,
                // with the last value it happened to compute still on screen and nothing to say so.
                const twice = state(1)
                const readTwice = state(true)
                let twiceRuns = 0
                let sum = 0
                const stopTwice = watch(() => {
                    twiceRuns++
                    sum = readTwice() ? twice() + twice() : twice()
                })
                await tick()
                twice.set(5)
                await tick()
                is('a source read twice wakes its reader ONCE', twiceRuns, 2)
                is('…and the body saw both reads', sum, 10)

                readTwice.set(false) // two reads become one
                await tick()
                is('dropping to a single read wakes it', [twiceRuns, sum], [3, 5])
                twice.set(9)
                await tick()
                is('…and it is still subscribed afterwards', [twiceRuns, sum], [4, 9])

                // 3. A dependency DROPPED between runs. The whole point of detaching: after the
                // flag flips, `left` is no longer read, so writing it must wake nothing.
                const flag = state(true)
                const left = state('L')
                const right = state('R')
                let branchRuns = 0
                let shown = ''
                const stopBranch = watch(() => {
                    branchRuns++
                    shown = flag() ? left() : right()
                })
                await tick()
                flag.set(false)
                await tick()
                is('flipping the branch woke it', [branchRuns, shown], [2, 'R'])
                left.set('L2')
                await tick()
                is('the dropped dependency wakes nothing', branchRuns, 2)
                right.set('R2')
                await tick()
                is('…and the acquired one still does', [branchRuns, shown], [3, 'R2'])

                // 4. A diamond. One write reaches the effect by two routes and must wake it once.
                const root = state(1)
                const viaA = memo(() => root() * 2)
                const viaB = memo(() => root() * 3)
                let diamondRuns = 0
                let total = 0
                const stopDiamond = watch(() => {
                    diamondRuns++
                    total = viaA() + viaB()
                })
                await tick()
                root.set(2)
                await tick()
                is('a diamond wakes its foot ONCE, not once per path', diamondRuns, 2)
                is('…with both arms recomputed', total, 10)

                // 5. A reader that goes away. Its slot must leave the list with it, or the next
                // write walks an entry whose node is dead.
                const watched = state(0)
                let liveRuns = 0
                let deadRuns = 0
                const stopLive = watch(() => {
                    watched()
                    liveRuns++
                })
                const stopDead = watch(() => {
                    watched()
                    deadRuns++
                })
                await tick()
                stopDead()
                watched.set(1)
                await tick()
                is('the disposed reader did not wake', deadRuns, 1)
                is('…and the one beside it still did', liveRuns, 2)

                for (const stop of stops) stop()
                stopTwice()
                stopBranch()
                stopDiamond()
                stopLive()

                // 6. Disposing the FIRST of three, and then the one that took its place. This is
                // the shape that catches a list which forgets to tell a moved reader where it went:
                // removing the first shuffles the last into its slot, so the last is now somewhere
                // other than it believes, and the damage only shows when IT leaves — it hands back
                // a position that belongs to a bystander, unsubscribing a stranger and staying
                // attached itself. Three readers is the minimum that can show it, and disposing in
                // this order is the whole of the case: nothing about two readers, or about
                // disposing in the order they were made, moves anything at all.
                const shuffled = state(0)
                const stays = state(true)
                let firstRuns = 0
                let bystanderRuns = 0
                let movedRuns = 0
                const stopFirst = watch(() => {
                    shuffled()
                    firstRuns++
                })
                const stopBystander = watch(() => {
                    shuffled()
                    bystanderRuns++
                })
                // Third, so disposing the first is what relocates THIS one — and it is the only
                // reader that can later stop reading, which is the half that makes the damage show.
                const stopMoved = watch(() => {
                    movedRuns++
                    if (stays()) shuffled()
                })
                await tick()
                stopFirst()

                // The moved reader now drops `shuffled`. Detaching at a position it no longer
                // occupies takes a BYSTANDER's entry out instead of its own, and leaves itself
                // subscribed to a cell it has stopped reading — so the write below wakes it. That is
                // the whole failure, and neither a value nor a DOM counter has anything to say about
                // it: nothing this effect renders would be wrong.
                stays.set(false)
                await tick()
                const before = movedRuns
                shuffled.set(1)
                await tick()
                is('a reader that stopped reading is not woken by the write', movedRuns, before)
                is('…and the bystander it was standing on still is', bystanderRuns, 2)
                is('…and the disposed one stays gone', firstRuns, 1)
                stopBystander()
                stopMoved()

                // 7. The list REFILLED after being emptied. Every reader of `shared` has just gone,
                // so this is the swap-remove edge no other case reaches: an implementation that
                // mishandles the last element out leaves the container describing a length it no
                // longer has, and the readers attached afterwards land in the gap.
                const fresh = [0, 0]
                const stopFresh = fresh.map((_, i) =>
                    watch(() => {
                        shared()
                        fresh[i] = (fresh[i] as number) + 1
                    }),
                )
                await tick()
                shared.set(2)
                await tick()
                is('readers attached after the list emptied wake exactly once', fresh, [2, 2])
                is('…and the disposed ones stayed disposed', runs, [2, 2, 2])
                for (const stop of stopFresh) stop()
            },
        },

        {
            title: 'awaiting a cell inside an effect does not subscribe it',
            note: 'Nothing can be tracked through an await anyway, so `await x` reads untracked on purpose — otherwise an effect would silently acquire dependencies it cannot re-collect.',
            async run({ is }) {
                const source = state(Promise.resolve(1))
                let runs = 0
                const awaited: number[] = []
                watch(() => {
                    runs++
                    void source.then((value) => awaited.push(value as number))
                })
                await sleep(20)
                source.set(Promise.resolve(2))
                await sleep(20)
                is('the effect ran once — the await created no subscription', runs, 1)
                is('and the await itself still resolved', awaited, [1])
            },
        },

        {
            title: 'a watch is what a template slot IS',
            note: 'One slot, one effect. Nothing else on the page re-renders when the cell moves — the client renderer creates exactly this subscription for you, one per slot.',
            async run({ host, is }) {
                const angle = state(0)
                const box = document.createElement('div')
                host.append(box)
                let paints = 0
                watch(() => {
                    paints++
                    box.setAttribute('style', `transform: rotate(${angle()}deg)`)
                })
                is('painted on creation', box.getAttribute('style'), 'transform: rotate(0deg)')
                angle.set(30)
                await tick()
                is('and once per write', box.getAttribute('style'), 'transform: rotate(30deg)')
                is('paints', paints, 2)
            },
            interact({ host }) {
                const angle = state(0)
                const box = el('div', 'size-16 rounded-lg bg-verdigris transition-transform')
                const wrap = el('div', 'py-4')
                wrap.append(box)
                host.append(wrap)
                watch(() => {
                    box.style.transform = `rotate(${angle()}deg)`
                })
                host.append(
                    row(
                        button('+30°', () => angle.set(angle.peek() + 30)),
                        button('reset', () => angle.set(0)),
                    ),
                )
            },
        },

        {
            title: 'a watch in a <script module> runs once per CALLER, not once per process',
            note: 'The third module-scope spelling that meant "once for the server process", and the one a lazy wrap could not fix: a cell can wait for somebody to read it, and an effect has no read to wait for. So the component that declared it is what asks — its setup kicks, the first instance in a caller runs the body, and every instance after it finds the effect already running. A component nobody renders in this request runs no effect in it, which is the honest reading of per-caller. Asserted as BODY RUNS, because an effect that runs three times instead of once produces exactly the same values.',
            async run({ is }) {
                let bodyRuns = 0
                const cell = state.scoped(() => state(0))
                // What the compiler writes for `watch(…)` in a `<script module>`.
                const kick = scopedEffect(() =>
                    watch(() => {
                        cell()
                        bodyRuns++
                    }),
                )
                is('declaring it runs nothing', bodyRuns, 0)

                const perRequest: number[] = []
                for (let request = 0; request < 2; request++) {
                    await isolate(async () => {
                        const before = bodyRuns
                        kick() // the first instance of this component in this caller…
                        kick() // …and two more, which must find the effect already running
                        kick()
                        perRequest.push(bodyRuns - before)
                    })
                }
                is('three instances in one caller are one effect', perRequest, [1, 1])

                // And it goes with the caller: the scope above is gone, so a write reaches no effect
                // either request left behind.
                const settled = bodyRuns
                cell.set(cell.peek() + 1)
                await tick()
                is('a disposed caller leaves nothing running', bodyRuns, settled)
            },
        },

    ],
})
