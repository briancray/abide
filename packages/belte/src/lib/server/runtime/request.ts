import { requestContext } from './requestContext.ts'

/*
Returns the inbound Request for the current SSR/RPC pass. Implemented as an
AsyncLocalStorage lookup over the per-request store the server installs at
the fetch boundary. Throws if called outside a request scope (e.g. from
top-level module code or from app.ts init) — silent undefined would mask
the misuse.
*/
export function request(): Request {
    const store = requestContext.getStore()
    if (!store) {
        throw new Error(
            '[belte] request() called outside a request scope — it only resolves while an SSR render or rpc handler is in flight',
        )
    }
    return store.req
}
