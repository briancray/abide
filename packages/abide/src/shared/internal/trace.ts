// Where the isomorphic half asks about the current trace, without knowing what answers.
//
// Two readers want two different things and neither may import `$server`: `log` wants the ID for a
// line, and `transport` wants the HEADERS for an outbound call. So there are two pointers rather than
// one source handing back a record — a log line that had to build a headers object to read one field
// off it would allocate per line, and lines are the hot path here.
//
// On a client nothing is ever installed, so both reads are a null compare and the answer is `null`:
// there is no request to belong to, and a browser inventing a trace id would be asserting a
// relationship to work it cannot see.

let idSource: (() => string | null) | null = null
let headerSource: (() => Record<string, string> | null) | null = null

/** Installed by `abide/server`'s request scope. Both must answer `null` outside a request. */
export function useTraceSources(id: () => string | null, headers: () => Record<string, string> | null): void {
    idSource = id
    headerSource = headers
}

/** The operation a log line belongs to, or `null` when there is no request to ask. */
export function traceId(): string | null {
    return idSource === null ? null : idSource()
}

/** What an outbound request carries to continue this trace, or `null` when there is none. */
export function traceHeaders(): Record<string, string> | null {
    return headerSource === null ? null : headerSource()
}
