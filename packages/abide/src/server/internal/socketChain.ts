// THE SOCKET CHAIN RUNG — which middleware authorizes a socket operation, per DOOR.
//
// `rpcChain.ts` exists because the rpc rung selection "used to be spelled out at both sites
// independently, which is two places that had to agree about a list whose whole job is authorization."
// The socket side had FOUR spellings and THREE different answers, each justified by a paragraph in a
// different module, and nothing tying them together:
//
//   • `router.ts`'s `socketPolicy`      — both rungs, as a literal spread
//   • `channelAuth.authorizeSocketJoin` — both rungs, but only when the socket declares its own; with
//                                         none it returns `true` outright
//   • `mcp.ts`'s `<name>_tail`/`_publish` — the own rung alone
//   • `socketMux`'s SSE subscribe        — no `authorize*` call at all; it relies on the router having
//                                         composed `socketPolicy` upstream
//
// So "what authorizes a socket subscribe" was a four-file tour. The three answers are all CORRECT and
// they are not the same, which is exactly why they belong in one place where they can be read against
// each other rather than discovered one module at a time.

import type { Socket } from '../socket.ts'
import type { AppConfig } from './appConfig.ts'
import type { Middleware } from './middleware.ts'

// Which door a socket operation arrived through. The differences between them are about WHAT HAS
// ALREADY RUN, not about what the socket declared — which is why this is a parameter and not three
// functions.
export type SocketDoor =
    // The per-socket HTTP face (`/__abide/sockets/<name>`, SSE subscribe / POST publish). An ordinary
    // HTTP request: nothing has run, so it owes both rungs. Pre-derived per socket at boot by
    // `deriveRouterPolicy`, because the merged list is a constant.
    | 'http-face'
    // A room subscribe/publish over the WS mux. The GLOBAL rung already ran at the upgrade
    // (`handleRequest`'s `SOCKET_MUX_ROUTE` branch), so this door is re-authorizing for the ROOM ARGS,
    // which the connection could not carry — one connection holds many rooms.
    | 'ws-join'
    // An MCP tool call. MCP arrives over HTTP, so the router already ran the global chain for this
    // request; re-running it here would double-count a page's reads in a rate limiter, for the same
    // reason `rpcChainFor` gives.
    | 'mcp'

// CONNECT-AUTHED: this door has nothing left to enforce, because what already ran is the whole of the
// authorization this socket declares. Distinct from an EMPTY chain, and the distinction is the reason
// this is not just `Middleware[]`: an empty chain still runs its terminal inside a synthesized scope,
// while this says not to bother — and only `ws-join` can ever answer it.
//
// Whatever this admits rests ENTIRELY on the connect gate existing. That premise was once written down
// before it was true: the upgrade used to return before the chain was composed, so no middleware ran for
// a WebSocket at all, and an app whose only global middleware was `requireLogin` answered an anonymous
// rpc with 401 while admitting the same anonymous caller to every socket subscribe. If
// `handleRequest`'s upgrade branch ever stops running the global chain, this becomes an open door again.
export const CONNECT_AUTHED = undefined

// THE OWN RUNG — the socket's own `middleware`, which is the per-ROOM refinement. One definition, so
// the three doors cannot come to disagree about what "the socket's own middleware" is.
function ownMiddlewareFor(
    // biome-ignore lint/suspicious/noExplicitAny: existential socket registry — the per-socket message type is erased at the transport boundary.
    sock: Socket<any>,
): Middleware[] {
    return sock.__socket.options.middleware ?? []
}

function merge(global: Middleware[], own: Middleware[]): Middleware[] {
    // Allocate only when both rungs are non-empty, matching `rpcChainFor`.
    if (own.length === 0) return global
    if (global.length === 0) return own
    return [...global, ...own]
}

// Overloaded on the DOOR, because `CONNECT_AUTHED` is not a possibility every door has: only a
// `ws-join` sits behind a gate that has already authorized the caller, so only a `ws-join` can be told
// there is nothing left to enforce. Declaring one union return would push a `| undefined` onto the two
// call sites that can never receive it — which reads as "handle this case" where the honest answer is
// that the case does not exist.
export function socketChainFor(
    // biome-ignore lint/suspicious/noExplicitAny: existential socket registry — the per-socket message type is erased at the transport boundary.
    sock: Socket<any>,
    config: AppConfig,
    door: 'ws-join',
): Middleware[] | typeof CONNECT_AUTHED
export function socketChainFor(
    // biome-ignore lint/suspicious/noExplicitAny: existential socket registry — the per-socket message type is erased at the transport boundary.
    sock: Socket<any>,
    config: AppConfig,
    door: 'http-face' | 'mcp',
): Middleware[]
export function socketChainFor(
    // biome-ignore lint/suspicious/noExplicitAny: existential socket registry — the per-socket message type is erased at the transport boundary.
    sock: Socket<any>,
    config: AppConfig,
    door: SocketDoor,
): Middleware[] | typeof CONNECT_AUTHED {
    const own = ownMiddlewareFor(sock)
    const global = config.middleware ?? []
    switch (door) {
        case 'http-face':
            return merge(global, own)
        case 'ws-join':
            // No per-room gate declared → nothing to refine; the connect gate is the authorization.
            return own.length === 0 ? CONNECT_AUTHED : merge(global, own)
        case 'mcp':
            return own
    }
}
