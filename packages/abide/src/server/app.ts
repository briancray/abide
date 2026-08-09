// Where the app's name comes from when nobody declared one, and where its version comes from at all.
//
// `ABIDE_APP_NAME` is the answer everywhere it is set, and `$shared/log.ts` asks the document for it.
// This file is only the fallback under it — package.json's `name`, and the `version` beside it that the
// health document publishes — and it lives here because finding one means walking a filesystem, which
// is a server. Installed as a source rather than called, so `$shared` keeps its node-free import
// graph and a browser bundle never carries a `fs` shim it would only ever find empty. Installed at
// IMPORT rather than lazily inside `serve()` the way the scope and href sources are: a line can be
// written long before anything serves a request.

// `readFileSync` because the walk below runs at IMPORT and `Bun.file().text()` is a promise; Bun
// ships no home-directory api and no path api, so `node:os`/`node:path` stand in for nothing.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { env } from '$shared/internal/env.ts'
import { appName, useAppNameSource } from '$shared/log.ts'
import { knobOf } from './config.ts'

/** What the climb below is looking for: the two facts an app is identified by. */
interface Manifest {
    name: string | null
    version: string | null
}

const NAMELESS: Manifest = { name: null, version: null }

let found: Manifest | null = null

/**
 * The nearest package.json above the working directory that names something.
 *
 * Nearest rather than the workspace root: in a monorepo the app is the leaf, and a leaf whose
 * package.json omits `name` is one nobody meant to identify by it either.
 *
 * Read at most once, and both facts come off the SAME file — the version of a manifest other than
 * the one that named the app would be a version of something else. `ABIDE_APP_NAME` can therefore
 * rename the app without the climb ever happening, and `appVersion()` is what starts it then.
 */
function nearestManifest(): Manifest {
    if (found !== null) return found
    found = NAMELESS
    if (typeof readFileSync !== 'function') return found
    const cwd = (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.()
    if (cwd === undefined) return found

    let directory = cwd
    for (;;) {
        try {
            const parsed = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
                name?: unknown
                version?: unknown
            }
            if (typeof parsed.name === 'string' && parsed.name !== '') {
                found = {
                    name: parsed.name,
                    version:
                        typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : null,
                }
                return found
            }
        } catch {
            // No package.json here, or an unreadable one. Keep climbing — an unparseable manifest is
            // not a reason to refuse to log.
        }
        const parent = dirname(directory)
        if (parent === directory) return found
        directory = parent
    }
}

useAppNameSource(() => nearestManifest().name)

/**
 * What this app is called a version of, for the health document.
 *
 * Empty rather than absent when nothing declared one, for the reason the log's trace column is empty
 * rather than dropped: a field that appears only sometimes is one every consumer has to branch on.
 */
export function appVersion(): string {
    return nearestManifest().version ?? ''
}

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
    // Through the document, like every other knob abide reads: `onConfig(() => ({ ABIDE_DATA_DIR }))`
    // is a default that has to reach the path, or `config()` publishes a directory nothing writes to.
    const declared = knobOf('ABIDE_DATA_DIR')
    if (declared !== null) return declared
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
