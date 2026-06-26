import { findExportCallSite } from './findExportCallSite.ts'
import { importNamesToStrip } from './importNamesToStrip.ts'
import { stripImport } from './stripImport.ts'
import type { HttpMethod } from './types/HttpMethod.ts'

const RPC_NAMES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
const RPC_SET = new Set<string>(RPC_NAMES)

const SINGLE_EXPORT_ERROR =
    '[abide] $rpc module contains more than one `<VERB>(...)` export — each file must declare exactly one remote function'

export type PreparedRpcModule = {
    verb: HttpMethod
    exportName: string
    rewriteForServer: (url: string) => string
}

/*
Scans an `$rpc/**` module once and returns its declared verb + export
name plus a closure that, given the route URL, emits the server-side
rewrite (`__abideDefineRpc__("VERB", "<url>", … )` spliced into the
original source). The single scan replaces the prior separate
extract + rewrite passes, so the resolver plugin only walks each source
character-by-character once.

A regex pass would be tidier but it can't tell a `GET` mention inside a
docstring or template literal from the real call, and it can't follow
nested generics like `GET<Map<K, V>>(`.
*/
export function prepareRpcModule(
    source: string,
    importName: string,
): PreparedRpcModule | undefined {
    /*
    The "no barrels" surface places each verb at its own path
    (`abide/server/GET`, `abide/server/POST`, …) — strip every one so
    the user's verb import doesn't linger and side-effect-load the
    stub module into the server bundle. The user may import under the
    project's chosen name or the canonical package name, so strip both.
    */
    const stripped = importNamesToStrip(importName).reduce(
        (current, name) =>
            RPC_NAMES.reduce((acc, verb) => stripImport(acc, `${name}/server/${verb}`), current),
        source,
    )
    const site = findExportCallSite(stripped, (ident) => RPC_SET.has(ident), SINGLE_EXPORT_ERROR)
    if (!site) {
        return undefined
    }
    const verb = site.ident as HttpMethod
    return {
        verb,
        exportName: site.exportName,
        rewriteForServer(url: string): string {
            const binding = `__abideDefineRpc__(${JSON.stringify(verb)}, ${JSON.stringify(url)}, `
            return stripped.slice(0, site.callStart) + binding + stripped.slice(site.parenStart + 1)
        },
    }
}
