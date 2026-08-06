// `state` — own a value. Every capability the primitive has, one case each, and every case asserts
// what it demonstrates: the values AND the wake-ups, because a cell that reports the right thing
// while waking readers nothing moved for is the wrong implementation.

import { state, watch } from 'abide'
import { keep, reader, settled, sleep, suite, tick } from 'abide/tests'
import { button, field, row, stage } from './dom.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

async function fetchSession(name: string): Promise<{ name: string }> {
    await sleep(20)
    return { name }
}

export default suite({
    ...META.state,
    cases: [
        {
            title: 'read · write · peek',
            note: 'The call IS the read. `peek` is the same value with no subscription — the escape hatch. A write of the value already held moves nothing, so it wakes nobody.',
            async run({ is, log }) {
                const count = state(0)
                const tracked = reader(() => count())

                is('count()', count(), 0)
                count.set(count.peek() + 1)
                await tick()
                is('after set(1) — count()', count(), 1)
                is('reader woke', tracked.seen.length, 2)

                count.set(count.peek()) // the identity check
                await tick()
                is('a write of the SAME value wakes nobody', tracked.seen.length, 2)
                log('the reader saw', tracked.seen.join(' → '))
                tracked.dispose()
            },
            interact({ host, log }) {
                const count = state(0)
                const tracked = reader(() => count())
                // The write count is what makes the negative claim legible: a click that moves
                // nothing leaves every other line where it was, and without this one the card is
                // indistinguishable from a button that is not wired up.
                let writes = 0
                const report = (): void => {
                    log.live('writes', writes)
                    log.live('count()', count.peek())
                    queueMicrotask(() =>
                        log.live('reader woke', `${tracked.seen.length}× — ${tracked.seen.join(', ')}`),
                    )
                }
                host.append(
                    row(
                        button('count.set(count.peek() + 1)', () => {
                            count.set(count.peek() + 1)
                            writes++
                            report()
                        }),
                        button('count.set(same value)', () => {
                            count.set(count.peek())
                            writes++
                            report()
                        }),
                    ),
                )
                report()
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    const cell = state(1)
                    const plain = vanilla.cell(1)
                    const bare = { value: 1 }
                    return [
                        { label: 'abide — count()', run: () => keep(cell()) },
                        { label: 'vanilla — cell.get()', run: () => keep(plain.get()) },
                        { label: 'vanilla — object field', run: () => keep(bare.value) },
                    ]
                })(),
            },
        },

        {
            title: 'a write with no observers is an identity check and a store',
            note: 'The floor. A cell that has never met a promise carries no async bookkeeping at all — it is one node, and the write is the same two operations a hand-written store does.',
            async run({ is }) {
                const count = state(0)
                is('settled', count.settled(), true)
                count.set(1)
                is('count()', count(), 1)
                // Nothing was ever awaited, so no tracker was allocated: the probes still answer.
                is('pending()', count.pending(), false)
                is('error()', count.error(), undefined)
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    const cell = state(0)
                    const plain = vanilla.cell(0)
                    const bare = { value: 0 }
                    return [
                        { label: 'abide — count.set(i)', run: (i: number) => cell.set(i) },
                        { label: 'vanilla — cell.set(i)', run: (i: number) => plain.set(i) },
                        {
                            label: 'vanilla — object field',
                            run: (i: number): void => {
                                bare.value = i
                            },
                        },
                    ]
                })(),
            },
        },

        {
            title: 'one write, delivered to one reader',
            note: 'abide batches onto a microtask, so its op has to include the flush; a hand-written store notifies synchronously. This is the price of batching, paid on the one write where batching cannot help — and the next case is what it buys.',
            async run({ is }) {
                const cell = state(0)
                let seen = 0
                watch(() => {
                    void cell()
                    seen++
                })
                cell.set(1)
                is('the write itself delivers nothing yet', seen, 1)
                await tick()
                is('the flush is what delivers it', seen, 2)
            },
            bench: {
                kind: 'time',
                // The arm has to await the flush to have delivered anything, and those two awaits
                // are not free — so the card shows what they cost and the ratio can be read net of
                // it. Unstated, the harness was roughly half the reported gap.
                floor: 'flush',
                arms: (() => {
                    const cell = state(0)
                    let seen = 0
                    watch(() => {
                        void cell()
                        seen++
                    })
                    const plain = vanilla.cell(0)
                    plain.subscribe(() => seen++)
                    return [
                        {
                            label: 'abide — set + microtask flush',
                            run: async (i: number) => {
                                cell.set(i)
                                await settled()
                            },
                        },
                        { label: 'vanilla — set, synchronous notify', run: (i: number) => plain.set(i) },
                    ]
                })(),
            },
        },

        {
            title: '50 writes in one turn, delivered once',
            note: 'The case batching exists for. A hand-written store runs its reader fifty times and paints forty-nine frames nobody asked for.',
            async run({ is }) {
                const cell = state(0)
                let runs = 0
                watch(() => {
                    void cell()
                    runs++
                })
                for (let n = 1; n <= 50; n++) cell.set(n)
                is('immediately after fifty writes', runs, 1)
                await tick()
                is('one flush for the batch', runs, 2)
                is('and it sees the LAST value, not fifty of them', cell(), 50)
            },
            bench: {
                kind: 'time',
                per: { n: 50, label: 'write' },
                // Divided by fifty, the harness floor is a twelfth of a write rather than half of
                // one — which is the whole reason batching looks better here than in the case above.
                floor: 'flush',
                arms: (() => {
                    const cell = state(0)
                    let seen = 0
                    watch(() => {
                        void cell()
                        seen++
                    })
                    const plain = vanilla.cell(0)
                    plain.subscribe(() => seen++)
                    return [
                        {
                            label: 'abide — 50 writes, one flush',
                            run: async (i: number) => {
                                for (let n = 0; n < 50; n++) cell.set(i * 50 + n)
                                await settled()
                            },
                        },
                        {
                            label: 'vanilla — 50 writes, 50 notifies',
                            run: (i: number) => {
                                for (let n = 0; n < 50; n++) plain.set(i * 50 + n)
                            },
                        },
                    ]
                })(),
            },
        },

        {
            title: 'a promise is a LOAD, not a value',
            note: '`state(fetch())` never holds the promise. It holds what the promise settled to, and the read is the ordinary call.',
            async run({ is, log }) {
                const session = state(fetchSession('ada'))
                const view = reader(() => (session.pending() ? 'loading…' : session()?.name))

                is('session() immediately', session(), undefined)
                is('pending()', session.pending(), true)
                is('settled()', session.settled(), false)

                await sleep(40)
                is('session() once it lands', session(), { name: 'ada' })
                is('pending() after', session.pending(), false)
                is('settled() after', session.settled(), true)
                is('await session', await session, { name: 'ada' })
                // One wake to fill it in — not one per probe.
                is('the reader woke', view.seen.length, 2)
                log('the reader saw', view.seen.join(' → '))
                view.dispose()
            },
        },

        {
            title: 'a sync cell answers the async surface honestly',
            note: 'There is no second vocabulary for a cell that never met a promise. It answers the same seven members, truthfully.',
            async run({ is }) {
                const count = state(1)
                is('count()', count(), 1)
                is('peek()', count.peek(), 1)
                is('pending()', count.pending(), false)
                is('refreshing()', count.refreshing(), false)
                is('settled()', count.settled(), true)
                is('error()', count.error(), undefined)
                is('await count', await count, 1) // already resolved: no load was ever started

                // …and the two kinds mix in one `Promise.all`, which is the point of the uniformity.
                const loaded = state(Promise.resolve(2))
                is('Promise.all over both kinds', await Promise.all([state('x'), loaded]), ['x', 2])
            },
        },

        {
            title: 'a reload RETAINS the value and moves only `refreshing`',
            note: '`pending` is COLD — nothing to show. `refreshing` is WARM — a load over a retained value. Separate signals, so a warm reload never wakes a reader whose answer did not change.',
            async run({ is, log }) {
                const session = state('ada')
                const value = reader(() => session())
                const blank = reader(() => session.pending())
                await tick()

                session.set(Promise.resolve('grace'))
                is('during: still serving what it has', session(), 'ada')
                is('during: refreshing()', session.refreshing(), true)
                is('during: pending() — warm, nothing to be blank about', session.pending(), false)

                await tick()
                is('after: session()', session(), 'grace')
                is('after: refreshing()', session.refreshing(), false)
                is('the value reader woke', value.seen.length, 2)
                // The whole reason `pending` and `refreshing` are separate signals.
                is('the blank-slate reader woke', blank.seen.length, 1)
                log('value reader saw', value.seen.join(' → '))
                value.dispose()
                blank.dispose()
            },
            interact({ host, log }) {
                const session = state<{ name: string } | undefined>({ name: 'ada' })
                const value = reader(() => session()?.name)
                const spinner = reader(() => session.refreshing())
                host.append(
                    row(
                        button('session.set(fetchSession("grace"))', async () => {
                            session.set(fetchSession('grace'))
                            log('during: [refreshing, pending]', [session.refreshing(), session.pending()])
                            await sleep(40)
                            log('after: session()', session.peek())
                            log('value reader', `${value.seen.join(' → ')} (${value.seen.length})`)
                            log('spinner reader', `${spinner.seen.join(' → ')} (${spinner.seen.length})`)
                        }),
                    ),
                )
            },
            bench: {
                kind: 'wake',
                arms: [
                    {
                        label: 'abide — refreshing is its own signal',
                        run: async () => {
                            const cell = state('a')
                            let valueRuns = 0
                            let coldRuns = 0
                            watch(() => {
                                void cell()
                                valueRuns++
                            })
                            watch(() => {
                                void cell.pending()
                                coldRuns++
                            })
                            await tick()
                            cell.set(Promise.resolve('a')) // a reload landing the same value
                            await tick()
                            await tick()
                            return {
                                count: valueRuns - 1 + (coldRuns - 1),
                                of: 'wakes across the value reader and the cold-spinner reader',
                            }
                        },
                    },
                    {
                        label: 'vanilla — one status record',
                        run: async () => {
                            // The shape everyone reaches for: { value, pending, refreshing } in one
                            // cell. Rebuilt per settle, so the identity check never holds.
                            const store = vanilla.cell({ value: 'a', pending: false, refreshing: false })
                            let runs = 0
                            store.subscribe(() => runs++)
                            store.set({ value: 'a', pending: false, refreshing: true })
                            await Promise.resolve()
                            store.set({ value: 'a', pending: false, refreshing: false })
                            return { count: runs, of: 'wakes — a rebuilt record is always a new value' }
                        },
                    },
                ],
            },
        },

        {
            title: 'a reload landing the SAME value wakes nobody',
            note: 'Identity is the test — which is why the second half uses a fresh object with identical fields and honestly reports a wake.',
            async run({ is }) {
                const name = state('ada')
                const primitive = reader(() => name())
                name.set(Promise.resolve('ada'))
                await sleep(20)
                is('a primitive re-fill wakes nobody', primitive.seen.length, 1)

                const session = state(await fetchSession('ada'))
                const record = reader(() => session()?.name)
                session.set(fetchSession('ada')) // a FRESH object with the same fields
                await sleep(40)
                is('a rebuilt record IS a new value', record.seen.length, 2)
                primitive.dispose()
                record.dispose()
            },
            bench: {
                kind: 'wake',
                arms: [
                    {
                        label: 'abide — state',
                        run: async () => {
                            const cell = state(1)
                            let runs = 0
                            watch(() => {
                                void cell()
                                runs++
                            })
                            await tick()
                            for (let i = 0; i < 100; i++) cell.set(1)
                            await tick()
                            return { count: runs - 1, of: 're-runs from 100 identical writes' }
                        },
                    },
                    {
                        label: 'vanilla — careful (identity check)',
                        run: async () => {
                            const cell = vanilla.cell(1)
                            let runs = 0
                            cell.subscribe(() => runs++)
                            for (let i = 0; i < 100; i++) cell.set(1)
                            return { count: runs, of: 're-runs from 100 identical writes' }
                        },
                    },
                    {
                        label: 'vanilla — careless (notify always)',
                        run: async () => {
                            const cell = vanilla.naiveCell(1)
                            let runs = 0
                            cell.subscribe(() => runs++)
                            for (let i = 0; i < 100; i++) cell.set(1)
                            return { count: runs, of: 're-runs from 100 identical writes' }
                        },
                    },
                ],
            },
        },

        {
            title: 'the newest write wins, however the loads settle',
            note: 'The classic type-ahead bug: two loads in flight, the first settling last. A generation stamp on every adoption drops the stale settle.',
            async run({ is }) {
                const slow = Promise.withResolvers<string>()
                const fast = Promise.withResolvers<string>()
                const query = state<string | undefined>(undefined)

                query.set(slow.promise)
                query.set(fast.promise)
                fast.resolve('the answer to the NEWER question')
                await tick()
                slow.resolve('the answer to the OLDER question') // lands last
                await tick()
                is('query()', query(), 'the answer to the NEWER question')
            },
        },

        {
            title: 'a sync write cancels an in-flight load',
            note: 'It is the newer answer, so the load in flight is no longer wanted.',
            async run({ is }) {
                const slow = Promise.withResolvers<string>()
                const draft = state<string | undefined>(undefined)
                draft.set(slow.promise)
                is('pending() while it is in flight', draft.pending(), true)

                draft.set('typed by hand')
                is('pending() after the sync write', draft.pending(), false)
                is('settled()', draft.settled(), true)

                slow.resolve('the server said otherwise')
                await tick()
                is('draft() — the load was dropped', draft(), 'typed by hand')
            },
        },

        {
            title: 'a failed load THROWS from the read',
            note: 'Reporting `undefined` would let a caller who never checked `error()` render as though nothing went wrong. `peek` still serves the retained value — that is how a UI shows stale data next to an error.',
            async run({ is, log, throws, rejects }) {
                const session = state('ada')
                const view = reader(() => session())
                await tick()

                session.set(Promise.reject(new Error('offline')))
                await tick()
                throws('session()', () => session(), 'offline')
                is('session.peek() still serves it', session.peek(), 'ada')
                is('session.error()', session.error(), new Error('offline'))
                is('settled()', session.settled(), true)
                is('pending()', session.pending(), false)
                await rejects('await session', Promise.resolve(session), 'offline')

                // The value node never moved — only the failure channel did. A reader subscribed to
                // the value alone would still be rendering 'ada' as though the load had succeeded.
                is('the reader saw the OUTCOME flip', view.seen, ['ada', 'THROW offline'])

                session.set('ada') // the SAME value: nothing moves but the error clearing
                await tick()
                is('recovery wakes it again', view.seen, ['ada', 'THROW offline', 'ada'])
                is('error() is cleared', session.error(), undefined)
                log('', 'the value never moved; only the OUTCOME of reading it did — and that is a wake')
                view.dispose()
            },
        },

        {
            title: 'a rejection of `undefined` still wakes and still throws',
            note: 'A reason of `undefined` is indistinguishable from "no error" in the error node’s identity check, so it would settle without waking anyone. A marker keeps the wake honest.',
            async run({ is, throws }) {
                const user = state<string | undefined>('ada')
                user.set(Promise.reject(undefined))
                await tick()
                throws('user()', () => user(), 'rejected with undefined')
                is('error() is a real Error', user.error() instanceof Error, true)
            },
        },

        {
            title: 'invalidate — this data is WRONG',
            note: 'Drops the value and the error, cancels what is in flight, and goes back to cold. A `state` has no body, so nothing re-runs: `invalidate` needs only data, `refresh` needs a body.',
            async run({ is }) {
                const token = state<string | undefined>('sk-live-42')
                is('settled() before', token.settled(), true)
                token.invalidate()
                is('token() after invalidate', token(), undefined)
                is('settled() after invalidate', token.settled(), false)
                is('it started nothing', token.pending(), false)

                token.set('sk-live-43')
                is('and a write settles it again', token(), 'sk-live-43')
                // `refresh` is the one verb a bodyless cell does not carry.
                is('"refresh" in a state', 'refresh' in token, false)
            },
            interact({ host, log }) {
                const token = state<string | undefined>('sk-live-42')
                const report = (): void => {
                    log.live('token()', token())
                    log.live('settled()', token.settled())
                }
                host.append(
                    row(
                        button('token.invalidate()', () => {
                            token.invalidate()
                            report()
                        }),
                        button('token.set("sk-live-43")', () => {
                            token.set('sk-live-43')
                            report()
                        }),
                    ),
                )
                report()
            },
        },

        {
            title: 'live — a state driving the DOM by hand',
            note: 'No renderer involved: a `watch` writes the text. This is exactly what a template slot compiles down to on the client page.',
            async run({ host, is }) {
                const text = state('type here')
                const view = document.createElement('p')
                host.append(view)
                const painted = reader(() => (view.textContent = text().toUpperCase()))

                is('the effect painted on creation', view.textContent, 'TYPE HERE')
                text.set('hello')
                await tick()
                is('and again when the cell moved', view.textContent, 'HELLO')
                is('one run per write, no more', painted.seen.length, 2)
                painted.dispose()
            },
            interact({ host }) {
                const text = state('type here')
                const out = stage(host)
                const view = document.createElement('p')
                view.className = 'text-lg text-slate-100'
                out.append(view)
                // The watch IS the subscription: reading `text()` inside it is the whole registration.
                reader(() => (view.textContent = text().toUpperCase()))
                host.append(field('text.set(', (value) => text.set(value), 'type here'))
            },
        },
    ],
})
