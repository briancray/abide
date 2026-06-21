import { browserClientFlags } from '../shared/browserClientFlags.ts'
import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { createRemoteFunction } from '../shared/createRemoteFunction.ts'
import { HttpError } from '../shared/HttpError.ts'
import { OFFLINE_HEADER } from '../shared/OFFLINE_HEADER.ts'
import { rpcTimeoutSlot } from '../shared/rpcTimeoutSlot.ts'
import { trace } from '../shared/trace.ts'
import type { HttpVerb } from '../shared/types/HttpVerb.ts'
import type { RemoteFunction } from '../shared/types/RemoteFunction.ts'
import { withBase } from '../shared/withBase.ts'
import { currentAbortSignal } from './runtime/currentAbortSignal.ts'
import { REQUEST_SUPERSEDED } from './runtime/REQUEST_SUPERSEDED.ts'

/*
Client-side substitute for a verb-defined handler. The bundler emits one
call per verb export inside an `$rpc/**` module (GET / POST / …): server
target uses defineVerb (real handler), browser target uses remoteProxy
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
    method: HttpVerb,
    url: string,
): RemoteFunction<Args, Return> {
    return createRemoteFunction<Args, Return>({
        method,
        url,
        clients: browserClientFlags,
        /*
        The Request URL carries the mount base so the fetch routes through the
        proxy (/v2/rpc/…); the cache key keeps the bare `url` (keyForRemoteCall
        reads fn.url), so SSR snapshots round-trip base-independently.
        */
        buildRequest: (args) =>
            buildRpcRequest({
                method,
                url: withBase(url),
                args,
                baseUrl: window.location.href,
                headers: rpcHeaders(),
            }),
        /*
        Forcing `getRequest()` once builds the Request and seeds the
        cache meta thunk in createRemoteFunction with the same instance,
        so cache() readers don't reconstruct it.
        */
        invoke: (_args, getRequest) => fetchWithTimeout(getRequest()),
    })
}

/*
Fetches under two optional aborts: the reactive scope that fired the call (so a
superseded/torn-down read cancels its in-flight request — currentAbortSignal) and
the env-configured client timeout (ABIDE_CLIENT_TIMEOUT, ms). Neither present →
the unbounded fetch, exactly as before. A timeout surfaces as a 504 HttpError so a
consumer reads an honest status instead of a raw DOMException → 500. Our scope abort
(reason REQUEST_SUPERSEDED) is swallowed into a never-settling promise: the reactive
owner is gone, so the result must neither resolve into a dead tree nor surface as a
rejection. Other rejections (genuine network failure) propagate untouched.
*/
function fetchWithTimeout(request: Request): Promise<Response> {
    const timeout = rpcTimeoutSlot.ms
    const timeoutSignal = timeout === undefined ? undefined : AbortSignal.timeout(timeout)
    const signal = combineSignals(currentAbortSignal(), timeoutSignal)
    if (signal === undefined) {
        return fetch(request)
    }
    return fetch(request, { signal }).catch((error: unknown) => {
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

/* One AbortSignal from the scope-abort and timeout sources: whichever is present,
   AbortSignal.any when both, or undefined when neither (the unbounded fetch). */
function combineSignals(
    scopeSignal: AbortSignal | undefined,
    timeoutSignal: AbortSignal | undefined,
): AbortSignal | undefined {
    if (scopeSignal === undefined) {
        return timeoutSignal
    }
    if (timeoutSignal === undefined) {
        return scopeSignal
    }
    return AbortSignal.any([scopeSignal, timeoutSignal])
}

/*
abide's per-RPC headers: the page traceparent (continues the server trace) and,
only while offline, the offline marker so the handler's online() reflects the
caller's connectivity. Returns undefined when neither applies so the
allocation-free fetch path stays the common case.
*/
function rpcHeaders(): Headers | undefined {
    const headers = new Headers()
    let any = false
    const traceparent = trace()
    if (traceparent) {
        headers.set('traceparent', traceparent)
        any = true
    }
    /* Presence = offline; absence = online/unknown. navigator.onLine's offline signal is the reliable direction. */
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        headers.set(OFFLINE_HEADER, '1')
        any = true
    }
    return any ? headers : undefined
}
