// Where the app's name comes from, when nobody declared one.
//
// `ABIDE_APP_NAME` is the answer everywhere it is set, and `$shared/log.ts` reads it on its own. This
// file is only the fallback under it — package.json's `name` — and it lives here because finding one
// means walking a filesystem, which is a server. Installed as a source rather than called, so
// `$shared` keeps its node-free import graph and a browser bundle never carries a `fs` shim it would
// only ever find empty. Installed at IMPORT rather than lazily inside `serve()` the way the scope and
// href sources are: a line can be written long before anything serves a request.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { appName, env, useAppNameSource } from '$shared/log.ts'

/**
 * The nearest package.json above the working directory that names something.
 *
 * Nearest rather than the workspace root: in a monorepo the app is the leaf, and a leaf whose
 * package.json omits `name` is one nobody meant to identify by it either.
 *
 * Called at most once — `log` holds the resolved name, and this is a filesystem climb.
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

// --- where the app keeps its own data ----------------------------------------

/**
 * The per-user directory this app may write to, as a PATH and nothing else.
 *
 * Not created here. `Bun.write` makes the parents of whatever it writes, so a caller that has this
 * path is already done — and a getter that touched the filesystem would be one that can throw on a
 * read-only mount for a caller that only wanted to print the path.
 *
 * Not an ambient in the request sense: it answers about the PROCESS, so it neither needs a `serve`
 * nor changes inside one.
 */
export function appDataDir(): string {
    const declared = env('ABIDE_DATA_DIR')
    if (declared !== undefined) return declared
    return join(userDataRoot(), appName())
}

/**
 * Where a platform puts per-user application data.
 *
 * Each is that platform's own convention rather than a dotfile in `$HOME` everywhere: a user who
 * backs up `Application Support`, or points `XDG_DATA_HOME` at another disk, has said where this
 * should go, and an app that ignored them would be the one thing on the machine that did.
 */
function userDataRoot(): string {
    const platform = (globalThis as { process?: { platform?: string } }).process?.platform
    const home = homedir()
    if (platform === 'darwin') return join(home, 'Library', 'Application Support')
    if (platform === 'win32') return env('APPDATA') ?? join(home, 'AppData', 'Roaming')
    return env('XDG_DATA_HOME') ?? join(home, '.local', 'share')
}
