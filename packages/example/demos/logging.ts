// The console, and the two rules that decide whether anything reaches it.
//
// The DEFAULT channel is the app talking to whoever started it, and it always writes — an app whose
// own output needs an env var to appear is an app nobody reads. A NAMED channel is volume you opt
// into, so it is off until `DEBUG` names it. The exception runs in both directions: `warning` and
// `error` always write, on every channel, because the gate is there to control volume rather than to
// hide breakage.
//
// Every claim below is about a RELATIONSHIP rather than an absolute string, because the two lanes
// genuinely differ: a server reads `DEBUG` and may be piped into a collector, a browser reads
// `localStorage.debug` and has no pipe to be. Asserting "the named channel is the default one plus a
// suffix" is true in both, and it is also the claim — the absolute name is the app's business.

import { log } from 'abide'
import { GET, type LogRecord, error, handle, json, register, socket } from 'abide/server'
import { loopback, sleep, suite, until } from 'abide/tests'
import { button, field, row, stage } from './dom.ts'
import { DECLARABLE, withEnv, writeEnv } from './env.ts'
import { META } from './SUITES.ts'

export default suite({
    ...META.logging,
    cases: [
        {
            title: 'the app’s own channel is not gated',
            note: 'Nothing is set, and it writes anyway. The default channel is named after the app — `ABIDE_APP_NAME`, else package.json’s `name`, else `abide` — and every level on it reaches the console.',
            async run({ is }) {
                await setDebug(undefined)
                const written = capture(() => {
                    log('the app started')
                    log.info('an info line')
                    log.debug('a debug line')
                })

                is('three lines, with nothing turned on', written.length, 3)
                is('the levels a console was asked for', levels(written), ['log', 'info', 'debug'])
                is(
                    'each carries the message',
                    written.every(
                        (line) => line.text.includes('an info line') || !line.text.includes('info'),
                    ),
                    true,
                )
                is('and the app’s channel', written[0]?.text.includes(defaultChannel()), true)
            },
        },

        {
            title: 'a named channel is silent until DEBUG names it',
            note: "This is what a channel is FOR. `log.channel('cards')` on an app called `docs` writes under `docs:cards`, which is the name `DEBUG=docs:cards` turns on.",
            async run({ is }) {
                const cards = log.channel('cards')

                await setDebug(undefined)
                is('nothing set', capture(() => cards('a card rendered')).length, 0)

                await setDebug(`${defaultChannel()}:cards`)
                is('named exactly', capture(() => cards('a card rendered')).length, 1)

                await setDebug(`${defaultChannel()}:*`)
                is('named by prefix', capture(() => cards('a card rendered')).length, 1)

                await setDebug('*')
                is('everything', capture(() => cards('a card rendered')).length, 1)

                await setDebug(undefined)
                is('and off again', capture(() => cards('a card rendered')).length, 0)
            },
        },

        {
            title: 'the channel is the app’s name plus the sub-name',
            note: 'The relationship, rather than a string this file could get wrong: whatever the app is called, a channel is that plus `:name`, and `.channel()` on a channel appends again.',
            async run({ is }) {
                await setDebug('*')
                const base = defaultChannel()
                const written = capture(() => {
                    log('default')
                    log.channel('cards')('one deep')
                    log.channel('cards').channel('rows')('two deep')
                })

                is('the default channel', channelOf(written[0]), base)
                is('one deep', channelOf(written[1]), `${base}:cards`)
                is('two deep', channelOf(written[2]), `${base}:cards:rows`)
                await setDebug(undefined)
            },
        },

        {
            title: 'warning and error are never gated',
            note: 'A failure a missing env var can swallow is a failure nobody sees. So the gate reaches `log`, `info` and `trace` on a named channel, and never reaches the two that report something went wrong.',
            async run({ is }) {
                await setDebug(undefined)
                const cards = log.channel('cards')
                const written = capture(() => {
                    cards('swallowed')
                    cards.info('swallowed')
                    cards.debug('swallowed')
                    cards.warning('never swallowed')
                    cards.error('never swallowed')
                })

                is('two of five, with nothing turned on', levels(written), ['warn', 'error'])
                is('on the named channel all the same', channelOf(written[0]), `${defaultChannel()}:cards`)
            },
        },

        {
            title: 'the DEBUG grammar — lists, globs and exclusions',
            note: 'debug-npm’s spelling, because it is the one every operator already knows: comma- or space-separated names, `*` anywhere in one, and a leading `-` to take a name back out of a wider match.',
            async run({ is }) {
                const base = defaultChannel()
                const cards = log.channel('cards')
                const database = log.channel('db')
                const queue = log.channel('queue')
                const write = (): string[] =>
                    capture(() => {
                        cards('c')
                        database('d')
                        queue('q')
                    }).map((line) => channelOf(line))

                await setDebug(`${base}:cards,${base}:db`)
                is('a list names two of three', write(), [`${base}:cards`, `${base}:db`])

                await setDebug(`${base}:*`)
                is('a glob names all three', write(), [`${base}:cards`, `${base}:db`, `${base}:queue`])

                await setDebug(`*,-${base}:cards`)
                is('an exclusion takes one back out', write(), [`${base}:db`, `${base}:queue`])

                await setDebug(`  ${base}:cards   ${base}:queue  `)
                is('whitespace separates too', write(), [`${base}:cards`, `${base}:queue`])

                await setDebug('')
                is('an empty spelling enables nothing', write(), [])

                await setDebug(undefined)
            },
        },

        {
            title: 'the app names its own channels; abide’s root does not move',
            note:
                '`ABIDE_APP_NAME` renames the default channel and everything under it, and the `DEBUG` patterns follow it. ' +
                'The framework’s own root stays `abide` however the embedding app is named, so `DEBUG=abide:*` turns on abide ' +
                'and an app that wants its own noise asks for its own name.',
            async run({ is }) {
                if (!DECLARABLE) {
                    // A browser has no environment and no package.json to read, so the fallback is the
                    // only answer there — and it is `abide`. The same mechanism, seen from the lane
                    // that has no choice in it.
                    is('the fallback names the channel', defaultChannel(), 'abide')
                    await setDebug('abide:*')
                    is(
                        'so the framework’s pattern is also the app’s here',
                        capture(() => log.channel('cards')('mine')).length,
                        1,
                    )
                    await setDebug(undefined)
                    return
                }

                await withEnv({ ABIDE_APP_NAME: 'docs' }, async () => {
                    const cards = log.channel('cards')
                    is('the app names the default channel', defaultChannel(), 'docs')
                    is(
                        'and everything under it',
                        channelOf(capture(() => cards.warning('w'))[0]),
                        'docs:cards',
                    )

                    await setDebug('abide:*')
                    is('the framework’s root does not reach the app', capture(() => cards('mine')).length, 0)

                    await setDebug('docs:*')
                    is('the app’s own name does', capture(() => cards('mine')).length, 1)
                })
                await setDebug(undefined)
            },
        },

        {
            title: 'one ask, one logger',
            note: 'The same name hands back the same object, so the `+Nms` delta belongs to the channel rather than to whichever call site asked for it first.',
            async run({ is }) {
                const asked = log.channel('cards')
                const askedAgain = log.channel('cards')
                const another = log.channel('db')

                is('two asks for one name', asked === askedAgain, true)
                is('a different name is a different logger', asked === another, false)
                is(
                    'and a sub-channel of one is stable too',
                    asked.channel('rows') === askedAgain.channel('rows'),
                    true,
                )
            },
        },

        {
            title: 'what a line looks like is what is reading it',
            note: 'A browser console is neither a terminal nor a pipe, so it always gets the readable form. A server’s follows the terminal — pretty at a TTY, `tsv` through a pipe — and `ABIDE_LOG_FORMAT` declares it outright. `NO_COLOR` forces `tsv`; `FORCE_COLOR` forces the readable form off a TTY. A message never becomes two records: in the machine formats a tab or a newline inside one is escaped.',
            async run({ is }) {
                await setDebug(undefined)
                if (!DECLARABLE) {
                    // The browser lane: there is no environment to declare a format in, and ANSI would
                    // arrive as literal junk. So this is the whole claim there.
                    const written = capture(() => log('a readable line'))
                    const text = written[0]?.text ?? ''
                    is('the readable form', text.startsWith(`${defaultChannel()} a readable line`), true)
                    is('with the delta since the last line on this channel', /\+\d+ms$/.test(text), true)
                    is('and no ANSI in it', text.includes(ESC), false)
                    return
                }

                const tsv = await withEnv({ ABIDE_LOG_FORMAT: 'tsv' }, () =>
                    capture(() => log('a piped line')),
                )
                const fields = (tsv[0]?.text ?? '').split('\t')
                // Five columns ALWAYS, empty where there is no id: a row whose column count depends
                // on whether a request was in flight is one no `cut -f` can read.
                is('five fields', fields.length, 5)
                is('level', fields[1], 'log')
                is('channel', fields[2], defaultChannel())
                is('message', fields[3], 'a piped line')
                is('and the trace column, empty outside a request', fields[4], '')

                const json = await withEnv({ ABIDE_LOG_FORMAT: 'json' }, () =>
                    capture(() => log.error('a collected line')),
                )
                const record = JSON.parse(json[0]?.text ?? '{}') as Record<string, string>
                is('the same five, named', Object.keys(record), [
                    'time',
                    'level',
                    'channel',
                    'message',
                    'trace',
                ])
                is('level', record.level, 'error')
                is('channel', record.channel, defaultChannel())

                const split = await withEnv({ ABIDE_LOG_FORMAT: 'tsv' }, () =>
                    capture(() => log('one\ttwo\nthree')),
                )
                is('one message is one record', split.length, 1)
                is('the separators are escaped, not emitted', (split[0]?.text ?? '').split('\t').length, 5)
                is('and the message survives', (split[0]?.text ?? '').split('\t')[3], 'one\\ttwo\\nthree')
            },
        },

        {
            title: 'the remote feed is a channel with a tail — closed until ABIDE_LOGS opens it',
            note: 'The feed is `channel({ tail })` and nothing else: the ring, the cap and the live subscribe are the primitive’s, so there is no second retention policy to keep in step with. `GET /__abide/logs` replays what the ring holds and then follows, and the snapshot and the subscribe happen in the SAME synchronous run — a line published between them would otherwise be missed by the one and dropped by the other. What it carries is what was WRITTEN, gate included: a tail showing lines the console did not would be a second answer to the same question.',
            async run({ is }) {
                await setDebug(undefined)
                const wire = loopback()

                // Closed is the default, and closed answers 404 rather than 403 — an app that never
                // opted in has nothing to refuse access to.
                is('closed by default', (await wire.fetch(LOGS, { method: 'GET' })).status, 404)

                if (!DECLARABLE) {
                    // A browser has no environment to opt in from, so the feed is closed there and
                    // that IS the claim. The rest of it is asserted in the lane that can open one.
                    return
                }

                // Asked before the feed opens: `defaultChannel()` writes a line, and a line written
                // while it is open is a record this case would then have to account for.
                const base = defaultChannel()

                await withEnv({ ABIDE_LOG_BUFFER: '2', ABIDE_LOGS: '1' }, async () => {
                    capture(() => {
                        log('one')
                        log('two')
                        log('three')
                    })

                    const feed = await wire.fetch(LOGS, { method: 'GET' })
                    is('opened', feed.status, 200)
                    is('one JSON value per line', feed.headers.get('content-type'), 'application/jsonl')

                    const reader = lines(feed)
                    const replayed = [await reader.next(), await reader.next()]
                    is('the ring is capped at ABIDE_LOG_BUFFER', replayed.map(messageOf), ['two', 'three'])
                    is('and a record is the five fields', Object.keys(replayed[0] as LogRecord), [
                        'time',
                        'level',
                        'channel',
                        'message',
                        'trace',
                    ])
                    // Nothing served these lines, so there is no operation to belong to — and a
                    // feed that invented one would be asserting a relationship it cannot see.
                    is('with no trace outside a request', replayed[0]?.trace, null)
                    is('on the app’s own channel', replayed[0]?.channel, base)

                    // Published while the tail is open: the same channel, now reaching a
                    // subscriber rather than the ring.
                    const cards = log.channel('never-turned-on')
                    capture(() => {
                        cards('a gated line the console never saw')
                        cards.warning('never gated, on any channel')
                    })

                    // The NEXT record is the warning, not the gated line before it — which is the
                    // only way to assert a skip on a stream: the one that was suppressed has no
                    // record to look for.
                    const followed = await reader.next()
                    is(
                        'the gated line never reached the feed',
                        followed?.message,
                        'never gated, on any channel',
                    )
                    is('…and the one that did carries its level', followed?.level, 'warning')
                    is('on the named channel', followed?.channel, `${base}:never-turned-on`)

                    await reader.stop()
                })

                // The ring is built once, on the first record, so what it holds outlives the opt-in.
                // Closing the feed is what makes it unreachable — which is the whole contract.
                is('closed again', (await wire.fetch(LOGS, { method: 'GET' })).status, 404)
            },
        },

        {
            title: 'abide:request — one line per request, and the trace it belongs to',
            note:
                'The framework’s own channels are the reason the gate exists. `handle` is the one funnel every request ' +
                'goes through, so this reports an app’s own routes and everything under `/__abide/` alike, and it reports ' +
                'them from INSIDE the request scope — which is what puts the trace id on the line. A socket upgrade has no ' +
                'response at all (Bun answers the handshake itself), so it says `upgraded` rather than inventing a 101.',
            async run({ is }) {
                await setDebug('abide:request')
                const serving = handle((asked) =>
                    new URL(asked.url).pathname === '/user' ? json({ id: 1 }) : undefined,
                )

                const written = await capture(async () => {
                    await serving(new Request(`${ORIGIN}/user`), NO_SERVER)
                    await serving(new Request(`${ORIGIN}/nowhere`), NO_SERVER)
                })

                is('one line per request', written.length, 2)
                is('on abide’s own channel, not the app’s', channelOf(written[0]), 'abide:request')
                is('the method, the path and the status', textOf(written[0]).includes('GET /user 200'), true)
                is(
                    'a route that answered nothing is the 404 it became',
                    textOf(written[1]).includes('GET /nowhere 404'),
                    true,
                )
                is('and how long it took', /\d+\.\d+ms/.test(textOf(written[0])), true)

                await setDebug(undefined)
                const off = await capture(async () => {
                    await serving(new Request(`${ORIGIN}/user`), NO_SERVER)
                })
                is('and nothing at all with the channel off', off.length, 0)
            },
        },

        {
            title: 'abide:rpc — one line per call, over the wire and in-process alike',
            note:
                '`respond` is what both doors go through, so an `fn.raw` that never touched a socket is reported the same ' +
                'way a request-borne call is. The ADDRESS rather than a path, because an in-process call has no path. The ' +
                'outcome is the third field: `ok`, the error’s own name and status, or `streaming` — a streaming call is ' +
                'reported when it becomes a stream rather than when the last chunk lands, because a duration covering work ' +
                'that has not happened yet is a number that means nothing.',
            async run({ is }) {
                const notFound = error.typed('NoUser', 404)
                const getUser = GET(({ id }: { id: number }) => ({ id, name: `user ${id}` }))
                const missing = GET(({ id }: { id: number }) => notFound(`no user ${id}`))
                async function* down({ from }: { from: number }): AsyncGenerator<number> {
                    for (let n = from; n > 0; n--) yield n
                }
                const countdown = GET(down)
                register(
                    'rpc',
                    [
                        ['demo/log/getUser', 'getUser'],
                        ['demo/log/missing', 'missing'],
                        ['demo/log/countdown', 'countdown'],
                    ],
                    { getUser, missing, countdown },
                )

                await setDebug('abide:rpc')
                const wire = loopback()
                const written = await capture(async () => {
                    await wire.fetch('/__abide/rpc/demo/log/getUser?id=7', { method: 'GET' })
                    await wire.fetch('/__abide/rpc/demo/log/missing?id=9', { method: 'GET' })
                    await wire.fetch('/__abide/rpc/demo/log/countdown?from=3', { method: 'GET' })
                    await getUser.raw({ id: 7 })
                })

                is('four calls, four lines', written.length, 4)
                is('on abide’s own channel', channelOf(written[0]), 'abide:rpc')
                is('the address and the outcome', textOf(written[0]).includes('demo/log/getUser ok'), true)
                is(
                    'a failure carries the name and the status it answered with',
                    textOf(written[1]).includes('demo/log/missing NoUser 404'),
                    true,
                )
                is(
                    'a stream is reported as one',
                    textOf(written[2]).includes('demo/log/countdown streaming'),
                    true,
                )
                is(
                    'and the in-process call is the same line',
                    textOf(written[3]).includes('demo/log/getUser ok'),
                    true,
                )

                await setDebug(undefined)
            },
        },

        {
            title: 'abide:socket — the accepted publish, not only the dropped one',
            note:
                'What was missing was the other half of a pair. An operator reading this channel to find out why nothing ' +
                'arrives cannot tell "every frame was refused" from "no frame was sent" when only the refusals are said. ' +
                'The line goes out BEFORE the handler runs, so a publish whose handler throws is still accounted for — what ' +
                'it reports is that the frame got past every gate, which is the question this channel answers.',
            async run({ is }) {
                const open = socket<string>({
                    clientPublish: (message, _room, into) => void into.publish(message),
                })
                const shut = socket<string>({})
                register(
                    'socket',
                    [
                        ['demo/log/open', 'open'],
                        ['demo/log/shut', 'shut'],
                    ],
                    { open, shut },
                )

                await setDebug('abide:socket')
                const wire = loopback()
                const allowed = wire.open(`ws://abide.test/__abide/socket/demo/log/open`)
                const refused = wire.open(`ws://abide.test/__abide/socket/demo/log/shut`)
                await until(() => wire.connected >= 2)

                const written = await capture(async () => {
                    allowed.send(JSON.stringify('hello'))
                    refused.send(JSON.stringify('let me in'))
                    await sleep(5)
                })

                is('the accepted one is said', textOf(written[0]).includes('demo/log/open accepted'), true)
                is('on abide’s own channel', channelOf(written[0]), 'abide:socket')
                // A socket that declared no `clientPublish` returns before the drop is reached: the
                // frame was never refused, it was never a publish at all. That is the one case the
                // pair still does not cover, and saying so here is cheaper than a line per frame on
                // every broadcast socket in the process.
                is('a socket that allows no publish at all says nothing', written.length, 1)

                await setDebug(undefined)
                wire.close()
            },
        },

        {
            title: 'what the framework’s own channels cost when nobody turned them on',
            note:
                'A correctness test cannot guard this: the request answers the same 200 whether or not the line timed it. ' +
                'So the claim is asserted as WORK — the gate is read before the CLOCK, so a closed channel never calls ' +
                '`performance.now()`, never parses the URL and never attaches the `.then` that observes the answer. Two ' +
                'reads per request when it is on, one at each end, and zero when it is off. That budget is the whole reason ' +
                '`log.channel(…).enabled()` exists: a message is built before the gate can refuse it, so a line ' +
                'interpolating a method, a path and a duration would allocate that string on every request in production.',
            async run({ is }) {
                const serving = handle(() => json({ ok: true }))
                const one = async (): Promise<void> => {
                    await serving(new Request(`${ORIGIN}/user`), NO_SERVER)
                }

                await setDebug(undefined)
                is('a closed channel never starts a stopwatch', await clockReads(one), 0)

                await setDebug('abide:request')
                is('an open one reads it twice — once at each end', await clockReads(one), 2)

                // The predicate and the write agree, which is the invariant that keeps the guard
                // honest: a call site that asks and then writes must not be able to get two answers.
                const channel = log.channel('cards')
                await setDebug(undefined)
                is('the predicate answers for the gate', channel.enabled(), false)
                is('…and the write agrees', capture(() => channel('x')).length, 0)
                await setDebug('*')
                is('open', channel.enabled(), true)
                is('…and agrees again', capture(() => channel('x')).length, 1)
                is('the app’s own channel is never gated, so it always answers true', log.enabled(), true)

                await setDebug(undefined)
                is('…including with nothing set at all', log.enabled(), true)
            },
        },

        {
            title: 'interact — turn a channel on and watch it appear',
            interact({ host, log: line }) {
                const cards = log.channel('cards')
                const base = defaultChannel()
                let spec = ''

                const show = (): void => {
                    line.live('DEBUG', spec === '' ? '(unset)' : spec)
                    const written = capture(() => {
                        cards('a card rendered')
                        cards.warning('a card could not render')
                    })
                    line.live(
                        `${base}:cards`,
                        written.map((each) => each.text).join('   ·   ') || '(nothing reached the console)',
                    )
                }

                const live = stage(host, 'the gate')
                live.append(
                    row(
                        field(
                            'DEBUG',
                            async (value) => {
                                spec = value
                                await setDebug(value === '' ? undefined : value)
                                show()
                            },
                            `${base}:cards`,
                        ),
                        button('clear', async () => {
                            spec = ''
                            await setDebug(undefined)
                            show()
                        }),
                    ),
                    row(
                        button('log on the app’s own channel', () => {
                            const written = capture(() => log('the app started'))
                            line.live(base, written[0]?.text ?? '(nothing)')
                        }),
                    ),
                )

                // `live` rather than a plain line for all three: the card tracks a live label by the
                // node it wrote, so a plain line seeded under the same label is a row the first
                // update appends beside rather than replaces.
                line.live('DEBUG', '(unset)')
                line.live(`${base}:cards`, '…')
                line.live(base, '— never gated, whatever DEBUG says')
                void setDebug(undefined).then(show)
            },
        },

        {
            title: 'what a channel nobody turned on costs',
            note:
                'The number that decides whether a channel can be left in the code, against a hand-written boolean that does ' +
                'nothing at all. A closed gate reads the spelling, compares it and returns: it never rebuilds the channel name, ' +
                'never recompiles a pattern and never reaches the console. The read is the whole cost, and in a browser it is ' +
                '`localStorage.debug` — ~225 ns against ~15 ns for a property on an ordinary object, measured here — so it is held ' +
                'for the rest of the synchronous run and dropped on the next microtask. That is what this ratio is: a loop pays ' +
                'for one read, and a change made from a console or a click is a later turn and is still seen on it.',
            bench: {
                kind: 'time',
                arms: [
                    {
                        label: 'abide — log.channel(…)(msg) with DEBUG unset, in a loop',
                        prepare: (): void => writeDebug(undefined),
                        run: (): unknown => {
                            CLOSED_CHANNEL('a message nobody asked for')
                            return 0
                        },
                    },
                    {
                        label: 'vanilla — if (enabled) console.log(msg), enabled false, in a loop',
                        prepare: (): void => {
                            vanillaEnabled = false
                        },
                        run: (): unknown => {
                            if (vanillaEnabled) console.log('a message nobody asked for')
                            return 0
                        },
                    },
                    // The pair above runs a whole batch inside one synchronous run, so the held
                    // `localStorage` read is paid once and divided by millions — which is the loop
                    // case honestly, and NOT what a click handler or a request does. These two put
                    // one turn boundary per call, so the browser pays the ~225 ns read every time and
                    // the card carries both numbers instead of only the flattering one.
                    {
                        label: 'abide — the same call, one per turn',
                        prepare: (): void => writeDebug(undefined),
                        run: async (): Promise<unknown> => {
                            CLOSED_CHANNEL('a message nobody asked for')
                            return await Promise.resolve(0)
                        },
                    },
                    {
                        label: 'vanilla — the same boolean, one per turn',
                        prepare: (): void => {
                            vanillaEnabled = false
                        },
                        run: async (): Promise<unknown> => {
                            if (vanillaEnabled) console.log('a message nobody asked for')
                            return await Promise.resolve(0)
                        },
                    },
                ],
            },
        },
    ],
})

// --- what the cases need -----------------------------------------------------

// Where the gate is written. A server reads `DEBUG` off the environment and a browser reads
// `localStorage.debug`; where both exist — a DOM emulator under `bun test` — the environment is what
// the runtime asks first, so that is what `writeEnv` sets.
function writeDebug(spec: string | undefined): void {
    if (DECLARABLE) {
        writeEnv('DEBUG', spec)
        return
    }
    if (spec === undefined) localStorage.removeItem('debug')
    else localStorage.setItem('debug', spec)
}

/**
 * Change the gate, and wait the one turn a browser needs to see it.
 *
 * `localStorage.debug` is read once per synchronous run and held — the read is ~15x a property on an
 * ordinary object, and holding it is what makes a suppressed channel in a loop cost a compare. So a
 * change is visible on the NEXT turn, which is every way anyone actually makes one: a console, a
 * click, a reload. An environment variable is an ordinary property and is live, so on a server this
 * await is one the demo pays and the runtime does not.
 */
async function setDebug(spec: string | undefined): Promise<void> {
    writeDebug(spec)
    await Promise.resolve()
}

// Built rather than written as literals: an escape character inside a regex literal is a lint error,
// and the readable form is the one shape that carries them.
const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

interface Written {
    /** The console method the level asked for. */
    level: string
    text: string
}

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

/**
 * Every line the region wrote, and which console method wrote it.
 *
 * A logger's whole observable behaviour is what reaches a console, so this is the only way to assert
 * one — and swapping the five methods is exactly what a collector does, which is why the demo can do
 * it honestly rather than reaching inside.
 */
function capture(fn: () => void): Written[]
function capture(fn: () => Promise<unknown>): Promise<Written[]>
function capture(fn: () => unknown): Written[] | Promise<Written[]> {
    const written: Written[] = []
    const held = METHODS.map((name) => console[name])
    const restore = (): void => {
        for (let i = 0; i < METHODS.length; i++)
            console[METHODS[i] as (typeof METHODS)[number]] = held[i] as never
    }
    for (const name of METHODS) {
        console[name] = (...args: unknown[]): void => {
            written.push({ level: name, text: args.map(String).join(' ') })
        }
    }
    // A request is answered over at least one await, so the swap has to outlive the call rather than
    // be put back by a `finally` that runs first. Widened here rather than copied into a second
    // helper: what a case asserts is the same lines either way, and two of these would be two places
    // to remember the restore in.
    let ran: unknown
    try {
        ran = fn()
    } catch (failure) {
        restore()
        throw failure
    }
    if (typeof (ran as Promise<unknown> | undefined)?.then !== 'function') {
        restore()
        return written
    }
    return (ran as Promise<unknown>).then(
        () => {
            restore()
            return written
        },
        (failure: unknown) => {
            restore()
            throw failure
        },
    )
}

/**
 * How many times the region read the CLOCK.
 *
 * The one thing a correctness test cannot see: a request answers the same 200 whether or not the
 * per-request line timed it, so "the gate is asked before the stopwatch" has to be asserted as work.
 * Swapping `performance.now` is the trick `capture` plays on the console — the observable substrate,
 * rather than a counter reached in through a back door.
 *
 * Through `capture` too, and discarding what it collected: the open arm of this claim writes real
 * lines, and a work assertion has no interest in them beyond keeping them off the runner's output.
 */
async function clockReads(fn: () => Promise<void>): Promise<number> {
    const held = performance.now.bind(performance)
    let reads = 0
    performance.now = (): number => {
        reads++
        return held()
    }
    try {
        await capture(fn)
    } finally {
        performance.now = held
    }
    return reads
}

function levels(written: Written[]): string[] {
    return written.map((line) => line.level)
}

/**
 * The channel a captured line was written on, whatever format it came out in.
 *
 * Three formats and one field: `tsv` puts it third, `json` names it, and the readable form leads with
 * it. Reading it back is what lets every case above assert a RELATIONSHIP between channel names
 * rather than a literal the app's own name would break.
 */
function channelOf(line: Written | undefined): string {
    const text = textOf(line)
    if (text.startsWith('{')) return (JSON.parse(text) as { channel: string }).channel
    if (text.includes('\t')) return text.split('\t')[2] ?? ''
    return text.split(' ')[0] ?? ''
}

/**
 * A captured line with the color taken off.
 *
 * ANSI comes off first in every reader: the readable form is colored at a TTY, so without this every
 * claim above would hold under `bun test | cat` and fail for whoever ran the suite in their own
 * terminal. What is left is the same text in all three formats, which is what lets a case assert a
 * message with `includes` rather than parsing the shape it happened to come out in.
 */
function textOf(line: Written | undefined): string {
    return (line?.text ?? '').replace(ANSI, '')
}

/** The app's own channel, asked rather than assumed — it is `ABIDE_APP_NAME`, a package.json, or `abide`. */
function defaultChannel(): string {
    return channelOf(capture(() => log('naming itself'))[0])
}

const LOGS = '/__abide/logs'

/** Nothing is upgrading through `handle` here, so nothing needs the Bun server — and one would latch. */
const NO_SERVER = undefined as never
const ORIGIN = 'https://app.test'

/**
 * A jsonl body, read one record at a time.
 *
 * One record per ask rather than "drain it", because the feed is a stream that never ends: draining
 * it hangs, and a fixed count read ahead of what has been published hangs on the last one. Asking for
 * exactly the record the case just caused is what keeps the claim about ORDER honest.
 */
function lines(response: Response): { next(): Promise<LogRecord | undefined>; stop(): Promise<void> } {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let held = ''
    return {
        async next(): Promise<LogRecord | undefined> {
            for (;;) {
                const at = held.indexOf('\n')
                if (at >= 0) {
                    const line = held.slice(0, at)
                    held = held.slice(at + 1)
                    if (line !== '') return JSON.parse(line) as LogRecord
                    continue
                }
                const step = await reader.read()
                if (step.done === true) return undefined
                held += decoder.decode(step.value, { stream: true })
            }
        },
        // The cancel is what unsubscribes the tail: `framedBody` calls `return()` on the generator,
        // whose `finally` drops the listener. Without it every case that opened a feed leaves one.
        stop: () => reader.cancel(),
    }
}

function messageOf(record: LogRecord | undefined): string {
    return record?.message ?? ''
}

// Built once, outside the arms: a bench measures the gate, not the construction.
const CLOSED_CHANNEL = log.channel('never-turned-on')

// A `let` an arm's `prepare` writes, not a `const false`. An engine can prove a module `const` never
// changes and fold the branch away entirely, and this flag is the DENOMINATOR of the ratio the card
// publishes — folding it would measure an empty loop and flatter abide by whatever that is worth.
let vanillaEnabled = false
