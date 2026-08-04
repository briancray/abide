// WHICH WIRE ENCODING A STREAMED RPC IS SERVED IN — one rule, for a fresh run and for a resume.
//
// `responseSource.ts` states it: the handler's own choice wins (`jsonl(...)`/`sse(...)` tag the
// source), else `Accept: text/event-stream` selects SSE, else jsonl. The router implemented it twice,
// twenty lines apart inside one function, and the resume half left out the middle rung:
//
//     streamEncodingOf(resumed.cursor) === 'sse' ? sse(resumed.cursor) : jsonl(resumed.cursor)
//
// So a handler returning a bare `async function*` served SSE to an `Accept: text/event-stream` client
// on the first read and JSONL on `?__abide_from=<n>` — the same slot, the same transcript, two content
// types, which is exactly what "re-encoded in the handler's ORIGINAL encoding" promises against. A
// value test cannot see it: both encodings decode to the same chunks, and only the `content-type`
// differs.

import { streamEncodingOf } from '../../shared/internal/responseSource.ts'
import { jsonl } from '../jsonl.ts'
import { sse } from '../sse.ts'

// `accept` is the header VALUE rather than the `Request` it came off: the second caller is `fn.raw`,
// which has no request — only the `init` a caller handed it — and fabricating a `Request` to ask it one
// question can throw (a body + a read method) for a header lookup either caller can do itself.
export function streamResponseFor(
    cursor: AsyncIterable<unknown>,
    accept: string | null | undefined,
): Response {
    const encoding = streamEncodingOf(cursor)
    if (encoding === 'sse') return sse(cursor)
    if (encoding !== undefined) return jsonl(cursor)
    return (accept ?? '').toLowerCase().includes('text/event-stream') ? sse(cursor) : jsonl(cursor)
}
