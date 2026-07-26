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
import type { Socket } from '../socket.ts'
import { compose, type Middleware } from './middleware.ts'
import { type Principal, type RequestScope, type RouteKind, runInScope } from './requestScope.ts'
import type { AppConfig } from './router.ts'

// Identity + request resolved ONCE at the WS upgrade (cookie/bearer via the same ladder as HTTP)
// and carried on the connection for the life of the socket. Every `@rpc:` join re-authorizes
// against THIS identity, but for the args it presents on that specific subscribe frame.
export interface SocketConnectionData {
    request: Request
    identity: Principal
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

    const routes = config.routes ?? {}
    const route = routes[rpcName]
    // Only READ rpcs have cache channels; an absent route or a mutation cannot be joined.
    if (route === undefined || route.__rpc.read !== true) return false

    // ARGS-SPOOF DEFENSE: the presented args must be exactly the ones that name this channel.
    if (memoChannelName(rpcName, presentedArgs) !== channelName) return false

    const globalMiddleware = config.middleware ?? []
    const rpcMiddleware = route.__rpc.options.middleware ?? []
    return reauthorize('rpc', rpcName, `/__abide/rpc/${rpcName}`, presentedArgs, connData, [
        ...globalMiddleware,
        ...rpcMiddleware,
    ])
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
    // No per-room gate configured → connect-authed (today's behavior). The global chain already ran at
    // the WS upgrade; without socket `middleware` there is no per-room refinement to enforce.
    if (socketMiddleware.length === 0) return true
    const globalMiddleware = config.middleware ?? []
    return reauthorize(
        'socket-subscribe',
        socketName,
        `/__abide/sockets/${socketName}`,
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
    const scope: RequestScope = {
        request: syntheticRequest,
        cookies: new Bun.CookieMap(connData.request.headers.get('cookie') ?? ''),
        // Copy so a middleware `identity.set()` on one join cannot bleed into the next subscribe.
        identity: { ...connData.identity },
        bag: {},
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
        slots: new Map<string, unknown>(),
    }
    const chain = compose(middleware, () => AUTHORIZED_SENTINEL)
    const result = await runInScope(scope, chain)
    return result === AUTHORIZED_SENTINEL
}
