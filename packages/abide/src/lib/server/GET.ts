import type { VerbHelper } from './rpc/types/VerbHelper.ts'
import { unprocessed } from './rpc/unprocessed.ts'

/*
GET verb helper. The bundler rewrites every `export const x = GET(fn)` inside
`src/server/rpc/<file>.ts` into a defineVerb call (server target) or a
remoteProxy stub (client target). Calling this directly throws.
*/
// @documentation rpc
export const GET: VerbHelper = (_fn: any, _opts?: any) => unprocessed('GET')
