import type { HttpVerb } from './HttpVerb.ts'
import type { RemoteResponse } from './RemoteResponse.ts'

/*
Remote function reference produced by handler() inside an `$rpc/**` module
and consumed by route dispatch, cache(), SSR auto-hydration, and direct
calls. Same callable signature on server and client — the bundler swaps the
implementation for browser builds. `.method` matches the export name the
module bound this function to (one of GET/POST/PUT/PATCH/DELETE/HEAD).
*/
export type RemoteFunction<Args, Return> = ((args: Args) => Promise<RemoteResponse<Return>>) & {
    readonly method: HttpVerb
    readonly url: string
    fetch(request: Request, pathParams?: Record<string, string>): Promise<RemoteResponse<Return>>
}
