// HEAD — read-only RPC helper, identical semantics to GET (cache/coalesce/reactive).

import { makeRead, type ReadSurface, type RpcOptions } from './internal/makeRpc.ts'

export function HEAD<Args, R>(
    fn: (args: Args) => Promise<R> | R,
    opts?: RpcOptions,
): ReadSurface<Args, R> {
    return makeRead<Args, R>('HEAD', fn, opts) as unknown as ReadSurface<Args, R>
}
