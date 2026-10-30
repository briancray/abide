import { serveCompilation } from '#server/abideModules.ts'

import { temporaryModule } from './temporaryModule.ts'

// A FIXTURE'S COMPILED `.abide` FILES, served as an app's are (`abideModules`): each is written at its
// name, with its source where the test has one, and its compiled modules answer an import of it — so
// a test imports `Page.abide?component` for the server's module and `Page.abide?client` for the
// browser's, and every `.abide` those import is the same file's, in the same lane.
//
// `files` maps a name like `Card.abide` to what it compiled to; `beside` is anything else the
// fixture holds, by name.
export function servedModules(
    files: Record<
        string,
        { server: string; client?: string; sheet?: string; source?: string }
    >,
    beside: Record<string, string> = {},
): string {
    const written: Record<string, string> = { ...beside }
    for (const [name, compiled] of Object.entries(files))
        written[name] = compiled.source ?? ''
    const dir = temporaryModule(written)
    const compilation: Parameters<typeof serveCompilation>[1] = {
        files: {},
        handlers: {},
        tables: {},
    }
    for (const [name, compiled] of Object.entries(files))
        compilation.files[name] = {
            server: compiled.server,
            client: compiled.client ?? '',
            sheet: compiled.sheet,
            serverMappings: undefined,
            clientMappings: undefined,
        }
    serveCompilation(dir, compilation)
    return dir
}
