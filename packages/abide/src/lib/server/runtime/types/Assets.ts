/*
Embedded asset bytes keyed by request path (compile-time gzip embed). Pinned
to a plain-ArrayBuffer backing so values feed `new Response(...)` directly —
BodyInit rejects views over a possibly-shared buffer.
*/
export type Assets = Record<string, Uint8Array<ArrayBuffer>>
