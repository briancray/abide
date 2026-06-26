import type { RpcHelper } from './rpc/types/RpcHelper.ts'
import { unprocessed } from './rpc/unprocessed.ts'

/*
GET rpc helper. The bundler rewrites every `export const x = GET(fn)` inside
`src/server/rpc/<file>.ts` into a defineRpc call (server target) or a
remoteProxy stub (client target). Calling this directly throws.
*/
// @documentation rpc
export const GET: RpcHelper = (_fn: any, _opts?: any) => unprocessed('GET')
