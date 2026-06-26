import type { VerbHelper } from './rpc/types/VerbHelper.ts'
import { unprocessed } from './rpc/unprocessed.ts'

/*
POST verb helper. The bundler rewrites every `export const x = POST(fn)` inside
`src/server/rpc/<file>.ts` into a defineRpc call (server target) or a
remoteProxy stub (client target). Calling this directly throws.
*/
// @documentation rpc
export const POST: VerbHelper = (_fn: any, _opts?: any) => unprocessed('POST')
