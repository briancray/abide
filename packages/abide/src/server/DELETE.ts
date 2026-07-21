// DELETE — mutating RPC helper, identical semantics to POST (no cache, direct call).

import type { StandardSchemaV1 } from '../shared/StandardSchema.ts'
import {
    type MutationSurface,
    makeMutation,
    type RpcOptions,
    type RpcOptionsWithInput,
    type RpcOptionsWithOutput,
} from './internal/makeRpc.ts'

export function DELETE<S extends StandardSchemaV1, R>(
    fn: (args: StandardSchemaV1.InferOutput<S>) => Promise<R> | R,
    opts: RpcOptionsWithInput<S, R>,
): MutationSurface<StandardSchemaV1.InferOutput<S>, R>
export function DELETE<Args, R>(
    fn: (args: Args) => Promise<R> | R,
    opts?: RpcOptionsWithOutput<R>,
): MutationSurface<Args, R>
export function DELETE<Args, R>(
    fn: (args: Args) => Promise<R> | R,
    opts?: RpcOptions,
): MutationSurface<Args, R> {
    return makeMutation<Args, R>('DELETE', fn, opts)
}
