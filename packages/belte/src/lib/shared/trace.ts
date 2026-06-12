import { formatTraceparent } from './formatTraceparent.ts'
import { requestScopeSlot } from './requestScopeSlot.ts'

/*
The current request's W3C `traceparent`, or undefined outside any request
scope (boot scripts, build, background work). Isomorphic: the server resolves
it from the ALS request scope, the browser from the trace stamped into
__SSR__ — so a client-side read returns the trace of the request that
rendered the page. The string is propagation-ready: hand it to your own logs,
error reports, or `propagation.extract` when attaching OpenTelemetry spans.
*/
export function trace(): string | undefined {
    const scope = requestScopeSlot.resolver?.()
    return scope ? formatTraceparent(scope.trace) : undefined
}
