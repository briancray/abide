// HEAD — read-only RPC helper, identical semantics to GET (cache/coalesce/reactive).

import type { StandardSchemaV1 } from '../shared/StandardSchema.ts'
import {
    makeRead,
    type ReadSurface,
    type RpcOptions,
    type RpcOptionsWithInput,
    type RpcOptionsWithOutput,
} from './internal/makeRpc.ts'

export function HEAD<S extends StandardSchemaV1, R>(
    fn: (args: StandardSchemaV1.InferOutput<S>) => Promise<R> | R,
    opts: RpcOptionsWithInput<S, R>,
): ReadSurface<StandardSchemaV1.InferOutput<S>, R>
export function HEAD<Args, R>(
    fn: (args: Args) => Promise<R> | R,
    opts?: RpcOptionsWithOutput<R>,
): ReadSurface<Args, R>
export function HEAD<Args, R>(
    fn: (args: Args) => Promise<R> | R,
    opts?: RpcOptions,
): ReadSurface<Args, R> {
    return makeRead<Args, R>('HEAD', fn, opts) as unknown as ReadSurface<Args, R>
}
