// The app's own account of whether it is working.
//
// There is nothing clever here and that is the point: the whole implementation is one object literal
// spread over another, which is what a hand-written health route already is. What abide adds is the
// two things a hand-written one gets wrong often enough to be worth naming — a FLOOR under the
// document, so an app that reported nothing still answers something a monitor can correlate a deploy
// by, and one rule for a reporter that throws, which is an app saying it is not working rather than a
// route falling over.
//
// `health()` is asked the same way on both sides, and the difference between the two is the whole of
// what `reachable` means: the process being asked about composes the answer, and anyone else fetches
// it. A fetch that never lands is itself an answer — `{ reachable: false }` and nothing else, because
// filling in a version for a server that did not reply is inventing the thing that was asked about.
//
// Which side is which is decided by `abide/server` being loaded, and this card loads it — so in the
// browser the app answering about itself is the PAGE, and its version is empty because there is no
// package.json to climb to. That is why every claim below is about a relationship or a field's kind
// rather than about a literal: the two lanes genuinely have different answers to give.

import { health } from 'abide'
import { onHealth } from 'abide/server'
import { loopback, suite } from 'harness'
import { capture, writtenAt } from './console.ts'
import { button, row, stage } from './dom.ts'
import { META } from './SUITES.ts'

const HEALTH = '/__abide/health'

export default suite({
    ...META.health,
    cases: [
        {
            title: 'the baseline is what an app that said nothing answers',
            note: 'Four fields nobody had to write: `reachable`, the version off the same package.json the app’s log channel is named after, when the process started, and how long ago that was. `startedAt` and `uptime` come from `performance.timeOrigin` and `performance.now()` — one instant and the count from it, so the two cannot disagree, and the count is monotonic where a subtraction of two `Date.now()` readings would step backwards through an NTP correction.',
            async run({ is }) {
                const document = await health()

                is('reachable, because the caller IS the app', document.reachable, true)
                is('a version, even when nothing declared one', typeof document.version, 'string')
                is('and no failure to report', document.error, undefined)

                const started = Date.parse(document.startedAt as string)
                is('startedAt is a time', Number.isFinite(started), true)
                // The relationship rather than either number: both lanes have a clock, neither has
                // the same one, and "the two fields describe the same instant" is the actual claim.
                const drift = Math.abs(started + (document.uptime as number) - Date.now())
                is('startedAt plus uptime is now', drift < 2000, true)
            },
        },

        {
            title: 'onHealth’s fields land OVER the baseline',
            note: 'The framework’s four are a floor, not a claim about the app’s own dependencies — so the app wins every field it names, including `version`, where a build stamp knows something a package.json climb cannot. The registration hands back the way off again: there is no CLI reading an app’s exports yet, and a hook that cannot be removed is one a second caller can never register.',
            async run({ is }) {
                const off = onHealth(() => ({ database: 'up', version: '9.9.9' }))

                const reported = await health()
                is('the app’s own field', reported.database, 'up')
                is('the app’s version wins', reported.version, '9.9.9')
                is('and the baseline is still under it', typeof reported.startedAt, 'string')

                off()
                is('off again', (await health()).database, undefined)
            },
        },

        {
            title: 'a reporter may be async, and its failure is an account rather than a throw',
            note: 'A reporter that throws is an app saying it is not working, which is exactly the case a monitor exists for — so it does not escape as a throw and take the baseline with it. The document keeps every field abide filled in, gains the failure under `error`, and the endpoint answers 503 off that one field. It is also written to `abide:health` as a warning, which the `DEBUG` gate never swallows: the gate is there to control volume, not to hide breakage.',
            async run({ is }) {
                onHealth(async () => {
                    await Promise.resolve()
                    return { queue: 0 }
                })
                is('an async reporter is awaited', (await health()).queue, 0)

                // No disposer between the two: one app has one account, so registering REPLACES.
                const off = onHealth(() => {
                    throw new TypeError('the pool is empty')
                })
                // "written to `abide:health` as a warning" is the claim the document cannot carry:
                // delete the line and every field below is unchanged, so the degradation reaches the
                // endpoint and nothing else. Captured here, which is where a log's behaviour is.
                let failed = await health()
                const written = await capture(async () => {
                    failed = await health()
                })
                const warnings = writtenAt(written, 'warn')
                is('said as a warning, which the gate never swallows', warnings.length, 1)
                is('on the health channel', warnings[0]?.text.includes('abide:health'), true)
                is('the failure is a field', failed.error, {
                    name: 'TypeError',
                    message: 'the pool is empty',
                })
                is('reachable is still true — it WAS reached', failed.reachable, true)
                // Nothing was caught here, because nothing threw: asking is what lets a caller treat
                // the document as the answer instead of wrapping every call in a `try`.
                is('and the baseline survived the reporter', typeof failed.startedAt, 'string')
                off()
            },
        },

        {
            title: 'the endpoint is that document, and 503 is the app’s own word',
            note: '`GET /__abide/health`, served by `dispatch` — an app that mounted that has it already. Open, like the schema catalogue and unlike the log feed: a health check an operator has to configure a secret into is one that is not wired up on the day it matters. The status comes off the document’s own `error` field rather than a flag beside it, so an app that puts one there deliberately says the same thing a thrown reporter did.',
            async run({ is }) {
                const wire = loopback()

                const answered = await wire.fetch(HEALTH, { method: 'GET' })
                is('open', answered.status, 200)
                is('one JSON document', answered.headers.get('content-type'), 'application/json')
                const document = (await answered.json()) as { reachable: boolean; uptime: number }
                is('the same fields the local call composes', document.reachable, true)
                is('with an uptime', typeof document.uptime, 'number')

                is('and it is a GET', (await wire.fetch(HEALTH, { method: 'POST' })).status, 405)

                const off = onHealth(() => ({ error: { name: 'Broken', message: 'no disk' } }))
                const refused = await wire.fetch(HEALTH, { method: 'GET' })
                is('an app that reports a failure answers 503', refused.status, 503)
                is('carrying the account', ((await refused.json()) as { error: unknown }).error, {
                    name: 'Broken',
                    message: 'no disk',
                })
                off()
            },
        },

        {
            title: 'an option names a WIRE, and a wire is another app',
            note: '`health({ fetch })` asks over that wire even in a process that could have answered itself — otherwise this would be the one call whose meaning depended on which modules the caller happened to import, and a test pointing at a loopback would be answered by the process running it. It is the FIELDS that name the wire rather than the argument, so a caller spreading a config that mentioned neither is still asking about itself. What comes back when nothing answers is one field: a client that filled in a version for a server it could not reach would be inventing the thing it was asked about.',
            async run({ is }) {
                const wire = loopback()

                const remote = await health({ fetch: wire.fetch })
                is('one request', wire.requests, 1)
                is('the app on the other end answered', remote.reachable, true)

                // An object naming neither `base` nor `fetch` named no wire, so nothing is sent.
                await health({})
                is('an empty option is not a wire', wire.requests, 1)

                const nothing = await health({
                    fetch: () => Promise.reject(new Error('connection refused')),
                })
                is('unreachable, and nothing else', nothing, { reachable: false })
            },
        },

        {
            title: 'interact — ask, and report something of your own',
            interact({ host, log }) {
                let off: (() => void) | null = null
                const show = async (): Promise<void> => {
                    log.live('document', JSON.stringify(await health()))
                }

                host.append(
                    stage(
                        row(
                            button('ask', () => void show()),
                            // No clearing between reports: registering REPLACES, so only the button
                            // that takes the reporter off entirely needs the disposer.
                            button('report { database: "up" }', () => {
                                off = onHealth(() => ({ database: 'up' }))
                                void show()
                            }),
                            button('report a failure', () => {
                                off = onHealth(() => {
                                    throw new Error('the pool is empty')
                                })
                                void show()
                            }),
                            button('stop reporting', () => {
                                off?.()
                                off = null
                                void show()
                            }),
                        ),
                    ),
                )
                log('document', '—')
            },
        },
    ],
})
