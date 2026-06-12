import type { TraceContext } from './TraceContext.ts'

/*
The request-scope facts the shared layer reads through requestScopeSlot:
trace position, elapsed ms since the scope opened (request start on the
server, navigation start in the browser), and the verb+path that anchors log
lines. Resolved fresh per read so `elapsedMs` is current at the call.
*/
export type RequestScopeInfo = {
    trace: TraceContext
    elapsedMs: number
    method: string
    path: string
}
