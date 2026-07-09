import { abideLog } from '../../shared/abideLog.ts'
import { buildRpcRequest } from '../../shared/buildRpcRequest.ts'
import { createRemoteFunction } from '../../shared/createRemoteFunction.ts'
import { forwardHeaders } from '../../shared/forwardHeaders.ts'
import { isReadOnlyMethod } from '../../shared/isReadOnlyMethod.ts'
import { resolveClientFlags } from '../../shared/resolveClientFlags.ts'
import type { CachePolicy } from '../../shared/types/CachePolicy.ts'
import type { ClientFlags } from '../../shared/types/ClientFlags.ts'
import type { HttpMethod } from '../../shared/types/HttpMethod.ts'
import type { InputCoercion } from '../../shared/types/InputCoercion.ts'
import type { RemoteFunction } from '../../shared/types/RemoteFunction.ts'
import type { StandardSchemaV1 } from '../../shared/types/StandardSchemaV1.ts'
import type { StreamPolicy } from '../../shared/types/StreamPolicy.ts'
import { requestContext } from '../runtime/requestContext.ts'
import { parseArgs } from './parseArgs.ts'
import { registerRpc } from './registerRpc.ts'
import { runWithRpcTimeout } from './runWithRpcTimeout.ts'
import type { RemoteHandler } from './types/RemoteHandler.ts'
import { validationError } from './validationError.ts'

/*
Stash for the per-request AbortController a timed rpc composes into the
inbound signal — read back in invoke's deadline callback to fire it. Lives on
the scope's Request (one rpc per .fetch — network or in-process dispatch) so
an SSR pass's many in-process cache reads, which call invoke() directly and
never reach parseArgsForFetch, can't cross-cancel.
*/
const RPC_TIMEOUT_ABORT = Symbol('abideRpcTimeoutAbort')

/* Rpc dispatch + validation spans, opt-in via DEBUG=abide:rpc. Reveals an
   in-process RPC→RPC call (same request scope, same trace) as a nested span. */
const rpcLog = abideLog.channel('abide:rpc')

/*
Builds a RemoteFunction from an HTTP method + RPC URL + handler. The bundler
rewrites every `export const METHOD = handler(fn)` inside an `$rpc/**` module
so the rpc (from the export name) and the URL (from the file path under
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
        /* Namespaced schemas (ADR-0020): `input` types + validates args, `output` is the
           success-body schema (OpenAPI/MCP), `files` validates multipart File parts. */
        schemas?: {
            input?: StandardSchemaV1
            output?: StandardSchemaV1
            files?: StandardSchemaV1
        }
        /* Surface-exposure flags (browser/mcp/cli) — which surfaces advertise this rpc. */
        clients?: Partial<ClientFlags>
        crossOrigin?: boolean
        /* Per-rpc cap on actual received body bytes (413 past it); omitted = Bun's server-wide maxRequestBodySize. */
        maxBodySize?: number
        /* Per-rpc handler deadline (ms): a 504 once exceeded, on every surface (SSR/MCP/CLI/network). */
        timeout?: number
        /* Durable delivery: on an unreachable server (transport failure / 502/503/504/52x)
           the client proxy parks the request for replay instead of just throwing. The
           parked write drains on `rpc.outbox.retry()` (no auto-drain). Mutating methods
           only. */
        outbox?: boolean
        /* Handler returns jsonl()/sse(): the bare call returns the NamedAsyncIterable directly (for
           isomorphic `for await (… of fn(args))` in server code). Bundler-stamped; the router's
           wire path (.fetch) is unaffected. */
        streaming?: boolean
        /* Numeric/boolean input fields → parseArgs coerces a string query/form value into the
           typed value the input schema expects (ADR-0028). Bundler-stamped from the endpoint's
           `Args` type; absent on the fail-open path (a GET field then stays a string as before). */
        coerce?: InputCoercion
        /* The handler's return type projected to JSON Schema (ADR-0030 D2). Bundler-stamped from the
           endpoint's success-body type; feeds the OpenAPI 200 / MCP outputSchema / inspector surface
           when no `schemas.output` validator is declared (which still overrides it). Absent on the
           fail-open path — the surface then omits the response schema exactly as before. */
        outputJsonSchema?: Record<string, unknown>
        /* Endpoint cache policy (ADR-0020) — read helpers only; readThrough's bottom layer. */
        cache?: CachePolicy<Args>
        /* Endpoint stream policy (ADR-0020) — streaming read helpers only; replay depth `n`. */
        stream?: StreamPolicy
    },
): RemoteFunction<Args, Return> {
    /* `outbox: true` is a mutation contract — a read RPC has nothing to durably deliver,
       so reject it at declaration rather than silently ignore. The server handler itself
       is unaffected; durability is a client-proxy concern. */
    if (opts?.outbox === true && isReadOnlyMethod(method)) {
        throw new Error(
            `[abide] outbox: true is only valid on mutating RPCs (POST/PUT/PATCH/DELETE), not ${method}`,
        )
    }
    const timeout = opts?.timeout
    const inputSchema = opts?.schemas?.input
    const outputSchema = opts?.schemas?.output
    const filesSchema = opts?.schemas?.files
    /*
    An input schema makes the handler safe to advertise to non-browser
    surfaces. CLI flips on for any rpc with one (a human/script invokes it
    deliberately). MCP only auto-exposes read-only rpcs (GET/HEAD) — a
    model shouldn't be able to mutate/delete just because the handler
    carries a schema, so mutating rpcs require an explicit clients.mcp.
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
        /* The forwarded allowlist is request-invariant — derive it once per scope
           and clone per call (buildRpcRequest mutates the Headers). */
        let headers: Headers
        if (store) {
            store.forwardedHeaders ??= forwardHeaders(store.req.headers)
            headers = new Headers(store.forwardedHeaders)
        } else {
            headers = new Headers()
        }
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
            () => handler(args as Args) as unknown as Response,
        )
    }

    /*
    Validates the parsed args against inputSchema (text fields), then — when the
    rpc declares filesSchema — validates the File parts parseArgs split onto
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
                return validationError(result.issues)
            }
            value = result.value
        }
        if (filesSchema) {
            const files = requestContext.getStore()?.files ?? {}
            const result = await filesSchema['~standard'].validate(files)
            if (result.issues) {
                return validationError(result.issues)
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
    function abortRpcTimeout(): void {
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
        rpc's outbound fetch is never cancelled) — then 504.
        */
        return runWithRpcTimeout(work, timeout, abortRpcTimeout)
    }

    const remote = createRemoteFunction<Args, Return>({
        method,
        url,
        clients,
        streaming: opts?.streaming ?? false,
        crossOrigin: opts?.crossOrigin,
        cache: opts?.cache,
        stream: opts?.stream,
        buildRequest,
        invoke,
        parseArgsForFetch: async (request) => {
            const args = await parseArgs(method, request, opts?.maxBodySize, opts?.coerce)
            /*
            Compose this rpc's deadline into request().signal so a handler's
            fetch(ext, { signal: request().signal }) is cancelled when the
            timeout fires — not just abandoned. Applied after parseArgs onto the
            scope's *final* request: a maxBodySize rpc swaps store.req for a
            buffered copy (readBodyWithinLimit) and an app.handle hook may
            rewrite it, so composing onto the inbound `request` would leave
            request() — and abortRpcTimeout, which reads store.req — pointed at
            an un-cancellable signal. Only the signal is shadowed; the body
            stays readable. The store always exists here (network + in-process
            dispatch both run inside runWithRequestScope); SSR cache reads call
            invoke() directly, never this path, so a sibling rpc is never
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
        outputJsonSchema: opts?.outputJsonSchema,
        filesSchema,
        timeout,
        maxBodySize: opts?.maxBodySize,
    })
    return remote
}
