// What this app does with the span abide already minted for it: shapes it as OTLP and ships it.
//
// A MIDDLEWARE rung rather than anything of the framework's, and that is the point the rung about this
// makes. abide mints one span per request — `trace()` is the operation, `trace.span()` is this hop —
// and a rung is holding the response when it comes back, so everything an exporter wants is in scope
// at exactly one place with no hook to register.
//
// NOTHING IS POSTED HERE. A real rung ends in `fetch(collector, …)`, and this app has no collector: a
// demo that opened a socket to a third party would be a network dependency in a docs page and would be
// the first thing to break on a machine with no egress. So the payload is kept and handed back, which
// is the same stance `10-what-the-trace-carries-onward` takes about outbound headers — what an exporter
// would send is the record, so the record is the demonstration.

import { type Middleware, request, trace } from 'abide/server'

/** The OTLP fields for one span. The names are the protocol's, so a reader can grep the spec for them. */
export interface OtlpSpan {
    traceId: string
    spanId: string
    name: string
    kind: number
    startTimeUnixNano: string
    endTimeUnixNano: string
    status: { code: number }
}

// `SERVER`, because this span is a request being answered rather than one being made.
const SPAN_KIND_SERVER = 2
// OTLP's three status codes. `UNSET` is not used here: a response has a status, so this hop always has
// an opinion about whether it worked.
const STATUS_OK = 1
const STATUS_ERROR = 2

// `performance.now()` is monotonic and counts from `timeOrigin`, so this is the one addition that turns
// a duration into the wall clock OTLP asks for. Two `Date.now()` readings would not be monotonic.
const EPOCH_MS = performance.timeOrigin

// The last span this app shaped, for the rung to read back. A real exporter batches into an array and
// flushes; ONE is what a preview can show, and a growing buffer nothing drains is a leak in a docs page.
let LAST: OtlpSpan | null = null

/** What the exporter would have sent for the most recent request, or `null` before there was one. */
export function lastShipped(): OtlpSpan | null {
    return LAST
}

/**
 * Time the hop, shape it, ship it — outermost, so the duration covers every rung under it.
 *
 * The ids are read AFTER `next()` rather than before, which costs nothing and is the honest order: a
 * rung that read them first would be asserting they cannot change, and `trace()` is built on first ask.
 */
export const exportSpans: Middleware = async (next) => {
    const started = performance.now()
    const answered = await next()
    const finished = performance.now()

    const asked = request()
    LAST = {
        traceId: trace(),
        spanId: trace.span(),
        name: `${asked.method} ${new URL(asked.url).pathname}`,
        kind: SPAN_KIND_SERVER,
        // Nanoseconds as a STRING, which is the protocol's own answer to a 64-bit value JSON cannot
        // hold: `Date.now() * 1e6` is already past `Number.MAX_SAFE_INTEGER`.
        startTimeUnixNano: String(Math.round((EPOCH_MS + started) * 1e6)),
        endTimeUnixNano: String(Math.round((EPOCH_MS + finished) * 1e6)),
        status: { code: answered.status >= 500 ? STATUS_ERROR : STATUS_OK },
    }
    // Where the POST goes in a real app:
    //
    //   if (trace.sampled()) await fetch(`${config().OTLP_URL}/v1/traces`, {
    //       method: 'POST',
    //       headers: { 'content-type': 'application/json' },
    //       body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [LAST] }] }] }),
    //   })
    //
    // Guarded by `trace.sampled()` because the CALLER already decided, and awaited or not is a real
    // choice: awaiting holds the response for the length of the collector's answer.
    return answered
}
