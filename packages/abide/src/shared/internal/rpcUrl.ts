// The URL of an RPC over HTTP — the one place that knows the path shape and the query encoding.
//
// FOUR callers reach an abide RPC over HTTP, and they are genuinely different clients: the browser
// proxy (same-origin cookies, a trace header it declines to send cross-origin), the CLI (a bearer
// token, an `accept` it negotiates on), the in-process loopback door that MCP and `agent()` use
// (forwards the caller's cookie), and the hydration stream-resume. Their HEADERS differ for real
// reasons and are not unified here — a bearer token means nothing in a browser, cookie-forwarding means
// nothing in the CLI.
//
// What is NOT different is the address, and all four had restated it: the `/__abide/rpc/<name>` path,
// and the rule that a read's args ride as ONE JSON blob under the reserved `__abide_args` param
// (`encodeURIComponent(JSON.stringify(args))`) while a resume rides under `__abide_from`. That is a
// wire format — the router's `decodeQueryArgs` is its other half — so a fifth caller should not have to
// rediscover it, and a change to it should not have to be found in four places.
//
// `base` is a prefix, not necessarily an origin: the browser proxy passes `''` for a same-origin
// relative URL, the CLI and loopback pass a full origin. Both are handled by string-joining rather than
// `new URL(...)`, because an empty base has no origin to resolve against.

import { RPC_QUERY_PARAMS } from './RPC_QUERY_PARAMS.ts'
import { RPC_ROUTE_PREFIX } from './RPC_ROUTE_PREFIX.ts'

export interface RpcUrlOptions {
    // A READ's arguments, carried as the canonical JSON blob. Omit for a mutation (args go in the body)
    // or for a zero-arg read.
    args?: unknown
    // Resume a retained stream transcript from this chunk count (`?__abide_from=`).
    from?: number
}

export function rpcUrl(base: string, name: string, options: RpcUrlOptions = {}): string {
    const params: string[] = []
    if (options.from !== undefined) params.push(`${RPC_QUERY_PARAMS.from}=${options.from}`)
    if (options.args !== undefined) {
        params.push(`${RPC_QUERY_PARAMS.args}=${encodeURIComponent(JSON.stringify(options.args))}`)
    }
    const query = params.length === 0 ? '' : `?${params.join('&')}`
    return `${base}${RPC_ROUTE_PREFIX}${name}${query}`
}
