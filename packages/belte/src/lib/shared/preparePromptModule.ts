import { findExportCallSite } from './findExportCallSite.ts'
import { stripImport } from './stripImport.ts'

const SINGLE_EXPORT_ERROR =
    '[belte] prompts module contains more than one `prompt(...)` export — each file must declare exactly one prompt'

export type PreparedPromptModule = {
    exportName: string
    rewriteForServer: (name: string) => string
}

/*
Scans a `src/server/prompts/**` module once and returns its declared
export name plus a closure that, given the prompt name, emits the
server-side rewrite (`__belteDefinePrompt__("<name>", opts)` spliced into
the original source). Mirrors prepareSocketModule — a single tokenizer
pass so a `prompt` mention inside a string or comment is left alone.
*/
export function preparePromptModule(source: string): PreparedPromptModule | undefined {
    const stripped = stripImport(source, 'belte/server/prompt')
    const site = findExportCallSite(stripped, (ident) => ident === 'prompt', SINGLE_EXPORT_ERROR)
    if (!site) {
        return undefined
    }
    return {
        exportName: site.exportName,
        rewriteForServer(name: string): string {
            const inner = stripped.slice(site.parenStart + 1, site.parenEnd).trim()
            const binding =
                inner.length === 0
                    ? `__belteDefinePrompt__(${JSON.stringify(name)})`
                    : `__belteDefinePrompt__(${JSON.stringify(name)}, ${stripped.slice(site.parenStart + 1, site.parenEnd)})`
            return stripped.slice(0, site.callStart) + binding + stripped.slice(site.parenEnd + 1)
        },
    }
}
