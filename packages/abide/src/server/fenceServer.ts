// 16.29 — WHAT THE BROWSER'S BUNDLE SEES OF THE SERVER: no server file, `<name>.server.<extension>`,
// wherever it lies, so a secret or a database client cannot ride into the browser by being imported
// from the wrong file. A handler crosses as the wrapper the compiler wrote in its place — a handler
// file as that file, a private handler in its server block's place (16.28); this is the fence around
// everything else.
//
// A PLUGIN ON THE BUNDLE, NOT A REWRITE OF THE PAGES. A rewrite reaches the specifiers the compiler
// emitted; the bundle reaches every edge — a helper the page imports, importing a server file,
// included.
//
// REGISTERED AHEAD OF `abideModules`, AND IN ITS NAMESPACES: a load is answered by the first plugin
// that answers it, and a component or a file's text is loaded there rather than as a `file`.
//
// BY NAME, NOT BY PLACE: the file's own name says it, so a dependency's or a mounted package's is
// fenced as the app's own is, and a module it imports is not (36.10).

import {
    COMPONENT_NAMESPACE,
    realFileOf,
    STYLE_NAMESPACE,
    TEXT_NAMESPACE,
} from './faceOf.ts'
import { isServerFile } from './placement.ts'

// Every namespace a browser bundle loads a file of the app's in: its modules, its components, a
// file's text and a component's stylesheet.
const FENCED = ['file', COMPONENT_NAMESPACE, TEXT_NAMESPACE, STYLE_NAMESPACE]

/**
 * The bundler plugin refusing every server file to the browser's bundle.
 *
 * `root` is its real path (`appRoot`), which is how the bundler names a file. Listed before
 * `abideModules`.
 */
export function fenceServer(root: string): Bun.BunPlugin {
    // Anything whose own name could be one, a face's suffix included, and `isServerFile` decides by
    // the file a face stands for — a load it passes on falls through to the next plugin's, or the
    // bundler's own.
    const filter = /\.server\.[^/]*$/
    return {
        name: 'abide-fence',
        setup(build) {
            for (const namespace of FENCED)
                build.onLoad({ filter, namespace }, (args) => {
                    const path = realFileOf(args.path)
                    if (!isServerFile(path)) return undefined
                    const dependency = path.lastIndexOf('/node_modules/')
                    const shown = path.startsWith(`${root}/`)
                        ? path.slice(root.length + 1)
                        : dependency === -1
                          ? path
                          : path.slice(dependency + 1)
                    throw new Error(
                        `abide: ${shown} is a server file, and the browser's bundle imports it. RULEBOOK 16.29.`,
                    )
                })
        },
    }
}
