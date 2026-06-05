import type { AppModule } from '../server/AppModule.ts'
import { dispatchVerbInProcess } from '../server/rpc/dispatchVerbInProcess.ts'
import { findVerbByCommandName } from '../server/rpc/findVerbByCommandName.ts'
import type { VerbRegistryEntry } from '../server/rpc/types/VerbRegistryEntry.ts'
import { decodeResponse } from '../shared/decodeResponse.ts'

/*
Each property is a callable: invoking it decodes the body (and throws
HttpError on non-2xx, like a real remote call), while `.raw(args)` returns
the underlying Response untouched for status/header/streaming assertions.
*/
type TestInvoker = ((args?: unknown) => Promise<unknown>) & {
    raw: (args?: unknown) => Promise<Response>
}

type AnyApi = Record<string, TestInvoker>

/*
In-process client for tests. Like createClient's in-process mode it discovers
verbs from the registry (populated by the test's defineVerb calls) and routes
through dispatchVerbInProcess — same synthesize-and-fetch the CLI and MCP
surfaces use, so they can't drift on how a verb is invoked. Each call runs
inside runWithRequestScope, the same seam createServer crosses for a live
request, so request-scoped helpers behave identically to production — a fresh
per-request cache(), the cookie jar with Set-Cookie flush, request()/server()
resolution, and handleError/500 fallback on a throw.

`headers` pre-populates the synthetic Request (auth, cookies) for handlers that
read inbound identity; `app.handleError` lets a suite assert its custom error
response. No `url` — this never hits the network, so it needs the rpc modules
imported into the process, not a running server.
*/
export function createTestClient<Api extends AnyApi = AnyApi>(opts?: {
    baseUrl?: string
    headers?: HeadersInit
    app?: AppModule
}): Api {
    const baseUrl = opts?.baseUrl ?? 'http://localhost/'

    /*
    Fresh Headers per call: buildRpcRequest mutates it (sets content-type on
    body verbs), so a shared instance would leak that mutation across calls.
    */
    function send(entry: VerbRegistryEntry, args: unknown): Promise<Response> {
        return dispatchVerbInProcess({
            entry,
            args,
            baseUrl,
            headers: new Headers(opts?.headers),
            app: opts?.app,
        })
    }

    function buildInvoker(entry: VerbRegistryEntry): TestInvoker {
        const invoker = (async (args?: unknown) =>
            decodeResponse(await send(entry, args))) as TestInvoker
        invoker.raw = (args?: unknown) => send(entry, args)
        return invoker
    }

    // Memoise per-name so repeated accesses skip the registry scan + closure alloc.
    const invokerCache = new Map<string, TestInvoker | undefined>()

    return new Proxy({} as Api, {
        get(_target, prop): TestInvoker | undefined {
            if (typeof prop !== 'string') {
                return undefined
            }
            if (invokerCache.has(prop)) {
                return invokerCache.get(prop)
            }
            const entry = findVerbByCommandName(prop)
            const invoker = entry ? buildInvoker(entry) : undefined
            invokerCache.set(prop, invoker)
            return invoker
        },
    })
}
