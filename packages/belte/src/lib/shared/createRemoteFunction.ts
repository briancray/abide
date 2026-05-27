import type { HttpVerb } from '../server/rpc/types/HttpVerb.ts'
import type { RawRemoteFunction } from '../server/rpc/types/RawRemoteFunction.ts'
import type { RemoteFunction } from '../server/rpc/types/RemoteFunction.ts'
import { decodeResponse } from './decodeResponse.ts'
import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { recordRemoteMeta } from './recordRemoteMeta.ts'
import { subscribableFromResponse } from './subscribableFromResponse.ts'
import type { ClientFlags } from './types/ClientFlags.ts'
import type { Subscribable } from './types/Subscribable.ts'

/*
Assembles the public RemoteFunction shape used identically by the
server-side defineVerb (in-process handler invocation) and the
client-side remoteProxy (network fetch). Centralising the wiring here
keeps the call/raw/stream/fetch semantics — including WeakMap meta
recording, Content-Type decode, and Subscribable derivation — in one
place so the two halves can't drift.

- `buildRequest(args)` synthesizes the Request a meta reader (cache()) or
  the client invoke needs. Server uses the inbound request's URL as the
  base; client uses window.location. The result is memoised inside the
  per-call `getRequest` thunk so the Request is built at most once per
  call regardless of how many readers pull on it.
- `invoke(args, getRequest)` actually runs the call: server defineVerb
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
    method: HttpVerb
    url: string
    clients: ClientFlags
    buildRequest: (args: Args | undefined) => Request
    invoke: (args: Args | undefined, getRequest: () => Request) => Promise<Response>
    parseArgsForFetch?: (request: Request) => Promise<Args | undefined>
}): RemoteFunction<Args, Return> {
    const { method, url, clients, buildRequest, invoke, parseArgsForFetch } = opts

    /*
    Dispatch is the one-stop entry for both the plain call (no prebuilt
    Request) and the fetch path (router hands us the inbound Request as
    `prebuilt`). The `getRequest` thunk lazily synthesizes — or
    short-circuits to the prebuilt one — and caches the result so the
    client invoke + the cache meta reader share a single Request.
    */
    function dispatch(args: Args | undefined, prebuilt?: Request): Promise<Response> {
        let cached = prebuilt
        function getRequest(): Request {
            return cached ?? (cached = buildRequest(args))
        }
        const promise = invoke(args, getRequest)
        recordRemoteMeta(promise, getRequest)
        return promise
    }

    function rawCall(args: Args): Promise<Response> {
        return dispatch(args)
    }
    rawCall.method = method
    rawCall.url = url
    const raw = rawCall as RawRemoteFunction<Args>

    function callable(args: Args): Promise<Return> {
        return raw(args).then(decodeResponse) as Promise<Return>
    }
    callable.method = method
    callable.url = url
    callable.clients = clients
    callable.raw = raw
    callable.stream = (args?: Args): Subscribable<Return> => {
        return subscribableFromResponse(keyForRemoteCall(method, url, args), () =>
            raw(args as Args),
        )
    }
    callable.fetch = parseArgsForFetch
        ? async (request: Request): Promise<Response> => {
              const args = await parseArgsForFetch(request)
              return dispatch(args, request)
          }
        : (request: Request): Promise<Response> => {
              return dispatch(undefined, request)
          }
    return callable as RemoteFunction<Args, Return>
}
