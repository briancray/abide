import { abideLog } from '../../shared/abideLog.ts'
import { buildRpcRequest } from '../../shared/buildRpcRequest.ts'
import { createRemoteFunction } from '../../shared/createRemoteFunction.ts'
import { forwardHeaders } from '../../shared/forwardHeaders.ts'
import { isReadOnlyMethod } from '../../shared/isReadOnlyMethod.ts'
import { resolveClientFlags } from '../../shared/resolveClientFlags.ts'
import type { ClientFlags } from '../../shared/types/ClientFlags.ts'
import type { ErrorSpec } from '../../shared/types/ErrorSpec.ts'
import type { HttpMethod } from '../../shared/types/HttpMethod.ts'
import type { RemoteFunction } from '../../shared/types/RemoteFunction.ts'
import type { StandardSchemaV1 } from '../../shared/types/StandardSchemaV1.ts'
import { json } from '../json.ts'
import { requestContext } from '../runtime/requestContext.ts'
import { buildErrorConstructors } from './buildErrorConstructors.ts'
import { fieldErrorsFromIssues } from './fieldErrorsFromIssues.ts'
import { parseArgs } from './parseArgs.ts'
import { registerRpc } from './registerRpc.ts'
import { runWithRpcTimeout } from './runWithRpcTimeout.ts'
import type { RemoteHandler } from './types/RemoteHandler.ts'

/*
Stash for the per-request AbortController a timed verb composes into the
inbound signal — read back in invoke's deadline callback to fire it. Lives on
the scope's Request (one verb per .fetch — network or in-process dispatch) so
an SSR pass's many in-process cache reads, which call invoke() directly and
never reach parseArgsForFetch, can't cross-cancel.
*/
const RPC_TIMEOUT_ABORT = Symbol('abideVerbTimeoutAbort')

/* Verb dispatch + validation spans, opt-in via DEBUG=abide:rpc. Reveals an
   in-process RPC→RPC call (same request scope, same trace) as a nested span. */
const rpcLog = abideLog.channel('abide:rpc')

/*
Builds a RemoteFunction from an HTTP verb + RPC URL + handler. The bundler
rewrites every `export const VERB = handler(fn)` inside an `$rpc/**` module
so the verb (from the export name) and the URL (from the file path under
`src/server/rpc/`, with `/rpc/` prefix) are threaded into defineRpc.

The plain call (`fn(args)`) resolves to the Content-Type-decoded body;
non-2xx responses throw HttpError. `.raw(args)` returns the underlying
Response for callers that need status/headers/body streaming.
`.fetch(req)` is the dispatch hook the framework's router uses to
invoke the handler from an incoming HTTP request (with args parsed off
the Request via parseArgs).

Every raw invocation records the synthesized Request against the returned
promise so cache() can stash it on the entry without re-building.
*/
// @documentation plumbing
export function defineRpc<Args, Return>(
    method: HttpMethod,
    url: string,
    handler: RemoteHandler<Args, Return>,
    opts?: {
        inputSchema?: StandardSchemaV1
        outputSchema?: StandardSchemaV1
        filesSchema?: StandardSchemaV1
        errors?: ErrorSpec
        clients?: Partial<ClientFlags>
        crossOrigin?: boolean
        /* Per-verb cap on actual received body bytes (413 past it); omitted = Bun's server-wide maxRequestBodySize. */
        maxBodySize?: number
        /* Per-verb handler deadline (ms): a 504 once exceeded, on every surface (SSR/MCP/CLI/network). */
        timeout?: number
    },
): RemoteFunction<Args, Return> {
    const timeout = opts?.timeout
    const inputSchema = opts?.inputSchema
    const outputSchema = opts?.outputSchema
    const filesSchema = opts?.filesSchema
    /* The declared error constructors handed to the handler as its `{ errors }` ctx. */
    const errors = buildErrorConstructors(opts?.errors ?? {})
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
        return rpcLog.trace(
            `rpc ${method} ${url}`,
            () => handler(args as Args, { errors }) as unknown as Response,
        )
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
            const result = await rpcLog.trace(`validate ${url}`, () =>
                inputSchema['~standard'].validate(value),
            )
            if (result.issues) {
                return json(
                    {
                        $abideError: 'validation',
                        data: {
                            issues: result.issues,
                            errors: fieldErrorsFromIssues(result.issues),
                        },
                    },
                    { status: 422 },
                )
            }
            value = result.value
        }
        if (filesSchema) {
            const files = requestContext.getStore()?.files ?? {}
            const result = await filesSchema['~standard'].validate(files)
            if (result.issues) {
                return json(
                    {
                        $abideError: 'validation',
                        data: {
                            issues: result.issues,
                            errors: fieldErrorsFromIssues(result.issues),
                        },
                    },
                    { status: 422 },
                )
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
    /* Abort the controller parseArgsForFetch stashed on store.req; a no-op when none was stashed (SSR cache reads). */
    function abortVerbTimeout(): void {
        const req = requestContext.getStore()?.req as
            | (Request & { [RPC_TIMEOUT_ABORT]?: AbortController })
            | undefined
        req?.[RPC_TIMEOUT_ABORT]?.abort(new DOMException('handler timeout', 'TimeoutError'))
    }

    function invoke(args: Args | undefined): Promise<Response> {
        const work = inputSchema || filesSchema ? validateThenHandle(args) : runHandler(args)
        if (timeout === undefined) {
            return work
        }
        /*
        On the deadline, fire the controller parseArgsForFetch composed into
        request().signal (absent on the SSR cache-read path, so a sibling
        verb's outbound fetch is never cancelled) — then 504.
        */
        return runWithRpcTimeout(work, timeout, abortVerbTimeout)
    }

    const remote = createRemoteFunction<Args, Return>({
        method,
        url,
        clients,
        crossOrigin: opts?.crossOrigin,
        buildRequest,
        invoke,
        parseArgsForFetch: async (request) => {
            const args = await parseArgs(method, request, opts?.maxBodySize)
            /*
            Compose this verb's deadline into request().signal so a handler's
            fetch(ext, { signal: request().signal }) is cancelled when the
            timeout fires — not just abandoned. Applied after parseArgs onto the
            scope's *final* request: a maxBodySize verb swaps store.req for a
            buffered copy (readBodyWithinLimit) and an app.handle hook may
            rewrite it, so composing onto the inbound `request` would leave
            request() — and abortVerbTimeout, which reads store.req — pointed at
            an un-cancellable signal. Only the signal is shadowed; the body
            stays readable. The store always exists here (network + in-process
            dispatch both run inside runWithRequestScope); SSR cache reads call
            invoke() directly, never this path, so a sibling verb is never
            cross-cancelled.
            */
            if (timeout !== undefined) {
                const req = requestContext.getStore()?.req
                if (req) {
                    const controller = new AbortController()
                    const composed = AbortSignal.any([req.signal, controller.signal])
                    Object.defineProperty(req, 'signal', { value: composed, configurable: true })
                    Object.defineProperty(req, RPC_TIMEOUT_ABORT, {
                        value: controller,
                        configurable: true,
                    })
                }
            }
            return args as Args | undefined
        },
    })
    registerRpc({
        remote: remote as RemoteFunction<unknown, unknown>,
        inputSchema,
        outputSchema,
        filesSchema,
        clients,
        timeout,
        maxBodySize: opts?.maxBodySize,
        crossOrigin: opts?.crossOrigin,
    })
    return remote
}
