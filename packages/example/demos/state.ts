// `state` — own a value. Every capability the primitive has, one case each, and every case asserts
// what it demonstrates: the values AND the wake-ups, because a cell that reports the right thing
// while waking readers nothing moved for is the wrong implementation.

import { isolate, state, watch } from 'abide'
import { keep, reader, settled, sleep, suite, tick, until } from 'abide/tests'
import { button, el, field, row, stage } from './dom.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

async function fetchSession(name: string): Promise<{ name: string }> {
    await sleep(20)
    return { name }
}

/** A stream of `n` chunks, yielding on the microtask queue rather than a timer. */
async function* chunks(n: number): AsyncGenerator<number> {
    for (let i = 0; i < n; i++) {
        await Promise.resolve()
        yield i
    }
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
            title: 'an async iterable is a STREAM, the way a promise is a load',
            note: 'The cell holds the LATEST chunk and `chunks()` holds the transcript. The probes compose rather than needing a vocabulary of their own — cold until the first chunk, then a load in flight over a value already being served, and `done` only once it ends cleanly.',
            async run({ is, log }) {
                async function* words(): AsyncGenerator<string> {
                    for (const word of ['the', 'quick', 'brown']) {
                        await sleep(5)
                        yield word
                    }
                }
                const line = state<string | undefined>(undefined)
                const view = reader(() => line())
                line.set(words())

                is('pending() before the first chunk', line.pending(), true)
                is('streaming()', line.streaming(), true)
                is('chunks()', line.chunks(), [])

                await until(() => line.chunks().length === 1)
                is('the value IS the latest chunk', line(), 'the')
                is('pending() — there is something to show now', line.pending(), false)
                is('refreshing() — and more is coming', line.refreshing(), true)
                // The cell settled long ago holding `undefined`, so `settled` is the wrong question
                // mid-stream — `done` is the one that asks whether there is an OUTCOME yet.
                is('done() — chunks have landed, but not an outcome', line.done(), false)

                is('await resolves when the stream ENDS', await line, 'brown')
                is('chunks()', line.chunks(), ['the', 'quick', 'brown'])
                is('streaming() after', line.streaming(), false)
                is('settled() after', line.settled(), true)
                is('done() — it ended cleanly', line.done(), true)
                // One per chunk. The end moves no value, so it wakes nobody a fourth time.
                is('the reader woke once per chunk', view.seen.length, 4)
                log('the reader saw', view.seen.join(' → '))
                view.dispose()

                // The VERSION is what a reader of `chunks()` wakes on, and what it is handed back is
                // the transcript itself rather than a copy — the same array across chunks as well as
                // between them. That is what stops a reader who re-reads the whole list paying an
                // array per chunk; the identity moving at all means the transcript was REPLACED,
                // which only a reset or an overflow drop does.
                const asked = line.chunks()
                const askedAgain = line.chunks()
                is('chunks() hands back the transcript itself', asked === askedAgain, true)
            },
            interact({ host, log }) {
                async function* typing(): AsyncGenerator<string> {
                    for (const word of 'a stream is a value that arrives in pieces'.split(' ')) {
                        await sleep(120)
                        yield word
                    }
                }
                const line = state<string | undefined>(undefined)
                const out = stage(host)
                const shown = el('p', 'text-lg text-slate-100 min-h-7')
                out.append(shown)
                reader(() => {
                    shown.textContent = line.chunks().join(' ')
                    log.live('[pending, streaming, done]', [line.pending(), line.streaming(), line.done()])
                    log.live('chunks', line.chunks().length)
                })
                host.append(
                    row(
                        button('line.set(typing())', () => line.set(typing())),
                        button('line.invalidate() — mid-stream', () => line.invalidate()),
                    ),
                )
            },
            bench: {
                kind: 'wake',
                arms: [
                    {
                        label: 'abide — state.set(asyncIterable)',
                        run: async () => {
                            const line = state<number | undefined>(undefined)
                            let runs = 0
                            watch(() => {
                                void line()
                                runs++
                            })
                            await tick()
                            line.set(chunks(20))
                            await until(() => line.done())
                            await tick()
                            return { count: runs - 1, of: 'wakes for a 20-chunk stream' }
                        },
                    },
                    {
                        label: 'vanilla — the loop, by hand',
                        run: async () => {
                            let runs = 0
                            const held = vanilla.stream(chunks(20))
                            held.subscribe(() => runs++)
                            await until(() => held.done())
                            return { count: runs, of: 'wakes for a 20-chunk stream' }
                        },
                    },
                ],
            },
        },

        {
            title: 'for await — the cursor face of the same transcript',
            note: '`chunks()` is for a reader that re-reads the whole list; this is for one that reads each chunk once and never looks back. Same cell, same transcript, no second vocabulary — and the two are why `chunks()` can hand back the live buffer: the reader that must not see it move is the one that re-reads it, and this one re-reads nothing. The replay is what makes it a CELL rather than a subscription: a consumer that arrives after the stream ended still gets the whole of it.',
            async run({ is }) {
                async function* words(): AsyncGenerator<string> {
                    for (const word of ['one', 'two', 'three']) {
                        await sleep(3)
                        yield word
                    }
                }
                const line = state<string | undefined>(undefined)
                line.set(words())

                const got: (string | undefined)[] = []
                for await (const word of line) got.push(word)
                is('the loop received every chunk', got, ['one', 'two', 'three'])

                const again: (string | undefined)[] = []
                for await (const word of line) again.push(word)
                is('a second consumer replays the whole of it', again, ['one', 'two', 'three'])

                // Nothing here is special-cased for a stream: a cell that never met one has no
                // transcript, so the loop hands over what it holds and ends.
                const plain = state('just this')
                const once: string[] = []
                for await (const value of plain) once.push(value)
                is('a cell that never streamed yields its value and ends', once, ['just this'])
            },
        },

        {
            title: 'a long stream costs its LENGTH, not its length squared',
            note: 'The transcript is what a stream accumulates, and unlike a channel’s it has no cap — so rebuilding it per chunk was O(n²) over the whole stream. At 64k chunks that was 98% of the entire cost of streaming: 781 ms, of which 770 ms was copying an array that had just been copied. It is pushed into now, with a version counter to wake readers, and `chunks()` hands back the buffer itself. Both arms below matter and only the second one is hard: a stream nobody reads the transcript of never copies anything, so it stayed linear even when a reader of one was still quadratic — the copy had moved from the write to the read rather than gone. The reader that re-reads the whole list per chunk is the one the shape has to survive.',
            async run({ is }) {
                async function* counted(n: number): AsyncGenerator<number> {
                    for (let i = 0; i < n; i++) yield i
                }
                const drain = async (n: number, live: boolean): Promise<number> => {
                    const cell = state<number | undefined>(undefined)
                    const at = performance.now()
                    cell.set(counted(n))
                    // Subscribed to the transcript, which is what a slot rendering one is: it wakes
                    // per chunk and reads the whole list back every time.
                    const stop = live ? watch(() => void cell.chunks().length) : null
                    await until(() => cell.done(), 'the stream to finish', 30_000)
                    const took = performance.now() - at
                    stop?.()
                    is(`${n} chunks all arrived`, cell.chunks().length, n)
                    return took
                }

                // Four times the chunks. Linear says about 4x; the quadratic shape this replaced was
                // 8x between these two sizes and got worse from there.
                const alone = (await drain(16_000, false)) / (await drain(4_000, false))
                is(`4x the chunks costs about 4x, not 16x (${alone.toFixed(1)}x)`, alone < 8, true)

                // The arm the copy hid in. Measured at 8.0x while `chunks()` still snapshotted, and
                // 1.2–3.0x once it stopped — the bound sits between the two rather than beside
                // either, because the quadratic only gets worse with n and the linear one does not.
                const watched = (await drain(16_000, true)) / (await drain(4_000, true))
                is(`…and the same with a reader of the transcript (${watched.toFixed(1)}x)`, watched < 6, true)
            },
        },

        {
            title: 'a transform is where a write is normalised',
            note: 'Every write passes through it before it is stored — the INITIAL too, because a clamp with a hole in it exactly where the author put the value is not a clamp. It runs untracked, and a promise is still a load: it sees what landed, not the promise.',
            async run({ is }) {
                const volume = state(11, (n: number) => Math.max(0, Math.min(10, n)))
                is('the initial passed through it too', volume(), 10)
                volume.set(-5)
                is('after set(-5)', volume(), 0)
                volume.set(7)
                is('after set(7)', volume(), 7)

                volume.set(Promise.resolve(99))
                await tick()
                is('a loaded value is a write like any other', volume(), 10)

                const heard = reader(() => volume())
                volume.set(50) // clamps to the value already held
                await tick()
                is('a write that normalises to what is held wakes nobody', heard.seen.length, 1)
                heard.dispose()
            },
            interact({ host, log }) {
                const volume = state(5, (n: number) => Math.max(0, Math.min(10, n)))
                const report = (): void => log.live('volume()', volume())
                host.append(
                    row(
                        button('volume.set(volume.peek() + 3)', () => {
                            volume.set(volume.peek() + 3)
                            report()
                        }),
                        button('volume.set(-100)', () => {
                            volume.set(-100)
                            report()
                        }),
                    ),
                    field('volume.set(', (value) => {
                        volume.set(Number(value))
                        report()
                    }),
                )
                report()
            },
        },

        {
            title: 'a transform that throws is a failed write',
            note: 'In the call it throws where the caller is standing. On a load it settles the cell as a failure exactly as a rejection would — there is nobody under a promise callback to catch it.',
            async run({ is, throws }) {
                const port = state(3000, (n: number) => {
                    if (!Number.isInteger(n)) throw new Error(`not a port: ${n}`)
                    return n
                })
                throws('a sync write throws at the call', () => port.set(1.5), 'not a port')
                is('and the cell still holds what it had', port(), 3000)

                port.set(Promise.resolve(2.5))
                await tick()
                throws('a loaded one settles as a failure', () => port(), 'not a port')
                is('error()', (port.error() as Error).message, 'not a port: 2.5')
                is('done() — it finished, but not cleanly', port.done(), false)
            },
        },

        {
            title: 'state.shared — one cell per KEY, not per call site',
            note: 'Two components asking for the same key get the same cell, so a write in one is a read in the other with nothing wired between them. Per-caller, for the reason a memo’s cache is: on a server, "shared across every component instance" must not quietly mean "shared across every visitor".',
            async run({ is }) {
                const one = state.shared('demo:theme', 'dark')
                const two = state.shared('demo:theme', 'light') // a different initial, not consulted
                is('the same cell', one === two, true)
                is('so both read the same thing', two(), one())

                one.set('solarized')
                is('a write in one is a read in the other', two(), 'solarized')
                is('a different key is a different cell', state.shared('demo:locale', 'en') === one, false)

                isolate(() => {
                    const mine = state.shared('demo:theme', 'zenburn')
                    is('another caller gets its own', mine === one, false)
                    is('…so ITS initial is the one that lands', mine(), 'zenburn')
                })
                is('and the first caller is untouched', one(), 'solarized')
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
