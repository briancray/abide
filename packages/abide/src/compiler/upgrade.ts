// 38.198-38.203 — `abide upgrade`: WHAT A RELEASE CHANGED IN HOW AN APP IS WRITTEN, changed in the app.
// Each migration is keyed to the release that made its change, and touches only text in the form
// that release replaced — so an app on any earlier release can run every migration past it, and an
// app already moved finds nothing left to move.

import { withoutRestatedNotes } from './agentNotes.ts'

/** A file's text before and after `abide upgrade`. */
export type Edit = { path: string; before: string; after: string }

/**
 * One release's change to the app under `directory`: the text of each file it changes, by path
 * relative to `directory`. `read` answers what earlier migrations left of a file, and `undefined`
 * where there is none.
 */
type Migration = {
    version: string
    migrate: (
        read: (path: string) => Promise<string | undefined>,
    ) => Promise<Record<string, string>>
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
    for (const migration of MIGRATIONS) {
        if (
            from !== undefined &&
            Bun.semver.order(migration.version, from) <= 0
        )
            continue
        for (const [path, text] of Object.entries(
            await migration.migrate(read),
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
