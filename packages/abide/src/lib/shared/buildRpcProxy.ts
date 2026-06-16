import { decodeResponse } from './decodeResponse.ts'
import type { RpcInvoker } from './types/RpcInvoker.ts'

/*
Builds the name→callable proxy every RPC client surface shares (the CLI client,
the test harness). The caller supplies `resolveSend`, the one part that differs:
it maps a command name to the closure that issues that command's wire call, or
undefined for an unknown name. This module owns the invariant — a plain call
decodes the body (decodeResponse throws HttpError on non-2xx), `.raw` returns the
untouched Response — so the two surfaces can't drift from each other or from the
remote-function path they mirror.

Each name resolves once: the per-name invoker (or its absence) is memoised, since
the underlying registry/manifest is fixed for a client's lifetime, so repeated
`client.foo` accesses skip both the resolve and a fresh closure allocation.
*/
export function buildRpcProxy<Api extends object>(
    resolveSend: (name: string) => ((args?: unknown) => Promise<Response>) | undefined,
): Api {
    const invokerCache = new Map<string, RpcInvoker | undefined>()
    return new Proxy({} as Api, {
        get(_target, prop): RpcInvoker | undefined {
            if (typeof prop !== 'string') {
                return undefined
            }
            // Caches undefined too, so an unknown name resolves once, not per access.
            return invokerCache.getOrInsertComputed(prop, () => {
                const send = resolveSend(prop)
                if (!send) {
                    return undefined
                }
                const invoker = (async (args?: unknown) =>
                    decodeResponse(await send(args))) as RpcInvoker
                invoker.raw = (args?: unknown) => send(args)
                return invoker
            })
        },
    })
}
