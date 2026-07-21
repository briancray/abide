// PUT — mutating RPC helper, identical semantics to POST (no cache, direct call).

import { type Mutation, makeMutation, type Payload, type RpcOptions } from './internal/makeRpc.ts'

export function PUT<Args, R>(
    fn: (args: Args) => Promise<R> | R,
    opts?: RpcOptions,
): Mutation<Args, Payload<R>> {
    return makeMutation<Args, R>('PUT', fn, opts)
}
