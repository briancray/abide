// TRANSPORT (out), ONCE — what a produced read result looks like as a `Response`.
//
// Two callers, and they are the same read leaving through two doors: the router's `encodeRpcResult`
// (over HTTP) and `fn.raw` (in-process). `.raw` is the bare call with a `Response` return, so "what
// `.raw` answers" and "what the wire answers" are one question with one answer — and the moment they
// were two ladders, `.raw` had already lost the `Accept` rung and the handler's `sse()` choice with it.
//
// The three cases, in order, because the first two are escapes from the third:
//   a `Response`  — one the handler built itself. Usually UNTAGGED: a tagged `json()`/`jsonl()`/`sse()`
//                   was seen through by the memo to its payload and never arrives as a Response. The
//                   exception is the path that BYPASSES the memo (a `memo: false` mutation, a FormData
//                   body), where there was no memo to see through it — and that is exactly the caller
//                   `json(data, init)`'s status and headers are still meant to reach, so this branch
//                   passing it through whole is what delivers them. Status and headers intact either
//                   way — the escape hatch for custom headers and binary downloads —
//                   but CLONED, because a `Response` body is single-consumption while the memo slot
//                   holding it is not. Retained at a read's default ttl, the SAME object is what every
//                   later caller is handed, and the second one to read it gets `Body already used`.
//                   One clone per caller, the pristine original left in the slot.
//   an ASYNC ITERABLE — a streaming slot's per-caller replay-then-live cursor. `streamResponseFor` picks
//                   jsonl vs sse: the handler's tagged choice first, then this caller's `Accept`.
//   anything else — `json(value)`.
//
// What is NOT here is the CONTRACT half the router wraps around it — `schemas.output` validation and
// output SHAPING. That is deliberate and it is the seam this module makes visible: shaping trims the
// value that LEAVES the process, while `.raw` is the bare call encoded and a bare call is unshaped.
// A caller wanting the shaped wire bytes is asking for an HTTP request, and has one.

import { isSingleConsumer } from '../../shared/internal/responseSource.ts'
import { json } from '../json.ts'
import { streamResponseFor } from './streamResponse.ts'

// A streaming read result is an AsyncIterable of decoded chunks (a ReplayableStream `consume()` cursor);
// a plain value/object is not async-iterable. Asked only AFTER the `Response` case, which is why it does
// not need the `Response`/`ReadableStream` exclusions `memo.ts`'s own stream test carries.
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
    )
}

export function encodeRpcValue(value: unknown, accept: string | null | undefined): Response {
    // The clone is what lets a RETAINED Response be handed to caller after caller. It is not free: a
    // stream body TEES, and the branch left in the slot buffers everything the returned branch reads
    // (measured streaming 200 MB: +43 MB RSS held, against 0 MB uncloned). So it is paid only where a
    // second reader can exist. A memo-BYPASSING mutation (`memo: false`, a `FormData` body) has one
    // consumer by construction — no slot, nobody to hand it to twice — and is tagged at the point that
    // knows it (`tagSingleConsumer`, in `makeRpc`'s bypass branch), because transport cannot tell a
    // bypass from a slot by looking at the `Response`.
    if (value instanceof Response) return isSingleConsumer(value) ? value : value.clone()
    if (isAsyncIterable(value)) return streamResponseFor(value, accept)
    return json(value)
}

// Did `encodeRpcValue` take the stream branch? The router asks so it can stamp the resume header on a
// streamed response and only on one. Exported rather than re-derived at that call site: two spellings of
// "is this the stream case" is exactly the drift this module exists to prevent.
export function encodesAsStream(value: unknown): boolean {
    return !(value instanceof Response) && isAsyncIterable(value)
}
