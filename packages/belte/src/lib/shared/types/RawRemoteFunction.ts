import type { HttpVerb } from './HttpVerb.ts'

/*
Bare-response remote function — same call shape as RemoteFunction but
resolves to the underlying Response without Content-Type decode and
without throwing on non-2xx. Produced as `.raw` on every RemoteFunction
so callers that need status / headers / body streaming or want to
implement custom error handling can opt out of the decode.
*/
export type RawRemoteFunction<Args> = ((args: Args | FormData) => Promise<Response>) & {
    readonly method: HttpVerb
    readonly url: string
}
