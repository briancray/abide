import type { HttpMethod } from './types/HttpMethod.ts'

/*
Reads the HTTP verb of an $rpc module from its source. Every file under
src/server/rpc/ follows the convention `export const <name> = GET(fn)` (the
verb helper picks the method, possibly with an explicit generic
`GET<{…}>(fn)`), so the helper name at the export is the method. Returns
undefined when no verb export matches — the caller skips the file rather
than guessing. Used by the rpc.d.ts codegen to type url() against
query-carrying verbs; matching the same convention the bundler rewrites
keeps the two from drifting.
*/
const RPC_EXPORT = /export\s+const\s+\w+\s*=\s*(GET|POST|PUT|PATCH|DELETE|HEAD)\s*[<(]/

export function detectVerbMethod(source: string): HttpMethod | undefined {
    return (source.match(RPC_EXPORT)?.[1] as HttpMethod | undefined) ?? undefined
}
