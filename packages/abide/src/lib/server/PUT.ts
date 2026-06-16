import type { VerbHelper } from './rpc/types/VerbHelper.ts'
import { unprocessed } from './rpc/unprocessed.ts'

/*
PUT verb helper. The bundler rewrites every `export const x = PUT(fn)` inside
`src/server/rpc/<file>.ts` into a defineVerb call (server target) or a
remoteProxy stub (client target). Calling this directly throws.
*/
// @readme rpc
export const PUT: VerbHelper = (_fn: any, _opts?: any) => unprocessed('PUT')
