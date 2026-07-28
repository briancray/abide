// Is this the run-deadline rejection (ADR 0028 D7)? Matched by NAME, not by identity: the value is a
// platform `DOMException` on the server (what `AbortSignal.timeout` aborts with) and may be a decoded
// `HttpError` carrying `kind: 'TimeoutError'` after crossing the wire — the same two shapes
// `fn.isError(e, name)` already reconciles, so the test is the same one it uses.
//
// Used to decide RETENTION, not to report: a timed-out slot settles like any other error and is then
// stamped immediately expired, because a deadline is the one failure most likely to succeed on retry.
export function isTimeoutError(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false
    const candidate = value as { name?: unknown; kind?: unknown }
    return candidate.name === 'TimeoutError' || candidate.kind === 'TimeoutError'
}
