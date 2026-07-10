import { browserClientFlags } from '../shared/browserClientFlags.ts'
import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { cacheManagedSlot } from '../shared/cacheManagedSlot.ts'
import { createRemoteFunction } from '../shared/createRemoteFunction.ts'
import { HttpError } from '../shared/HttpError.ts'
import { OFFLINE_HEADER } from '../shared/OFFLINE_HEADER.ts'
import { rpcTimeoutSlot } from '../shared/rpcTimeoutSlot.ts'
import { trace } from '../shared/trace.ts'
import type { CachePolicy } from '../shared/types/CachePolicy.ts'
import type { HttpMethod } from '../shared/types/HttpMethod.ts'
import type { OutputWirePlan } from '../shared/types/OutputWirePlan.ts'
import type { RemoteFunction } from '../shared/types/RemoteFunction.ts'
import type { RpcOptions } from '../shared/types/RpcOptions.ts'
import type { StandardSchemaV1 } from '../shared/types/StandardSchemaV1.ts'
import type { StreamPolicy } from '../shared/types/StreamPolicy.ts'
import { validationHttpError } from '../shared/validationHttpError.ts'
import { withBase } from '../shared/withBase.ts'
import { currentAbortSignal } from './runtime/currentAbortSignal.ts'
import { REQUEST_SUPERSEDED } from './runtime/REQUEST_SUPERSEDED.ts'
import { watch } from './watch.ts'

/* The proxy's third argument. ADR-0022 D2: the client rpc transform passes the endpoint's LIVE
   `opts` object here verbatim, so the type widens to the endpoint opts shape — remoteProxy reads
   only the keys below and IGNORES the rest (`crossOrigin` / `timeout` / `maxBodySize`), which ride
   along harmlessly. `streaming: true` (handler returns jsonl()/sse(), build-injected) makes the
   bare call return the NamedAsyncIterable directly; `cache` / `stream` carry the endpoint's declared
   policy (ADR-0020) so the client honours the ttl (staleness/SWR), the refetch clock
   (throttle/debounce), and tags. `schemas` — its live `input` validator now reaches the stub (ADR-0022
   D2) — drives the ADR-0026 client-side pre-flight. */
export type RemoteProxyOptions<Args = unknown> = {
    streaming?: boolean
    /* The client output wire codec plan (ADR-0029) the resolver plugin baked onto the stub — the
       handler's structured success fields, so the proxy revives a `Set`/`Map`/`bigint`/`Date` off a
       decoded response. Absent on the fail-open path (a response array then stays an array). */
    outputWirePlan?: OutputWirePlan
    cache?: CachePolicy<Args>
    stream?: StreamPolicy
    /* The endpoint's live schema group (ADR-0022 D2 forwards it verbatim). `input` is the
       Standard Schema the ADR-0026 pre-flight validates the typed args against. */
    schemas?: {
        input?: StandardSchemaV1
        output?: StandardSchemaV1
        files?: StandardSchemaV1
    }
    /* Ignored endpoint opts keys, present only so the author's live `opts` object type-checks
       when the client transform forwards it verbatim (ADR-0022). `clients` (surface flags) is
       read only on the server. */
    clients?: unknown
    crossOrigin?: unknown
    timeout?: unknown
    maxBodySize?: unknown
}

/*
Client-side substitute for a rpc-defined handler. The bundler emits one
call per rpc export inside an `$rpc/**` module (GET / POST / …): server
target uses defineRpc (real handler), browser target uses remoteProxy
(fetch over the network). Both paths produce identical RemoteFunction
shapes and identical WeakMap metadata so cache() works the same on either
side.

`url` is the flat rpc route. Args go in the JSON body (POST/PUT/PATCH) or
the query string (GET/DELETE/HEAD). Plain `fn(args)` decodes the Response
by Content-Type and throws HttpError on non-2xx; `.raw(args)` is the
escape hatch that returns the Response untouched.
*/
// @documentation plumbing
export function remoteProxy<Args, Return>(
    method: HttpMethod,
    url: string,
    options?: RemoteProxyOptions<Args>,
): RemoteFunction<Args, Return> {
    /* ADR-0026 client-side pre-flight: validate the typed args against the endpoint's input
       schema (forwarded to the stub, ADR-0022 D2) BEFORE the fetch whenever one is present — always
       on, no opt-in. This is a UX optimization ONLY: the server's unconditional inputSchema validate
       → 422 (defineRpc.ts `validateThenHandle`) stays the trust boundary, so a client that skips or
       fakes this check is still fully validated on the server. undefined here (no input schema)
       keeps today's behaviour — the client serializes and sends unvalidated. */
    const preflightSchema = options?.schemas?.input
    const fn = createRemoteFunction<Args, Return>({
        method,
        url,
        clients: browserClientFlags,
        streaming: options?.streaming ?? false,
        /* The client revives a decoded response's structured fields through this plan (ADR-0029
           output path); undefined leaves the honest-JSON body untouched. */
        outputWirePlan: options?.outputWirePlan,
        /* Endpoint policy the resolver plugin spliced onto the stub — governs client cache
           behaviour (ttl/staleness, refetch clock, tags). createRemoteFunction stamps it onto
           `fn.cache` / `fn.stream` so readThrough reads it as the bottom policy layer. */
        cache: options?.cache,
        stream: options?.stream,
        /*
        The Request URL carries the mount base so the fetch routes through the
        proxy (/v2/rpc/…); the cache key keeps the bare `url` (keyForRemoteCall
        reads fn.url), so SSR snapshots round-trip base-independently.
        */
        buildRequest: (args, opts) =>
            buildRpcRequest({
                method,
                url: withBase(url),
                args,
                baseUrl: window.location.href,
                headers: rpcHeaders(opts?.headers),
            }),
        /*
        Forcing `getRequest()` once builds the Request and seeds the cache meta thunk in
        createRemoteFunction with the same instance, so cache() readers don't reconstruct
        it.
        */
        invoke: (args, getRequest, opts) => {
            /* ADR-0026 D2/D3: an input schema present → validate the TYPED args (pre-serialization
               — NOT the string-shaped serialized form, which sidesteps parseArgs's query-coercion
               gap) before any fetch. The validate may return a Promise (StandardSchemaV1), so await
               it (D3). On a returned failure throw an HttpError shaped IDENTICALLY to the server's
               422 (validationHttpError) and make NO fetch — saving the round-trip. */
            if (preflightSchema !== undefined) {
                return (
                    Promise.resolve()
                        .then(() => preflightSchema['~standard'].validate(args))
                        .then(
                            (result) => {
                                /* A returned `issues` result is a definitive "this input is invalid" —
                               throw the same 422-shaped HttpError the server would (validationHttpError)
                               so it rejects the chain and makes NO fetch, saving the round-trip. */
                                if (result.issues) {
                                    throw validationHttpError(result.issues)
                                }
                            },
                            () => {
                                /* A validate REJECTION (not an `issues` verdict) means the validator itself
                               could not run here (a non-portable / async-resource refinement), which is
                               NOT a verdict on the input: swallow it and fall through to the fetch, letting
                               the server (the authoritative validator) decide. So a schema can never break
                               a call merely by failing to run client-side. */
                            },
                        )
                        /* Fetch exactly ONCE, only after validation settles — outside the validate handlers
                       so a fetch/timeout rejection propagates to the caller untouched rather than being
                       mistaken for a "validator couldn't run" fall-through and resending the request. */
                        .then(() => fetchWithTimeout(getRequest(), opts))
                )
            }
            return fetchWithTimeout(getRequest(), opts)
        },
    })
    /* Overwrite the inert `.watch` the shared attach bound: on the client the real reaction
       sugar routes to the `watch` ui primitive (`fn.watch(handler)` / `fn.watch(args, handler)`).
       Attached here — not in the shared attach — so `watch` never rides into a server bundle. */
    Object.assign(fn, {
        watch: (argsOrHandler: unknown, handler?: unknown) =>
            (watch as (source: unknown, a?: unknown, b?: unknown) => () => void)(
                fn,
                argsOrHandler,
                handler,
            ),
    })
    return fn
}

/*
Fetches under three optional aborts: the reactive scope that fired the call (so a
superseded/torn-down read cancels its in-flight request — currentAbortSignal), the
caller-supplied opts.signal, and the env-configured client timeout
(ABIDE_CLIENT_TIMEOUT, ms). None present and no transport opts → the unbounded
fetch, exactly as before. A timeout surfaces as a 504 HttpError so a consumer reads
an honest status instead of a raw DOMException → 500. Our scope abort (reason
REQUEST_SUPERSEDED) is swallowed into a never-settling promise: the reactive owner is
gone, so the result must neither resolve into a dead tree nor surface as a rejection.
Other rejections (genuine network failure) propagate untouched. The caller's
keepalive/priority/cache opts pass through to fetch unchanged.
*/
function fetchWithTimeout(request: Request, opts?: RpcOptions): Promise<Response> {
    const timeout = rpcTimeoutSlot.ms
    const timeoutSignal = timeout === undefined ? undefined : AbortSignal.timeout(timeout)
    /*
    A cache-managed flight is shared across readers (cache() owns its lifetime), so a
    single caller's signal must not abort it for the others — the same opt-out
    currentAbortSignal makes for the scope signal. keepalive/priority/cache are
    harmless to keep there.
    */
    const callerSignal = cacheManagedSlot.active ? undefined : (opts?.signal ?? undefined)
    const signal = combineSignals(currentAbortSignal(), callerSignal, timeoutSignal)
    const init = fetchInit(signal, opts)
    if (init === undefined) {
        return fetch(request)
    }
    return fetch(request, init).catch((error: unknown) => {
        if (error === REQUEST_SUPERSEDED) {
            return new Promise<Response>(() => {})
        }
        if (error instanceof DOMException && error.name === 'TimeoutError') {
            throw new HttpError(
                new Response('client timeout', { status: 504, statusText: 'Gateway Timeout' }),
            )
        }
        throw error
    })
}

/*
The fetch init from the merged abort signal plus the caller's transport opts
(keepalive/priority/cache). headers are deliberately absent — they live on the
Request built in buildRequest, since fetch(request, { headers }) replaces rather than
merges. undefined when nothing applies, preserving the allocation-free unbounded
fetch for the common reactive-free call.
*/
function fetchInit(signal: AbortSignal | undefined, opts?: RpcOptions): RequestInit | undefined {
    const init: RequestInit = {}
    if (signal !== undefined) {
        init.signal = signal
    }
    if (opts?.keepalive !== undefined) {
        init.keepalive = opts.keepalive
    }
    if (opts?.priority !== undefined) {
        init.priority = opts.priority
    }
    if (opts?.cache !== undefined) {
        init.cache = opts.cache
    }
    return Object.keys(init).length === 0 ? undefined : init
}

/* One AbortSignal merging the scope abort, the caller signal, and the timeout:
   AbortSignal.any over those present, the lone one when one, undefined when none
   (the unbounded fetch). */
function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
    const present = signals.filter((signal): signal is AbortSignal => signal !== undefined)
    if (present.length <= 1) {
        return present[0]
    }
    return AbortSignal.any(present)
}

/*
abide's per-RPC headers, merged onto the caller's opts.headers: the page traceparent
(continues the server trace) and, only while offline, the offline marker so the
handler's online() reflects the caller's connectivity. Caller headers go in first and
the framework's are set last, so a caller adds transport metadata (idempotency-key,
authorization) but can never overwrite traceparent or the offline marker; content-type
stays owned by buildRpcRequest. Returns undefined when neither caller nor framework set
a header, so the allocation-free fetch path stays the common case.
*/
function rpcHeaders(callerHeaders?: HeadersInit): Headers | undefined {
    const headers = new Headers(callerHeaders)
    const traceparent = trace()
    if (traceparent) {
        headers.set('traceparent', traceparent)
    }
    /* Presence = offline; absence = online/unknown. navigator.onLine's offline signal is the reliable direction. */
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        headers.set(OFFLINE_HEADER, '1')
    }
    return headers.keys().next().done ? undefined : headers
}
