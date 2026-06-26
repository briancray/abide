import { decodeResponse } from './decodeResponse.ts'
import { HttpError } from './HttpError.ts'
import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { REMOTE_FUNCTION } from './REMOTE_FUNCTION.ts'
import { recordRemoteMeta } from './recordRemoteMeta.ts'
import { subscribableFromResponse } from './subscribableFromResponse.ts'
import type { ClientFlags } from './types/ClientFlags.ts'
import type { HttpMethod } from './types/HttpMethod.ts'
import type { RawRemoteFunction } from './types/RawRemoteFunction.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'
import type { RpcOptions } from './types/RpcOptions.ts'
import type { Subscribable } from './types/Subscribable.ts'

/*
Assembles the public RemoteFunction shape used identically by the
server-side defineRpc (in-process handler invocation) and the
client-side remoteProxy (network fetch). Centralising the wiring here
keeps the call/raw/stream/fetch semantics — including WeakMap meta
recording, Content-Type decode, and Subscribable derivation — in one
place so the two halves can't drift.

- `buildRequest(args)` synthesizes the Request a meta reader (cache()) or
  the client invoke needs. Server uses the inbound request's URL as the
  base; client uses window.location. The result is memoised inside the
  per-call `getRequest` thunk so the Request is built at most once per
  call regardless of how many readers pull on it.
- `invoke(args, getRequest)` actually runs the call: server defineRpc
  runs the handler and ignores `getRequest`; client remoteProxy calls
  `fetch(getRequest())`. The thunk lets the server skip the Request
  allocation entirely on the SSR hot path — the only consumer that ever
  forces it is cache(), via the meta thunk recorded below.
- `parseArgsForFetch` is optional and only set by the server, so the
  framework's router can call `.fetch(inboundRequest)` and have the
  handler receive parsed args. Client `remoteProxy.fetch` just
  forwards the request through invoke().
*/
export function createRemoteFunction<Args, Return>(opts: {
    method: HttpMethod
    url: string
    clients: ClientFlags
    /* Server-side only: exempts a mutating rpc from the router's same-origin CSRF gate. */
    crossOrigin?: boolean
    buildRequest: (args: Args | undefined, opts?: RpcOptions) => Request
    invoke: (
        args: Args | undefined,
        getRequest: () => Request,
        opts?: RpcOptions,
    ) => Promise<Response>
    parseArgsForFetch?: (request: Request) => Promise<Args | undefined>
}): RemoteFunction<Args, Return> {
    const { method, url, clients, crossOrigin, buildRequest, invoke, parseArgsForFetch } = opts

    /*
    Dispatch is the one-stop entry for both the plain call (no prebuilt
    Request) and the fetch path (router hands us the inbound Request as
    `prebuilt`). The `getRequest` thunk lazily synthesizes — or
    short-circuits to the prebuilt one — and caches the result so the
    client invoke + the cache meta reader share a single Request.
    */
    function dispatch(
        args: Args | undefined,
        opts?: RpcOptions,
        prebuilt?: Request,
    ): Promise<Response> {
        let cached = prebuilt
        function getRequest(): Request {
            if (cached === undefined) {
                cached = buildRequest(args, opts)
            }
            return cached
        }
        const promise = invoke(args, getRequest, opts)
        recordRemoteMeta(promise, getRequest)
        return promise
    }

    /*
    A body rpc may receive a FormData in place of typed Args (the upload
    escape hatch). It flows through dispatch only into buildRpcRequest /
    keyForRemoteCall, both of which take it as-is, so the cast to Args is a
    contained type lie — buildRpcRequest's `instanceof FormData` branch handles
    it at runtime.
    */
    function rawCall(args: Args | FormData, opts?: RpcOptions): Promise<Response> {
        return dispatch(args as Args, opts)
    }
    rawCall.method = method
    rawCall.url = url
    /* Non-enumerable brand on both variants; see REMOTE_FUNCTION. */
    Object.defineProperty(rawCall, REMOTE_FUNCTION, { value: true })
    const raw = rawCall as RawRemoteFunction<Args>

    function callable(args: Args | FormData, opts?: RpcOptions): Promise<Return> {
        return raw(args, opts).then(decodeResponse) as Promise<Return>
    }
    callable.method = method
    callable.url = url
    callable.clients = clients
    callable.crossOrigin = crossOrigin
    callable.raw = raw
    callable.stream = (args?: Args | FormData): Subscribable<Return> => {
        return subscribableFromResponse(keyForRemoteCall(method, url, args), () =>
            raw(args as Args),
        )
    }
    Object.defineProperty(callable, REMOTE_FUNCTION, { value: true })
    callable.fetch = parseArgsForFetch
        ? async (request: Request): Promise<Response> => {
              let args: Args | undefined
              try {
                  args = await parseArgsForFetch(request)
              } catch (error) {
                  /*
                  Parse-stage rejections that already chose their wire shape
                  (readBodyWithinLimit's 413) return it; anything else (e.g.
                  malformed JSON) keeps propagating to the scope's catch.
                  Handler errors are outside this try on purpose — throwing
                  is the app.handleError path, `return error(...)` the wire one.
                  */
                  if (error instanceof HttpError) {
                      return error.response
                  }
                  throw error
              }
              return dispatch(args, undefined, request)
          }
        : (request: Request): Promise<Response> => {
              return dispatch(undefined, undefined, request)
          }
    return callable as RemoteFunction<Args, Return>
}
