// callOwnRpc — call one of THIS app's rpcs over its OWN HTTP face, from inside the process.
//
// The machine surfaces dispatch this way rather than invoking the rpc callable, because the callable is
// only the HANDLER. `schemas.input` validation and the rpc's own `middleware` are both composed by the
// ROUTER — the validate step ahead of `dispatch`, and `routePolicy` at mount — so an in-process call has
// NEITHER. For a caller that is a model choosing what to invoke, with args it wrote itself, that is the
// difference between "reachability, not authorization" and no authorization at all.
//
// One loopback request means the whole chain applies verbatim — CSRF, CORS, identity, middleware, input
// validation, the memo, the run deadline, output shaping — with no second copy of any of it living here.
// `abide compile`'s self-hosting REPL already makes this trade for exactly this reason: it "calls it over
// HTTP, not in-process, so middleware/identity/CSRF/validation/memo/deadline all apply".
//
// `credentials` is the request whose identity this call inherits — the incoming MCP request, or the
// request scope an `agent()` run happens to sit inside. Absent (a cron tick, an `abide run` script), the
// call goes out anonymous, which is the fail-closed answer; there is no ambient elevation to a principal
// nobody presented.

import { outgoingTraceparent } from '../../shared/internal/outgoingTraceparent.ts'
import { rpcUrl } from '../../shared/internal/rpcUrl.ts'

// The three fields of an `RpcEntry` this needs. Named structurally so a caller can pass a registry entry
// straight through without the module reaching for the registry's whole type graph.
export interface OwnRpcTarget {
    name: string
    method: string
    read: boolean
}

export function callOwnRpc(
    rpc: OwnRpcTarget,
    args: unknown,
    base: string | URL,
    credentials: Request | undefined,
): Promise<Response> {
    const headers = new Headers()
    if (credentials !== undefined) {
        const authorization = credentials.headers.get('authorization')
        if (authorization !== null) headers.set('authorization', authorization)
        const cookie = credentials.headers.get('cookie')
        if (cookie !== null) headers.set('cookie', cookie)
    }
    // A CHILD span of whatever is calling (CO2.3, the caller-names-the-span rule the browser proxy
    // follows): the tool call's server work joins the trace of the request that provoked it instead of
    // starting an orphan one. Undefined outside any scope — then no header, and the router mints.
    const traceparent = outgoingTraceparent()
    if (traceparent !== undefined) headers.set('traceparent', traceparent)

    const encoded = JSON.stringify(args ?? {})
    // Path + query via the shared `rpcUrl`, so this door and the browser proxy cannot disagree about the
    // form the router decodes. It is built ROOT-RELATIVE and then resolved against `base` — `base` here
    // is an origin (possibly a `URL`), and string-joining it would double the slash.
    const target = new URL(
        rpc.read ? rpcUrl('', rpc.name, { args: args ?? {} }) : rpcUrl('', rpc.name),
        base,
    )
    if (rpc.read) {
        return fetch(target, { method: rpc.method, headers })
    }
    // `application/json` is what clears the AU8 CSRF gate for a mutation. The DECLARED method, never a
    // hardcoded POST — the router enforces the declaration with a 405, so a PUT/PATCH/DELETE rpc is
    // otherwise simply unreachable through this door.
    headers.set('content-type', 'application/json')
    return fetch(target, { method: rpc.method, headers, body: encoded })
}
