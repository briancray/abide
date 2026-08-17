// The remote log feed: `GET /__abide/logs`, which is what `./app logs` tails.
//
// It is `channel({ tail })` and `ch.tail()` and nothing else — the ring, the cap, the replay and the
// live subscribe are all the primitive's, so the feed is one `publish` per line written and one
// subscriber per reader. That is the whole implementation, and it is the reason there is no second
// retention policy to keep in step with the one `channel` has.
//
// What it carries is what was WRITTEN. The `DEBUG` gate decides that, here as at the console: a tail
// showing lines the console did not would be a second answer to the same question, and an operator
// comparing the two would be right to call one of them broken.
//
// Closed unless `ABIDE_LOGS` says otherwise, because an open feed is an app's own log output readable
// by whoever can reach the port.

import type { Channel } from '#shared/channel.ts'
import { channel } from '#shared/channel.ts'
import { type LogRecord, useLogSink } from '#shared/log.ts'
import { knobOf } from './config.ts'
import { jsonl, refuse } from './responses.ts'

// Built on the first line recorded rather than at import, so an app that never opts in never
// allocates the ring — and so the size is read after an app has had a chance to declare one.
let feed: Channel<LogRecord> | null = null

function ring(): Channel<LogRecord> {
    if (feed !== null) return feed
    const tail = knobOf('ABIDE_LOG_BUFFER')
    feed = channel<LogRecord>({ tail: Math.floor(tail) })
    return feed
}

/**
 * Asked per line rather than once at import.
 *
 * Through `knobOf`, not off the environment: the document is the one account of what this process is
 * running on, so an app that declared `ABIDE_LOGS` in `onConfig` opens the actual feed. That also
 * means a variable changed mid-run is seen on the next `config.invalidate()` rather than instantly —
 * the resolve is held for the process, which is what makes every other knob answerable synchronously.
 */
function isOpen(): boolean {
    return knobOf('ABIDE_LOGS')
}

// The gate is the SINK's, not the callback's: a closed feed is the default, and a record built for
// it would be a `Date` and an object allocated per line to be thrown away.
useLogSink((record) => ring().publish(record), isOpen)

/**
 * The endpoint. A 404 rather than a 403 when it is closed, because a closed feed is one that is not
 * there — an app that never opted in has nothing to refuse access to.
 */
export function logs(request: Request): Response {
    if (!isOpen()) return refuse('the log feed is closed — set ABIDE_LOGS', 404)
    if (request.method !== 'GET') return refuse('the log feed is a GET', 405)
    // Line-delimited JSON, one record per line, written as the reader takes it — so a tail that stops
    // reading applies back-pressure rather than filling a buffer nobody is draining.
    return jsonl(ring().tail())
}
