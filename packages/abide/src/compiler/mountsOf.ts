// 23.19 — A PACKAGE'S DIRECTORY, MOUNTED WHERE THE APP SAYS.
// `import 'kit/admin' with { type: 'routes' }` in a file of the app's places every `.abide` and
// handler file under the package's `admin` directory at the importing file's directory, so its
// pages, layouts, error pages and handlers answer below it — and the app, not the package, decides
// where: the mount is a line in a file the app writes, at the position the app gave it.
//
// A FILE KEEPS ITS PATH AND GAINS A POSITION. It is compiled, served and keyed by where it lies, as
// any dependency's is (34.23); its POSITION — the path it would have below the root — is what
// `placement` reads, so a mounted page is a page by the same test as the app's.

import { realpathSync, statSync } from 'node:fs' // bun exposes no sync stat or realpath of its own
import { dirname, relative, resolve } from 'node:path' // bun exposes no path helpers of its own

import { appFiles } from '#server/appTree.ts'
import { placeOf } from '#server/placement.ts'

import { nearest } from './nearest.ts'
import { type AbideFile, scriptBodies } from './parseAbide.ts'
import { Refusals } from './Refusals.ts'
import { attributedImports } from './splitImports.ts'

/** A `.abide` on disk, and the position it takes in the app. */
type Placed = { path: string; position: string }

/**
 * One directory a file mounts, and each `.abide` and each handler file under it at the position it
 * takes in the app.
 */
type DirectoryMount = {
    specifier: string
    directory: string
    /** The position its files take below the root: the mounting file's directory, `/`-ended. */
    at: string
    files: Placed[]
    handlers: Placed[]
    /** 23.26 — the param files under it, by path: what its own segments' matchers resolve in. */
    params: string[]
}

/**
 * Every directory the file at `path` mounts, its position in the app being `position` — or none,
 * where one of them cannot be mounted and `refusals` is told what.
 *
 * `root` is the app's, real: a directory under it is the app's own already, with a position of its
 * own, and mounting it would give its files a second (23.20).
 */
export function mountsOf(
    root: string,
    path: string,
    position: string,
    file: AbideFile,
    refusals: Refusals,
): DirectoryMount[] {
    const mounts: DirectoryMount[] = []
    const at = position.includes('/')
        ? `${position.slice(0, position.lastIndexOf('/'))}/`
        : ''
    for (const script of scriptBodies(file))
        for (const { specifier } of attributedImports(script, 'routes')) {
            const directory = mountedDirectory(specifier, dirname(path))
            // A file that mounts what it may not mounts nothing.
            if (directory === undefined) {
                refusals.at(
                    path,
                    new Error(
                        `abide: ${position} mounts ${specifier}, and no directory answers to it. RULEBOOK 23.19.`,
                    ),
                )
                return []
            }
            if (ownDirectory(root, directory)) {
                refusals.at(
                    path,
                    new Error(
                        `abide: ${position} mounts ${specifier}, which is the app's own directory already. RULEBOOK 23.20.`,
                    ),
                )
                return []
            }
            // The package's tree is the package's to refuse; a mount places what it finds.
            const found = appFiles(directory, new Refusals(directory, true))
            const placed = (below: string): Placed => ({
                path: `${directory}/${below}`,
                position: `${at}${below}`,
            })
            mounts.push({
                specifier,
                directory,
                at,
                files: found.abide.map(placed),
                handlers: found.handlers.map(placed),
                params: found.params.map((below) => `${directory}/${below}`),
            })
        }
    return mounts
}

// Under the root and not a dependency's there: one of the app's own, with positions of its own.
function ownDirectory(root: string, directory: string): boolean {
    if (directory === root) return true
    const below = relative(root, directory)
    return !below.startsWith('..') && placeOf(`${below}/`) !== 'dependency'
}

/**
 * The real directory `specifier` names from `from`: a relative path as written, and a bare one as a
 * package and the path into it, found in the nearest `node_modules` above.
 *
 * A DIRECTORY, NOT A MODULE: a package's `exports` names its modules, and a mount asks for none of
 * them, so its directory is found as bun would find the package and then walked.
 */
function mountedDirectory(specifier: string, from: string): string | undefined {
    let candidate: string | undefined
    if (specifier.startsWith('./') || specifier.startsWith('../'))
        candidate = resolve(from, specifier)
    else {
        const parts = specifier.split('/')
        const nameLength = specifier.startsWith('@') ? 2 : 1
        const name = parts.slice(0, nameLength).join('/')
        const inside = parts.slice(nameLength).join('/')
        const found = nearest(from, `node_modules/${name}`)
        if (found === undefined) return undefined
        candidate = inside === '' ? found : `${found}/${inside}`
    }
    try {
        return statSync(candidate).isDirectory()
            ? realpathSync(candidate)
            : undefined
    } catch {
        return undefined
    }
}
