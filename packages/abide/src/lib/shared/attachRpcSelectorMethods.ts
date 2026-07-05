import { cache } from './cache.ts'
import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { pending } from './pending.ts'
import { refreshing } from './refreshing.ts'
import { rpcErrorRegistry } from './rpcErrorRegistry.ts'
import type { CacheOptions } from './types/CacheOptions.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'

/*
Attaches the pre-bound selector sugar onto an assembled RemoteFunction:
`fn.pending(args?)` ≡ `pending(fn, args?)`, likewise refreshing / invalidate,
`fn.cache(args?, options?)` ≡ `cache(fn, args, options)` (the direct read-through call), and
`fn.error(args?)` — the typed last error from the rpc error registry (most-recent across the
rpc when args omitted, that exact call when given). The methods only reference the globals at
call time, so the shared import edge carries no module-init dependency (safe against any
cache ↔ createRemoteFunction cycle). Attached in createRemoteFunction so the server
(defineRpc) and client (remoteProxy) shapes are identical.
*/
export function attachRpcSelectorMethods<Args, Return>(fn: RemoteFunction<Args, Return>): void {
    Object.assign(fn, {
        pending: (args?: Args) => pending(fn, args),
        refreshing: (args?: Args) => refreshing(fn, args),
        invalidate: (args?: Args) => cache.invalidate(fn, args),
        cache: (args?: Args, options?: CacheOptions) => cache(fn, args, options),
        error: (args?: Args) =>
            args === undefined
                ? rpcErrorRegistry.readAny(`${fn.method} ${fn.url}`)
                : rpcErrorRegistry.read(keyForRemoteCall(fn.method, fn.url, args)),
    })
}
