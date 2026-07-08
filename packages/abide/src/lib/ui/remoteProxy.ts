import { browserClientFlags } from '../shared/browserClientFlags.ts'
import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { cacheManagedSlot } from '../shared/cacheManagedSlot.ts'
import { createRemoteFunction } from '../shared/createRemoteFunction.ts'
import { HttpError } from '../shared/HttpError.ts'
import { OFFLINE_HEADER } from '../shared/OFFLINE_HEADER.ts'
import { rpcTimeoutSlot } from '../shared/rpcTimeoutSlot.ts'
import { trace } from '../shared/trace.ts'
import type { HttpMethod } from '../shared/types/HttpMethod.ts'
import type { Outbox } from '../shared/types/Outbox.ts'
import type { RemoteFunction } from '../shared/types/RemoteFunction.ts'
import type { RpcOptions } from '../shared/types/RpcOptions.ts'
import { UNREACHABLE_STATUSES } from '../shared/UNREACHABLE_STATUSES.ts'
import { withBase } from '../shared/withBase.ts'
import { createOutboxQueue, type OutboxQueue } from './rpcOutbox/createOutboxQueue.ts'
import { outboxRegistry } from './rpcOutbox/outboxRegistry.ts'
import { currentAbortSignal } from './runtime/currentAbortSignal.ts'
import { REQUEST_SUPERSEDED } from './runtime/REQUEST_SUPERSEDED.ts'
import type { PersistenceStore } from './types/PersistenceStore.ts'
import { watch } from './watch.ts'

/* The framework-reserved `HttpError.kind` for a request the durable outbox parked because
   the server was unreachable — distinct from a handler-declared error name. Lets a caller
   branch with `error instanceof HttpError && error.kind === 'queued'`. */
const QUEUED = 'queued'

/* Build-time options the bundler stamps onto the client proxy stub. `outbox: true` parks an
   unreachable call for replay; `streaming: true` (handler returns jsonl()/sse()) makes the bare
   call return the NamedAsyncIterable directly; `store` exists for testing (production uses the default
   persistence store). */
export type DurableOptions = {
    outbox?: boolean
    streaming?: boolean
    store?: PersistenceStore
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

A durable (`outbox: true`) rpc is still a normal RemoteFunction — it fetches and
throws exactly the same. The differences: when the server can't be reached
(a transport failure, or a 502/503/504/52x), the request is `park`ed onto the
RPC's app-owned outbox as a SIDE-EFFECT and the throw is a `kind: 'queued'`
HttpError; and once a backlog exists, a fresh call parks straight to the TAIL
(no fetch) so writes can't land out of order. The parked write waits for
`rpc.outbox.retry()` (or the global `outbox.retry()`) — there is no auto-drain;
the app owns when to replay. `rpc.outbox()` exposes the queue.
*/
// @documentation plumbing
export function remoteProxy<Args, Return>(
    method: HttpMethod,
    url: string,
    durable: DurableOptions & { outbox: true },
): RemoteFunction<Args, Return, Record<never, never>, true>
export function remoteProxy<Args, Return>(
    method: HttpMethod,
    url: string,
    durable?: DurableOptions,
): RemoteFunction<Args, Return>
export function remoteProxy<Args, Return>(
    method: HttpMethod,
    url: string,
    durable?: DurableOptions,
): RemoteFunction<Args, Return, Record<never, never>, boolean> {
    /* Assigned after `createRemoteFunction` so the invoke closure (which runs later, per
       call) parks through the shared queue; undefined leaves the plain fetch path. */
    let queue: OutboxQueue<Args> | undefined
    const fn = createRemoteFunction<Args, Return>({
        method,
        url,
        clients: browserClientFlags,
        streaming: durable?.streaming ?? false,
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
        it. On a durable rpc, an unreachable result parks a pristine CLONE and throws a
        `queued`-tagged HttpError — `fetch` consumes the original (its body stream is read
        and locked), so parking that same instance would leave the queue a request a resend
        can't reconstruct and a capture can't read. The clone is parked, the original is
        sent. The throw lets the caller branch on `error.kind === 'queued'` (parked, will
        retry) vs. a real server rejection; `error.data` is the parked entry, so a caller
        can `await (error.data as OutboxEntry).settled` for the eventual outcome.
        */
        invoke: (args, getRequest, opts) => {
            if (queue === undefined) {
                return fetchWithTimeout(getRequest(), opts)
            }
            /* A non-empty queue means an undelivered backlog: park this call at the TAIL
               and throw, rather than let a live fetch leapfrog the older writes and land
               out of order. `retry()` then flushes the whole queue FIFO. */
            if (queue.size() > 0) {
                return Promise.reject(
                    queuedThrow(
                        queue,
                        args as Args,
                        getRequest().clone(),
                        unreachableResponse(),
                        undefined,
                    ),
                )
            }
            const request = getRequest()
            const parkable = request.clone()
            return fetchWithTimeout(request, opts).then(
                (response) => {
                    if (UNREACHABLE_STATUSES.has(response.status)) {
                        throw queuedThrow(
                            queue,
                            args as Args,
                            parkable,
                            response,
                            new HttpError(response.clone()),
                        )
                    }
                    return response
                },
                (error: unknown) => {
                    if (shouldParkRejection(error)) {
                        const response =
                            error instanceof HttpError ? error.response : unreachableResponse()
                        throw queuedThrow(queue, args as Args, parkable, response, error)
                    }
                    throw error
                },
            )
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
    if (durable?.outbox === true) {
        queue = getOrCreateOutboxQueue<Args, Return>(url, fn, durable)
        Object.assign(fn, { outbox: outboxFace(queue) })
    }
    return fn
}

/* The synthetic "unreachable" Response a park reuses when there is no real one — a
   transport failure (fetch rejected) or a backlog park that never fetched. */
function unreachableResponse(): Response {
    return new Response('queued', { status: 503, statusText: 'Service Unavailable' })
}

/* Park the unreachable request (`cause` becomes the entry's parked reason, `entry.error`)
   and return the `kind: 'queued'` HttpError to throw — its `.data` is the parked entry, so
   a caller can `await (error.data as OutboxEntry).settled` for the eventual delivered
   result or server refusal. */
function queuedThrow<Args>(
    queue: OutboxQueue<Args> | undefined,
    args: Args,
    request: Request,
    response: Response,
    cause: unknown,
): HttpError {
    const entry = queue?.park(args, request, cause)
    return new HttpError(response, QUEUED, entry)
}

/* A fetch REJECTION (no Response) the durable rpc should park: a transport failure or
   the synthesized client-timeout 504. NOT a caller/scope abort — that's a deliberate
   cancel, not the server being unreachable. (HTTP error STATUSES never reject — `fetch`
   resolves with them — so 4xx/500 are classified on the response, not here.) */
function shouldParkRejection(error: unknown): boolean {
    if (error === REQUEST_SUPERSEDED) {
        return false
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
        return false
    }
    if (error instanceof HttpError) {
        return UNREACHABLE_STATUSES.has(error.response.status)
    }
    return true
}

/* The single app-owned queue for a durable RPC url — created + registered on first use
   so every call site (and the global `outbox()`) shares one queue. The send is a plain
   `fetch`; createOutboxQueue rides the entry's abort signal on the resent Request and
   keeps scope-abort + the client timeout out. */
function getOrCreateOutboxQueue<Args, Return>(
    url: string,
    rpc: RemoteFunction<Args, Return>,
    durable: DurableOptions,
): OutboxQueue<Args> {
    const existing = outboxRegistry.get(url)
    if (existing !== undefined) {
        return existing as OutboxQueue<Args>
    }
    const queue = createOutboxQueue<Args>({
        url,
        send: (request) => fetch(request),
        store: durable.store,
    })
    outboxRegistry.register(url, queue as OutboxQueue<unknown>, rpc)
    return queue
}

/* The `.outbox` face: callable for the live entries, `retry()` to drain on demand. */
function outboxFace<Args>(queue: OutboxQueue<Args>): Outbox<Args> {
    const face = (() => queue.entries()) as Outbox<Args>
    face.retry = () => queue.retry()
    return face
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
