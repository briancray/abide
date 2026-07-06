import type { ContentBodyKind } from './contentBodyKind.ts'
import { DEFER } from './DEFER.ts'

/*
The single body-kind → value mapping shared by the live read (decodeResponse) and
the synchronous warm read (warmValueFromSnapshot), so neither can disagree about
which kind yields what — the divergence behind the streaming-guard-in-one-but-not-
the-other bug.

Generic over the extraction (`Value`) so both async and sync callers reuse it:
the live read passes Promise-returning accessors (response.json()/text()) and
handles the deferred kinds (streaming → throw, binary → blob); the warm read
passes sync accessors (JSON.parse(body)/body) and treats every deferred kind as
no-warm-value, leaving the live async path to throw/blob exactly as a fresh call
would. The json/text branches — the only kinds that produce a directly-usable
value on both sides — are decided here, once.

Returns the DEFER sentinel for `streaming` and `binary`: kinds whose handling is
side-specific (the live read throws on streaming and blobs on binary; the warm
read has no synchronous equivalent for either), so the caller branches on it.
*/
export function bodyValueForKind<Value>(
    kind: ContentBodyKind,
    json: () => Value,
    text: () => Value,
): Value | typeof DEFER {
    if (kind === 'json') {
        return json()
    }
    if (kind === 'text') {
        return text()
    }
    return DEFER
}
