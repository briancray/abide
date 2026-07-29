// The URL prefix of a content-addressed, code-split client asset.
//
// Two stages of the response pipeline turn on it and must agree: the chunk ROUTE (which negotiates
// `Accept-Encoding` over the brotli/gzip variants `abide build` precomputed) and dynamic compression
// (which must decline these bytes, since re-compressing an identity-served one would undo a deliberate
// build-time decision). It was declared independently in both — a shared secret with no owner, where
// a rename in one place silently double-compresses in the other.
export const CHUNK_PREFIX = '/__abide/chunk/'
