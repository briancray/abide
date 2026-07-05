import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { patch } from './patch.ts'
import { peek } from './peek.ts'
import { pending } from './pending.ts'
import { refresh } from './refresh.ts'
import { refreshing } from './refreshing.ts'
import { rpcErrorRegistry } from './rpcErrorRegistry.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'

/*
Attaches the pre-bound selector sugar onto an assembled RemoteFunction:
`fn.pending(args?)` ≡ `pending(fn, args?)`, likewise refreshing / refresh / peek,
`fn.patch(args?, updater)` ≡ `patch(fn, args, updater)`, and `fn.error(args?)` — the typed
last error from the rpc error registry (most-recent across the rpc when args omitted, that
exact call when given). The cached read is the bare call `fn(args, opts)` itself; refetch is
`fn.refresh(args?)`. The methods only reference the globals at call time, so the shared import
edge carries no module-init dependency (safe against any cache ↔ createRemoteFunction cycle).
Attached in createRemoteFunction so the server (defineRpc) and client (remoteProxy) shapes are
identical. `patch` is attached uniformly; the type omits it for a streaming rpc (harmless at
runtime — a stream has no cache entry).
*/
export function attachRpcSelectorMethods<Args, Return>(fn: RemoteFunction<Args, Return>): void {
    Object.assign(fn, {
        pending: (args?: Args) => pending(fn, args),
        refreshing: (args?: Args) => refreshing(fn, args),
        refresh: (args?: Args) => refresh(fn, args),
        peek: (args?: Args) => peek(fn, args),
        patch: (argsOrUpdater?: unknown, updater?: unknown) =>
            (patch as (fn: unknown, a?: unknown, b?: unknown) => void)(fn, argsOrUpdater, updater),
        error: (args?: Args) =>
            args === undefined
                ? rpcErrorRegistry.readAny(`${fn.method} ${fn.url}`)
                : rpcErrorRegistry.read(keyForRemoteCall(fn.method, fn.url, args)),
    })
}
