// Where an RPC is MOUNTED. `/__abide/rpc/<name>`.
//
// The busiest route in the framework was the last one in this namespace with no constant: `SOCKETS_ROUTE`,
// `HEALTH_ROUTE`, `LOGS_ROUTE`, `IDENTITY_ROUTE` and `CHUNK_PREFIX` are all named, and this was spelled
// out in five places — `rpcUrl` (which claims in its own header to be "the one place that knows the path
// shape"), the router's classifier, `channelAuth`'s synthetic re-auth request, the OpenAPI document's
// advertised address, and the test app's proxy.
//
// The asymmetry showed up INSIDE single functions rather than across the codebase, which is the tell:
// `channelAuth` passes `${SOCKET_FACE_PREFIX}${socketName}` into the same argument slot of
// `reauthorize` that the line above passed a raw literal into, and the router matches sockets with
// `SOCKET_FACE_PREFIX` six lines below matching RPCs with a literal.
//
// It is the ADDRESS only. The four HTTP callers differ in their headers for real reasons — a bearer
// token means nothing in a browser, cookie-forwarding means nothing in the CLI — and `rpcUrl` states
// why those are deliberately not unified.
export const RPC_ROUTE_PREFIX = '/__abide/rpc/'
