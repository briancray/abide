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
 * The same catalogue as an OpenAPI 3.1 document — one address, like the schema above it.
 *
 * `.json` on the end where nothing else here carries an extension, because this one is READ BY TOOLS
 * that key off it: a generator handed a URL with no extension guesses, and every one of them guesses
 * differently. It is the one path abide serves whose consumer is somebody else's program.
 */
export const OPENAPI_PATH = `${ABIDE_PREFIX}openapi.json`

/**
 * The MCP surface — one JSON-RPC endpoint, which is what the protocol's streamable HTTP transport is.
 *
 * Not a prefix: every method travels in the BODY as `{"method": "tools/call"}`, so there is nothing
 * under it to address. That is also why it is a single `POST` where the rest of `/__abide/` is REST —
 * the shape is the protocol's, not abide's.
 */
export const MCP_PATH = `${ABIDE_PREFIX}mcp`

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

/**
 * `abide dev`'s reload client, which is a FILE rather than an inline `<script>` in the shell's head.
 *
 * The document is served under the app's own policy, and `csp()`'s `script-src` carries no
 * `'unsafe-inline'`: abide stamps the inline output it writes per RENDER with that request's nonce,
 * where a dev client lives in a shell head cut once at boot and has no nonce to carry. A script from
 * this origin is `'self'` — already allowed by any policy that allows the bundle — so the head names
 * one instead.
 *
 * Claimed here for the reason `CLIENT_ROUTE` is, and answered the same way: in FRONT of the request
 * pipeline, by the command that serves it.
 */
export const RELOAD_PATH = `${ABIDE_PREFIX}reload.js`

/**
 * The ESCAPE HATCH parameter, carrying every argument as one JSON value.
 *
 * A read's arguments are ordinarily one query parameter EACH — `?id=7&q=ada` — because the URL is
 * the public face of a call: it is what curl types, what an OpenAPI client generates, what a network
 * panel shows and what an intermediary keys a cache on. This is what carries the rest: args that are
 * not an object at all, so there is no name to put them under, and the multipart field beside a file.
 *
 * Spelled in full, the way `__abide_file` is: the name has to be one no app would write, because a
 * caller's own argument called `a` — or `args` — would otherwise be read as the hatch and swallow
 * the whole call.
 */
export const ARGS_PARAM = '__abide_args'

/**
 * How many messages an HTTP tail takes before the response ENDS.
 *
 * A socket is a stream that never ends, which is the right answer for a browser holding the
 * connection open and a useless one for anything that has to RETURN — a generated client, a `curl`,
 * an MCP tool call. So the bound is the caller's, said per request, and absent means what a socket
 * has always meant: keep the connection and keep writing.
 *
 * Spelled in full for the reason `__abide_args` is: everything else on this query string is the ROOM,
 * so a name an app might write as a room member would be swallowed. It comes off the parameters
 * before the room is decoded, and is therefore never part of the address a subscriber resolves to.
 */
export const TAIL_PARAM = '__abide_tail'

/**
 * ms an HTTP tail waits for the NEXT message before the response ends.
 *
 * The other half of the bound, and it is needed because the two questions are different: `__abide_tail`
 * is how much is enough, this is how long to wait for it. A count alone blocks forever on a quiet
 * room — the transcript runs out and the count is never reached — which reads to a caller as a hang
 * rather than as the empty answer it is.
 *
 * Absent means what a socket has always meant: wait, indefinitely. That is right for the browser
 * holding a connection open and wrong for everything that has to return, so the callers that have to
 * return are the ones that say so.
 */
export const WAIT_PARAM = '__abide_wait'

/**
 * What a client-side navigation puts on its request so the pages layer answers with the outlet alone
 * rather than the whole document.
 *
 * A HEADER rather than a path or a query, and that is the whole point: a navigation asks for the URL
 * it is actually navigating to, so it passes through the app's middleware onion AT THAT PATH, with
 * the same cookies and the same request scope a full page load would have. A `/__abide/` address
 * would run the onion at an address that is not the one being navigated to, so every rung deciding
 * by path — an auth rung above all — would answer about the wrong page.
 *
 * It also has to reach `Vary`, because two callers asking for one URL get two different bodies.
 */
export const NAVIGATION_HEADER = 'x-abide-navigation'

/**
 * The route the client is LEAVING, so the server can skip the layouts it is already showing.
 *
 * A route NAME — the pattern, not the path — because that is what a layout stack hangs off, and it is
 * the only thing the server needs to compare. It is a HINT and is treated as one: the answer is a
 * smaller fragment, so a client that lies about where it is gets markup missing the layouts it
 * claimed to have, and nothing else. Every rung of the onion still runs, at the target url, exactly
 * as it does without this.
 */
export const NAVIGATION_FROM_HEADER = 'x-abide-navigation-from'

/**
 * How many layouts the answer LEFT OFF, which is what says where the client has to put it.
 *
 * Written by the server rather than assumed by the client, because the server is what decided: the
 * two route entries it compared are the ones it has, and a client computing the same number from its
 * own table would be a second implementation of one rule to keep in step.
 */
export const NAVIGATION_DEPTH_HEADER = 'x-abide-navigation-depth'
