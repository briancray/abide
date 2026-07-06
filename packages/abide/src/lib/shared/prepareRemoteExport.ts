import { type ExportCallSite, findExportCallSite } from './findExportCallSite.ts'
import { importNamesToStrip } from './importNamesToStrip.ts'
import { stripImport } from './stripImport.ts'

export type RemoteExport = {
    /* The source with the user's dead server-helper import removed. */
    stripped: string
    /* The one exported `helper(...)` call the surface must rewrite. */
    site: ExportCallSite
}

/*
The scan-once envelope every file-based remote surface ($rpc, $sockets) shares:
strip the user's server-helper import under both the project's chosen name and
the canonical package name (so the dead import can't side-effect-load the stub
into the server bundle), then locate the single exported helper call. Each
surface passes the subpaths it places under a name (`server/GET`…/`server/socket`)
and the ident predicate that recognizes its call; the character-by-character
walk still happens exactly once. Returns undefined when the module declares no
matching export (a plain `.ts` helper alongside the surface), and throws the
surface's own single-export error when it declares more than one.
*/
export function prepareRemoteExport(
    source: string,
    importName: string,
    subpathsForName: (name: string) => string[],
    identMatches: (ident: string) => boolean,
    singleExportError: string,
): RemoteExport | undefined {
    const stripped = importNamesToStrip(importName).reduce(
        (current, name) =>
            subpathsForName(name).reduce((acc, subpath) => stripImport(acc, subpath), current),
        source,
    )
    const site = findExportCallSite(stripped, identMatches, singleExportError)
    if (!site) {
        return undefined
    }
    return { stripped, site }
}
