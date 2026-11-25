// 38.198-38.203 — `abide upgrade`: WHAT A RELEASE CHANGED IN HOW AN APP IS WRITTEN, changed in the app.
// Each migration is keyed to the release that made its change, and touches only text in the form
// that release replaced — so an app on any earlier release can run every migration past it, and an
// app already moved finds nothing left to move.

import { withoutRestatedNotes } from './agentNotes.ts'
import { toJob } from './toJob.ts'
import { toKey } from './toKey.ts'
import { toMemo } from './toMemo.ts'
import { toNamedParts } from './toNamedParts.ts'
import { toRefuseNamed } from './toRefuseNamed.ts'

/** A file's text before and after `abide upgrade`. */
export type Edit = { path: string; before: string; after: string }

/**
 * One release's change to the app under `directory`: the text of each file it changes, by path
 * relative to `directory`. `read` answers what earlier migrations left of a file, and `undefined`
 * where there is none; `sources` is every file of the app's own its code is written in.
 */
type Migration = {
    version: string
    migrate: (
        read: (path: string) => Promise<string | undefined>,
        sources: () => Promise<string[]>,
    ) => Promise<Record<string, string>>
}

// What an app's code is written in, outside what it installs or builds.
const SOURCES = new Bun.Glob('**/*.{ts,tsx,js,mjs,abide,md}')
const NOT_SOURCES = /(^|\/)(node_modules|\.abide|\.git|dist|build)\//

/** A migration rewriting each source file by `rewrite`, keeping only the files it changed. */
function eachSource(
    rewrite: (text: string, path: string) => string,
): Migration['migrate'] {
    return async (read, sources) => {
        const changed: Record<string, string> = {}
        for (const path of await sources()) {
            const text = await read(path)
            if (text === undefined) continue
            const migrated = rewrite(text, path)
            if (migrated !== text) changed[path] = migrated
        }
        return changed
    }
}

// 38.198 — in the order of their versions.
const MIGRATIONS: Migration[] = [
    {
        // 38.202, 38.203 — the abide facts an earlier scaffold wrote into the app's own notes.
        version: '0.140.0',
        migrate: async (read) => {
            const notes = await read('AGENTS.md')
            return notes === undefined
                ? {}
                : { 'AGENTS.md': await withoutRestatedNotes(notes) }
        },
    },
    // 38.215 — a body handed to `reactive` is handed to `memo`.
    { version: '0.143.0', migrate: eachSource(toMemo) },
    // 38.217 — what tells one element from another is `key`, where it was `by`.
    { version: '0.143.0', migrate: eachSource(toKey) },
    // 38.219 — a `job`'s name is one of its options, and `run` is what runs it ahead of schedule.
    { version: '0.144.0', migrate: eachSource(toJob) },
    // 38.220, 38.221 — a `chart`'s `svg` part is `root`, and another component's parts handed back
    // whole are a member named for it (49.18).
    { version: '0.144.0', migrate: eachSource(toNamedParts) },
    // 38.222 — a refusal is declared by its name and its options, its status among them.
    { version: '0.144.0', migrate: eachSource(toRefuseNamed) },
]

/**
 * 38.198 — every migration keyed past `from` (every one where it is `undefined`) over the app whose
 * package is `directory`, answered as the files it would change. Nothing is written.
 */
export async function upgrade(
    directory: string,
    from: string | undefined,
): Promise<Edit[]> {
    const before = new Map<string, string | undefined>()
    const after = new Map<string, string>()
    const read = async (path: string): Promise<string | undefined> => {
        const changed = after.get(path)
        if (changed !== undefined) return changed
        if (!before.has(path)) {
            const file = Bun.file(`${directory}/${path}`)
            before.set(
                path,
                (await file.exists()) ? await file.text() : undefined,
            )
        }
        return before.get(path)
    }
    let listed: string[] | undefined
    const sources = async (): Promise<string[]> => {
        if (listed !== undefined) return listed
        listed = []
        for await (const path of SOURCES.scan({ cwd: directory, dot: false }))
            if (!NOT_SOURCES.test(path)) listed.push(path)
        listed.sort()
        return listed
    }
    for (const migration of MIGRATIONS) {
        if (
            from !== undefined &&
            Bun.semver.order(migration.version, from) <= 0
        )
            continue
        for (const [path, text] of Object.entries(
            await migration.migrate(read, sources),
        )) {
            await read(path)
            after.set(path, text)
        }
    }
    const edits: Edit[] = []
    for (const [path, text] of after) {
        const original = before.get(path) ?? ''
        if (text !== original)
            edits.push({ path, before: original, after: text })
    }
    return edits
}
