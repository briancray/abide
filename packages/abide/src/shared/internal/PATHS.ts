// Every path abide serves is under one reserved prefix, and every path an app serves is not.
//
// One prefix rather than a convention per feature: an app author needs exactly one rule to know what
// is theirs, and an operator needs exactly one pattern to proxy, cache, CSP or exclude. `__` is the
// ordinary "not yours" signal and it cannot collide with a route segment anyone would write.
//
// The KIND is in the path even though the id after it is already unique, because the two are
// dispatched differently — a socket is a websocket upgrade, not a POST — and because a network panel
// showing `/__abide/rpc/users/getUser` says what happened without anyone decoding it.

export const ABIDE_PREFIX = '/__abide/'
export const RPC_PREFIX = `${ABIDE_PREFIX}rpc/`
export const SOCKET_PREFIX = `${ABIDE_PREFIX}socket/`

/**
 * The remote log feed. Not a prefix: it addresses one thing, and there is nothing under it — an id
 * here would name a second feed nobody asked for.
 */
export const LOGS_PATH = `${ABIDE_PREFIX}logs`

/**
 * Every endpoint's declared shape, as one document. Not a prefix either: it addresses the whole
 * catalogue, and a per-endpoint address under it would be a second way to ask the same question.
 */
export const SCHEMA_PATH = `${ABIDE_PREFIX}schema`

/**
 * The app's own account of whether it is working — one document, like the catalogue above it. Here
 * rather than in the server half because the CLIENT half of `health()` is what asks for it, and an
 * address only one side knows is an address the two can spell differently.
 */
export const HEALTH_PATH = `${ABIDE_PREFIX}health`

/**
 * Who the server resolved this caller to be. Here for the same reason `HEALTH_PATH` is: the CLIENT
 * half of `identity()` is what asks for it, and an address only one side knows is an address the two
 * can spell differently.
 */
export const IDENTITY_PATH = `${ABIDE_PREFIX}identity`

/**
 * Where a built client bundle is served FROM. A prefix, because a directory of hashed files is what
 * is under it.
 *
 * Here rather than beside the build that writes the directory, for the reason `HEALTH_PATH` is here:
 * this is the table of what abide has CLAIMED, and a segment claimed in some other file is one
 * `dispatch` cannot know is taken. Not `dispatch`'s to answer either — it is files on a disk rather
 * than an endpoint, so whatever mounts it does so in FRONT of the request pipeline.
 */
export const CLIENT_ROUTE = `${ABIDE_PREFIX}client/`

/** The query parameter carrying JSON args: a read's arguments, and a socket's room. */
export const ARGS_PARAM = 'a'
