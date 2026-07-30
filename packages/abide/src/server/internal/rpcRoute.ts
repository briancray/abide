// The RPC route class — `/__abide/rpc/<name>` — as four NAMED stages instead of one inline ladder.
//
// The split is TRANSPORT vs CONTRACT, and it is the distinction that was missing rather than a tidier
// arrangement of the same code:
//
//   decodeRpcArgs   TRANSPORT — where the args were on the wire (read: `__abide_args` blob or flat query
//                              params; mutation: JSON body under `maxBodySize`, or a multipart FormData)
//   validateRpcArgs CONTRACT  — `schemas.input` (and `schemas.files`, and the multipart TEXT fields),
//                              enforced before the handler runs; a failure is a 422 the caller narrows
//                              to `ValidationErrorData`
//   invokeRpc       CONTRACT  — the memo-backed call: coalesce, retain, run under the deadline
//   encodeRpcResult TRANSPORT — Response passthrough, stream encoding (jsonl/sse), or output validation +
//                              output shaping + `json()`
//
// WHY IT MATTERS THAT THE MIDDLE TWO ARE NAMED: an rpc's declaration promises one thing a bare call to the
// callable does NOT deliver, because `makeRpc` builds only the handler + memo + deadline. Its
// `schemas.input` is applied by TRANSPORT — here, ahead of `invokeRpc`. So "call this rpc as declared" has
// no callable form for a caller whose ARGS are untrusted, and four callers work around that by making an
// HTTP request to their own process: `callOwnRpc` (MCP and `agent()` tools), the compiled binary's
// self-host, `createTestApp.rpc`, and the REPL.
//
// Its own `middleware` used to be on that list and no longer is: the chain runs per READ from any door
// (`rpcChain.ts`), which is why `invokeRpc` calls `route.__bare(args)` — the router composes the chain around
// the whole of dispatch, so validation happens INSIDE authorization and a 422 never precedes a 403.
//
// This module does not close the remaining gap; it makes the gap have a shape. `validateRpcArgs` +
// `invokeRpc` are the two stages an in-process door would need, and they are now reachable without a socket.

import { asStandardSchema } from '../../shared/internal/jsonSchema.ts'
import { positiveEnvBytes } from '../../shared/internal/positiveEnvBytes.ts'
import { RPC_QUERY_PARAMS } from '../../shared/internal/RPC_QUERY_PARAMS.ts'
import { STREAM_RESUME, STREAM_RESUME_HEADER } from '../../shared/internal/STREAM_RESUME_HEADER.ts'
import { jsonSchemaOf, shapeToSchema } from '../../shared/internal/shapeToSchema.ts'
import { log } from '../../shared/log.ts'
import { validateStandard } from '../../shared/StandardSchema.ts'
import { json } from '../json.ts'
import type { AppConfig, Route } from './appConfig.ts'
import { decodeQueryArgs } from './decodeQueryArgs.ts'
import { errorResponse } from './errorResponse.ts'
import { isProd } from './isProd.ts'
import type { Rpc, RpcMeta } from './makeRpc.ts'
import { projectFormText } from './projectFormText.ts'
import type { RequestScope } from './requestScope.ts'
import { streamResponseFor } from './streamResponse.ts'
import { validateFiles } from './validateFiles.ts'
import { validationError } from './validationError.ts'

// The methods an rpc route admits, derived from its DECLARED verb — the whole gate, since a handler
// serves exactly one. HEAD is not in the list: `enforceMethod` derives it from GET (ADR 0027 D6), so
// there is no second statement of that rule here. An unmatched name has no declared verb to report, so it
// names the full set (and then answers 404 in `handleRpcRoute`, which is the outcome that fits an
// unknown resource better than a 405 whose `Allow` would confirm it might exist).
//
// This used to be `allowHeaderFor`, a HEADER — five independent literals, none agreeing. Returning the
// method LIST instead is what lets the rpc gate be `enforceMethod` rather than a hand-rolled compare that
// re-implemented the HEAD rule next to a helper written to own it.
const ANY_RPC_METHOD = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export function allowedMethodsFor(route: Route | undefined): readonly string[] {
    const meta = route?.__rpc
    return meta === undefined ? ANY_RPC_METHOD : [meta.method]
}

// A streaming read result is an AsyncIterable of decoded chunks (a ReplayableStream `consume()` cursor);
// the router transport-encodes it (jsonl/sse). A plain value/object is not async-iterable.
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
    )
}

// What the wire carried, and in which of the two forms. `multipart` is not merely a content type here: it
// selects a different validation path (files + projected text fields) and always bypasses the memo, so it
// is part of the decoded result rather than something a later stage re-derives from headers.
export type DecodedArgs =
    | { rejected: Response }
    | { rejected?: undefined; args: unknown; multipart: boolean }

// ── TRANSPORT (in) ──────────────────────────────────────────────────────────────────────────────────
export async function decodeRpcArgs(
    scope: RequestScope,
    meta: RpcMeta<unknown, unknown>,
): Promise<DecodedArgs> {
    if (meta.read) {
        // Reads carry args in the URL two ways: the canonical `__abide_args` JSON blob (what the browser
        // proxy / test app / MCP / channel-auth emit), or FLAT query params (`?key=beta`, the
        // hand-testable form) decoded + schema-coerced when the blob is absent.
        const params = scope.route.url.searchParams
        const raw = params.get(RPC_QUERY_PARAMS.args)
        return {
            args:
                raw !== null
                    ? JSON.parse(raw)
                    : decodeQueryArgs(params, meta.options.schemas?.input),
            multipart: false,
        }
    }

    // maxBodySize is enforced on the mutation body up front via Content-Length (multipart streams can lie
    // about length, but a declared oversize is rejected before we buffer it). The per-RPC option is an
    // OVERRIDE of `ABIDE_MAX_REQUEST_BODY_SIZE` — which was documented in two places and read nowhere, so
    // an rpc that declared no ceiling buffered an unbounded body. Unset, the env read yields Infinity,
    // which is the same "no ceiling" this had before, now stated once.
    const maxBodySize = meta.options.maxBodySize ?? positiveEnvBytes('ABIDE_MAX_REQUEST_BODY_SIZE')
    const contentLength = scope.request.headers.get('content-length')
    // A finite, oversized declared length is rejected before buffering. A non-numeric or absent length
    // (chunked bodies) can't be trusted, so the real guard is the post-buffer check below.
    const declared = contentLength !== null ? Number(contentLength) : Number.NaN
    if (Number.isFinite(declared) && declared > maxBodySize) {
        return {
            rejected: errorResponse(
                413,
                `Request body exceeds maxBodySize (${maxBodySize} bytes).`,
            ),
        }
    }
    const contentType = (scope.request.headers.get('content-type') ?? '').toLowerCase()
    // A mutation carrying a `multipart/form-data` body is a file upload (TODO #8): the args are a
    // `FormData` (a `File` rides in it, never in a JSON args object), passed straight to the handler.
    if (contentType.startsWith('multipart/form-data')) {
        return { args: await scope.request.formData(), multipart: true }
    }
    const body = await scope.request.text()
    // Enforce maxBodySize against the ACTUAL byte count too — a chunked or length-spoofed body slips past
    // the Content-Length check above, so measure what we actually buffered.
    if (Buffer.byteLength(body) > maxBodySize) {
        return {
            rejected: errorResponse(
                413,
                `Request body exceeds maxBodySize (${maxBodySize} bytes).`,
            ),
        }
    }
    return { args: body.length > 0 ? JSON.parse(body) : {}, multipart: false }
}

// ── CONTRACT ────────────────────────────────────────────────────────────────────────────────────────
// M8a input validation — runs before the handler for EVERY request. On failure the handler never runs and
// the caller gets a 422 that narrows to `ValidationErrorData`. Returns the (possibly coerced) args, or the
// rejection.
//
// This is half of what an rpc's DECLARATION promises and what a bare callable does not enforce. It is
// exported for that reason: any door that admits caller-supplied args owes this stage, and today only the
// HTTP one pays it.
export async function validateRpcArgs(
    meta: RpcMeta<unknown, unknown>,
    args: unknown,
    multipart: boolean,
): Promise<{ rejected: Response } | { rejected?: undefined; args: unknown }> {
    const inputSchema = meta.options.schemas?.input
    if (multipart) {
        // Multipart: the `files` schema validates the uploaded file fields; the JSON `input` schema (TODO
        // #8 follow-up) validates the multipart TEXT fields — a `File` never rides in the JSON args, so we
        // project only the non-File fields and validate that object. The handler still receives the raw
        // `FormData` untouched (validation is a gate only). Both failures narrow to the same
        // ValidationErrorData (422) shape as the JSON input path.
        const filesSchema = meta.options.schemas?.files
        if (filesSchema !== undefined) {
            const issues = validateFiles(args as FormData, filesSchema)
            if (issues.length > 0) return { rejected: validationError(issues) }
        }
        if (inputSchema !== undefined) {
            const textArgs = projectFormText(args as FormData, inputSchema)
            const validated = await validateStandard(asStandardSchema(inputSchema), textArgs)
            if (!validated.ok) return { rejected: validationError(validated.issues) }
        }
        return { args }
    }
    if (inputSchema === undefined) return { args }
    const validated = await validateStandard(asStandardSchema(inputSchema), args)
    if (!validated.ok) return { rejected: validationError(validated.issues) }
    return { args: validated.value }
}

// The memo-backed call. `read` chooses the surface only — both go through the memo (rpc-core: a mutation
// is a memo + transport exactly like a read, differing in the default retention).
// `bare` — the memo call WITHOUT the rpc's middleware chain. The router composes that chain around the
// WHOLE of dispatch (`createApp`'s `routePolicy`), so going through the chained callable here would run it
// twice. It is also the right ordering for HTTP and the reason the two entry points exist: arg decoding and
// `schemas.input` validation happen INSIDE authorization, so an unauthenticated caller gets a 403 rather
// than a 422 that would have told it the shape of the input first.
//
// One memo underneath both, so a read coalesces across doors regardless of which one asked.
export function invokeRpc(
    route: Route,
    _meta: RpcMeta<unknown, unknown>,
    args: unknown,
): Promise<unknown> {
    // biome-ignore lint/suspicious/noExplicitAny: existential rpc — concrete Args/T erased at dispatch; `unknown` breaks assignability through RpcMeta's invariant Args.
    return (route as Rpc<any, any>).__bare(args)
}

// ── TRANSPORT (out) ─────────────────────────────────────────────────────────────────────────────────
async function encodeRpcResult(
    scope: RequestScope,
    meta: RpcMeta<unknown, unknown>,
    result: unknown,
    resumeFresh: boolean,
): Promise<Response> {
    // Streams and other raw Responses pass through untouched — nothing to validate or shape.
    if (result instanceof Response) return result

    // A streaming read whose slot holds a ReplayableStream resolves to an AsyncIterable of DECODED chunks
    // (replayable-streams.md §4): the ROUTER applies the transport encoding downstream, once per HTTP
    // consumer. The handler's chosen encoding (jsonl(...)/sse(...)) wins; else `Accept: text/event-stream`
    // selects SSE; else application/jsonl.
    if (isAsyncIterable(result)) {
        const response = streamResponseFor(result, scope.request)
        // A `?__abide_from=` resume whose transcript was gone → a fresh run from 0; the client must REPLACE.
        if (resumeFresh) response.headers.set(STREAM_RESUME_HEADER, STREAM_RESUME.fresh)
        return response
    }

    // M8a output validation — DEV ONLY contract-drift catch. A mismatch logs loudly but never becomes a
    // client error.
    const outputSchema = meta.options.schemas?.output
    if (outputSchema !== undefined && !isProd()) {
        const checked = await validateStandard(asStandardSchema(outputSchema), result)
        if (!checked.ok) {
            log.channel('abide:rpc').warn(
                `output schema mismatch for rpc "${scope.route.name}":`,
                checked.issues,
            )
        }
    }

    // Output-shaping (§5.2) — trim the wire result to the declared output schema so undeclared fields
    // (e.g. a `passwordHash` the handler over-returned) never leak. Applied in ALL environments. A
    // Standard Schema or absent schema is not shapeable → the value passes through unchanged.
    return json(shapeToSchema(result, jsonSchemaOf(outputSchema)))
}

// Resumable stream replay (replayable-streams.md §5): `?__abide_from=<count>` asks to resume a RETAINED
// stream transcript from chunk `count` (replay `chunks[count..]` then live). If the transcript is gone we
// fall through to a fresh run and flag it so the client REPLACES its painted prefix instead of appending.
function resumeRetainedStream(
    scope: RequestScope,
    route: Route,
    meta: RpcMeta<unknown, unknown>,
    args: unknown,
): { response: Response } | { response?: undefined; fresh: boolean } {
    const fromRaw = meta.read ? scope.route.url.searchParams.get(RPC_QUERY_PARAMS.from) : null
    if (fromRaw === null || !/^\d+$/.test(fromRaw)) return { fresh: false }
    // biome-ignore lint/suspicious/noExplicitAny: existential rpc — the route's concrete Args/T are erased at this dispatch boundary; `unknown` breaks assignability through RpcMeta's invariant Args.
    const resumable = route as Rpc<any, any> & {
        resumeStream(
            a: unknown,
            f: number,
        ): { cursor: AsyncIterable<unknown> | undefined; fresh: boolean }
    }
    const resumed = resumable.resumeStream(args, Number(fromRaw))
    if (!resumed.fresh && resumed.cursor !== undefined) {
        // Re-served through the SAME encoding decision the fresh run makes — including the `Accept` rung,
        // which this half used to skip, so an untagged source resumed as jsonl after having been served
        // as sse.
        const response = streamResponseFor(resumed.cursor, scope.request)
        response.headers.set(STREAM_RESUME_HEADER, STREAM_RESUME.live)
        return { response }
    }
    return { fresh: true }
}

export async function handleRpcRoute(scope: RequestScope, config: AppConfig): Promise<Response> {
    const routes = config.routes ?? {}
    const route = routes[scope.route.name]
    if (route === undefined) return errorResponse(404, `Unknown rpc: ${scope.route.name}`)
    const meta = route.__rpc as RpcMeta<unknown, unknown>

    log.channel('abide:rpc').trace(`dispatch ${meta.method} ${scope.route.name}`)
    applyRunDeadlineSignal(scope, meta)

    const decoded = await decodeRpcArgs(scope, meta)
    if (decoded.rejected !== undefined) return decoded.rejected

    const validated = await validateRpcArgs(meta, decoded.args, decoded.multipart)
    if (validated.rejected !== undefined) return validated.rejected

    const resumed = resumeRetainedStream(scope, route, meta, validated.args)
    if (resumed.response !== undefined) return resumed.response

    const result = await invokeRpc(route, meta, validated.args)
    return encodeRpcResult(scope, meta, result, resumed.fresh)
}

// Hand an rpc handler its RUN deadline through the `Request` it already reads (ADR 0028 D5). No new
// ambient accessor: a handler writes the completely standard `fetch(url, { signal: request().signal })`
// and gets both halves of the rule, because the substituted signal is composed from them:
//
//     crossRequest  →  AbortSignal.timeout(T)
//     otherwise     →  AbortSignal.any([AbortSignal.timeout(T), <the incoming request's signal>])
//
// The fork is D4. A NON-crossRequest slot lives in this request's own scope, so when the client aborts,
// every reader of that slot is dying with the request and the run can never be observed — kill it. A
// crossRequest slot lives in the process-global store and a DIFFERENT request will read the fill, so the
// originating request's death is not the run's death; only the deadline ends it.
//
// ORDER IS LOAD-BEARING, in both directions. It must run AFTER route resolution (the timeout is per-rpc)
// and BEFORE the body is read — constructing a `Request` from one whose body is already disturbed throws.
// The construction also transfers the body to the new object, which is why the scope's request is
// REPLACED rather than shadowed: the body read in `decodeRpcArgs` must happen on the new one.
//
// Two things this deliberately does not reach, recorded rather than papered over: a `crossRequest` handler
// runs scope-exited (`memo.ts`) so `request()` is unavailable to it at all, and an rpc invoked IN-PROCESS
// during page SSR never passes through here — its `request()` is the page's, carrying the page's
// client-abort signal but no deadline component. Both are still bounded at the waiter by the memo's own
// deadline; what they lack is the cooperative teardown signal.
function applyRunDeadlineSignal(scope: RequestScope, meta: RpcMeta<unknown, unknown>): void {
    if (meta.timeout <= 0) return // unbounded by declaration — nothing to arm
    const memoOption = meta.options.memo
    const crossRequest = memoOption !== false && memoOption?.crossRequest === true
    const deadline = AbortSignal.timeout(meta.timeout)
    const signal = crossRequest ? deadline : AbortSignal.any([deadline, scope.request.signal])
    scope.request = new Request(scope.request, { signal })
}
