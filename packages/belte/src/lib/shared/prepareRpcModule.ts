import type { HttpVerb } from '../server/rpc/types/HttpVerb.ts'
import { findExportCallSite } from './findExportCallSite.ts'
import { stripImport } from './stripImport.ts'

const VERB_NAMES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
const VERB_SET = new Set<string>(VERB_NAMES)

const SINGLE_EXPORT_ERROR =
    '[belte] $rpc module contains more than one `<VERB>(...)` export — each file must declare exactly one remote function'

export type PreparedRpcModule = {
    verb: HttpVerb
    exportName: string
    rewriteForServer: (url: string) => string
}

/*
Scans an `$rpc/**` module once and returns its declared verb + export
name plus a closure that, given the route URL, emits the server-side
rewrite (`__belteDefineVerb__("VERB", "<url>", … )` spliced into the
original source). The single scan replaces the prior separate
extract + rewrite passes, so the resolver plugin only walks each source
character-by-character once.

A regex pass would be tidier but it can't tell a `GET` mention inside a
docstring or template literal from the real call, and it can't follow
nested generics like `GET<Map<K, V>>(`.
*/
export function prepareRpcModule(source: string): PreparedRpcModule | undefined {
    const stripped = stripImport(source, 'belte/rpc')
    const site = findExportCallSite(stripped, (ident) => VERB_SET.has(ident), SINGLE_EXPORT_ERROR)
    if (!site) {
        return undefined
    }
    const verb = site.ident as HttpVerb
    return {
        verb,
        exportName: site.exportName,
        rewriteForServer(url: string): string {
            const binding = `__belteDefineVerb__(${JSON.stringify(verb)}, ${JSON.stringify(url)}, `
            return stripped.slice(0, site.callStart) + binding + stripped.slice(site.parenStart + 1)
        },
    }
}
