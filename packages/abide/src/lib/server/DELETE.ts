import type { VerbHelper } from './rpc/types/VerbHelper.ts'
import { unprocessed } from './rpc/unprocessed.ts'

/*
DELETE verb helper. The bundler rewrites every `export const x = DELETE(fn)` inside
`src/server/rpc/<file>.ts` into a defineVerb call (server target) or a
remoteProxy stub (client target). Calling this directly throws.
*/
// @documentation rpc
export const DELETE: VerbHelper = (_fn: any, _opts?: any) => unprocessed('DELETE')
