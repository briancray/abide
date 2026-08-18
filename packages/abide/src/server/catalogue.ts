// What an app has DECLARED: id → declaration, and the same list as the document a machine reads.
//
// Split out of `registry.ts` because the two answer different questions and only one of them has
// clients. This is what EXISTS; `registry.ts` is how a request reaches it. The projections —
// `openapi.ts` and `mcp.ts` — are readers of this and of nothing else, so they import downward
// rather than back into the door that serves them.
//
// Nothing here is discovered by scanning the filesystem. The compiler appends a `register(...)` call
// to every transport module it loads, so a handler is reachable exactly when its module was imported
// — the same rule the runtime already follows for scoped `<style>` blocks.

import type { Channel, KeyedChannel } from '#shared/channel.ts'
import { type Declaration, type EndpointShape, EVERY_CLIENT } from '#shared/internal/shapes.ts'
import type { Kind, Rpc } from '#shared/transport.ts'
import { describeRpc, describeSocket, policyOf, socketPolicyOf } from './rpc.ts'

type AnyRpc = Rpc<unknown, unknown>
export type AnySocket = Channel<unknown> & KeyedChannel<unknown, unknown>

export const RPCS = new Map<string, AnyRpc>()
export const SOCKETS = new Map<string, AnySocket>()

/**
 * What the compiler appends to a transport module. Also the hand-written spelling — nothing stops an
 * app registering a declaration it built itself, which is what makes a demo of the seam possible.
 */
export function register(
    kind: Kind,
    entries: [id: string, name: string][],
    module: Record<string, unknown>,
    /**
     * What the compiler read off each declaration, by export name — its shapes, and whether its
     * syntax says the answer is a SEQUENCE.
     *
     * Absent when the module's types said nothing this could read, and absent entirely from a
     * hand-written `register` — so a shape is something an endpoint gains, never something it needs.
     */
    shapes?: Record<string, Declaration>,
): void {
    for (const [id, name] of entries) {
        const declared = module[name]
        if (declared === undefined) continue
        if (kind === 'rpc') {
            describeRpc(declared as object, id, shapes?.[name])
            RPCS.set(id, declared as AnyRpc)
        } else {
            describeSocket(declared as object, id, shapes?.[name])
            SOCKETS.set(id, declared as AnySocket)
        }
    }
}

/** Every address a lane has registered. What a test asks to prove the seam wired itself. */
export function registered(kind: Kind): string[] {
    return [...(kind === 'rpc' ? RPCS : SOCKETS).keys()]
}

/**
 * Every endpoint, as the document a machine reads BEFORE it calls one.
 *
 * This is what the whole shape story is for. An MCP tool definition is `{ name: id, description,
 * inputSchema: input }` and an OpenAPI operation is the same three facts under different names —
 * because the shape exists in a form other than a validator, which is why JSON Schema is what a
 * declaration MEANS rather than something abide converts to on the way out.
 *
 * `openapi.ts` and `mcp.ts` are those two projections, and what they add is not derivation but the
 * WIRE: which door a call arrives through, that a read spends its args one query parameter each, and
 * that a socket has two HTTP arms rather than a call. This function stays the one source both read,
 * so a fact learned here reaches both surfaces without either being edited.
 *
 * Sorted by address, so two runs of the same app produce the same document and a diff of one is a
 * diff of the API. MCP asks for that by name: a deterministic `tools/list` is what lets a client
 * cache it.
 */
export function endpoints(): EndpointShape[] {
    const all: EndpointShape[] = []
    for (const [id, rpc] of RPCS) {
        const policy = policyOf(rpc)
        all.push({
            id,
            kind: 'rpc',
            method: rpc.method,
            ...(rpc.description === undefined ? {} : { description: rpc.description }),
            // `declaredStreams`, not `streams`: the second decides the call path and is blind to a
            // framing, so publishing off it said "one value" about `() => jsonl(items())`.
            ...(policy?.declaredStreams === true ? { streams: true } : {}),
            ...(policy?.input == null ? {} : { input: policy.input }),
            ...(policy?.output == null ? {} : { output: policy.output }),
            clients: policy?.clients ?? EVERY_CLIENT,
        })
    }
    for (const [id, stream] of SOCKETS) {
        const policy = socketPolicyOf(stream)
        all.push({
            id,
            kind: 'socket',
            // A socket never ends, so it is the one endpoint whose `streams` is not worth saying: it
            // is true by construction, and a flag that is always true tells a reader nothing.
            ...(policy?.message == null ? {} : { input: policy.message }),
            ...(policy?.room == null ? {} : { room: policy.room }),
            // Said only when TRUE, like `streams` above: the ordinary socket speaks outward only, so
            // `clientPublish: false` on almost every one of them would be noise carrying no fact.
            ...(policy?.clientPublish ? { clientPublish: true } : {}),
            clients: policy?.clients ?? EVERY_CLIENT,
        })
    }
    all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return all
}
