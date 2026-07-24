// GET — read-only RPC helper (rpc-core §4). The handler is wrapped in a memo so in-process
// calls cache, coalesce, and are reactive; the router mounts it at `/__abide/rpc/<name>` via `__rpc`.

import type { StandardSchemaV1 } from '../shared/StandardSchema.ts'
import {
    makeRead,
    type ReadSurface,
    type RpcOptions,
    type RpcOptionsWithInput,
    type RpcOptionsWithOutput,
} from './internal/makeRpc.ts'

export type { Rpc, RpcOptions, StreamRead } from './internal/makeRpc.ts'

// The return type is conditional: a handler yielding an `AsyncIterable<C>` gets a `StreamRead<Args, C>`
// (reactive `latest`/`chunks`/`done`); a value handler gets the usual `Rpc<Args, T>`.
//
// Two overloads: pass `schemas.input` (a Zod/Valibot/etc. Standard Schema) and the handler's argument
// type flows FROM the schema's parsed output — no annotation. Otherwise `Args` comes from the handler
// (annotation, generic, or a destructuring default). `schemas.output`, either way, is checked against
// the handler's return.
export function GET<S extends StandardSchemaV1, R>(
    fn: (args: StandardSchemaV1.InferOutput<S>) => Promise<R> | R,
    opts: RpcOptionsWithInput<S, R>,
): ReadSurface<StandardSchemaV1.InferOutput<S>, R>
export function GET<Args, R>(
    fn: (args: Args) => Promise<R> | R,
    opts?: RpcOptionsWithOutput<R>,
): ReadSurface<Args, R>
export function GET<Args, R>(
    fn: (args: Args) => Promise<R> | R,
    opts?: RpcOptions,
): ReadSurface<Args, R> {
    return makeRead<Args, R>('GET', fn, opts) as unknown as ReadSurface<Args, R>
}
