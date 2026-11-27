// A `.abide` source compiled and imported as the server component it emits — what the render and
// component benches time — built as `buildCompiledPage` builds a page (`servedFiles`), so a page with
// a component in it is compiled the way the build compiles one. One checker session per run.

import { TypeSession } from '@abide/abide/compiler'

// The emitted modules go where the tests write theirs, by the tests' own helper — see
// `serveDocsApp.ts` for why a bench reaches into `tests/`.
import {
    removeTemporaryModules,
    temporaryModule,
} from '../tests/temporaryModule.ts'
import { servedFiles } from './buildCompiledPage.ts'

const REPO = new URL('../../../', import.meta.url).pathname

export type Render = () => { head: string; body: string }

/**
 * Opens one checker session and returns `compile`, which turns a source into an imported server
 * component, and `close`, which ends the session and removes every emitted module.
 */
export async function openBenchCompiler(): Promise<{
    compile: (
        name: string,
        source: string,
        components?: Record<string, string>,
    ) => Promise<Render>
    close: () => void
}> {
    const session = await TypeSession.open(
        `${REPO}packages/abide/tsconfig.json`,
    )
    return {
        /**
         * Compiles `source` as `name`, with the `.abide` `components` it imports by name, and returns
         * its imported render.
         *
         * ITS OWN DIR PER CALL, because an import path is cached: a second `Page.abide` at a path
         * already imported hands back the first size's module.
         */
        async compile(name, source, components = {}) {
            const scratch = temporaryModule({})
            await servedFiles(
                session,
                scratch,
                [[name, source], ...Object.entries(components)],
                name,
                false,
            )
            const loaded = (await import(
                `${scratch}/${name}.abide?component`
            )) as { default: Render }
            return loaded.default
        },
        close() {
            session.close()
            removeTemporaryModules()
        },
    }
}
