import type { HttpVerb } from '../server/rpc/types/HttpVerb.ts'
import type { RawRemoteFunction } from '../server/rpc/types/RawRemoteFunction.ts'
import type { RemoteFunction } from '../server/rpc/types/RemoteFunction.ts'
import type { Subscribable } from './types/Subscribable.ts'
import { decodeResponse } from './decodeResponse.ts'
import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { recordRemoteMeta } from './recordRemoteMeta.ts'
import { subscribableFromResponse } from './subscribableFromResponse.ts'

/*
Assembles the public RemoteFunction shape used identically by the
server-side defineVerb (in-process handler invocation) and the
client-side remoteProxy (network fetch). Centralising the wiring here
keeps the call/raw/stream/fetch semantics — including WeakMap meta
recording, Content-Type decode, and Subscribable derivation — in one
place so the two halves can't drift.

- `buildRequest(args)` synthesizes the Request for plain calls. Server
  uses the inbound request's URL as the base; client uses
  window.location.
- `invoke(request, args)` actually runs the call: server runs the
  handler (with optional schema validation); client does fetch(request).
- `parseArgsForFetch` is optional and only set by the server, so the
  framework's router can call `.fetch(inboundRequest)` and have the
  handler receive parsed args. Client `remoteProxy.fetch` just
  forwards the request through invoke().
*/
export function createRemoteFunction<Args, Return>(opts: {
    method: HttpVerb
    url: string
    buildRequest: (args: Args | undefined) => Request
    invoke: (request: Request, args: Args | undefined) => Promise<Response>
    parseArgsForFetch?: (request: Request) => Promise<Args | undefined>
}): RemoteFunction<Args, Return> {
    const { method, url, buildRequest, invoke, parseArgsForFetch } = opts

    function dispatch(request: Request, args: Args | undefined): Promise<Response> {
        const promise = invoke(request, args)
        recordRemoteMeta(promise, request)
        return promise
    }

    function rawCall(args: Args): Promise<Response> {
        return dispatch(buildRequest(args), args)
    }
    rawCall.method = method
    rawCall.url = url
    const raw = rawCall as RawRemoteFunction<Args>

    function callable(args: Args): Promise<Return> {
        return raw(args).then(decodeResponse) as Promise<Return>
    }
    callable.method = method
    callable.url = url
    callable.raw = raw
    callable.stream = (args?: Args): Subscribable<Return> => {
        return subscribableFromResponse(keyForRemoteCall(method, url, args), () =>
            raw(args as Args),
        )
    }
    callable.fetch = parseArgsForFetch
        ? async (request: Request): Promise<Response> => {
              const args = await parseArgsForFetch(request)
              return dispatch(request, args)
          }
        : (request: Request): Promise<Response> => {
              return dispatch(request, undefined)
          }
    return callable as RemoteFunction<Args, Return>
}
