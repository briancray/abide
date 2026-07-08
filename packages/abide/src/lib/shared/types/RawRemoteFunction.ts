import type { CachePolicy } from './CachePolicy.ts'
import type { HttpMethod } from './HttpMethod.ts'
import type { RemoteCallable } from './RemoteCallable.ts'
import type { StreamPolicy } from './StreamPolicy.ts'

/*
Bare-response remote function — same call shape as RemoteFunction but
resolves to the underlying Response without Content-Type decode and
without throwing on non-2xx. Produced as `.raw` on every RemoteFunction
so callers that need status / headers / body streaming or want to
implement custom error handling can opt out of the decode.
*/
export type RawRemoteFunction<Args> = RemoteCallable<Args, Response> & {
    readonly method: HttpMethod
    readonly url: string
    /* Endpoint cache/stream policy (ADR-0020), stamped on this variant too so readThrough can
       read it whether the caller passed `fn` or `fn.raw`. Same value as the decoded sibling's. */
    readonly cache?: CachePolicy<Args>
    readonly stream?: StreamPolicy
}
