import { buildRpcRequest } from '../../shared/buildRpcRequest.ts'
import { createRemoteFunction } from '../../shared/createRemoteFunction.ts'
import { forwardHeaders } from '../../shared/forwardHeaders.ts'
import { isReadOnlyMethod } from '../../shared/isReadOnlyMethod.ts'
import { resolveClientFlags } from '../../shared/resolveClientFlags.ts'
import type { ClientFlags } from '../../shared/types/ClientFlags.ts'
import type { HttpVerb } from '../../shared/types/HttpVerb.ts'
import type { RemoteFunction } from '../../shared/types/RemoteFunction.ts'
import type { StandardSchemaV1 } from '../../shared/types/StandardSchemaV1.ts'
import { json } from '../json.ts'
import { requestContext } from '../runtime/requestContext.ts'
import { parseArgs } from './parseArgs.ts'
import { registerVerb } from './registerVerb.ts'
import type { RemoteHandler } from './types/RemoteHandler.ts'

/*
Builds a RemoteFunction from an HTTP verb + RPC URL + handler. The bundler
rewrites every `export const VERB = handler(fn)` inside an `$rpc/**` module
so the verb (from the export name) and the URL (from the file path under
`src/server/rpc/`, with `/rpc/` prefix) are threaded into defineVerb.

The plain call (`fn(args)`) resolves to the Content-Type-decoded body;
non-2xx responses throw HttpError. `.raw(args)` returns the underlying
Response for callers that need status/headers/body streaming.
`.fetch(req)` is the dispatch hook the framework's router uses to
invoke the handler from an incoming HTTP request (with args parsed off
the Request via parseArgs).

Every raw invocation records the synthesized Request against the returned
promise so cache() can stash it on the entry without re-building.
*/
export function defineVerb<Args, Return>(
    method: HttpVerb,
    url: string,
    handler: RemoteHandler<Args, Return>,
    opts?: {
        inputSchema?: StandardSchemaV1
        outputSchema?: StandardSchemaV1
        filesSchema?: StandardSchemaV1
        clients?: Partial<ClientFlags>
        crossOrigin?: boolean
    },
): RemoteFunction<Args, Return> {
    const inputSchema = opts?.inputSchema
    const outputSchema = opts?.outputSchema
    const filesSchema = opts?.filesSchema
    /*
    An input schema makes the handler safe to advertise to non-browser
    surfaces. CLI flips on for any verb with one (a human/script invokes it
    deliberately). MCP only auto-exposes read-only verbs (GET/HEAD) — a
    model shouldn't be able to mutate/delete just because the handler
    carries a schema, so mutating verbs require an explicit clients.mcp.
    Explicit `clients` always wins.
    */
    const hasSchema = inputSchema !== undefined
    const clients = resolveClientFlags(opts?.clients, {
        mcp: hasSchema && isReadOnlyMethod(method),
        cli: hasSchema,
    })

    function buildRequest(args: Args | undefined): Request {
        const store = requestContext.getStore()
        const baseUrl = store ? store.url.href : 'http://localhost/'
        const headers = store ? forwardHeaders(store.req.headers) : new Headers()
        return buildRpcRequest({ method, url, args, baseUrl, headers })
    }

    /*
    Handler bodies may throw synchronously (e.g. an `assert(...)` at the
    top of the function). The `async function` wrapper coerces both sync
    throws and returned non-promises into the Promise<Response> shape
    callers expect, so an SSR caller's `await` always sees the rejection
    through the cache layer's snapshot boundary instead of the error
    escaping the request scope.
    */
    async function runHandler(args: Args | undefined): Promise<Response> {
        return handler(args as Args) as unknown as Response
    }

    /*
    Validates the parsed args against inputSchema (text fields), then — when the
    verb declares filesSchema — validates the File parts parseArgs split onto
    the request store and merges them into the args bag the handler receives.
    Either schema's issues become a 422. Files stay out of inputSchema so its
    JSON-Schema projection (OpenAPI/MCP/CLI) never has to model a binary.
    */
    async function validateThenHandle(args: Args | undefined): Promise<Response> {
        let value: unknown = args
        if (inputSchema) {
            const result = await inputSchema['~standard'].validate(value)
            if (result.issues) {
                return json({ issues: result.issues }, { status: 422 })
            }
            value = result.value
        }
        if (filesSchema) {
            const files = requestContext.getStore()?.files ?? {}
            const result = await filesSchema['~standard'].validate(files)
            if (result.issues) {
                return json({ issues: result.issues }, { status: 422 })
            }
            value = { ...(value as object), ...(result.value as object) }
        }
        return runHandler(value as Args)
    }

    /*
    `getRequest` is unused on the server path — handlers receive parsed
    `args` directly and reach the inbound Request via `request()`.
    createRemoteFunction passes a thunk so the client side can lazily
    synthesize its Request without forcing the server to allocate one per
    SSR call.
    */
    function invoke(args: Args | undefined): Promise<Response> {
        return inputSchema || filesSchema ? validateThenHandle(args) : runHandler(args)
    }

    const remote = createRemoteFunction<Args, Return>({
        method,
        url,
        clients,
        crossOrigin: opts?.crossOrigin,
        buildRequest,
        invoke,
        parseArgsForFetch: (request) => parseArgs(method, request) as Promise<Args | undefined>,
    })
    registerVerb({
        remote: remote as RemoteFunction<unknown, unknown>,
        inputSchema,
        outputSchema,
        filesSchema,
        clients,
    })
    return remote
}
