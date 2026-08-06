// `watch` — the effect. Its RETURN is the lifecycle hook: a returned function is the teardown, run
// before every re-run and once on disposal. That is why there is no onMount/onDestroy.

import { channel, memo, scope, state, untrack, watch } from 'abide'
import { keep, reader, sleep, suite, tick } from 'abide/tests'
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
                            label: 'vanilla — subscribe() then off()',
                            run: () => {
                                const off = plain.subscribe(() => void plain.get())
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
                            for (let i = 0; i < 100; i++) noise.set(i)
                            await tick()
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
                            for (let i = 0; i < 100; i++) noise.set(i)
                            await tick()
                            return { count: runs - 1, of: 're-runs from 100 writes to what the BODY reads' }
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
                                for (let i = 0; i < 50; i++)
                                    offs.push(plain.subscribe(() => void plain.get()))
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
                const box = el('div', 'size-16 rounded-lg bg-sky-500 transition-transform')
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
    ],
})
