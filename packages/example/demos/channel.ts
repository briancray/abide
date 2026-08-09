// `channel` — the third primitive: subscribe. `state` OWNS a value, `memo` LOADS one, `channel`
// RECEIVES them. It is the push face of the same atom, which is why it carries the same read
// vocabulary: call it, or iterate it.

import { channel, html, memo } from 'abide'
import { renderToString } from 'abide/server'
import { container, duration, nsPerOp, quiesce, reader, sleep, suite, tick, until } from 'abide/tests'
import { mount } from 'abide/ui'
import { button, el, field, row, stage } from './dom.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

export default suite({
    ...META.channel,
    cases: [
        {
            title: 'a channel in a slot is READ, on both substrates',
            note: 'SPEC calls `state`, `memo` and `channel` alike a `source`, and a source in a slot means its value. One brand answers that for both substrates, which is what makes this the same claim twice rather than two renderers agreeing by luck.',
            async run({ is }) {
                const room = channel<string>()
                room.publish('hello')

                is('server', await renderToString(html`<p>${() => room}</p>`), '<p>hello</p>')

                const host = container()
                mount(host, () => html`<p>${() => room}</p>`)
                is('client', host.querySelector('p')?.textContent, 'hello')

                room.publish('second')
                await tick()
                is('…and it is reactive', host.querySelector('p')?.textContent, 'second')
                host.remove()
            },
        },

        {
            title: 'publish → the call is the read, and it is reactive',
            note: 'The call IS the read, as it is for every other source — there is no second name for it. Publishing the SAME text still wakes: a channel is a stream of MESSAGES, and receiving one twice is two events. That is the one place its semantics part company with a cell.',
            async run({ is }) {
                const feed = channel<string>()
                const view = reader(() => feed())
                is('nothing has arrived', feed(), undefined)
                is('settled()', feed.settled(), false)

                feed.publish('hello')
                await tick()
                is('feed()', feed(), 'hello')
                is('feed.peek()', feed.peek(), 'hello')
                is('settled()', feed.settled(), true)
                is('the reader woke', view.seen.length, 2)

                feed.publish('hello') // the SAME text
                await tick()
                is('a repeated message is still a message', view.seen.length, 3)
                view.dispose()
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    // A channel's reactive read goes through a `state` cell, so a publish is one wake
                    // and not two — and that cell is what the extra nanoseconds buy.
                    const feed = channel<number>()
                    let seen = 0
                    feed.subscribe(() => seen++)
                    const plain = vanilla.feed<number>()
                    plain.subscribe(() => seen++)
                    return [
                        { label: 'abide — feed.publish(i)', run: (i: number) => feed.publish(i) },
                        { label: 'vanilla — emitter', run: (i: number) => plain.publish(i) },
                    ]
                })(),
            },
            interact({ host, log }) {
                const feed = channel<string>()
                const view = reader(() => feed())
                let n = 0
                const report = (): void => {
                    log.live('feed()', feed.peek())
                    log.live('settled()', feed.settled())
                    queueMicrotask(() =>
                        log.live('reader wakes', `${view.seen.length} — ${view.seen.join(' → ')}`),
                    )
                }
                host.append(
                    row(
                        button('feed.publish(…)', () => {
                            feed.publish(`message ${++n}`)
                            report()
                        }),
                        button('feed.publish(same text)', () => {
                            feed.publish(`message ${n}`)
                            report()
                        }),
                    ),
                )
                report()
            },
        },

        {
            title: 'chunks — a capped transcript, also reactive',
            note: '`tail` defaults to 0: latest only. Give it a number and the session transcript is retained up to that many messages.',
            async run({ is }) {
                const latest = channel<number>()
                latest.publish(1)
                latest.publish(2)
                is('tail 0 retains no transcript', latest.chunks(), [])
                is('…but still holds the latest', latest.peek(), 2)

                const tailed = channel<number>({ tail: 3 })
                for (const n of [1, 2, 3, 4, 5]) tailed.publish(n)
                is('tail 3 keeps the last three', tailed.chunks(), [3, 4, 5])

                // `ch.tail()` is that transcript AND what comes next, as one sequence that never
                // ends — the replay and the subscribe happen in the same synchronous run, so a
                // message published between them is missed by neither. Iterating a channel instead
                // starts from whatever is published after.
                const following = tailed.tail()
                const seen: number[] = []
                for (let i = 0; i < 3; i++) seen.push((await following.next()).value as number)
                is('tail() replays the ring first', seen, [3, 4, 5])
                tailed.publish(6)
                is('…then follows what arrives next', (await following.next()).value, 6)
                await following.return(undefined)
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    // Two tails an order of magnitude apart, because the thing worth measuring is
                    // whether the retention SIZE reaches the publish at all. It must not: the buffer
                    // is pushed into and compacted once per `tail` messages, so both abide arms sit
                    // on top of the hand-written one and neither moves when the cap grows.
                    const small = channel<number>({ tail: 8 })
                    const large = channel<number>({ tail: 500 })
                    const plain = vanilla.feed<number>(8)
                    return [
                        { label: 'abide — channel({ tail: 8 })', run: (i: number) => small.publish(i) },
                        { label: 'abide — channel({ tail: 500 })', run: (i: number) => large.publish(i) },
                        { label: 'vanilla — push + shift', run: (i: number) => plain.publish(i) },
                    ]
                })(),
            },
            interact({ host, log }) {
                const latest = channel<number>()
                const tailed = channel<number>({ tail: 3 })
                let n = 0
                const report = (): void => {
                    log.live('latest.chunks() — tail 0', latest.chunks())
                    log.live('tailed.chunks() — tail 3', tailed.chunks())
                }
                host.append(
                    row(
                        button('publish to both', () => {
                            n++
                            latest.publish(n)
                            tailed.publish(n)
                            report()
                        }),
                    ),
                )
                report()
            },
        },

        {
            title: 'the retention SIZE never reaches the publish',
            note: 'A `tail` is a cap on what is REMEMBERED, and it has no business being a cost on every message. Rebuilding the transcript per publish made it one — 94 ns at `tail: 8` against 1314 ns at `tail: 500` — so raising a scrollback silently taxed a hot path nobody was looking at, and the same shape uncapped made a stream O(n²). The buffer is pushed into and compacted once per `tail` messages instead, which is what a ring was always supposed to mean. Both arms run again under `maxAge`, because that lane used to evict with a memmove per publish and this ratio was the only thing that could have said so.',
            async run({ is, log }) {
                // A ratio between two abide arms in the same substrate: an absolute number here
                // would describe the machine, and a correctness test cannot see this at all — the
                // wrong implementation retains exactly the right messages, just slowly.
                //
                // `nsPerOp` sizes the batch rather than fixing it, because a publish is tens of
                // nanoseconds and a fixed 20k of them reads as 0 ms under Safari's 1 ms clamp — two
                // arms that both read 0 make the ratio NaN, which fails for a reason that is about
                // the clock rather than the ring.
                const small = channel<number>({ tail: 8 })
                const large = channel<number>({ tail: 512 })
                const [cheap, dear] = (await nsPerOp([
                    { label: 'tail: 8', run: (i: number) => small.publish(i) },
                    { label: 'tail: 512', run: (i: number) => large.publish(i) },
                ])) as [number, number]

                const ratio = dear / cheap
                log('per publish', `tail 8 — ${duration(cheap)}, tail 512 — ${duration(dear)}`)
                // 64x the retention. The bound is loose because a clock inside a browser card is;
                // what it has to separate is ~1x from the ~14x a per-publish rebuild costs.
                is(`a 64x larger cap costs no more per publish (${ratio.toFixed(1)}x)`, ratio < 4, true)

                // The SAME ratio with expiry on. Eviction under `maxAge` used to run with no slack
                // at all — every publish past the cap spliced the front of two arrays — so the two
                // arms above were measuring the one lane that was already right. `maxAge` is far
                // enough out that nothing expires during the batch: what is being timed is the
                // eviction path, not the timer.
                const smallAged = channel<number>({ tail: 8, maxAge: 60_000 })
                const largeAged = channel<number>({ tail: 512, maxAge: 60_000 })
                // `quiesce` rather than the default frame yield, which is what the second argument is
                // for: these two arms are the ones with a timer armed, so what they want between
                // passes is a machine that has settled, not a paint that has landed.
                const [cheapAged, dearAged] = (await nsPerOp(
                    [
                        { label: 'tail: 8 + maxAge', run: (i: number) => smallAged.publish(i) },
                        { label: 'tail: 512 + maxAge', run: (i: number) => largeAged.publish(i) },
                    ],
                    quiesce,
                )) as [number, number]

                const agedRatio = dearAged / cheapAged
                log('per publish, maxAge', `tail 8 — ${duration(cheapAged)}, tail 512 — ${duration(dearAged)}`)
                is(
                    `and no more per publish under maxAge (${agedRatio.toFixed(1)}x)`,
                    agedRatio < 4,
                    true,
                )
            },
        },

        {
            title: 'a reader wakes for what it READS, not for every publish',
            note: 'The three questions a channel answers move at three different rates: a message arrives constantly, the transcript moves only when there is retention to move, and `settled()` flips once in a channel\'s life. One envelope rebuilt per publish made all three move together — the identity check downstream never held, so every reader woke for every message and read back exactly what it had before. Three cells is what makes the cutoffs real, and only counting the wake-ups can see it.',
            async run({ is }) {
                // A correctness test cannot reach this: the wrong implementation hands every reader
                // the right value, just after waking it for a change it cannot see.
                const room = channel<number>()

                const settled = reader(() => room.settled())
                const chunks = reader(() => room.chunks().length)
                const messages = reader(() => room())

                // A tick per publish, because the queue coalesces: five writes in one synchronous
                // region wake an effect once, which would hide the difference this case is about.
                for (let i = 0; i < 5; i++) {
                    room.publish(i)
                    await tick()
                }

                // `seen` carries one entry per RUN, so its length is the wake count. Five publishes:
                // `settled()` went false → true on the first and cannot move again, and with no
                // `tail` the transcript never moved at all.
                is('settled() woke once, not per publish', settled.seen.length, 2)
                is('chunks() on a tail-less channel never woke', chunks.seen.length, 1)
                // The one that genuinely moves five times — a message arriving IS the event, so this
                // counts publishes and not distinct values.
                is('the message reader woke for every publish', messages.seen.length, 6)

                settled.dispose()
                chunks.dispose()
                messages.dispose()
            },
        },

        {
            title: 'a channel answers the whole source surface',
            note: 'It never loads, so the load probes are always the cold answer. They are here so a reader can treat any source alike rather than having to know which primitive it was handed.',
            async run({ is }) {
                const feed = channel<string>({ tail: 3 })
                feed.publish('hello')
                feed.publish('again')
                is('feed()', feed(), 'again')
                is('peek()', feed.peek(), 'again')
                is('settled()', feed.settled(), true)
                is('pending()', feed.pending(), false)
                is('refreshing()', feed.refreshing(), false)
                is('error()', feed.error(), undefined)

                // The verb means the same here: this is no longer good.
                feed.invalidate()
                is('after invalidate — feed()', feed(), undefined)
                is('after invalidate — chunks()', feed.chunks(), [])
                is('after invalidate — settled()', feed.settled(), false)
            },
        },

        {
            title: 'subscribe — the imperative face, with an unsubscribe',
            note: 'For the callers that are not reactive readers. The returned function stops delivery, and the reactive read carries on regardless.',
            async run({ is }) {
                const feed = channel<number>()
                const got: number[] = []
                const off = feed.subscribe((n) => got.push(n))
                feed.publish(1)
                off()
                feed.publish(2)
                is('delivery stopped at the unsubscribe', got, [1])
                is('…and the reactive read still moved', feed(), 2)
            },
            interact({ host, log }) {
                const feed = channel<string>()
                let delivered = 0
                const off = feed.subscribe(() => log.live('delivered to the listener', ++delivered))
                let n = 0
                host.append(
                    row(
                        button('publish', () => feed.publish(`m${++n}`)),
                        button('unsubscribe', () => {
                            off()
                            log('off()', 'delivery stops; publish still updates the reactive read')
                        }),
                    ),
                )
                log.live('delivered to the listener', delivered)
            },
        },

        {
            title: 'for await — a channel is an async iterable',
            note: 'This is the shape a socket transport plugs into: `socket = channel + transport` is the law, and the left-hand side is what exists here. It is an INFINITE stream, so the consumer is what ends the loop.',
            async run({ is }) {
                const feed = channel<number>()
                const got: number[] = []
                const done = (async () => {
                    for await (const n of feed) {
                        got.push(n)
                        if (got.length === 2) break
                    }
                })()
                await tick()
                feed.publish(1)
                feed.publish(2)
                await done
                is('the loop received', got, [1, 2])
            },
            interact({ host, log }) {
                const ticks = channel<number>()
                let running = true
                let n = 0
                host.append(
                    row(
                        button('publish one now', () => ticks.publish(++n)),
                        button('stop', () => {
                            running = false
                            // `for await` is parked in `await` until the next message, so a flag
                            // alone can never end it — the loop has to be woken to see the flag.
                            ticks.publish(++n)
                        }),
                    ),
                )
                void (async () => {
                    while (running && n < 20) {
                        await sleep(1000)
                        if (running) ticks.publish(++n)
                    }
                })()
                void (async () => {
                    for await (const value of ticks) {
                        log.live('for await received', value)
                        if (!running) break
                    }
                    log('loop ended', 'the generator’s `finally` unsubscribes')
                })()
            },
        },

        {
            title: 'rooms — the CALL selects one, the way a keyed memo selects a slot',
            note: '`channel<T, Args>()` splits one stream into independent rooms, and the call is what tells the two forms apart: with no argument it is the read every source spells the same way, with one it hands back an ordinary channel. Rooms are process-wide, because a channel is not a cache — a publisher has to reach subscribers that arrived some other way.',
            async run({ is }) {
                const chat = channel<string, { room: string }>({ tail: 3 })
                chat({ room: 'general' }).publish('hello')
                chat({ room: 'random' }).publish('cat picture')

                is('each room has its own latest', chat({ room: 'general' })(), 'hello')
                is('…and its own transcript', chat({ room: 'random' }).chunks(), ['cat picture'])
                // Two calls, one room — selecting is a lookup, not a construction.
                const first = chat({ room: 'general' })
                const again = chat({ room: 'general' })
                is('selecting the same room twice is the same channel', first === again, true)
                // A room IS a channel, so nothing below it is a second vocabulary.
                is('and it answers the whole source surface', chat({ room: 'general' }).settled(), true)

                chat.invalidate({ room: 'random' })
                is('a pattern reaches only what matches', chat({ room: 'random' }).peek(), undefined)
                is('general is untouched', chat({ room: 'general' }).peek(), 'hello')

                chat.invalidate()
                is('and no pattern means every room', chat({ room: 'general' }).peek(), undefined)
            },
            interact({ host, log }) {
                const chat = channel<string, { room: string }>({ tail: 5 })
                const rooms = ['general', 'random']
                const out = stage(host)
                const panes = rooms.map((room) => {
                    const pane = el('p', 'font-mono text-xs text-emerald-300 min-h-5')
                    out.append(pane)
                    reader(() => {
                        pane.textContent = `#${room}: ${chat({ room }).chunks().join(' · ')}`
                    })
                    return pane
                })
                void panes
                let n = 0
                host.append(
                    row(
                        ...rooms.map((room) =>
                            button(`publish to #${room}`, () => {
                                chat({ room }).publish(`msg ${++n}`)
                                log.live('latest in #general', chat({ room: 'general' }).peek())
                                log.live('latest in #random', chat({ room: 'random' }).peek())
                            }),
                        ),
                        button('chat.invalidate()', () => chat.invalidate()),
                    ),
                )
            },
        },

        {
            title: 'maxAge — a message counts as current only while it is young',
            note: 'It goes stale by the passage of time, so something has to WAKE for it: a reader that only found out on its next read would go on showing a message the channel had already stopped claiming.',
            async run({ is, log }) {
                const presence = channel<string>({ tail: 4, maxAge: 30 })
                const view = reader(() => presence())
                presence.publish('ada is typing')
                await tick()
                is('while it is current', presence(), 'ada is typing')
                is('settled()', presence.settled(), true)

                await until(() => presence.peek() === undefined)
                is('past maxAge it is no longer the latest', presence(), undefined)
                is('and it has left the transcript', presence.chunks(), [])
                is('settled() — nothing current has arrived', presence.settled(), false)
                is('the reader woke for the expiry', view.seen, ['undefined', 'ada is typing', 'undefined'])
                log('', 'expiry is a publish of nothing, so it costs one wake like any other')
                view.dispose()
            },
            interact({ host, log }) {
                const presence = channel<string>({ tail: 4, maxAge: 3_000 })
                const out = stage(host)
                const shown = el('p', 'text-lg text-slate-100 min-h-7')
                out.append(shown)
                reader(() => {
                    shown.textContent = presence() ?? '(nothing current)'
                    log.live('chunks', presence.chunks())
                    log.live('settled()', presence.settled())
                })
                host.append(
                    row(
                        button('someone is typing (3 s of life)', () =>
                            presence.publish(`typing at ${new Date().toLocaleTimeString()}`),
                        ),
                    ),
                )
            },
        },

        {
            title: 'a memo derived off a channel, with the ordinary call',
            note: 'The pub/sub side and the graph are not two systems: a derivation reads a channel the same way it reads a cell, and wakes on publish with no bridging code.',
            async run({ is }) {
                const temperature = channel<number>({ tail: 8 })
                let derivations = 0
                const average = memo(() => {
                    derivations++
                    const values = temperature.chunks()
                    if (values.length === 0) return '—'
                    let total = 0
                    for (const value of values) total += value
                    return (total / values.length).toFixed(1)
                })
                const view = reader(() => average())
                is('cold', average(), '—')

                is('the body ran once for the cold read', derivations, 1)

                temperature.publish(20)
                temperature.publish(22)
                await tick()
                is('average()', average(), '21.0')
                is('the reader woke on publish', view.seen, ['—', '21.0'])
                // Two publishes in one turn, one recompute: the channel's reads go through a `state`
                // cell, so the derivation is batched exactly as it would be off any other source.
                is('and the body re-ran once, not twice', derivations, 2)
                view.dispose()
            },
            interact({ host }) {
                const temperature = channel<number>({ tail: 8 })
                const average = memo(() => {
                    const values = temperature.chunks()
                    if (values.length === 0) return '—'
                    let total = 0
                    for (const value of values) total += value
                    return (total / values.length).toFixed(1)
                })

                const out = stage(host)
                const current = el('p', 'text-3xl font-semibold text-slate-100 tabular-nums', '—')
                const mean = el('p', 'text-sm text-slate-400', 'mean of the last 8: —')
                const spark = el('p', 'font-mono text-xs text-emerald-300 mt-1')
                out.append(current, mean, spark)

                reader(() => {
                    const value = temperature()
                    current.textContent = value === undefined ? '—' : `${value.toFixed(1)}°`
                    mean.textContent = `mean of the last 8: ${average()}`
                    spark.textContent = temperature
                        .chunks()
                        .map((v) => '▁▂▃▄▅▆▇█'[Math.max(0, Math.min(7, Math.round((v - 15) / 2)))])
                        .join('')
                })

                host.append(
                    row(
                        button('publish a reading', () => temperature.publish(15 + Math.random() * 15)),
                        button('invalidate the channel', () => temperature.invalidate()),
                    ),
                    field('publish exactly', (value) => {
                        const parsed = Number(value)
                        if (Number.isFinite(parsed)) temperature.publish(parsed)
                    }),
                )
            },
        },
    ],
})
