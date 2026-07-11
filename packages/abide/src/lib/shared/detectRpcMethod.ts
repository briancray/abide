import { HTTP_METHODS } from './HTTP_METHODS.ts'
import type { HttpMethod } from './types/HttpMethod.ts'

/*
Reads the HTTP method of an $rpc module from its source. Every file under
src/server/rpc/ follows the convention `export const <name> = GET(fn)` (the
rpc helper picks the method, possibly with an explicit generic
`GET<{…}>(fn)`), so the helper name at the export is the method. Returns
undefined when no rpc export matches — the caller skips the file rather
than guessing. Used by the rpc.d.ts codegen to type url() against
query-carrying rpcs; matching the same convention the bundler rewrites
keeps the two from drifting.

The FAIL-OPEN fallback for writeRpcDts's method resolution (ADR-0025 D2/D3): when a
warm server program is present the method is read off the export's helper SYMBOL
(alias/re-export-aware), and this regex — keyed on the literal helper name — is used
only when no program built or the query didn't resolve. Byte-identical to the pre-ADR
path when no program is present.
*/
const RPC_EXPORT = new RegExp(
    `export\\s+const\\s+\\w+\\s*=\\s*(${HTTP_METHODS.join('|')})\\s*[<(]`,
)

export function detectRpcMethod(source: string): HttpMethod | undefined {
    return (source.match(RPC_EXPORT)?.[1] as HttpMethod | undefined) ?? undefined
}
