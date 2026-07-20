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
// carries the RAW `args`, and we VERIFY `cacheChannelName(rpcName, presentedArgs) === channelName`
// before trusting them. Without this a client could name channel-for-A (whose data it wants) while
// presenting args-for-B (which its identity is allowed to read) and slip past the gate.

import { cacheChannelName } from './cacheChannels.ts'
import { compose } from './middleware.ts'
import type { AppConfig } from './router.ts'
import { type Principal, type RequestScope, runInScope } from './scope.ts'

// Identity + request resolved ONCE at the WS upgrade (cookie/bearer via the same ladder as HTTP)
// and carried on the connection for the life of the socket. Every `@rpc:` join re-authorizes
// against THIS identity, but for the args it presents on that specific subscribe frame.
export interface SocketConnectionData {
    request: Request
    identity: Principal
}

const RPC_CHANNEL_PREFIX = '@rpc:'

// A unique 200 Response that is returned ONLY when the composed chain reaches its terminal
// untouched (no middleware short-circuited). Identity comparison (`===`) — not a status check —
// decides pass/deny, so a middleware that happens to return its own 200 still counts as a DENY
// (fail-closed: anything other than THIS exact instance means the chain did not pass cleanly).
const AUTHORIZED_SENTINEL = new Response(null, { status: 200 })

// True for a reserved cache-broadcast channel name (`@rpc:<rpc>:<key>`). Bare user-socket names
// (config.sockets keys) never carry the `@` namespace, so they take the unchanged connect-authed
// path in the router.
export function isCacheChannel(name: string): boolean {
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
    if (cacheChannelName(rpcName, presentedArgs) !== channelName) return false

    // Reconstruct the scope the HTTP GET read of `(rpcName, presentedArgs)` would have run in:
    // identity resolved at upgrade (same cookie/bearer ladder), args reachable both on the request
    // URL query (`?args=` — where a read handler's middleware reads them) AND in route().params.
    const rpcUrl = new URL(`/rpc/${rpcName}`, new URL(connData.request.url).origin)
    rpcUrl.searchParams.set('args', JSON.stringify(presentedArgs))
    const syntheticRequest = new Request(rpcUrl, {
        method: 'GET',
        headers: connData.request.headers,
    })
    const scope: RequestScope = {
        request: syntheticRequest,
        cookies: new Bun.CookieMap(connData.request.headers.get('cookie') ?? ''),
        // Copy so a middleware `identity.set()` on one join cannot bleed into the next subscribe.
        identity: { ...connData.identity },
        bag: {},
        route: {
            kind: 'rpc',
            name: rpcName,
            params:
                presentedArgs !== null && typeof presentedArgs === 'object'
                    ? (presentedArgs as Record<string, unknown>)
                    : {},
            url: rpcUrl,
            navigating: false,
        },
        cache: new Map<string, unknown>(),
    }

    const globalMiddleware = config.middleware ?? []
    const rpcMiddleware = route.__rpc.options.middleware ?? []
    const chain = compose([...globalMiddleware, ...rpcMiddleware], () => AUTHORIZED_SENTINEL)

    const result = await runInScope(scope, chain)
    return result === AUTHORIZED_SENTINEL
}
