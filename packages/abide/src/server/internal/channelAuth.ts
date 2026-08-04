// SECURITY-CRITICAL — channel-join authorization for `@rpc:` cache-invalidation channels
// (shared-cache-plan §2.3, rpc-core §8.4). A WS client may subscribe to a `(rpc,args)` cache
// channel ONLY if it passes the SAME gate that authorizes READING `(rpc,args)` over HTTP — we
// re-run that RPC's own middleware/identity chain, for those args, PER SUBSCRIBE.
//
// This is the explicit, documented exception to sockets.md S4.4 ("WS runs middleware only at
// connect"): the bare user-socket subscribe path stays connect-authed, but an `@rpc:` cache
// channel re-enters the middleware onion on every join, because middleware may enforce per-args
// row-level authorization (joining `profile:B` must re-run `profile`'s chain for `{id:B}`).
//
// THE ARGS-SPOOF HOLE (the single most important adversarial case): `canonicalKey(args)` is
// opaque/lossy — the channel name CANNOT be reversed back into `args`, so the middleware run has
// no args to authorize against unless the client sends them. The subscribe frame therefore
// carries the RAW `args`, and we VERIFY `memoChannelName(rpcName, presentedArgs) === channelName`
// before trusting them. Without this a client could name channel-for-A (whose data it wants) while
// presenting args-for-B (which its identity is allowed to read) and slip past the gate.

import { memoChannelName, RPC_CHANNEL_PREFIX } from '../../shared/internal/memoChannels.ts'
import { RPC_QUERY_PARAMS } from '../../shared/internal/RPC_QUERY_PARAMS.ts'
import { RPC_ROUTE_PREFIX } from '../../shared/internal/RPC_ROUTE_PREFIX.ts'
import { SOCKET_FACE_PREFIX } from '../../shared/internal/SOCKETS_ROUTE.ts'
import { TAG_CHANNEL_PREFIX } from '../../shared/internal/tagChannelName.ts'
import { log } from '../../shared/log.ts'
import type { Socket } from '../socket.ts'
import { routeFor } from './appConfig.ts'
import { compose, type Middleware } from './middleware.ts'
import { outcomeResponse } from './outcomeResponse.ts'
import { buildRegistry } from './registry.ts'
import {
    makeRequestScope,
    type Principal,
    type RequestScope,
    type RouteKind,
    runInScope,
} from './requestScope.ts'
import type { AppConfig } from './router.ts'
import { rpcChainFor } from './rpcChain.ts'
import { rpcsFor } from './surfaceProjection.ts'

// Identity + request resolved ONCE at the WS upgrade (cookie/bearer via the same ladder as HTTP)
// and carried on the connection for the life of the socket. Every `@rpc:` join re-authorizes
// against THIS identity, but for the args it presents on that specific subscribe frame.
export interface SocketConnectionData {
    request: Request
    identity: Principal
    // The bound server, so `reauthorize` can build a scope with the same `server()` the upgrade had.
    server: Bun.Server<undefined> | undefined
}

// A unique 200 Response that is returned ONLY when the composed chain reaches its terminal
// untouched (no middleware short-circuited). Identity comparison (`===`) — not a status check —
// decides pass/deny, so a middleware that happens to return its own 200 still counts as a DENY
// (fail-closed: anything other than THIS exact instance means the chain did not pass cleanly).
const AUTHORIZED_SENTINEL = new Response(null, { status: 200 })

// True for a reserved cache-broadcast channel name (`@rpc:<rpc>:<key>`). Bare user-socket names
// (config.sockets keys) never carry the `@` namespace, so they take the unchanged connect-authed
// path in the router.
export function isMemoChannel(name: string): boolean {
    return name.startsWith(RPC_CHANNEL_PREFIX)
}

// True for a reserved cache-TAG channel name (`@tag:<tag>`).
export function isTagChannel(name: string): boolean {
    return name.startsWith(TAG_CHANNEL_PREFIX)
}

// Decide whether a connection may join `@tag:<tag>`.
//
// The gate is DECLARATION, not per-identity authorization, and that is a deliberate choice about what
// this channel can actually leak. Unlike an `@rpc:` frame — which carries a value-form `publish`
// payload and therefore needs the full re-run of the rpc's read gate for the presented args — a tag
// frame carries ONLY a verb (`memoTags.ts` publishes `{ verb }` and nothing else). A subscriber learns
// "something tagged X was invalidated", then re-reads through the ordinary HTTP path, where its own
// identity is enforced exactly as always. So a join grants no data a client could not already fetch.
//
// What the gate DOES stop is probing: a tag must be declared by at least one browser-reachable READ
// rpc, so a client cannot fish for the existence or timing of a server-internal tag it was never meant
// to see. What it does NOT stop is one authenticated client learning the CHANGE TIMING of a tag
// declared on a read it is not itself permitted to fetch. If a tag name or its edit rhythm is itself
// sensitive, do not put it on a browser-reachable read.
export function authorizeTagJoin(channelName: string, config: AppConfig): boolean {
    if (!channelName.startsWith(TAG_CHANNEL_PREFIX)) return false
    const tag = channelName.slice(TAG_CHANNEL_PREFIX.length)
    if (tag === '') return false
    // Gated by DECLARATION rather than by the per-args middleware re-run an `@rpc:` join gets, because a
    // tag frame carries a verb and NO payload: the client re-reads over HTTP under its own identity, so
    // the join grants no data. It does reveal change-TIMING for any tag on a browser-reachable read —
    // see CLAUDE.md's `tags` note. Asking `rpcsFor(..., 'browser')` is the same reachability question
    // every other surface asks; what makes this one load-bearing is the argument above, not a different
    // predicate.
    for (const entry of rpcsFor(buildRegistry(config), 'browser')) {
        if (!entry.read) continue
        if (entry.tags?.includes(tag) === true) return true
    }
    return false
}

// Extract the rpc name from `@rpc:<rpc>:<canonicalKey>`. Returns undefined when the name is not a
// well-formed cache channel (no prefix, or no `:` after the rpc name).
function parseRpcName(channelName: string): string | undefined {
    if (!channelName.startsWith(RPC_CHANNEL_PREFIX)) return undefined
    const rest = channelName.slice(RPC_CHANNEL_PREFIX.length)
    const colon = rest.indexOf(':')
    if (colon <= 0) return undefined
    return rest.slice(0, colon)
}

// Decide whether `connData.identity` may join `channelName` while presenting `presentedArgs`.
// PASS iff: (1) the name resolves to a registered READ rpc, (2) the presented args actually NAME
// the channel (args-spoof defense), and (3) re-running that rpc's `compose(global, rpc.middleware)`
// with the connection's identity + presented args reaches the terminal without any middleware
// short-circuit. Any short-circuit Response (e.g. `error(403)`/`redirect`) ⇒ DENY.
export async function authorizeChannelJoin(
    channelName: string,
    presentedArgs: unknown,
    connData: SocketConnectionData,
    config: AppConfig,
): Promise<boolean> {
    const rpcName = parseRpcName(channelName)
    if (rpcName === undefined) return false

    const route = routeFor(config, rpcName)
    // Only READ rpcs have cache channels; an absent route or a mutation cannot be joined.
    if (route === undefined || route.__rpc.read !== true) return false

    // ARGS-SPOOF DEFENSE: the presented args must be exactly the ones that name this channel.
    if (memoChannelName(rpcName, presentedArgs) !== channelName) return false

    // BOTH rungs: a WS subscribe is not inside an HTTP request, so the global chain has not run for it.
    // Composed through the one shared definition (`rpcChainFor`) rather than spelled out here — this and
    // `createApp` used to state the same list independently, which is two places that had to agree about
    // something whose whole job is authorization.
    return reauthorize(
        'rpc',
        rpcName,
        `${RPC_ROUTE_PREFIX}${rpcName}`,
        presentedArgs,
        connData,
        rpcChainFor(route, config),
    )
}

// Decide whether `connData.identity` may join a USER SOCKET's room `roomArgs`. This is the socket
// analog of `authorizeChannelJoin`: opt-in per-room authorization via the socket's own `middleware`
// (auth.md; ADR 0023 rooms). A socket with NO `middleware` stays CONNECT-authed (returns true — any
// connected client may join any room, exactly as a middleware-less rpc is public); a socket WITH
// `middleware` re-enters `compose(global, socket.middleware)` for the room args on EVERY join, so
// per-room row-level auth is enforced (joining room `B` re-runs the chain for `{room:B}`).
//
// No args-spoof defense is needed here (unlike the `@rpc:` case): the room the client JOINS is exactly
// the args it presents, and it receives only that room's messages — there is no opaque channel-name
// hash to lie about. Auth runs on the same args the subscription is keyed by.
export async function authorizeSocketJoin(
    socketName: string,
    // biome-ignore lint/suspicious/noExplicitAny: existential socket registry — the per-socket message type is erased at the transport boundary.
    sock: Socket<any>,
    roomArgs: unknown,
    connData: SocketConnectionData,
    config: AppConfig,
): Promise<boolean> {
    const socketMiddleware = sock.__socket.options.middleware ?? []
    // No per-room gate configured → connect-authed. The global chain already ran at the WS upgrade
    // (`router.ts`, the `SOCKET_MUX_ROUTE` branch), so this caller has already passed the app's own
    // authorization; without socket `middleware` there is no per-room refinement left to enforce.
    //
    // That premise was written here before it was TRUE. The upgrade used to return before the chain was
    // composed, so no middleware ran for a WebSocket at all — and this line then admitted every
    // connect-authed socket to a caller the app's `requireLogin` had never seen. Whatever this returns
    // rests entirely on the connect gate existing; if that branch ever stops running the chain, this
    // `true` becomes an open door again.
    if (socketMiddleware.length === 0) return true
    const globalMiddleware = config.middleware ?? []
    return reauthorize(
        'socket-subscribe',
        socketName,
        `${SOCKET_FACE_PREFIX}${socketName}`,
        roomArgs,
        connData,
        [...globalMiddleware, ...socketMiddleware],
    )
}

// Shared re-auth core (rpc cache-channel + user-socket room). Rebuild the scope a normal request for
// `(name, presentedArgs)` would have run in — identity resolved at upgrade (same cookie/bearer ladder),
// args reachable both on the request URL query (`?__abide_args=` — where a handler's middleware reads
// them) AND in `route().params` — then run `chain` to its terminal. PASS iff nothing short-circuited
// (identity `===` on the sentinel, NOT a status check, so a middleware's own 200 still counts as DENY).
async function reauthorize(
    kind: RouteKind,
    name: string,
    path: string,
    presentedArgs: unknown,
    connData: SocketConnectionData,
    middleware: Middleware[],
): Promise<boolean> {
    const url = new URL(path, new URL(connData.request.url).origin)
    url.searchParams.set(RPC_QUERY_PARAMS.args, JSON.stringify(presentedArgs))
    const syntheticRequest = new Request(url, { method: 'GET', headers: connData.request.headers })
    // Built through the shared factory, so this scope has the SAME shape the router's does. It used to
    // be a second object literal that omitted `server`, `traceparent` and the identity flags — and this
    // gate fails closed on any throw, so a global middleware calling `server()` denied every join.
    const scope: RequestScope = makeRequestScope({
        request: syntheticRequest,
        cookies: new Bun.CookieMap(connData.request.headers.get('cookie') ?? ''),
        // Copy so a middleware `identity.set()` on one join cannot bleed into the next subscribe.
        identity: { ...connData.identity },
        route: {
            kind,
            name,
            params:
                presentedArgs !== null && typeof presentedArgs === 'object'
                    ? (presentedArgs as Record<string, unknown>)
                    : {},
            url,
            navigating: false,
        },
        server: connData.server,
        // A join is its own unit of work, so it joins the CONNECTION's trace when the upgrade carried
        // one rather than inventing an unrelated id.
        traceparent: connData.request.headers.get('traceparent') ?? undefined,
        identityStateless: false,
        identityExpiresAt: undefined,
    })
    const chain = compose(middleware, () => AUTHORIZED_SENTINEL)
    // A middleware short-circuits by THROWING (`error(403)`/`redirect(...)`), so a throw is a DENY, not a
    // crashed join — the sentinel comparison alone would let it escape and take the subscribe with it.
    // Fail CLOSED on any throw, deliberate or not: this is an authorization gate, and the safe reading of
    // "the chain did not reach its terminal" is that it did not authorize.
    let result: Response
    try {
        result = await runInScope(scope, chain)
    } catch (caught) {
        if (outcomeResponse(caught) === undefined)
            log.channel('abide:socket').error(`channel authorization threw for ${name}:`, caught)
        return false
    }
    return result === AUTHORIZED_SENTINEL
}
