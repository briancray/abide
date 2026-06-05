import { buildRpcRequest } from '../../shared/buildRpcRequest.ts'
import type { AppModule } from '../AppModule.ts'
import { runWithRequestScope } from '../runtime/runWithRequestScope.ts'
import type { VerbRegistryEntry } from './types/VerbRegistryEntry.ts'

/*
Runs a registered verb in-process: synthesizes the rpc Request from the
entry's own method + url and pipes it through entry.remote.fetch — the
same handler/validation/error path the HTTP router uses, no network hop.
The single in-process dispatch every registry-backed consumer surface (the
CLI client, the MCP tool dispatcher, and the test client) routes through, so
they can't drift on how a verb is invoked. `baseUrl` gives the synthetic
Request its origin (handlers reading request.url see the caller's host);
`headers` carries forwarded auth/identity context.

Runs inside the runWithRequestScope seam createServer crosses for real
requests, so a handler sees an identical scope to a live HTTP request: a fresh
per-request cache, the cookie jar with Set-Cookie flush, request()/server()
resolution, and the app's handleError (or the 500 fallback) on a throw. The
synthesized Request is shared between the scope store and the handler fetch so
request() returns the same Request parseArgs read from.
*/
export function dispatchVerbInProcess({
    entry,
    args,
    baseUrl,
    headers,
    app,
}: {
    entry: VerbRegistryEntry
    args: unknown
    baseUrl: string
    headers?: Headers
    app?: AppModule
}): Promise<Response> {
    const request = buildRpcRequest({
        method: entry.remote.method,
        url: entry.remote.url,
        args,
        baseUrl,
        headers,
    })
    return runWithRequestScope(request, { app, logRequests: false }, () =>
        entry.remote.fetch(request),
    )
}
