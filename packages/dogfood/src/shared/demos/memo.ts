// `memo` — one name, two forms, split by whether the body DECLARES INPUTS.
//
//   memo(() => a() + b())        no args -> deps inferred from the body
//   memo(({ id }) => fetch(id))  args    -> the args ARE the cache key

import { memo, state, watch } from 'abide'
import { reader, scratch, show, sleep, suite, until } from 'harness'
import { countCalls, keep, tick } from 'harness/measure'
import { button, field, row, stage } from './dom.ts'
// The rungs the case at the bottom asserts. Two of them, because the two FORMS are two rungs: a
// derivation paints at once and a load has to say what to show meanwhile, and one mount cannot claim
// both without being a file that shows two things.
import Derive from './fixtures/memo/1-derive-one.abide'
import Load from './fixtures/memo/3-say-what-to-show-meanwhile.abide'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

async function fetchSession(name: string): Promise<{ name: string }> {
    await sleep(20)
    return { name }
}

export default suite({
    ...META.memo,
    cases: [
        // --- the derive form -------------------------------------------------

        {
            title: 'derive — deps come from the body, and it memoises on identity',
            note: 'The body runs only when a dependency actually moved. A write of the same value moves nothing.',
            async run({ is }) {
                const first = state('ada')
                const last = state('lovelace')
                let bodyRuns = 0
                const full = memo(() => {
                    bodyRuns++
                    return `${first()} ${last()}`
                })
                const view = reader(() => full())

                is('full()', full(), 'ada lovelace')
                is('body runs', bodyRuns, 1)

                first.set('grace')
                await tick()
                is('after a real write', full(), 'grace lovelace')
                is('body runs', bodyRuns, 2)

                first.set('grace') // the same value
                await tick()
                is('a write of the same value re-runs nothing', bodyRuns, 2)
                is('and wakes nobody', view.seen.length, 2)
                view.dispose()
            },
            interact({ host, log }) {
                const first = state('ada')
                const last = state('lovelace')
                let bodyRuns = 0
                const full = memo(() => {
                    bodyRuns++
                    return `${first()} ${last()}`
                })
                // A write that moves nothing leaves every other line untouched, so without a count
                // of the writes themselves the card cannot tell "nothing re-ran" from "nothing
                // happened".
                let writes = 0
                const report = (): void => {
                    log.live('writes', writes)
                    log.live('full()', full())
                    log.live('body runs', bodyRuns)
                }
                host.append(
                    row(
                        button('first.set("grace")', () => {
                            first.set('grace')
                            writes++
                            report()
                        }),
                        button('first.set(same)', () => {
                            first.set(first.peek())
                            writes++
                            report()
                        }),
                        button('last.set(random)', () => {
                            last.set(Math.random().toString(36).slice(2, 7))
                            writes++
                            report()
                        }),
                    ),
                )
                report()
            },
        },

        {
            title: 'lazy — unobserved, the READ is what re-runs it',
            note: 'A derivation with no watcher does no work when its source moves. It recomputes when someone asks.',
            async run({ is }) {
                const n = state(1)
                let bodyRuns = 0
                const doubled = memo(() => {
                    bodyRuns++
                    return n() * 2
                })

                is('body runs before any read', bodyRuns, 0)
                is('doubled()', doubled(), 2)
                n.set(2)
                n.set(3)
                n.set(4)
                is('body runs after three writes, no read', bodyRuns, 1)
                is('doubled()', doubled(), 8)
                is('body runs after the read', bodyRuns, 2)
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    const source = state(2)
                    const derivation = memo(() => source() * 2)
                    derivation()
                    const plainSource = vanilla.cell(2)
                    const plainDerived = vanilla.derived([plainSource], () => plainSource.get() * 2)
                    plainDerived.get()
                    const memoised = vanilla.derivedMemoised([plainSource], () => plainSource.get() * 2)
                    return [
                        {
                            label: 'abide — doubled() (clean, no recompute)',
                            run: () => keep(derivation()),
                        },
                        { label: 'vanilla — dirty flag', run: () => keep(plainDerived.get()) },
                        { label: 'vanilla — eager, memoised', run: () => keep(memoised.get()) },
                    ]
                })(),
            },
        },

        {
            title: 'write then read — the recompute path',
            note: 'abide re-collects its dependency set on every run. That is what buys tracking, and it is what it costs: a hand-written derivation is faster here precisely because its sources were DECLARED, which is also where the bugs come from when the list drifts from the body.',
            async run({ is }) {
                const source = state(2)
                let runs = 0
                const derivation = memo(() => {
                    runs++
                    return source() * 2
                })
                is('first read', derivation(), 4)
                source.set(3)
                is('after a write', derivation(), 6)
                is('one recompute per write, on read', runs, 2)
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    const source = state(2)
                    const derivation = memo(() => source() * 2)
                    const plainSource = vanilla.cell(2)
                    const plainDerived = vanilla.derived([plainSource], () => plainSource.get() * 2)
                    return [
                        {
                            label: 'abide — set + read',
                            run: (i: number) => {
                                source.set(i)
                                keep(derivation())
                            },
                        },
                        {
                            label: 'vanilla — set + read (declared deps)',
                            run: (i: number) => {
                                plainSource.set(i)
                                keep(plainDerived.get())
                            },
                        },
                    ]
                })(),
            },
        },

        {
            title: 'a diamond wakes its sink ONCE',
            note: 'Push-CHECK / pull-recompute, no topological sort: a write marks direct dependents DIRTY and everything deeper CHECK, and a CHECK node recomputes only if a source really moved.',
            async run({ is, log }) {
                const source = state(1)
                const left = memo(() => source() + 1)
                const right = memo(() => source() * 2)
                const sink = reader(() => left() + right())
                await tick()
                is('the first run', sink.seen.length, 1)

                source.set(2)
                await tick()
                source.set(3)
                await tick()
                is('two writes, two wakes — not one per path', sink.seen.length, 3)
                log('the sink saw', sink.seen.join(' → '))
                sink.dispose()
            },
            bench: {
                kind: 'wake',
                arms: [
                    {
                        label: 'abide — push CHECK, pull recompute',
                        run: async () => {
                            const source = state(1)
                            const left = memo(() => source() + 1)
                            const right = memo(() => source() * 2)
                            let runs = 0
                            watch(() => {
                                void (left() + right())
                                runs++
                            })
                            await tick()
                            source.set(2)
                            await tick()
                            return { count: runs - 1, of: 'sink re-runs for one write' }
                        },
                    },
                    {
                        label: 'vanilla — naive push (the classic glitch)',
                        run: async () => {
                            const source = vanilla.cell(1)
                            const left = vanilla.derived([source], () => source.get() + 1)
                            const right = vanilla.derived([source], () => source.get() * 2)
                            let runs = 0
                            left.subscribe(() => runs++)
                            right.subscribe(() => runs++)
                            source.set(2)
                            return { count: runs, of: 'sink re-runs for one write' }
                        },
                    },
                ],
            },
        },

        {
            title: 'a derived value that does not MOVE wakes nobody',
            note: 'The memo re-runs — its source moved — but its own readers stay asleep, because the answer is the same.',
            async run({ is, log }) {
                const n = state(1)
                const isPositive = memo(() => n() > 0)
                const view = reader(() => isPositive())

                for (const value of [2, 99, 5]) {
                    n.set(value)
                    await tick()
                }
                is('the predicate never flipped', view.seen.length, 1)

                n.set(-1)
                await tick()
                is('…and this is what a flip looks like', view.seen, ['true', 'false'])
                log('the reader saw', view.seen.join(' → '))
                view.dispose()
            },
            bench: {
                kind: 'wake',
                arms: [
                    {
                        label: 'abide — memo',
                        run: async () => {
                            const n = state(1)
                            const positive = memo(() => n() > 0)
                            let runs = 0
                            watch(() => {
                                void positive()
                                runs++
                            })
                            await tick()
                            for (let i = 1; i <= 100; i++) {
                                n.set(i)
                                await tick()
                            }
                            return { count: runs - 1, of: 're-runs from 100 source writes' }
                        },
                    },
                    {
                        label: 'vanilla — memoised derivation',
                        run: async () => {
                            const n = vanilla.cell(1)
                            const positive = vanilla.derivedMemoised([n], () => n.get() > 0)
                            let runs = 0
                            positive.subscribe(() => runs++)
                            for (let i = 1; i <= 100; i++) n.set(i)
                            return { count: runs, of: 're-runs from 100 source writes' }
                        },
                    },
                    {
                        label: 'vanilla — naive forward',
                        run: async () => {
                            const n = vanilla.cell(1)
                            const positive = vanilla.derived([n], () => n.get() > 0)
                            let runs = 0
                            positive.subscribe(() => runs++)
                            for (let i = 1; i <= 100; i++) n.set(i)
                            return { count: runs, of: 're-runs from 100 source writes' }
                        },
                    },
                ],
            },
        },

        {
            title: 'a cell is a THENABLE — then, catch, finally, and not a Promise',
            note: 'Awaiting a cell already worked; the other two verbs did not, so `x.then(…).catch(…)` was fine and `x.catch(…)` was a TypeError — an asymmetry nothing in the surface tells you about. Both are now there, and both are ONE shared function reached through `this` rather than a closure per cell: a handle already carries fourteen own properties and is allocated per keyed slot, which in a list is per row, so two more closures each would be a cost paid everywhere to fix an ergonomic gap. What is deliberately NOT here is `instanceof Promise`. There is no `[[PromiseState]]` under a cell, so a native fast path reaching for one would throw on an object that had just claimed to be one — a thenable that says what it is fails in ways a reader can act on.',
            async run({ is }) {
                const loaded = memo(async () => {
                    await sleep(1)
                    return 'landed'
                })
                const refused = memo(async () => {
                    await sleep(1)
                    throw new Error('nope')
                })

                is('await works, as it always did', await loaded, 'landed')
                is('and now catch does too, with no then in front of it', await refused.catch((e) => `caught ${(e as Error).message}`), 'caught nope')

                let ran = false
                is('finally runs and passes the value through', await loaded.finally(() => { ran = true }), 'landed')
                is('…and it ran', ran, true)

                // The SHAPE claim, which is the whole reason these are not closures: two different
                // cells carry the same function object. A per-cell closure passes every assertion
                // above and allocates two more objects per keyed slot, so the identity is the only
                // thing that can tell the two implementations apart.
                is('every cell shares one catch', loaded.catch === refused.catch, true)
                is('…and one finally', loaded.finally === refused.finally, true)

                // A sync cell is thenable for the same reason: awaiting differs from reading in HOW
                // it waits, not in what it can hand back.
                is('a sync memo answers the same way', await memo(() => 42), 42)

                // The OTHER construction path, and it has to be covered explicitly: an argless memo
                // is a per-caller facade, while a KEYED slot and a `state` are built by the graph
                // itself. Assert only the facade and the graph's half of this is untested — which is
                // exactly what happened, and what these three lines were added to close.
                const rows = memo(async ({ id }: { id: number }) => {
                    await sleep(1)
                    if (id < 0) throw new Error('no such row')
                    return { id }
                })
                is('a keyed slot catches too', await rows({ id: -1 }).catch(() => 'refused'), 'refused')
                is('…and a state built from a promise', await state(Promise.resolve('held')).finally(() => {}), 'held')
                is(
                    'and the graph hands out the same pair it hands the facade',
                    rows({ id: 1 }).catch === memo(async () => 1).catch,
                    true,
                )

                // Not a Promise, and the surface says so rather than pretending.
                is('and it is not a Promise', loaded instanceof Promise, false)
            },
        },

        {
            title: 'an ASYNC argless body tracks the deps read before its first await',
            note: 'That is everything tracking can honestly see. The re-load STARTING does not wake a value reader — only the settle does.',
            async run({ is }) {
                const id = state(1)
                let bodyRuns = 0
                const user = memo(async () => {
                    bodyRuns++
                    const current = id() // read BEFORE the await, so it is tracked
                    await sleep(15)
                    return `user#${current}`
                })
                // A memo is lazy; an effect (or a template slot) is what keeps it live.
                const view = reader(() => user())

                is('the read before it lands', user(), undefined)
                await sleep(40)
                is('user()', user(), 'user#1')
                is('body runs', bodyRuns, 1)

                id.set(2)
                await sleep(40)
                is('a tracked dep moved, so it re-ran', user(), 'user#2')
                is('body runs', bodyRuns, 2)
                // user#1 → user#2, and nothing for the cold pass: that read signalled, so the
                // reader produced nothing rather than an `undefined`. Not one for the re-load
                // STARTING either — only a settle moves the value.
                is('the reader woke once per settle', view.seen.length, 2)
                view.dispose()
            },
        },

        {
            title: 'unobserved, it stays lazy: the read is what re-runs it',
            note: 'Nobody is watching, so a dependency moving schedules nothing. The next read serves the retained value AND kicks the re-load.',
            async run({ is }) {
                const id = state(1)
                let bodyRuns = 0
                const user = memo(async () => {
                    bodyRuns++
                    return `user${id()}`
                })

                is('cold read', user(), undefined)
                await tick()
                is('once it lands', user(), 'user1')

                id.set(2)
                await tick()
                is('nobody observed it, so nothing re-ran', bodyRuns, 1)
                is('this read kicks it and keeps serving the old value', user(), 'user1')
                await tick()
                is('and then the new one', user(), 'user2')
            },
        },

        {
            title: 'a re-run DISCARDS the older load rather than letting it land on top',
            note: 'The same generation stamp `state` uses. Without it the answer to the older question ends up on screen.',
            async run({ is }) {
                const id = state(1)
                const gate = [Promise.withResolvers<string>(), Promise.withResolvers<string>()]
                let runs = 0
                const user = memo(() => {
                    id()
                    return (gate[runs++] as { promise: Promise<string> }).promise
                })
                const view = reader(() => user())
                is('pending() on the cold load', user.pending(), true)

                gate[0]?.resolve('one')
                await tick()
                is('user()', user(), 'one')

                id.set(2)
                await tick()
                is('still serving the last good value', user(), 'one')
                is('refreshing() — warm, not blank', user.refreshing(), true)

                gate[1]?.resolve('second')
                await tick()
                gate[0]?.resolve('first') // the stale one lands last
                await tick()
                is('the newer answer survives', user(), 'second')
                is('refreshing() once it lands', user.refreshing(), false)
                view.dispose()
            },
        },

        {
            title: 'derive off an async cell with the ORDINARY sync spelling',
            note: 'No `.then`, no await, no second kind of memo — and nothing to narrow, in the types either: `session()` reads as the `{ name: string }` the load resolves to, so the `?.` and the `?? stranger` this used to need cannot be written any more. A read with nothing to serve yet SIGNALS, so the body does not run at all until `session()` can be served, and a reader that cannot be run again — an event handler — gets what is there.',
            async run({ is }) {
                const session = state(fetchSession('ada'))
                const greeting = memo(() => `hello ${session().name}`)
                is('greeting() cold — the body never ran, so nothing was rendered', greeting(), undefined)
                await sleep(40)
                is('greeting() warm', greeting(), 'hello ada')

                // `await` is a CATCHER, in the shape the server walk is: it waits out the load the
                // body could not read and runs the body again, rather than resolving the value the
                // body never produced.
                const other = state(fetchSession('grace'))
                const label = memo(() => `hello ${other().name}`)
                is('await waits for the body to become runnable', await label, 'hello grace')
            },
        },

        {
            title: 'a derivation is TRANSPARENT to a pending read',
            note: 'The signal names the CELL it started at, not the derivation it unwound through, because a cell is the only thing that can be waited for. The derivation stays dirty so the next read runs its body again — which costs the wake, since a dirty node swallows the mark that would have travelled through it, so the reader is subscribed to the load itself instead.',
            async run({ is }) {
                const account = state(fetchSession('lin'))
                const shout = memo(() => `HELLO ${account()?.name.toUpperCase() ?? ''}`)
                const view = reader(() => shout())

                is('the cold pass produced nothing at all', view.seen, [])
                await sleep(40)
                is('woken once, with the value', view.seen, ['HELLO LIN'])
                view.dispose()
            },
        },

        {
            title: '…and it keeps carrying marks after the load it signalled on',
            note: 'The dirty derivation above swallows the mark, and the reader is subscribed to the LOAD instead — which covers that load and no other. Move the key and the body reads a different cell entirely: the first flip never fires again, so without the mark still travelling from a signalled node the whole fan downstream sits on the previous key’s data forever, rendering perfectly. Only the body-run counts can see it, which is why they are the assertion.',
            async run({ is }) {
                let loads = 0
                const source = memo(async ({ key }: { key: number }) => {
                    loads++
                    // A REAL delay: on a resolved promise the slot is read warm, nothing signals at
                    // all, and every line below passes with the mark swallowed.
                    await sleep(20)
                    return `answer ${key}`
                })

                const key = state(1)
                let fanRuns = 0
                const rows = memo(() => source({ key: key() })())
                // Counted AFTER the read, so this is runs that COMPLETED. A pass that signals has
                // incremented nothing, which is the honest denominator: it produced no value.
                const fan = memo(() => {
                    const shouted = rows().toUpperCase()
                    fanRuns++
                    return shouted
                })
                const view = reader(() => fan())

                await sleep(60)
                is('the first key, once it lands', view.seen, ['ANSWER 1'])
                is('…and the fan ran once for it', fanRuns, 1)

                key.set(2)
                await sleep(60)
                is('the second key reached the server', loads, 2)
                is('…and the fan ran again for it', fanRuns, 2)
                is('…and the reader has it', view.seen, ['ANSWER 1', 'ANSWER 2'])
                view.dispose()
            },
        },

        {
            title: '…and it answers the PROBES for the load it could not read',
            note: 'Transparency has to reach the PROBES or a derivation is only half a cell: `memo(() => rows({ q })())` settles nothing of its own, so its own tracker is never written and `pending()` reported false while there was nothing to show — an `{#if}` gate over a derived load rendered its else arm at once, on both substrates. The probe’s kick could not see it either, because it pulled untracked: a signal with nobody standing under it unwinds the body and is dropped where the pull catches it, which is right for a caller that will not ask again and is the opposite of what a probe is. So the kick pulls RETRYABLY, and the signal it catches IS the answer — with the asker subscribed to the cell that signalled, since that cell owns the only flip that can stand the probe down.',
            async run({ is }) {
                const rows = memo(async ({ q }: { q: string }) => {
                    // A REAL delay for the reason the case above states: a resolved promise is read
                    // warm, nothing signals, and every line here passes with the probe still lying.
                    await sleep(20)
                    return [`${q}-one`, `${q}-two`]
                })
                const query = state('ab')
                const found = memo(() => rows({ q: query() })())

                is('pending() — there is nothing to serve', found.pending(), true)
                is('settled()', found.settled(), false)
                is('done()', found.done(), false)

                // The probe ALONE, with nothing reading the value: what stands it down is the flip
                // on the cell one level down, which is the subscription the probe has to have made.
                const asked = reader(() => found.pending())
                await sleep(60)
                is('the probe-only reader saw it stand down', asked.seen, ['true', 'false'])
                is('…and the value is there', found(), ['ab-one', 'ab-two'])
                asked.dispose()
            },
        },

        {
            title: 'a probe ASKS, and asking KICKS',
            note: 'Every member that asks ABOUT the value starts the load: `()`, `await`, and the probes. `pending()` on a cell nobody had kicked used to report `false` — which reads as "no load is running" and meant "none has begun", a different fact wearing the same answer. Kicking makes it true, and makes a probe-first template work on its own: `{#if a.pending() || b.pending()}` starts both, with no compiler recognising the spelling. `peek` is the one member left that only observes, and SELECTING a keyed slot still starts nothing — the two places a caller can ask about a key without paying for it.',
            async run({ is }) {
                let bodyRuns = 0
                const report = memo(async () => {
                    bodyRuns++
                    await sleep(10)
                    return 'the report'
                })

                is('peek() is what observes', report.peek(), undefined)
                is('…and it started nothing', bodyRuns, 0)

                is('pending() reports the load it just started', report.pending(), true)
                is('body runs after the probe', bodyRuns, 1)
                is('settled()', report.settled(), false)
                is('error()', report.error(), undefined)
                is('…and neither of those started a second', bodyRuns, 1)

                is('the read has nothing yet — it is in flight', report(), undefined)
                await sleep(30)
                is('report() once it lands', report(), 'the report')

                // …and so does an await, on a memo nothing has asked about.
                let awaited = 0
                const other = memo(async () => `${++awaited}`)
                is('await DOES cause', await other, '1')
                is('one body run for it', awaited, 1)
            },
        },

        {
            title: 'a probe starts what it ASKS — and `||` asks about one cell',
            note: 'The reason the kick moved onto the probe, and the limit of what moving it buys. Deferring used to be decided by the COMPILER matching `{#if <cell>.pending()}` as the whole of a chain’s first test, so a gate spelled any other way started nothing and reported `false` forever; the runtime is the recogniser now, and whatever asks, starts — including a `memo` over a probe, which no regex could have seen. But it can only start what is EVALUATED, and `||` short-circuits: `{#if a.pending() || b.pending()}` starts `a` and leaves `b` cold until something reads it, which is the two-load waterfall in a new place rather than a fixed one. A gate over several loads has to ask about all of them — `[a.pending(), b.pending()].includes(true)`, which reads worse and is the honest spelling. Asserted in BODY RUNS: every one of these renders correctly either way, just a round trip apart.',
            async run({ is }) {
                let leftRuns = 0
                let rightRuns = 0
                const left = memo(async () => {
                    leftRuns++
                    await sleep(10)
                    return 'L'
                })
                const right = memo(async () => {
                    rightRuns++
                    await sleep(10)
                    return 'R'
                })

                // The spelling `deferrable` could never see: two cells, one placeholder. It answers
                // correctly and starts ONE load, because `||` never evaluated the second probe.
                is('the OR gate answers', left.pending() || right.pending(), true)
                is('…but short-circuit left the second cold', [leftRuns, rightRuns], [1, 0])

                // Asking about both is what starts both, and it has to be spelled that way.
                is('asking about both', [left.pending(), right.pending()].includes(true), true)
                is('…and now both are in flight', [leftRuns, rightRuns], [1, 1])

                // And a gate lifted into a derivation, which is the same fact one level up.
                let gateRuns = 0
                const slow = memo(async ({ id }: { id: number }) => {
                    gateRuns++
                    await sleep(10)
                    return `row ${id}`
                })
                const loading = memo(() => slow({ id: 1 }).pending())
                is('a memo OVER a probe reports the load', loading(), true)
                is('…which its own read started', gateRuns, 1)

                // A NEGATED probe in a ternary — no `{#if}`, so nothing ever recognised it. It read
                // `done()` false on a cold cell, rendered the placeholder and started nothing, on
                // both substrates: a page stuck on 'Not done' for good, with the right markup.
                let stuckRuns = 0
                const report = memo(async () => {
                    stuckRuns++
                    await sleep(10)
                    return 'ready'
                })
                is('the arm a cold cell takes', !report.done() ? 'Not done' : report(), 'Not done')
                is('…and taking it started the load', stuckRuns, 1)

                await sleep(40)
                is('left', left(), 'L')
                is('right', right(), 'R')
                is('the row', slow({ id: 1 })(), 'row 1')
                is('the ternary is no longer stuck', !report.done() ? 'Not done' : report(), 'ready')
                is('and none of them loaded twice', [leftRuns, rightRuns, gateRuns, stuckRuns], [1, 1, 1, 1])
            },
        },

        {
            title: 'a rejecting body throws from the read; await rejects',
            note: 'Both spellings report the same failure. The probes still answer without throwing.',
            async run({ is, throws, rejects }) {
                const flaky = memo(async () => {
                    await sleep(10)
                    throw new Error('upstream 503')
                })
                // The load has not failed yet — it has not finished starting.
                is('the first read', flaky(), undefined)
                await sleep(30)
                throws('flaky()', () => flaky(), 'upstream 503')
                await rejects('await flaky', Promise.resolve(flaky), 'upstream 503')
                is('flaky.error()', flaky.error(), new Error('upstream 503'))
                is('flaky.peek() — nothing was ever retained', flaky.peek(), undefined)
            },
        },

        {
            title: 'dispose — a derivation owns subscriptions, so it can be torn down',
            note: 'The one verb `state` does not carry, for the same reason it has no `refresh`: there is nothing there to own.',
            async run({ is }) {
                const n = state(1)
                let bodyRuns = 0
                const doubled = memo(() => {
                    bodyRuns++
                    return n() * 2
                })
                is('doubled()', doubled(), 2)
                doubled.dispose()
                n.set(5)
                is('after dispose, n=5 → doubled()', doubled(), 2)
                is('it never re-ran', bodyRuns, 1)
            },
        },

        {
            title: 'a body that throws SYNCHRONOUSLY settles, and recovers when its deps do',
            note: 'A sync throw is a failed settle, the same outcome the keyed form gives it — not a node left mid-recompute. Left mid-recompute it can never be marked again, so nothing downstream wakes even after the data comes back, and the memoisation goes with it: every read re-runs the body. Both halves are invisible to a value assertion — the read throws the right error either way — so the claim is the wake count and the body count.',
            async run({ is }) {
                const n = state(1)
                let bodyRuns = 0
                const checked = memo(() => {
                    bodyRuns++
                    const value = n()
                    if (value < 3) throw new Error('too small')
                    return value * 10
                })

                // `reader` records one entry per RUN, and turns a throw into `THROW <message>`.
                const view = reader(() => checked())
                is('the read throws while the body does', view.seen, ['THROW too small'])

                // A failed derivation is still a derivation: the failure is what it HOLDS.
                for (let i = 0; i < 5; i++) {
                    try {
                        checked()
                    } catch {}
                }
                is('five more reads, no more body runs', bodyRuns, 1)

                n.set(5)
                await tick()
                is('the reader woke when the source recovered', view.seen.length, 2)
                is('…and reads the recovered value', checked(), 50)
                is('…which took exactly one more body run', bodyRuns, 2)
                view.dispose()
            },
        },

        {
            title: 'a disposed derivation stays disposed, through refresh and invalidate',
            note: 'Both verbs WRITE the status, so assigning "recompute me" over "dead" undid the disposal and the guards further in had nothing left to see. A revived node re-subscribes to every source and has no owner left to dispose it a second time — it just keeps running, which nothing about the values it reports can show.',
            async run({ is }) {
                const n = state(1)
                let bodyRuns = 0
                const doubled = memo(() => {
                    bodyRuns++
                    return n() * 2
                })
                is('doubled()', doubled(), 2)
                doubled.dispose()

                doubled.refresh()
                doubled.invalidate()
                n.set(5)
                await tick()
                is('neither verb re-ran the body', bodyRuns, 1)
                is('…and what it held is still what it reads', doubled(), 2)
            },
        },

        {
            title: 'disposing mid-load ENDS it: awaiters are told, later awaits do not hang',
            note: 'A settle after disposal is dropped, so an in-flight load has to be ended rather than left looking in flight — or anyone already awaiting it parks forever.',
            async run({ is }) {
                const gate = Promise.withResolvers<string>()
                const user = memo(() => gate.promise)
                // `.then` directly, not `Promise.resolve(user)`: assimilation calls `then` a
                // microtask later, which would park the waiter AFTER the dispose it must observe.
                const stranded = user.then(
                    () => 'landed',
                    (error: unknown) => String(error),
                )
                user.dispose()
                is('the awaiter was told', (await stranded).includes('disposed'), true)
                is('pending()', user.pending(), false)
                // Nothing more is coming, so this resolves rather than waiting on a load that is over.
                is('a later await resolves what was retained', await user, undefined)
                gate.resolve('too late')
                await tick()
                is('the settle was dropped', user.peek(), undefined)
            },
        },

        // --- the load form ---------------------------------------------------

        {
            title: 'load — the args ARE the cache key, one slot per key',
            note: 'The call SELECTS a slot and hands back its handle. Selecting costs nothing and starts nothing; the read is what kicks a cold load.',
            async run({ is }) {
                let bodyRuns = 0
                const get = memo(async ({ id }: { id: number }) => {
                    bodyRuns++
                    return id * 10
                })

                is('await get({id:1})', await get({ id: 1 }), 10)
                is('await get({id:2})', await get({ id: 2 }), 20)
                is('await get({id:1}) again', await get({ id: 1 }), 10)
                is('one run per distinct key', bodyRuns, 2)
            },
            interact({ host, log }) {
                let bodyRuns = 0
                const search = memo(async ({ q }: { q: string }) => {
                    bodyRuns++
                    await sleep(120)
                    return ['alpha', 'beta', 'gamma', 'delta'].filter((word) => word.includes(q))
                })
                const out = stage(host)
                const list = document.createElement('p')
                list.className = 'text-ink min-h-6'
                out.append(list)

                const query = state('')
                // The read is the subscription AND the kick — so it goes FIRST, and the probe
                // interprets what it found. Probing before reading reports `false` on a cold slot
                // and the spinner branch is then chosen before anything has started.
                reader(() => {
                    const slot = search({ q: query() })
                    const value = slot()
                    list.textContent = slot.pending() ? 'loading…' : show(value ?? [])
                    log.live('body runs (one per distinct key)', bodyRuns)
                })
                host.append(field('q =', (value) => query.set(value)))
            },
        },

        {
            title: 'a NULL-valued arg addresses its slot WITHOUT the JSON path',
            note: '`typeof null` is `object`, so a nullable optional argument used to fall out of the length-prefixed key and onto `Object.entries` + `JSON.stringify` — the same cliff the key format exists to avoid, one type over. It cost 26 ns on a select costing 124. COUNTED rather than timed, because the wrong implementation returns exactly the right key at full price: what is asserted is that the expensive path was not walked.',
            async run({ is }) {
                const get = memo(async (args: { id: number; parent: number | null }) => `${args.id}/${args.parent}`)

                // Warmed first: a MISS builds the slot, and the SELECT is what is being counted.
                is('the null slot loads', await get({ id: 1, parent: null }), '1/null')
                is('and the ordinary one', await get({ id: 1, parent: 2 }), '1/2')

                const stringify = countCalls(JSON, 'stringify')
                try {
                    get({ id: 1, parent: null })
                    is('selecting with a null arg stringifies nothing', stringify.calls, 0)
                } finally {
                    stringify.restore()
                }

                // The `typeof` tag is what keeps the two apart now that both are written inline:
                // `null` carries `object`, the string carries `string`. Without it they would glue
                // into one key and the second call would be answered with the first's result.
                let runs = 0
                const spelled = memo(async (args: { v: unknown }) => {
                    runs++
                    return String(args.v)
                })
                is('null', await spelled({ v: null }), 'null')
                is("the string 'null'", await spelled({ v: 'null' }), 'null')
                is('two spellings, two slots', runs, 2)
            },
        },

        {
            title: 'identical concurrent calls COALESCE onto one run',
            note: 'And the args key is order-independent: {a,b} and {b,a} address one slot.',
            async run({ is }) {
                let bodyRuns = 0
                const load = memo(async (args: { a: number; b: number }) => {
                    bodyRuns++
                    await sleep(20)
                    return args.a + args.b
                })

                is(
                    'two concurrent awaits',
                    await Promise.all([load({ a: 1, b: 2 }), load({ a: 1, b: 2 })]),
                    [3, 3],
                )
                is('one run', bodyRuns, 1)
                is('the reordered key', await load({ b: 2, a: 1 }), 3)
                is('…addresses the same slot', bodyRuns, 1)
            },
            bench: {
                kind: 'wake',
                arms: [
                    {
                        label: 'abide — keyed memo',
                        run: async () => {
                            let bodyRuns = 0
                            const load = memo(async ({ q }: { q: string }) => {
                                bodyRuns++
                                await Promise.resolve()
                                return q
                            })
                            await Promise.all(Array.from({ length: 100 }, () => load({ q: 'alpha' })))
                            return { count: bodyRuns, of: 'body runs for 100 concurrent calls' }
                        },
                    },
                    {
                        label: 'vanilla — careful (in-flight map)',
                        run: async () => {
                            let bodyRuns = 0
                            const cache = vanilla.keyedCache(async (key) => {
                                bodyRuns++
                                await Promise.resolve()
                                return key
                            })
                            await Promise.all(Array.from({ length: 100 }, () => cache.load('alpha')))
                            return { count: bodyRuns, of: 'body runs for 100 concurrent calls' }
                        },
                    },
                    {
                        label: 'vanilla — careless (settled map only)',
                        run: async () => {
                            let bodyRuns = 0
                            const cache = vanilla.keyedCache(async (key) => {
                                bodyRuns++
                                await Promise.resolve()
                                return key
                            })
                            await Promise.all(Array.from({ length: 100 }, () => cache.loadNaive('alpha')))
                            return { count: bodyRuns, of: 'body runs for 100 concurrent calls' }
                        },
                    },
                ],
            },
        },

        {
            title: 'a SYNC body settles in the call',
            note: 'No pending flash, no microtask, no wake-up a tick later to correct an `undefined` nobody should have seen. The promise wrapper is the fallback path, not the default.',
            async run({ is }) {
                let bodyRuns = 0
                const double = memo(({ n }: { n: number }) => {
                    bodyRuns++
                    return n * 2
                })

                is('the first read', double({ n: 21 })(), 42)
                is('pending() on that slot', double({ n: 21 }).pending(), false)
                is('settled()', double({ n: 21 }).settled(), true)

                const view = reader(() => double({ n: 4 })())
                await tick()
                is('the value was there on the first read', view.seen, ['8'])

                // …and it still caches, coalesces and awaits like the async one.
                is('await', await double({ n: 21 }), 42)
                is('body runs', bodyRuns, 2)
                view.dispose()
            },
            bench: {
                kind: 'wake',
                arms: [
                    {
                        label: 'abide — keyed memo, sync body',
                        run: async () => {
                            const double = memo(({ n }: { n: number }) => n * 2)
                            const seen: unknown[] = []
                            watch(() => {
                                seen.push(double({ n: 21 })())
                            })
                            await tick()
                            return { count: seen.length, of: `paints to show 42 — saw ${seen.join(' → ')}` }
                        },
                    },
                    {
                        label: 'vanilla — the same body behind a promise',
                        run: async () => {
                            const held = vanilla.cell<number | undefined>(undefined)
                            const seen: unknown[] = []
                            const paint = (): number => seen.push(held.get())
                            held.subscribe(paint)
                            paint()
                            void Promise.resolve(21 * 2).then((value) => held.set(value))
                            await tick()
                            return { count: seen.length, of: `paints to show 42 — saw ${seen.join(' → ')}` }
                        },
                    },
                ],
            },
        },

        {
            title: 'a keyed cache HIT',
            note: 'The args have to become a key. abide sorts the entries and stringifies them so {a,b} and {b,a} address one slot — a `Map` keyed by a hand-built string does not pay that, and cannot make that promise.',
            async run({ is }) {
                const load = memo(({ q }: { q: string }) => `result for ${q}`)
                is('the first read loads', load({ q: 'alpha' })(), 'result for alpha')
                is('the second is a hit', load({ q: 'alpha' }).peek(), 'result for alpha')
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    const load = memo(({ q }: { q: string }) => `result for ${q}`)
                    load({ q: 'alpha' })()
                    const cache = new Map<string, string>([['alpha', 'result for alpha']])
                    return [
                        {
                            label: 'abide — search({ q }).peek()',
                            run: () => keep(load({ q: 'alpha' }).peek()),
                        },
                        { label: 'vanilla — map.get(q)', run: () => keep(cache.get('alpha')) },
                    ]
                })(),
            },
        },

        {
            title: 'the handle is a CELL — no vocabulary of its own',
            note: 'There is no `live` / `peek(args)` / `publish(args, v)`: those were one cell’s surface with an `args` parameter bolted onto each member. The args select the slot once, at the call.',
            async run({ is }) {
                let bodyRuns = 0
                const get = memo(async ({ id }: { id: number }) => {
                    bodyRuns++
                    return `v${id}`
                })

                const handle = get({ id: 1 }) // selection alone
                is('selecting starts nothing', bodyRuns, 0)
                // SELECTING and PEEKING are what leave it cold — the property that dies if the call
                // kicks, because then there is no way to name a key without starting work on it.
                // Asking is a different act, and it pays: see "a probe ASKS, and asking KICKS".
                is('peek()', handle.peek(), undefined)
                is('after a select and a peek, still cold', bodyRuns, 0)

                is('pending() kicks it', handle.pending(), true)
                is('body runs', bodyRuns, 1)
                is('settled()', handle.settled(), false)
                is('error()', handle.error(), undefined)
                is('…and those two joined the load rather than starting one', bodyRuns, 1)

                is('the read has nothing yet', handle(), undefined)
                is('await handle', await handle, 'v1')

                // …and so does an await on a cold slot, or it would resolve `undefined` forever.
                is('await on a fresh slot', await get({ id: 2 }), 'v2')
                is('body runs', bodyRuns, 2)
            },
            interact({ host, log }) {
                // The load is stamped, or a refresh reads as a button that does nothing: the verb
                // re-runs the body and lands the same fields, so every logged line is identical
                // unless the value itself records which run produced it.
                let loads = 0
                const profile = memo(async ({ id }: { id: number }) => {
                    await sleep(80)
                    if (id === 0) throw new Error('no such user')
                    return { id, name: `user#${id}`, load: ++loads }
                })
                const id = state(1)
                host.append(
                    row(
                        button('id = 1', () => id.set(1)),
                        button('id = 2', () => id.set(2)),
                        button('id = 0 (fails)', () => id.set(0)),
                        button('refresh this slot', () => profile({ id: id.peek() }).refresh()),
                        button('set() a local value', () =>
                            profile({ id: id.peek() }).set({ id: -1, name: 'local', load: 0 }),
                        ),
                        button('invalidate this slot', () => profile({ id: id.peek() }).invalidate()),
                    ),
                )
                reader(() => {
                    const slot = profile({ id: id() })
                    let read: string
                    try {
                        read = show(slot())
                    } catch (error) {
                        read = `THROW ${(error as Error).message}`
                    }
                    log.live('slot()', read)
                    log.live('peek()', slot.peek())
                    log.live('[pending, refreshing]', [slot.pending(), slot.refreshing()])
                    log.live('settled()', slot.settled())
                    log.live('error()', slot.error())
                })
            },
        },

        {
            title: 'a local write HOLDS, and is not treated as stale',
            note: '`set` on a slot settles it. The next read must not kick a load that immediately overwrites what was just written — it holds until a real load replaces it.',
            async run({ is }) {
                let runs = 0
                const get = memo(async ({ id }: { id: number }) => `loaded${id}:${++runs}`)
                const handle = get({ id: 1 })

                handle.set('typed by hand')
                is('the read does not kick over a fresh local write', handle(), 'typed by hand')
                is('await agrees', await handle, 'typed by hand')
                is('the body never ran', runs, 0)

                handle.refresh() // …until a real load replaces it
                await tick()
                is('after refresh', handle(), 'loaded1:1')
            },
        },

        {
            title: 'a live read wakes when its slot settles',
            note: 'A template slot is exactly this reader: the cold read SIGNALS, so the pass produces nothing at all — no `undefined` to narrow, and nothing painted — and the settle wakes it once with the value.',
            async run({ is }) {
                const get = memo(async ({ id }: { id: number }) => `v${id}`)
                const view = reader(() => get({ id: 7 })())
                await tick()
                is('the reader saw', view.seen, ['v7'])
                view.dispose()
            },
        },

        {
            title: 'a re-fill of unchanged data wakes nobody',
            note: 'Same status, same value — nothing a reader can observe changed, so nothing is woken.',
            async run({ is }) {
                const get = memo(async ({ id }: { id: number }) => `stable${id}`)
                await get({ id: 1 })
                const view = reader(() => get({ id: 1 })())
                is('the first read', view.seen.length, 1)

                get({ id: 1 }).refresh()
                await tick()
                is('after a refresh landing the same value', view.seen.length, 1)
                view.dispose()
            },
        },

        {
            title: 'a slot that resolved UNDEFINED reloads cold, exactly as a cell does',
            note: 'A retained `undefined` has settled but has nothing to keep showing — so the next load is `pending`, not `refreshing`. A spinner reading `refreshing` over a blank slot is the wrong spinner.',
            async run({ is }) {
                let runs = 0
                const maybe = memo(async ({ n }: { n: number }) => {
                    runs++
                    return n === 1 ? undefined : `value ${n}`
                })
                await maybe({ n: 1 })
                is('settled()', maybe({ n: 1 }).settled(), true)
                is('peek()', maybe({ n: 1 }).peek(), undefined)

                maybe({ n: 1 }).refresh()
                is('pending() — nothing is retained to keep showing', maybe({ n: 1 }).pending(), true)
                is('refreshing()', maybe({ n: 1 }).refreshing(), false)
                await tick()
                is('body runs', runs, 2)
            },
        },

        {
            title: 'a retry after a failure keeps throwing until it lands',
            note: 'The last known outcome is still a failure — a retry being in flight does not undo it.',
            async run({ is, throws }) {
                const attempts: {
                    promise: Promise<string>
                    resolve(v: string): void
                    reject(e: unknown): void
                }[] = []
                const get = memo(({ id: _id }: { id: number }) => {
                    const attempt = Promise.withResolvers<string>()
                    attempts.push(attempt)
                    return attempt.promise
                })
                is('the cold read', get({ id: 1 })(), undefined)
                attempts[0]?.reject(new Error('boom'))
                await tick()
                throws('after the failure', () => get({ id: 1 })(), 'boom')

                get({ id: 1 }).refresh()
                throws('a retry in flight does not clear it', () => get({ id: 1 })(), 'boom')
                attempts[1]?.resolve('recovered')
                await tick()
                is('and the settle does', get({ id: 1 })(), 'recovered')
            },
        },

        {
            title: 'a body that yields is a STREAM, and a dependency moving re-streams it',
            note: 'The same law a promise gets: an async iterable is not a value to hold, it is chunks to receive. A dependency of the body moving tears the old stream down — the generator’s own `finally` runs — and starts a new transcript rather than interleaving into the last one.',
            async run({ is, log }) {
                let closed = 0
                async function* run(n: number): AsyncGenerator<string> {
                    try {
                        for (let i = 0; i < 3; i++) {
                            await sleep(4)
                            yield `${n}.${i}`
                        }
                    } finally {
                        closed++
                    }
                }
                const seed = state(1)
                const feed = memo(() => run(seed()))
                const view = reader(() => feed())

                await until(() => feed.done())
                is('chunks()', feed.chunks(), ['1.0', '1.1', '1.2'])
                is('the value is the last chunk', feed(), '1.2')

                seed.set(2)
                // The chunks node still holds the OLD transcript until the re-run replaces it, so
                // the condition has to name the new stream rather than "three and done".
                await until(() => feed.done() && feed.chunks()[0] === '2.0')
                is('a new transcript, not a continuation', feed.chunks(), ['2.0', '2.1', '2.2'])
                is('and the old generator was closed', closed, 2)
                // One per chunk across both runs, and NOT one for the reader's own first pass: the
                // stream is cold there, so that read signals and the pass produces nothing. Nor one
                // for the re-stream — starting a stream moves no value, so nobody wakes for it.
                is('the reader woke once per chunk', view.seen.length, 6)
                log('the reader saw', view.seen.join(' → '))
                view.dispose()
            },
        },

        {
            title: 'invalidate mid-stream closes the generator at its next yield',
            note: 'Cancellation is OBSERVED, not preempted: the chunk already in flight is produced and then dropped, because nothing can reach into a suspended `await`. What is guaranteed is that it never lands, and that the generator’s `finally` runs.',
            async run({ is }) {
                let produced = 0
                let closed = 0
                async function* forever(): AsyncGenerator<number> {
                    try {
                        for (;;) {
                            await sleep(4)
                            produced++
                            yield produced
                        }
                    } finally {
                        closed++
                    }
                }
                const cell = state<number | undefined>(undefined)
                cell.set(forever())
                await until(() => cell.chunks().length >= 3)

                cell.invalidate()
                const atCancel = produced
                await sleep(40)
                is('the generator was closed', closed, 1)
                is('and stopped producing', produced <= atCancel + 1, true)
                is('nothing landed after the cancel', cell.chunks(), [])
                is('streaming()', cell.streaming(), false)
                is('and the cell is cold', cell.settled(), false)
            },
        },

        {
            title: 'a transform runs UNTRACKED over whatever the body produced',
            note: 'The body declares the dependencies; the transform shapes the answer. What the transform reads does NOT subscribe, which is the whole difference from writing the same code at the end of the body — and on a load it runs over the value that landed, not over the promise.',
            async run({ is }) {
                const rows = state([3, 1, 2])
                const cutoff = state(2)
                let transforms = 0
                const kept = memo(
                    () => rows(),
                    (values: number[]) => {
                        transforms++
                        return values.filter((n) => n <= cutoff()).sort((a, b) => a - b)
                    },
                )
                is('the memo IS the transform’s return value', kept(), [1, 2])
                is('transforms', transforms, 1)

                cutoff.set(9)
                is('a read inside the TRANSFORM is not a dependency', kept(), [1, 2])
                is('transforms', transforms, 1)

                rows.set([9, 1])
                is('a dependency of the BODY is', kept(), [1, 9])
                is('transforms', transforms, 2)
            },
        },

        {
            title: 'a transform that hands back a PROMISE is a load like any other',
            note: 'The same law the body follows, one stage along — so the declared-dependency form has an async arm: the first argument says what wakes it, the second is an untracked body that may load. What the cell holds is what the transform RESOLVED to, never the promise itself.',
            async run({ is }) {
                const id = state(1)
                let transforms = 0
                const label = memo(
                    () => id(),
                    async (n: number) => {
                        transforms++
                        await sleep(20)
                        return `row ${n}`
                    },
                )
                // Asking is what starts it, and `peek` is the one member that does not ask.
                is('cold, so the first probe kicks the load', label.pending(), true)
                is('and nothing is retained meanwhile', label.peek(), undefined)

                is('await serves what the transform RESOLVED to', await label, 'row 1')
                is('the read hands back the value, not the promise', label(), 'row 1')
                is('transforms', transforms, 1)

                id.set(2)
                await tick()
                is('a dependency moved: the old value is still served', label.peek(), 'row 1')
                is('over a load in flight', label.refreshing(), true)
                is('and the new answer replaces it', await label, 'row 2')
                is('transforms', transforms, 2)
            },
        },

        {
            title: 'an async transform over a STREAM is awaited in ORDER, not raced',
            note: 'A chunk is ordered, so this is the one place the promise is awaited in the loop rather than adopted: chunk n lands before n+1 is pulled. The delays below DECREASE, so a transform that ran concurrently would land them backwards.',
            async run({ is }) {
                async function* counted(): AsyncGenerator<number> {
                    yield 1
                    yield 2
                    yield 3
                }
                const doubled = memo(counted, async (n: number) => {
                    await sleep(24 - n * 6) // 18ms, 12ms, 6ms — later chunks resolve SOONER
                    return n * 2
                })
                await until(() => doubled.done())
                is('the transcript is in source order', doubled.chunks(), [2, 4, 6])
                is('and the value is the last chunk', doubled(), 6)
            },
        },

        {
            title: 'a transform on a keyed slot sees the LOADED value',
            note: 'It is the same rule one argument along: the args pick the slot, the body loads it, and the transform is what the slot ends up holding. That is what lets the shape a caller wants live next to the call rather than at every read site.',
            async run({ is }) {
                const name = memo(
                    async ({ id }: { id: number }) => ({ id, first: 'ada', last: 'lovelace' }),
                    (row: { id: number; first: string; last: string }) => `${row.first} ${row.last}`,
                )
                is('await', await name({ id: 7 }), 'ada lovelace')
                is('and the slot holds the transformed value', name({ id: 7 }).peek(), 'ada lovelace')
            },
        },

        {
            title: 'a synchronous throw reaches the reader, the probes and the promise alike',
            note: 'A body that throws in the call settles the slot in the call — the same way a sync value does.',
            async run({ is, throws, rejects }) {
                const parse = memo(({ text }: { text: string }) => JSON.parse(text) as unknown)
                throws('the read', () => parse({ text: '{oops' })(), 'JSON')
                is('peek() never throws', parse({ text: '{oops' }).peek(), undefined)
                is(
                    'error() is a SyntaxError',
                    (parse({ text: '{oops' }).error() as Error).name,
                    'SyntaxError',
                )
                is('settled()', parse({ text: '{oops' }).settled(), true)
                await rejects('await', Promise.resolve(parse({ text: '{oops' })))
                is('a good key still works', parse({ text: '{"ok":true}' })(), { ok: true })
            },
        },

        {
            title: 'a total `catch` around a pending read cannot commit what it built',
            note:
                'The reason nothing about the signal is on `abide`. A read with nothing to serve throws, a ' +
                'JavaScript catch is TOTAL, so an author’s try/catch swallows it — and the value that catch ' +
                'returns is still discarded, because the read RECORDS the signal and the run boundary ' +
                're-throws from the record rather than from what reached it. Reverting `Node.run`’s ' +
                '`if (outstanding !== null) throw outstanding` puts the fallback in front of a reader on ' +
                'every arm below.',
            async run({ is }) {
                const id = state(1)
                const user = memo(async ({ n }: { n: number }) => {
                    await sleep(20)
                    if (n < 0) throw new Error('no user by that id')
                    return `user ${n}`
                })
                // Written the way an author would who never heard of the signal: catch everything,
                // return something to show. The fallback is what this case is watching for.
                const nameOrTrouble = (n: number): string => {
                    try {
                        return user({ n })()
                    } catch {
                        return 'could not load'
                    }
                }

                // A DERIVATION over it — the boundary is `Node.run`'s.
                const label = memo(() => nameOrTrouble(id()))
                const derived = reader(() => label())
                await until(() => derived.seen.length > 0, 'the load to land')
                is('a derivation never serves the fallback', derived.seen, ['user 1'])
                derived.dispose()

                // The same helper read STRAIGHT from an effect, so the swallow happens in the effect's
                // own body rather than one derivation down.
                id.set(2)
                const direct = reader(() => nameOrTrouble(id()))
                await until(() => direct.seen.length > 0, 'the second load to land')
                is('…and neither does a watch body', direct.seen, ['user 2'])
                direct.dispose()

                // The arm that keeps the catch honest: a REJECTED load is not a signal, so the same
                // catch does the job it was written for. Without this the case would pass against an
                // implementation that simply never ran the catch.
                id.set(-1)
                const failing = reader(() => nameOrTrouble(id()))
                await until(() => failing.seen.length > 0, 'the failing load to settle')
                is('a real failure still reaches the catch', failing.seen, ['could not load'])
                failing.dispose()
            },
        },

        {
            title: 'the documented example runs',
            note: 'What `/docs/memo` shows and mounts, mounted here and asserted — including the half a reader would not think to check: the load form’s `pending()` region resolves to the list, on its own, with nothing in the markup awaiting anything.',
            async run({ is }) {
                // The rungs own their cells — a setup block is per INSTANCE — so this reaches them the
                // way a reader does, through the `bind:value` input each one renders. That is also what
                // makes the defaults assertable: a fresh mount cannot have been typed into.

                // Rung 1 — the derive form. Synchronous, so it is painted by the time `mount` returns.
                const derive = scratch(() => Derive({}))
                is('a derivation paints at once', derive.querySelector('p')?.textContent, 'AB')
                const typed = derive.querySelector('input') as HTMLInputElement
                typed.value = 'cd'
                typed.dispatchEvent(new Event('input'))
                await tick()
                is('…and again when the cell behind it is written', derive.querySelector('p')?.textContent, 'CD')
                derive.remove()

                // Rung 3 — the load form, whose whole claim is the region: a placeholder now, the list
                // when it lands, and nothing in the markup awaiting anything.
                const load = scratch(() => Load({}))
                is('a load shows its placeholder', load.querySelector('p')?.textContent, 'searching…')

                await until(() => load.querySelector('li') !== null, 'the load to land')
                const shown: string[] = []
                for (const item of load.querySelectorAll('li')) shown.push(item.textContent ?? '')
                is('…and then the list, with no await in the markup', shown, ['ab-one', 'ab-two'])

                load.remove()
            },
        },
    ],
})
