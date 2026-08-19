import { type Middleware, request, trace } from 'abide/server'

/**
 * What the ids are FOR: a span, shipped from a middleware rung.
 *
 * abide mints one span per request and reports it nowhere — `trace()` is the operation and
 * `trace.span()` is this hop, and the rungs above showed both travelling on `traceresponse` and on
 * every outbound call. Exporting them is the app's, and a rung is the place: it is holding the response
 * when it comes back, so the status, the duration and the two ids are all in scope at once with no
 * hook to register and nothing of the framework's to configure.
 *
 * OUTERMOST in the array, so the duration covers every rung under it and the route itself.
 *
 * `trace.sampled()` is the guard because the CALLER already decided — abide is not a sampler and does
 * not vote, so a rung that exported unsampled traces would be overruling whoever asked. Whether to
 * `await` the POST is a real choice and not a detail: awaiting holds the response for the length of the
 * collector's answer, and not awaiting means a failed flush is a rejection with nobody attached.
 *
 * This rung is the SHAPE; what this app actually installs is `#server/lib/otlp.ts`, which is the same
 * middleware with the protocol's numbers named and the record kept for a preview to read back. Both
 * stop short of the `fetch`, because a docs page that opened a socket to a third party is a network
 * dependency and the first thing to break on a machine with no egress.
 */
export const exportSpans: Middleware = async (next) => {
    const started = performance.now()
    const answered = await next()

    const asked = request()
    const span = {
        traceId: trace(),
        spanId: trace.span(),
        name: `${asked.method} ${new URL(asked.url).pathname}`,
        // `SERVER`: this span is a request being ANSWERED rather than one being made.
        kind: 2,
        // Nanoseconds as a STRING, which is the protocol's own answer to a 64-bit value JSON cannot
        // hold — `Date.now() * 1e6` is already past `Number.MAX_SAFE_INTEGER`. `performance.timeOrigin`
        // is what turns a monotonic reading into the wall clock OTLP asks for.
        startTimeUnixNano: String(Math.round((performance.timeOrigin + started) * 1e6)),
        endTimeUnixNano: String(Math.round((performance.timeOrigin + performance.now()) * 1e6)),
        // OTLP's `OK` and `ERROR`. `UNSET` is unused here: a response has a status, so this hop always
        // has an opinion about whether it worked.
        status: { code: answered.status >= 500 ? 2 : 1 },
    }

    if (trace.sampled()) {
        void fetch('http://localhost:4318/v1/traces', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span] }] }] }),
        })
    }
    return answered
}
