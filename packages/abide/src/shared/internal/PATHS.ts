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
 * What a client-side navigation puts on its request so the pages layer answers with the outlet alone
 * rather than the whole document.
 *
 * A HEADER rather than a path or a query, and that is the whole point: a navigation asks for the URL
 * it is actually navigating to, so it passes through the app's middleware onion with the same path,
 * the same cookies and the same request scope a full page load would have. A `/__abide/` address
 * would sit in FRONT of that chain — see `handle` — and an app's auth rung would never see it.
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
