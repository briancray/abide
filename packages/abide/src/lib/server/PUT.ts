import type { RpcHelper } from './rpc/types/RpcHelper.ts'
import { unprocessed } from './rpc/unprocessed.ts'

/*
PUT rpc helper. The bundler rewrites every `export const x = PUT(fn)` inside
`src/server/rpc/<file>.ts` into a defineRpc call (server target) or a
remoteProxy stub (client target). Calling this directly throws.
*/
// @documentation rpc
export const PUT: RpcHelper = (_fn: any, _opts?: any) => unprocessed('PUT')
