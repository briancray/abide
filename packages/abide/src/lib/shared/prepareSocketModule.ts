import { findExportCallSite } from './findExportCallSite.ts'
import { importNamesToStrip } from './importNamesToStrip.ts'
import { stripImport } from './stripImport.ts'

const SINGLE_EXPORT_ERROR =
    '[abide] $sockets module contains more than one `socket(...)` export — each file must declare exactly one socket'

export type PreparedSocketModule = {
    exportName: string
    rewriteForServer: (name: string) => string
}

/*
Scans a `$sockets/**` module once and returns its declared export name
plus a closure that, given the socket name, emits the server-side
rewrite (`__abideDefineSocket__("<name>"[, opts])` spliced into the
original source). The single scan replaces the prior separate
extract + rewrite passes, so the resolver plugin only walks each source
character-by-character once.
*/
export function prepareSocketModule(
    source: string,
    importName: string,
): PreparedSocketModule | undefined {
    /*
    Strip the user's `socket` import under the project's chosen name and the
    canonical package name so the dead import can't side-effect-load the
    socket helper into the server bundle.
    */
    const stripped = importNamesToStrip(importName).reduce(
        (current, name) => stripImport(current, `${name}/server/socket`),
        source,
    )
    const site = findExportCallSite(stripped, (ident) => ident === 'socket', SINGLE_EXPORT_ERROR)
    if (!site) {
        return undefined
    }
    return {
        exportName: site.exportName,
        rewriteForServer(name: string): string {
            const inner = stripped.slice(site.parenStart + 1, site.parenEnd).trim()
            const binding =
                inner.length === 0
                    ? `__abideDefineSocket__(${JSON.stringify(name)})`
                    : `__abideDefineSocket__(${JSON.stringify(name)}, ${stripped.slice(site.parenStart + 1, site.parenEnd)})`
            return stripped.slice(0, site.callStart) + binding + stripped.slice(site.parenEnd + 1)
        },
    }
}
