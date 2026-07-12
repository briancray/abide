/*
The single decode point for the "is this ref-json?" policy: abide's own client speaks
ref-json (encodeRefJson — restores the cycles/shared refs/structured types plain JSON
can't carry); a foreign client (curl, an OpenAPI SDK, a raw ws client) speaks ordinary
JSON. Both the rpc body face and the socket-frame face funnel through here so the
codec fork lives in exactly one place instead of being re-derived per face.

The discriminator is a genuine per-face input difference, kept thin at the call site:

  - `isRefJson === true`  — the rpc client stamped REF_JSON_HEADER, so decode as ref-json.
  - `isRefJson === false` — no header (a non-abide rpc body), so plain JSON.parse.
  - `isRefJson === undefined` — no header is available at all (a ws frame carries none),
    so sniff: try ref-json, fall back to plain JSON. The ref-json `[rootValue, slots]`
    envelope is ambiguous with a legitimate 2-element array, but a frame is always an
    object, so a foreign plain-JSON frame makes decodeRefJson throw and we fall back.

Throws on a malformed payload (JSON.parse's own SyntaxError) — the caller decides
whether that's a 400 (rpc) or a dropped frame (ws).
*/
import { decodeRefJson } from './decodeRefJson.ts'

export function decodeWireBody(text: string, isRefJson: boolean | undefined): unknown {
    if (isRefJson === true) {
        return decodeRefJson(text)
    }
    if (isRefJson === false) {
        return JSON.parse(text)
    }
    // No discriminator (a ws frame has no header): try ref-json, fall back to plain JSON.
    try {
        return decodeRefJson(text)
    } catch {
        return JSON.parse(text)
    }
}
