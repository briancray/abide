// Reserved query-param names for the RPC read transport. Namespaced under `__abide_` so they can
// NEVER collide with a read handler's own arg fields, which now arrive as flat query params
// (`?key=beta`) coerced by the input schema. `args` still carries the canonical JSON-encoded args
// blob that machine callers emit (the browser proxy, the test app, MCP, channel-auth); `from` resumes
// a retained stream transcript. A read that carries `args` uses the blob verbatim; otherwise the
// router builds args from the remaining flat params.
export const RPC_QUERY_PARAMS = {
    args: '__abide_args',
    from: '__abide_from',
} as const
