import { readdirSync, statSync } from 'node:fs' // Bun exposes no sync directory listing of its own
import { dirname, join } from 'node:path' // Bun exposes no path helpers of its own
import { API } from 'typescript/unstable/async'
import { declaredNames } from './declaredNames.ts'
import type { AbideFile } from './parseAbide.ts'

// Where 31.3 gets its answer. A `.abide` file is projected into a SHADOW `.ts` held in a virtual
// filesystem and never written to disk, and TypeScript's own checker is asked what each declared
// name's type is. That is the whole reason the checker is here rather than a local inference over
// annotations: the corpus writes `let rows = reactive([...])` with no annotation anywhere, so the
// answer comes from the initializer's INFERRED type or it does not come at all.
//
// The API is the ASYNC one on purpose. `typescript/unstable/sync` reads `child.stdout._handle.fd`
// and bun exposes no fd on a child pipe, so the sync channel cannot connect. The async channel is
// a stream and needs nothing.

// What a name must be typed as to be read and written by name. A type alias over `Reactive` is not
// recognised, and that is a real limit rather than a decision — see the test beside this.
const REACTIVE_PREFIX = 'Reactive<'

export class TypeSession {
    private api: API
    private shadows = new Map<string, string>()

    private constructor(api: API) {
        this.api = api
    }

    static async open(tsconfig: string): Promise<TypeSession> {
        const session = new TypeSession(
            new API({
                cwd: dirname(tsconfig),
                fs: {
                    readFile: (name) => session.shadows.get(name),
                    fileExists: (name) =>
                        session.shadows.has(name) ? true : undefined,
                    getAccessibleEntries: (directory) =>
                        session.entriesIn(directory),
                },
            }),
        )
        session.tsconfig = tsconfig
        return session
    }

    private tsconfig = ''

    // The shadow has to appear in its directory's listing or it is not a root of the project and
    // the checker never reads it.
    private entriesIn(
        directory: string,
    ): { files: string[]; directories: string[] } | undefined {
        const mine: string[] = []
        for (const path of this.shadows.keys())
            if (dirname(path) === directory)
                mine.push(path.slice(directory.length + 1))
        if (mine.length === 0) return undefined

        const files: string[] = []
        const directories: string[] = []
        for (const entry of readdirSync(directory)) {
            if (statSync(join(directory, entry)).isDirectory())
                directories.push(entry)
            else files.push(entry)
        }
        for (const name of mine) if (!files.includes(name)) files.push(name)
        return { files, directories }
    }

    // The names in `file` whose type is a `Reactive`. Everything else is left exactly as written,
    // which is 19.12: an unresolved name reads rather than refuses the file.
    async reactiveNames(
        abidePath: string,
        file: AbideFile,
    ): Promise<Set<string>> {
        const names = declaredNames(file.scripts.join('\n'))
        if (names.length === 0) return new Set()

        const shadowPath = `${abidePath}.shadow.ts`
        const setup = file.scripts.join('\n')
        const offsets: number[] = []
        let shadow = `${setup}\n`
        for (const name of names) {
            offsets.push(shadow.length)
            shadow += `${name};\n`
        }
        // The shadow STAYS registered for the life of the session, and the snapshot is told it
        // changed. Deleting it and re-adding it under the same path does not invalidate the
        // source-file cache, and the checker then answers about the PREVIOUS file at these
        // offsets — right-looking types for the wrong names, with nothing to say so.
        const seen = this.shadows.has(shadowPath)
        this.shadows.set(shadowPath, shadow)

        try {
            const snapshot = await this.api.updateSnapshot({
                openProjects: [this.tsconfig],
                fileChanges: seen
                    ? { changed: [shadowPath] }
                    : { created: [shadowPath] },
            })
            const project = snapshot.getProjects()[0]
            if (project === undefined) return new Set()
            // ONE round trip for the whole file. The per-position overload exists and costs a
            // request each; the gate beside this counts them.
            let types: Awaited<
                ReturnType<typeof project.checker.getTypeAtPosition>
            >
            try {
                types = await project.checker.getTypeAtPosition(
                    shadowPath,
                    offsets,
                )
            } catch (thrown) {
                // The shadow has to be INSIDE the opened project or the checker never reads it.
                // Refusing loudly rather than answering an empty set: an empty set is a file
                // whose every name lowers as written, which renders `[object Object]` where a
                // value was due — a wrong page, with nothing about it saying so.
                throw new Error(
                    `abide: ${abidePath} is not inside the project ${this.tsconfig}, so no name in it can be typed (31.3). Give the app a tsconfig whose include reaches it.`,
                    { cause: thrown },
                )
            }
            const reactive = new Set<string>()
            for (let i = 0; i < names.length; i += 1) {
                const type = types[i]
                if (type === undefined) continue
                const text = await project.checker.typeToString(type)
                if (text.startsWith(REACTIVE_PREFIX))
                    reactive.add(names[i] as string)
            }
            return reactive
        } finally {
            // Left in place on purpose; see the note above the snapshot call.
        }
    }

    close(): void {
        this.api.close()
    }
}
