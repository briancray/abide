// Where the app's name comes from, when nobody declared one.
//
// `ABIDE_APP_NAME` is the answer everywhere it is set, and `$shared/log.ts` reads it on its own. This
// file is only the fallback under it — package.json's `name` — and it lives here because finding one
// means walking a filesystem, which is a server. Installed as a source rather than called, so
// `$shared` keeps its node-free import graph and a browser bundle never carries a `fs` shim it would
// only ever find empty. Installed at IMPORT rather than lazily inside `serve()` the way the scope and
// href sources are: a line can be written long before anything serves a request.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { useAppNameSource } from '$shared/log.ts'

/**
 * The nearest package.json above the working directory that names something.
 *
 * Nearest rather than the workspace root: in a monorepo the app is the leaf, and a leaf whose
 * package.json omits `name` is one nobody meant to identify by it either.
 */
function fromPackageJson(): string | null {
    if (typeof readFileSync !== 'function') return null
    const cwd = (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.()
    if (cwd === undefined) return null

    let directory = cwd
    for (;;) {
        try {
            const parsed = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
                name?: unknown
            }
            if (typeof parsed.name === 'string' && parsed.name !== '') return parsed.name
        } catch {
            // No package.json here, or an unreadable one. Keep climbing — an unparseable manifest is
            // not a reason to refuse to log.
        }
        const parent = dirname(directory)
        if (parent === directory) return null
        directory = parent
    }
}

useAppNameSource(fromPackageJson)
