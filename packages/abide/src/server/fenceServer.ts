// 16.29 AND 16.30 — WHAT THE BROWSER'S BUNDLE SEES OF `server/`. A page imports a handler from the
// module the app wrote it in, and the server's render reaches that module as written; the bundle a
// browser loads reaches it through here instead, and gets the wrapper the build wrote in its place
// (`WIRE_DIRECTORY`). Anything else under `server/` is refused, so a secret, a database client or
// the server barrel cannot ride into the browser by being imported from the wrong file.
//
// A PLUGIN ON THE BUNDLE, NOT A REWRITE OF THE PAGES. A rewrite reaches the specifiers the compiler
// emitted; the bundle reaches every edge — a `#ui` helper importing a handler included.

import { realpathSync } from 'node:fs' // bun exposes no realpath of its own
import { WIRE_DIRECTORY } from './CLIENT_BUILD.ts'

// `modules` is the compiled app, keyed by path below the output directory as `compileApp` hands it
// back — where the wrappers are.
export function fenceServer(
    root: string,
    modules: Map<string, string>,
): Bun.BunPlugin {
    // BOTH SPELLINGS OF THE ROOT, because the bundler names a file with its symlinks resolved and an
    // app under `/tmp` is `/private/tmp` to it.
    const roots = new Set([root, realpathSync(root)])
    return {
        name: 'abide-fence',
        setup(build) {
            for (const at of roots)
                build.onLoad(
                    {
                        filter: new RegExp(`^${RegExp.escape(at)}/server/`),
                    },
                    (args) => {
                        const source = args.path.slice(at.length + 1)
                        const wrapper = modules.get(
                            `${WIRE_DIRECTORY}/${source}`,
                        )
                        if (wrapper === undefined)
                            throw new Error(
                                `abide: ${source} is server code, and the browser's bundle imports it. A browser may import a handler from a module under server/rpc and nothing else under server/. RULEBOOK 16.30.`,
                            )
                        return { contents: wrapper, loader: 'ts' }
                    },
                )
        },
    }
}
