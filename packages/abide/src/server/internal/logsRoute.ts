// `GET /__abide/logs` — subscribe to this process's log records as SSE.
//
// OFF unless the deployment sets `ABIDE_LOGS`, and served from inside the middleware chain like every
// other route, so authorization is the app's own middleware — the same answer abide gives everywhere
// else ("auth is middleware"), and the reason this file has no auth vocabulary of its own.
//
// NOT on the WS mux, deliberately. A reserved `@log:` channel beside `@rpc:`/`@tag:` would have been
// tidier, but the mux is reachable from the client bundle, and a log feed a browser can join turns any
// XSS into whole-server log exfiltration. A separate SSE route is reachable only by something that can
// present a credential out of band, and SSE additionally suits a long-lived tail: no upgrade, fewer
// unhappy proxies, and `applyResponseCompression` already refuses to compress `text/event-stream`.
//
// ONE PROCESS. A deployment behind a load balancer serves this from whichever instance the request
// landed on — the same honest limitation `memo({ crossRequest })` has, and not one a per-process ring
// can fix.

import { type LogRecord, logFeed } from '../../shared/internal/logFeed.ts'
import { logFilterFromParams, logRecordMatches } from '../../shared/internal/logRecordMatches.ts'
import { error } from '../error.ts'
import { sse } from '../sse.ts'

// How many records may sit undelivered for one slow subscriber before further ones are counted as
// lost. A bound is mandatory, and it does more work than the slow-reader case suggests: MEASURED, Bun
// does not report a client hang-up promptly — neither `request.signal` nor the stream's `cancel` fires
// for seconds after the peer disappears (worst case `idleTimeout`, 255s). So a subscriber that walked
// away keeps matching records until Bun notices, and this is what caps what that costs. Both teardown
// paths are wired and both work; only their timing belongs to Bun.
const MAX_QUEUE = 1000
const DEFAULT_TAIL = 200

// A gap in the feed is REPORTED, never silent — a tail that quietly skips lines reads as "nothing
// happened", which is the one thing a log must never imply. `seq: 0` marks it as synthesised here
// rather than emitted by the app (every real record's sequence starts at 1).
function droppedMarker(count: number): LogRecord {
    return {
        seq: 0,
        level: 'warn',
        time: new Date().toISOString(),
        channel: 'abide:logs',
        traceparent: undefined,
        message: `${count} log line${count === 1 ? '' : 's'} dropped — this subscriber could not keep up`,
    }
}

// A HAND-WRITTEN iterator rather than an `async function*`, and the reason is the teardown path.
//
// A tail spends nearly all its life suspended on "no records yet". An async generator expresses that
// as `await <promise that resolves on the next record>` — and a generator suspended at an AWAIT cannot
// be resumed by `.return()`: the request is queued until the generator next reaches a YIELD, which for
// an idle feed is never. So `sse`'s cancel (the disconnect path) would never run the generator's
// `finally`, and every subscriber that ever hung up would stay in the feed's listener set for the life
// of the process — a leak that grows with exactly the thing this route is for.
//
// With an explicit iterator, `return()` is an ordinary method call: it unsubscribes, resolves whatever
// `next()` is outstanding, and is done. The request signal stays wired for the case where the socket
// dies without the body being cancelled; both paths land on the same `finish`.
function logRecordSource(url: URL, signal: AbortSignal): AsyncIterable<LogRecord> {
    return {
        [Symbol.asyncIterator](): AsyncIterator<LogRecord> {
            const filter = logFilterFromParams(url.searchParams)
            const requested = Number.parseInt(url.searchParams.get('tail') ?? '', 10)
            const tail = Number.isFinite(requested) ? requested : DEFAULT_TAIL
            // `follow=0` (`logs --no-follow`) is the `tail` half without the `-f`: history, then EOF.
            // The SERVER ends the stream because only it knows where the backlog stopped — a client
            // hanging up on its own could not tell an exhausted backlog from a merely quiet app.
            const follow = url.searchParams.get('follow') !== '0'

            // Backlog first — you run `logs` AFTER noticing a problem, so the lines from before you
            // connected are usually the ones you came for.
            const pending: LogRecord[] = []
            for (const record of logFeed.backlog(tail)) {
                if (logRecordMatches(record, filter)) pending.push(record)
            }

            let dropped = 0
            let closed = false
            let waiting: ((result: IteratorResult<LogRecord>) => void) | undefined

            const deliver = (record: LogRecord): IteratorResult<LogRecord> => {
                if (dropped === 0) return { done: false, value: record }
                const count = dropped
                dropped = 0
                // Placement is approximate: what was dropped is NEWER than what is still queued, so
                // the marker lands earlier in the transcript than the loss it reports. Reporting the
                // count in the right neighbourhood beats holding it back for exact ordering.
                pending.unshift(record)
                return { done: false, value: droppedMarker(count) }
            }

            const unsubscribe = logFeed.subscribe((record) => {
                if (closed || !logRecordMatches(record, filter)) return
                if (pending.length >= MAX_QUEUE) {
                    dropped++
                    return
                }
                pending.push(record)
                const resume = waiting
                if (resume === undefined) return
                waiting = undefined
                const next = pending.shift()
                if (next !== undefined) resume(deliver(next))
            })

            const finish = (): IteratorResult<LogRecord> => {
                if (!closed) {
                    closed = true
                    signal.removeEventListener('abort', onAbort)
                    unsubscribe()
                }
                const resume = waiting
                waiting = undefined
                resume?.({ done: true, value: undefined })
                return { done: true, value: undefined }
            }

            function onAbort(): void {
                finish()
            }
            signal.addEventListener('abort', onAbort, { once: true })

            return {
                next(): Promise<IteratorResult<LogRecord>> {
                    if (closed) return Promise.resolve({ done: true, value: undefined })
                    const record = pending.shift()
                    if (record !== undefined) return Promise.resolve(deliver(record))
                    if (!follow) return Promise.resolve(finish())
                    return new Promise<IteratorResult<LogRecord>>((resolve) => {
                        waiting = resolve
                    })
                },
                return(): Promise<IteratorResult<LogRecord>> {
                    return Promise.resolve(finish())
                },
            }
        },
    }
}

export function logsRoute(url: URL, signal: AbortSignal): Response {
    if (!logFeed.enabled) {
        return error(
            404,
            'the log feed is disabled on this deployment — set ABIDE_LOGS=1 on the server to enable it',
        )
    }
    return sse(logRecordSource(url, signal))
}
