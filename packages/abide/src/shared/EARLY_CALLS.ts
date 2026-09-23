// 41.21 — where a page's early-call script leaves each call it started, keyed by `rpcRequest`'s
// `key`, for the browser's own `wire` to take. A global because the script runs before any module
// does, and a leaf because the server writes the name into the script and the browser reads it.
export const EARLY_CALLS = '__abideCalls'
