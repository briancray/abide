// 16.29 — WHAT THE BROWSER'S BUNDLE SEES OF THE SERVER: nothing under a `server` directory, at any
// depth, so a secret or a database client cannot ride into the browser by being imported from the
// wrong file. A handler crosses as the wrapper the compiler wrote in its place — a handler file as
// that file, a private handler in its server block's place (16.28); this is the fence around
// everything else.
//
// A PLUGIN ON THE BUNDLE, NOT A REWRITE OF THE PAGES. A rewrite reaches the specifiers the compiler
// emitted; the bundle reaches every edge — a helper the page imports, importing a server module,
// included.
//
// REGISTERED AHEAD OF `abideModules`, AND IN ITS NAMESPACES: a load is answered by the first plugin
// that answers it, and a component or a file's text is loaded there rather than as a `file`.
//
// BY POSITION, NOT BY PATH (23.19): a directory a file mounts places its files where the app says,
// so a `server` directory inside it is fenced as the app's own would be, wherever the package lies.

import { resolve } from 'node:path' // bun exposes no path helpers of its own
import { SERVER_DIRECTORY } from '#shared/RESERVED_DIRECTORIES.ts'
import { placeOf } from '#shared/routePattern.ts'
import {
    COMPONENT_NAMESPACE,
    type Compilation,
    STYLE_NAMESPACE,
    TEXT_NAMESPACE,
} from './abideModules.ts'

// Every namespace a browser bundle loads a file of the app's in: its modules, its components, a
// file's text and a component's stylesheet.
const FENCED = ['file', COMPONENT_NAMESPACE, TEXT_NAMESPACE, STYLE_NAMESPACE]

/**
 * The bundler plugin refusing everything under a `server` directory to the browser's bundle.
 *
 * `root` is its real path (`appRoot`), which is how the bundler names a file; `mounted` is the
 * compilation's. Listed before `abideModules`.
 */
export function fenceServer(
    root: string,
    mounted: Compilation['mounted'],
): Bun.BunPlugin {
    // Mounted directories first: one under the root's `node_modules` is the app's at its position.
    const directories: [string, string][] = []
    for (const [directory, at] of Object.entries(mounted))
        directories.push([`${resolve(root, directory)}/`, at])
    const positionOf = (path: string): string | undefined => {
        for (const [directory, at] of directories)
            if (path.startsWith(directory))
                return `${at}${path.slice(directory.length)}`
        return path.startsWith(`${root}/`)
            ? path.slice(root.length + 1)
            : undefined
    }
    // Anything with a `server` directory in its path, and `placeOf` decides by its position — a
    // load it passes on falls through to the next plugin's, or the bundler's own.
    const filter = new RegExp(`/${SERVER_DIRECTORY}/`)
    return {
        name: 'abide-fence',
        setup(build) {
            for (const namespace of FENCED)
                build.onLoad({ filter, namespace }, (args) => {
                    const position = positionOf(args.path)
                    if (
                        position === undefined ||
                        placeOf(position) !== 'server'
                    )
                        return undefined
                    throw new Error(
                        `abide: ${position.replace(/::\w+$/, '')} is under a server directory, and the browser's bundle imports it. RULEBOOK 16.29.`,
                    )
                })
        },
    }
}
