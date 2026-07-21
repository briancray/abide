// POST — mutating RPC helper (rpc-core §4). Routes through a cell defaulting to `cache: { ttl: 0 }`
// (replayable-streams.md §1): coalesce identical CONCURRENT in-flight calls (per-request scope, so
// inert for the normal one-call-per-request case), retain nothing. `cache: false` opts out entirely; a
// FormData body always bypasses the cell. Exposes the FULL `Rpc`/`StreamRead` surface (peek/refresh/
// amend/chunks/…) — symmetric with a read; mounted at `/__abide/rpc/<name>`.

import type { StandardSchemaV1 } from '../shared/StandardSchema.ts'
import {
    type MutationSurface,
    makeMutation,
    type RpcOptions,
    type RpcOptionsWithInput,
    type RpcOptionsWithOutput,
} from './internal/makeRpc.ts'

// The resolved type unwraps a transport wrapper (`json(x)` → `x`, `jsonl(gen())` → the stream), so a
// mutation behaves the same whether the handler returns its result raw or wrapped (replayable-streams §4).
// Pass `schemas.input` (a Standard Schema) and the handler's argument type flows from it; otherwise
// `Args` comes from the handler. `schemas.output` is checked against the return either way.
export function POST<S extends StandardSchemaV1, R>(
    fn: (args: StandardSchemaV1.InferOutput<S>) => Promise<R> | R,
    opts: RpcOptionsWithInput<S, R>,
): MutationSurface<StandardSchemaV1.InferOutput<S>, R>
export function POST<Args, R>(
    fn: (args: Args) => Promise<R> | R,
    opts?: RpcOptionsWithOutput<R>,
): MutationSurface<Args, R>
export function POST<Args, R>(
    fn: (args: Args) => Promise<R> | R,
    opts?: RpcOptions,
): MutationSurface<Args, R> {
    return makeMutation<Args, R>('POST', fn, opts)
}
