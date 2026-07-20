// #demo platformObserve
import { GET } from 'abide/server/GET'
import { health } from 'abide/shared/health'
import { log } from 'abide/shared/log'
import { trace } from 'abide/shared/trace'

// Observability surface: `trace()` returns the request's W3C traceparent (seeded from an incoming
// header or lazily generated + cached on the scope), `health()` is the framework baseline probe,
// and `log()` writes a structured line to the server channel. The browser renders trace + health.
export default GET(() => {
    const traceparent = trace()
    log.info('platformObserve read', { traceparent })
    return {
        traceparent: traceparent ?? null,
        // A traceparent is `version-traceid-spanid-flags`; expose the trace id for display/assertions.
        traceId: traceparent ? (traceparent.split('-')[1] ?? null) : null,
        health: health(),
    }
})
// #enddemo
