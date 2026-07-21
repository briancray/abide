// #demo platformObserve
import { GET } from 'abide/server/GET'
import { trace } from 'abide/shared/trace'

// `trace()` returns the request's W3C traceparent — seeded from an incoming header or lazily
// generated and cached on the request scope. A traceparent is `version-traceid-spanid-flags`; this
// read also splits out the trace id for display. (`health()` and `log()` each have their own card.)
export default GET(() => {
    const traceparent = trace()
    return {
        traceparent: traceparent ?? null,
        traceId: traceparent ? (traceparent.split('-')[1] ?? null) : null,
    }
})
// #enddemo
