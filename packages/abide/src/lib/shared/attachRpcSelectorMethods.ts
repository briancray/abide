import { cache } from './cache.ts'
import { pending } from './pending.ts'
import { refreshing } from './refreshing.ts'
import type { CacheOptions } from './types/CacheOptions.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'

/*
Attaches the pre-bound selector sugar onto an assembled RemoteFunction:
`fn.pending(args?)` ≡ `pending(fn, args?)`, likewise refreshing / invalidate, and
`fn.cache(args?, options?)` ≡ `cache(fn, options)(args)` (the direct read-through call).
The methods only reference the globals at call time, so the shared import edge carries no
module-init dependency (safe against any cache ↔ createRemoteFunction cycle). Attached in
createRemoteFunction so the server (defineRpc) and client (remoteProxy) shapes are identical.
*/
export function attachRpcSelectorMethods<Args, Return>(fn: RemoteFunction<Args, Return>): void {
    Object.assign(fn, {
        pending: (args?: Args) => pending(fn, args),
        refreshing: (args?: Args) => refreshing(fn, args),
        invalidate: (args?: Args) => cache.invalidate(fn, args),
        cache: (args?: Args, options?: CacheOptions) => cache(fn, options)(args),
    })
}
