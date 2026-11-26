// 38.198-38.203 — `abide upgrade`: WHAT A RELEASE CHANGED IN HOW AN APP IS WRITTEN, changed in the app.
// Each migration is keyed to the release that made its change, and touches only text in the form
// that release replaced — so an app on any earlier release can run every migration past it, and an
// app already moved finds nothing left to move.

import { withoutRestatedNotes } from './agentNotes.ts'
import { toComputed } from './toComputed.ts'
import { toComputedCall } from './toComputedCall.ts'
import { toDerived } from './toDerived.ts'
import { type Note, toFetchAndHandle } from './toFetchAndHandle.ts'
import { toHeldFunction } from './toHeldFunction.ts'
import { toJob } from './toJob.ts'
import { toKey } from './toKey.ts'
import { toMemo } from './toMemo.ts'
import { toNamedParts } from './toNamedParts.ts'
import { toReactive } from './toReactive.ts'
import { toRefuseNamed } from './toRefuseNamed.ts'
import { toRpc } from './toRpc.ts'
import { toServedValues } from './toServedValues.ts'
import { toShared } from './toShared.ts'
import { toSourceOptions } from './toSourceOptions.ts'

/** A file's text before and after `abide upgrade`: `null` after, for a file it moves away from. */
export type Edit = { path: string; before: string; after: string | null }

/** 38.226 — a line a migration changed the meaning of and left for the app to decide. */
export type UpgradeNote = { path: string; line: number; message: string }

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
        note: (path: string, line: string, message: string) => void,
        // 38.231 — a file it moves, so a note an earlier migration made of it names where it went.
        move: (from: string, to: string) => void,
    ) => Promise<Record<string, string | null>>
}

// What an app's code is written in, outside what it installs or builds.
const SOURCES = new Bun.Glob('**/*.{ts,tsx,js,mjs,abide,md}')
const NOT_SOURCES = /(^|\/)(node_modules|\.abide|\.git|dist|build)\//

/** A migration rewriting each source file by `rewrite`, keeping only the files it changed. */
function eachSource(
    rewrite: (text: string, path: string, note: Note) => string,
): Migration['migrate'] {
    return async (read, sources, note) => {
        const changed: Record<string, string> = {}
        for (const path of await sources()) {
            const text = await read(path)
            if (text === undefined) continue
            const migrated = rewrite(text, path, (line, message) =>
                note(path, line, message),
            )
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
    // 38.223 — a body declaring no parameter is handed to `computed`, and `memo` is keyed alone.
    { version: '0.144.0', migrate: eachSource(toComputed) },
    // 38.224 — a handler call a page holds as a value is held through `computed`.
    { version: '0.144.0', migrate: eachSource(toComputedCall) },
    // 38.225 — `fetchData` is `fetchAndHandle`.
    { version: '0.144.0', migrate: eachSource(toFetchAndHandle) },
    // 38.228 — `computed` is `reactive.derived`: after 38.223 and 38.224, which write `computed`, and
    // ahead of 38.227, whose notes name the line as the migrations leave it.
    {
        version: '0.144.0',
        migrate: eachSource((text, path) => toDerived(text, path)),
    },
    // 38.227 — `poll` is a `ttl`, and a `reactive` or `reactive.derived` takes none of a source's options.
    { version: '0.144.0', migrate: eachSource(toSourceOptions) },
    // 38.229 — a key shared down the tree is a handle: declared once, and called where it is wanted.
    { version: '0.144.0', migrate: toShared },
    // 38.230 — a handler over a value the app declares as a `reactive` throws (16.109): noted, after
    // 38.228 has spelled every such value `reactive` or `reactive.derived`.
    { version: '0.144.0', migrate: toServedValues },
    // 38.231 — the five verbs are one `rpc`, and a handler file is a server file.
    { version: '0.145.0', migrate: toRpc },
    // 38.232 — a function `reactive` held is handed back by a body: ahead of 38.233, while every
    // `reactive` call is still the value form.
    { version: '0.145.0', migrate: eachSource(toHeldFunction) },
    // 38.233 — `reactive.derived` is `reactive`.
    { version: '0.145.0', migrate: eachSource(toReactive) },
]

/**
 * 38.198 — every migration keyed past `from` (every one where it is `undefined`) over the app whose
 * package is `directory`, answered as the files it would change, with each line it left the app to
 * decide handed to `noteEach` (38.226). Nothing is written.
 */
export async function upgrade(
    directory: string,
    from: string | undefined,
    noteEach: (note: UpgradeNote) => void = () => {},
): Promise<Edit[]> {
    const before = new Map<string, string | undefined>()
    const after = new Map<string, string | null>()
    const read = async (path: string): Promise<string | undefined> => {
        const changed = after.get(path)
        if (changed === null) return undefined
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
    let noted: { path: string; line: string; message: string }[] = []
    const note = (path: string, line: string, message: string): void => {
        noted.push({ path, line, message })
    }
    // Each migration's notes numbered in the text it left, so a later one rewriting the line keeps
    // the number; and a file a later one moves carries its notes with it (38.231).
    const numberedNotes: UpgradeNote[] = []
    const move = (from: string, to: string): void => {
        for (const each of numberedNotes) if (each.path === from) each.path = to
    }
    for (const migration of MIGRATIONS) {
        if (
            from !== undefined &&
            Bun.semver.order(migration.version, from) <= 0
        )
            continue
        for (const [path, text] of Object.entries(
            await migration.migrate(read, sources, note, move),
        )) {
            await read(path)
            after.set(path, text)
        }
        numberedNotes.push(...(await numbered(noted, read)))
        noted = []
    }
    const edits: Edit[] = []
    for (const [path, text] of after) {
        const original = before.get(path)
        if (text === null) {
            if (original !== undefined)
                edits.push({ path, before: original, after: null })
        } else if (text !== (original ?? ''))
            edits.push({ path, before: original ?? '', after: text })
    }
    for (const each of numberedNotes) noteEach(each)
    return edits
}

/**
 * Each note at the number of the line it names, in the file as the migrations left it — the first
 * line of that text no earlier note took, so two calls written alike are two lines.
 */
async function numbered(
    noted: { path: string; line: string; message: string }[],
    read: (path: string) => Promise<string | undefined>,
): Promise<UpgradeNote[]> {
    const taken = new Set<string>()
    const notes: UpgradeNote[] = []
    for (const { path, line, message } of noted) {
        const lines = ((await read(path)) ?? '').split('\n')
        let found = 0
        for (let index = 0; index < lines.length; index += 1)
            if (
                lines[index] === line &&
                !taken.has(`${path}:${index}:${message}`)
            ) {
                taken.add(`${path}:${index}:${message}`)
                found = index + 1
                break
            }
        notes.push({ path, line: found, message })
    }
    return notes
}
