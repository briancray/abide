import { prepareRemoteExport } from './prepareRemoteExport.ts'

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
original source). The strip + find envelope is the shared prepareRemoteExport
scan; this module only supplies the socket import subpath and ident, then
splices its own binding.
*/
export function prepareSocketModule(
    source: string,
    importName: string,
): PreparedSocketModule | undefined {
    const prepared = prepareRemoteExport(
        source,
        importName,
        (name) => [`${name}/server/socket`],
        (ident) => ident === 'socket',
        SINGLE_EXPORT_ERROR,
    )
    if (!prepared) {
        return undefined
    }
    const { stripped, site } = prepared
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
