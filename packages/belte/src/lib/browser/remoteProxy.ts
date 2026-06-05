import { browserClientFlags } from '../shared/browserClientFlags.ts'
import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { createRemoteFunction } from '../shared/createRemoteFunction.ts'
import type { HttpVerb } from '../shared/types/HttpVerb.ts'
import type { RemoteFunction } from '../shared/types/RemoteFunction.ts'

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
export function remoteProxy<Args, Return>(
    method: HttpVerb,
    url: string,
): RemoteFunction<Args, Return> {
    return createRemoteFunction<Args, Return>({
        method,
        url,
        clients: browserClientFlags,
        buildRequest: (args) =>
            buildRpcRequest({ method, url, args, baseUrl: window.location.href }),
        /*
        Forcing `getRequest()` once builds the Request and seeds the
        cache meta thunk in createRemoteFunction with the same instance,
        so cache() readers don't reconstruct it.
        */
        invoke: (_args, getRequest) => fetch(getRequest()),
    })
}
