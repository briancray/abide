import { browserClientFlags } from '../shared/browserClientFlags.ts'
import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { cacheManagedSlot } from '../shared/cacheManagedSlot.ts'
import { createRemoteFunction } from '../shared/createRemoteFunction.ts'
import { HttpError } from '../shared/HttpError.ts'
import { OFFLINE_HEADER } from '../shared/OFFLINE_HEADER.ts'
import { REMOTE_FUNCTION } from '../shared/REMOTE_FUNCTION.ts'
import { rpcTimeoutSlot } from '../shared/rpcTimeoutSlot.ts'
import { trace } from '../shared/trace.ts'
import type { HttpMethod } from '../shared/types/HttpMethod.ts'
import type { RemoteFunction } from '../shared/types/RemoteFunction.ts'
import type { RpcOptions } from '../shared/types/RpcOptions.ts'
import { withBase } from '../shared/withBase.ts'
import { createOutboxQueue, type OutboxQueue } from './rpcOutbox/createOutboxQueue.ts'
import { outboxRegistry } from './rpcOutbox/outboxRegistry.ts'
import { currentAbortSignal } from './runtime/currentAbortSignal.ts'
import { REQUEST_SUPERSEDED } from './runtime/REQUEST_SUPERSEDED.ts'
import type { PersistenceStore } from './types/PersistenceStore.ts'

/* A durable RPC's per-call queueing options (`outbox: true`); `store`/`online` exist
   for testing — production uses the default persistence store + system connectivity. */
export type DurableOptions = { outbox?: boolean; store?: PersistenceStore; online?: () => boolean }

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
    durable?: DurableOptions,
): RemoteFunction<Args, Return> {
    const base = createRemoteFunction<Args, Return>({
        method,
        url,
        clients: browserClientFlags,
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
        Forcing `getRequest()` once builds the Request and seeds the
        cache meta thunk in createRemoteFunction with the same instance,
        so cache() readers don't reconstruct it.
        */
        invoke: (_args, getRequest, opts) => fetchWithTimeout(getRequest(), opts),
    })
    if (durable?.outbox !== true) {
        return base
    }
    /*
    Durable (`outbox: true`): the call ENQUEUES instead of fetching — it builds the
    Request, pushes it onto the RPC's app-owned queue (created + registered once), and
    returns the queued entry (a cancelable handle). The queue drains by `fetch`ing the
    Request under the entry's own signal alone (createOutboxQueue applies it), so the
    write survives unmount + waits out offline. `rpc.outbox()` reads the live queue.
    */
    const queue = getOrCreateOutboxQueue<Args, Return>(method, url, base, durable)
    const durableProxy = (args: Args, opts?: RpcOptions) =>
        queue.enqueue(
            args,
            buildRpcRequest({
                method,
                url: withBase(url),
                args,
                baseUrl: window.location.href,
                headers: rpcHeaders(opts?.headers),
            }),
        )
    Object.assign(durableProxy, {
        method: base.method,
        url: base.url,
        clients: base.clients,
        crossOrigin: base.crossOrigin,
        raw: base.raw,
        stream: base.stream,
        fetch: base.fetch,
        outbox: () => queue.entries(),
    })
    Object.defineProperty(durableProxy, REMOTE_FUNCTION, { value: true })
    return durableProxy as unknown as RemoteFunction<Args, Return>
}

/* The single app-owned queue for a durable RPC url — created + registered on first
   use so every call site (and the global `outbox()`) shares one queue. The send is a
   plain `fetch`; the entry's abort signal already rides the Request (createOutboxQueue
   wraps it), keeping scope-abort + the client timeout deliberately out. */
function getOrCreateOutboxQueue<Args, Return>(
    method: HttpMethod,
    url: string,
    rpc: RemoteFunction<Args, Return>,
    durable: DurableOptions,
): OutboxQueue<Args> {
    void method
    const existing = outboxRegistry.get(url)
    if (existing !== undefined) {
        return existing as OutboxQueue<Args>
    }
    const queue = createOutboxQueue<Args>({
        url,
        send: (request) => fetch(request),
        store: durable.store,
        online: durable.online,
    })
    outboxRegistry.register(url, queue as OutboxQueue<unknown>, rpc)
    return queue
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
