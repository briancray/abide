// The WS MUX address, and the per-socket HTTP face under it.
//
// This is the one framework route that a BUNDLED browser module and a HAND-WRITTEN browser snippet
// both dial — `ui/internal/mux.ts` and the dev live-reload string `cli/serve.ts` emits into the page —
// which is what makes drift here fail open and silently: a rename moves the server and leaves both
// clients connecting to a 404 with no compile error anywhere.
//
// The argument is not new; it is the one `serve.ts` already makes about the very next token in the
// same emitted string. `MUX_UPSTREAM` exists so "a rename is a COMPILE error on both sides rather than
// a silently dropped frame", and `serve.ts` interpolates `MUX_UPSTREAM.sub` with a comment saying a
// rename "would otherwise leave dev live-reload silently subscribing to nothing". The ADDRESS one line
// above it was spelled inline in five places.
export const SOCKETS_ROUTE = '/__abide/sockets'

// `/__abide/sockets/<name>` — SSE subscribe / POST publish for ONE socket. The trailing slash is what
// separates the face from the mux, so the two are derived together rather than stated apart.
export const SOCKET_FACE_PREFIX = `${SOCKETS_ROUTE}/`
