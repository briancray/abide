// JSON response helper (rpc-core §4). Serializes `data` and tags it application/json.
//
// Carries a phantom <T> so callers/tooling can recover the response payload type; at
// runtime it is a plain Response, which is all the wire needs.

import { type TypedResponse, tagResponseSource } from '../shared/internal/responseSource.ts'

export function json<T>(data: T, init?: ResponseInit): TypedResponse<T> {
    const headers = new Headers(init?.headers)
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    // Tag with the pre-encoding value so a memo-backed read caches/seeds `data` exactly like a handler
    // that returned `data` raw (replayable-streams.md §4). This Response is then DISCARDED on that path —
    // including for `fn.raw`, which is the same memo-backed read and re-encodes the payload — so an
    // `init` here (a status, a header) reaches only the callers that bypass the memo. A handler that is
    // really shaping a response returns a plain `Response`, which the memo keeps as its value. The
    // `TypedResponse<T>` brand carries `T` so a read/mutation infers the value type, not `Response`.
    return tagResponseSource(new Response(JSON.stringify(data), { ...init, headers }), {
        kind: 'value',
        value: data,
    }) as TypedResponse<T>
}
