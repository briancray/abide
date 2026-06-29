import { buildRpcRequest } from '../../shared/buildRpcRequest.ts'
import type { RemoteFunction } from '../../shared/types/RemoteFunction.ts'
import type { AppModule } from '../AppModule.ts'
import { runWithRequestScope } from '../runtime/runWithRequestScope.ts'

/*
Runs a rpc in-process: synthesizes the rpc Request from the remote's own
method + url and pipes it through remote.fetch — the same handler/validation/
error path the HTTP router uses, no network hop. The single in-process
dispatch every consumer surface (the CLI client and the MCP tool dispatcher)
routes through, so they can't drift on how a rpc is invoked.
Takes the RemoteFunction directly — invocation never reads the registry
entry's schemas/clients (validation is closed over inside the remote), so the
entry is not a dependency here. `baseUrl` gives the synthetic Request its
origin (handlers reading request.url see the caller's host); `headers` carries
forwarded auth/identity context.

Runs inside the runWithRequestScope seam createServer crosses for real
requests, so a handler sees an identical scope to a live HTTP request: a fresh
per-request cache, the cookie jar with Set-Cookie flush, request()/server()
resolution, and the app's handleError (or the 500 fallback) on a throw. The
synthesized Request is shared between the scope store and the handler fetch so
request() returns the same Request parseArgs read from.
*/
export function dispatchRpcInProcess({
    remote,
    args,
    baseUrl,
    headers,
    app,
}: {
    remote: RemoteFunction<unknown, unknown>
    args: unknown
    baseUrl: string
    headers?: Headers
    app?: AppModule
}): Promise<Response> {
    const request = buildRpcRequest({
        method: remote.method,
        url: remote.url,
        args,
        baseUrl,
        headers,
    })
    return runWithRequestScope(request, { app, logRequests: false }, () => remote.fetch(request))
}
