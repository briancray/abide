import { findExportCallSite } from './findExportCallSite.ts'
import { importNamesToStrip } from './importNamesToStrip.ts'
import { stripImport } from './stripImport.ts'
import type { HttpMethod } from './types/HttpMethod.ts'

const RPC_NAMES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
const RPC_SET = new Set<string>(RPC_NAMES)

const SINGLE_EXPORT_ERROR =
    '[abide] $rpc module contains more than one `<METHOD>(...)` export — each file must declare exactly one remote function'

export type PreparedRpcModule = {
    method: HttpMethod
    /* `outbox: true` in the opts — the client proxy is emitted durable. */
    durable: boolean
    exportName: string
    rewriteForServer: (url: string) => string
}

/* `outbox: true` as an opts key in the rpc-declaring call's arguments. A heuristic
   (not a full parse): it scans the whole `METHOD(handler, { … })` arg text, so a
   handler body that literally writes the key `outbox: true` would also match — rare,
   and the effect (a durable client proxy) is visible. */
const OUTBOX_TRUE = /\boutbox\s*:\s*true\b/

/*
Scans an `$rpc/**` module once and returns its declared method + export
name plus a closure that, given the route URL, emits the server-side
rewrite (`__abideDefineRpc__("METHOD", "<url>", … )` spliced into the
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
    The "no barrels" surface places each method at its own path
    (`abide/server/GET`, `abide/server/POST`, …) — strip every one so
    the user's method import doesn't linger and side-effect-load the
    stub module into the server bundle. The user may import under the
    project's chosen name or the canonical package name, so strip both.
    */
    const stripped = importNamesToStrip(importName).reduce(
        (current, name) =>
            RPC_NAMES.reduce(
                (acc, method) => stripImport(acc, `${name}/server/${method}`),
                current,
            ),
        source,
    )
    const site = findExportCallSite(stripped, (ident) => RPC_SET.has(ident), SINGLE_EXPORT_ERROR)
    if (!site) {
        return undefined
    }
    const method = site.ident as HttpMethod
    const durable = OUTBOX_TRUE.test(stripped.slice(site.parenStart, site.parenEnd))
    return {
        method,
        durable,
        exportName: site.exportName,
        rewriteForServer(url: string): string {
            const binding = `__abideDefineRpc__(${JSON.stringify(method)}, ${JSON.stringify(url)}, `
            return stripped.slice(0, site.callStart) + binding + stripped.slice(site.parenStart + 1)
        },
    }
}
