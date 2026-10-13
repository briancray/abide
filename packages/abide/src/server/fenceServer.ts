// 16.29 — WHAT THE BROWSER'S BUNDLE SEES OF THE SERVER: nothing under a `server` directory, at any
// depth, so a secret or a database client cannot ride into the browser by being imported from the
// wrong file. A handler crosses as the wrapper its file's browser module carries in place of the
// server block (34.23), which the compiler wrote; this is the fence around everything else.
//
// A PLUGIN ON THE BUNDLE, NOT A REWRITE OF THE PAGES. A rewrite reaches the specifiers the compiler
// emitted; the bundle reaches every edge — a helper the page imports, importing a server module,
// included.
//
// REGISTERED AHEAD OF `abideModules`, AND IN ITS NAMESPACES: a load is answered by the first plugin
// that answers it, and a component or a file's text is loaded there rather than as a `file`.

import { SERVER_DIRECTORY } from '#shared/RESERVED_DIRECTORIES.ts'
import { placeOf } from '#shared/routePattern.ts'
import {
    COMPONENT_NAMESPACE,
    STYLE_NAMESPACE,
    TEXT_NAMESPACE,
} from './abideModules.ts'

// Every namespace a browser bundle loads a file of the app's in: its modules, its components, a
// file's text and a component's stylesheet.
const FENCED = ['file', COMPONENT_NAMESPACE, TEXT_NAMESPACE, STYLE_NAMESPACE]

/**
 * The bundler plugin refusing everything under a `server` directory to the browser's bundle.
 *
 * `root` is its real path (`appRoot`), which is how the bundler names a file. Listed before
 * `abideModules`.
 */
export function fenceServer(root: string): Bun.BunPlugin {
    // Anything with a `server` directory in its path below the root, and `placeOf` decides — a load
    // it passes on falls through to the next plugin's, or the bundler's own.
    const filter = new RegExp(
        `^${RegExp.escape(root)}/(?:.*/)?${SERVER_DIRECTORY}/`,
    )
    return {
        name: 'abide-fence',
        setup(build) {
            for (const namespace of FENCED)
                build.onLoad({ filter, namespace }, (args) => {
                    const below = args.path.slice(root.length + 1)
                    if (placeOf(below) !== 'server') return undefined
                    throw new Error(
                        `abide: ${below.replace(/::\w+$/, '')} is under a server directory, and the browser's bundle imports it. RULEBOOK 16.29.`,
                    )
                })
        },
    }
}
