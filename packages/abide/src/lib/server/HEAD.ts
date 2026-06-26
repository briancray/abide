import type { RpcHelper } from './rpc/types/RpcHelper.ts'
import { unprocessed } from './rpc/unprocessed.ts'

/*
HEAD rpc helper. The bundler rewrites every `export const x = HEAD(fn)` inside
`src/server/rpc/<file>.ts` into a defineRpc call (server target) or a
remoteProxy stub (client target). Calling this directly throws.
*/
// @documentation rpc
export const HEAD: RpcHelper = (_fn: any, _opts?: any) => unprocessed('HEAD')
