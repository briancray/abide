import { GET, trace } from 'abide/server'

/**
 * The other half of a trace: not what arrived, but what LEAVES.
 *
 * `trace.headers()` is what an outbound request carries — a `traceparent` naming OUR span as the
 * parent, plus `tracestate`. `remote` attaches it for you, so this is for a `fetch` to something that
 * is not an abide endpoint; an explicit header of your own is not overruled.
 *
 * `trace.responseHeaders()` is the mirror, and abide sets it on every response it builds. Reading it is
 * for a route assembling a `Response` by hand.
 *
 * `trace.state()` is `tracestate` as a live, mutable `Map` — the same shape `cookies()` and `bag()` are,
 * for the same reason. Left alone, the inbound text propagates byte for byte, which is the contract:
 * vendor entries belong to the vendors that wrote them, and rewriting one is how a chain loses them.
 *
 * Nothing here actually fetches. What an outbound call would carry is the HEADERS, so the headers are
 * the demonstration — a real hop to a third party would make this rung a network dependency and show
 * one line less.
 */
export const whatArrived = GET(() => {
    trace.state().set('mine', 'ab')
    return {
        outbound: Object.fromEntries(new Headers(trace.headers())),
        onTheResponse: Object.fromEntries(new Headers(trace.responseHeaders())),
        state: [...trace.state()],
    }
})
