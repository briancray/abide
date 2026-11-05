import { type Dirent, readdirSync, realpathSync, statSync } from 'node:fs' // Bun exposes no sync directory listing or realpath of its own
import { basename, dirname, join, resolve } from 'node:path' // Bun exposes no path helpers of its own

import type { SourceFile } from 'typescript/unstable/ast'
import { API, type Project, type Snapshot } from 'typescript/unstable/async'

import { placeOf } from '#server/placement.ts'

import { COMPONENT_MODULE } from './checkedShadow.ts'
import type { LoweredFile } from './LoweredFile.ts'
import { CHECKED_SUFFIX, SHADOW_SUFFIX, ShadowMap } from './ShadowMap.ts'
import { SOURCE_SUFFIX } from './splitImports.ts'

// Where every analysis of an app meets the checker. A `.abide` is projected into a SHADOW `.ts` held
// in a virtual filesystem and never written to disk, and TypeScript's own checker is asked about it.
// This holds those files, the snapshots the checker takes of them, and the lowerings an editor's
// questions map their offsets through — and `ask` is the one way a question reaches a project.
//
// The API is the ASYNC one on purpose. `typescript/unstable/sync` reads `child.stdout._handle.fd`
// and bun exposes no fd on a child pipe, so the sync channel cannot connect. The async channel is
// a stream and needs nothing.

/** The files a write registered and moved, for the next snapshot to be told. */
export type ShadowEdit = { created: string[]; changed: string[] }

/** The checker process, the virtual files it reads, and the snapshots it holds of them. */
export class ShadowHost {
    private api: API
    /** The `tsconfig` the host was opened on, which a file outside its project is refused by. */
    readonly tsconfig: string
    /**
     * Per checker key, the text the checker reads for a file this host wrote, and the path it
     * was registered under.
     *
     * KEYED AS THE CHECKER KEYS ITS OWN CACHE (`keyOf`), not by the string a caller handed in. On a
     * case-insensitive disk the checker folds `Page.abide.shadow.ts` and `page.abide.shadow.ts` to
     * one file, so a map telling them apart reported the second spelling `created` for a file the
     * checker already held — it read nothing, and answered the second text's reads at the first
     * text's offsets.
     */
    private shadows = new Map<string, { path: string; text: string }>()
    /** The checker's own key for a path: resolved, and case-folded where its host folds case. */
    readonly keyOf: (path: string) => string
    /**
     * Per `.abide` path as the checker keys it (`keyOf`), what a diagnosis last lowered it to.
     *
     * THE ONE THING CARRIED FROM ONE CALL TO ANOTHER, because an editor's hover is a request of
     * its own that arrives after the check that lowered the file, and has to map its offset
     * through the lowering the checker's program holds rather than one made again — and a span in
     * another `.abide` maps back through that file's own.
     */
    private lowerings = new Map<string, LoweredFile>()

    private constructor(
        api: API,
        tsconfig: string,
        keyOf: (path: string) => string,
        root: string,
    ) {
        this.api = api
        this.tsconfig = tsconfig
        this.root = root
        this.opened = `${dirname(tsconfig)}/${SESSION_CONFIG}`
        this.keyOf = keyOf
    }

    /**
     * The project this host opens: the app's tsconfig, with every shadow in `outside` a root.
     *
     * 34.25 — A DEPENDENCY'S `.abide` IS TYPED AS THE APP'S OWN, and its tsconfig's `include` never
     * reaches `node_modules` or a linked package's directory. The host opens a config of its own —
     * served from here, never written — that extends the app's, names those shadows as files, which
     * TypeScript adds to what the base config includes (a linked package's shadow, asked for through
     * the link, is reached no other way), and allows the declaration a package's `exports` is asked
     * for by (`standIn`).
     */
    private readonly opened: string

    /** The shadows of the files outside the app's own, as `opened` names them. */
    private outside = new Set<string>()

    private sessionConfig(): string {
        const config: {
            extends: string
            compilerOptions: Record<string, unknown>
            files?: string[]
        } = {
            extends: `./${basename(this.tsconfig)}`,
            // A package's `exports` names `./x.abide` exactly, so the checker asks for its
            // declaration as `./x.d.abide.ts` (`standIn`) — and takes the answer only with this.
            compilerOptions: { allowArbitraryExtensions: true },
        }
        // An empty `files` is a config error, and the base's `include` alone is the app.
        if (this.outside.size > 0) config.files = [...this.outside]
        return JSON.stringify(config)
    }

    /**
     * Checked-module paths a stand-in answered for, without the `.abide` being lowered.
     *
     * 38.39 — A `.abide` THIS HOST HAS NOT LOWERED IS STILL A MODULE ANOTHER CAN IMPORT. What its
     * checked module exports does not depend on what the component holds (`COMPONENT_MODULE`), so an
     * editor checking one page resolves the components it imports without lowering each of them.
     * Remembered, so the lowering that replaces a stand-in is reported as a change to it.
     */
    private stoodIn = new Set<string>()

    /** The app's root, real. */
    readonly root: string

    /**
     * `path` below the app's root, where it lies under it.
     *
     * 23.14 — what a page's route is read off: the directories below the root are it, and the
     * machine's directories above the root are not.
     */
    belowRoot(path: string): string {
        return path.startsWith(`${this.root}/`)
            ? path.slice(this.root.length + 1)
            : path
    }

    /**
     * The shadow registered at `name`, or at the same file through its directory's real path.
     *
     * 34.25 — A LINKED PACKAGE IS ASKED FOR THROUGH ITS LINK: the checker resolves `kit/x.abide` to
     * `node_modules/kit/x.d.abide.ts` and the re-export there to the shadow beside it, while the
     * shadow is registered where bun resolved the file — the package's real directory.
     */
    private shadowAt(name: string): { path: string; text: string } | undefined {
        const found = this.shadows.get(this.keyOf(name))
        // Only a shadow is registered through a link, so any other name is spared the realpath.
        if (
            found !== undefined ||
            !name.includes('/node_modules/') ||
            !(name.endsWith(SHADOW_SUFFIX) || name.endsWith(CHECKED_SUFFIX))
        )
            return found
        let real: string
        try {
            real = realpathSync(dirname(name))
        } catch {
            return undefined
        }
        return this.shadows.get(this.keyOf(`${real}/${basename(name)}`))
    }

    private standIn(name: string): string | undefined {
        // 34.21 — a file imported as text is its text, which the projection names apart.
        if (name.endsWith(`${SOURCE_SUFFIX}.d.ts`))
            return isFile(name.slice(0, -`${SOURCE_SUFFIX}.d.ts`.length))
                ? 'declare const text: string\nexport default text\n'
                : undefined
        // 34.17 — WHAT A `.abide` EXPORTS, to anything importing it: the component its checked
        // module declares, and nothing else. The checker resolves `./x.abide` by trying
        // `./x.abide.d.ts`; the bindings the projection re-exports for the build (16.70) are not
        // the importer's to read.
        //
        // 34.25 — AND THROUGH A PACKAGE'S `exports`, which the checker follows to the exact file and
        // so asks for the arbitrary extension's declaration, `./x.d.abide.ts`, instead.
        const abide = name.endsWith(DECLARATION_SUFFIX)
            ? name.slice(0, -'.d.ts'.length)
            : name.endsWith(EXPORTED_DECLARATION_SUFFIX)
              ? `${name.slice(0, -EXPORTED_DECLARATION_SUFFIX.length)}.abide`
              : undefined
        if (abide !== undefined) {
            if (!isFile(abide)) return undefined
            const own = `./${basename(abide)}`
            return `export { default } from '${own}${CHECKED_SUFFIX.slice(0, -'.ts'.length)}'
`
        }
        // A projection not registered — a file with nothing to read, or one this host has not
        // projected yet — exports nothing, so the declaration above always resolves.
        if (name.endsWith(`.abide${SHADOW_SUFFIX}`))
            return isFile(name.slice(0, -SHADOW_SUFFIX.length))
                ? 'export {}\n'
                : undefined
        if (!name.endsWith(`.abide${CHECKED_SUFFIX}`)) return undefined
        if (!isFile(name.slice(0, -CHECKED_SUFFIX.length))) return undefined
        this.stoodIn.add(this.keyOf(name))
        return COMPONENT_MODULE
    }

    /**
     * Opens a host on the project `tsconfig` configures, for the app at `root` — real, and empty
     * for a host asked about no app's routes.
     */
    static async open(tsconfig: string, root = ''): Promise<ShadowHost> {
        const api = new API({
            cwd: dirname(tsconfig),
            fs: {
                readFile: (name) =>
                    name === host.opened
                        ? host.sessionConfig()
                        : (host.shadowAt(name)?.text ?? host.standIn(name)),
                fileExists: (name) =>
                    name === host.opened ||
                    host.shadowAt(name) !== undefined ||
                    host.standIn(name) !== undefined
                        ? true
                        : undefined,
                getAccessibleEntries: (directory) => host.entriesIn(directory),
            },
        })
        // Whether the host folds case is the checker process's answer to `initialize`, and the API
        // keeps it only inside the private `toPath` its own `getSourceFile` keys by — so that is
        // what is read, rather than a second guess at the disk that could disagree with it.
        const internals = api as unknown as {
            ensureInitialized(): Promise<void>
            toPath?: (path: string) => string
        }
        await internals.ensureInitialized()
        const toPath = internals.toPath
        if (typeof toPath !== 'function')
            throw new Error(
                'abide: the TypeScript API no longer keeps `toPath` where the type session reads it, so a path cannot be keyed as the checker keys it.',
            )
        const host = new ShadowHost(api, tsconfig, toPath, root)
        return host
    }

    /**
     * The project as of the last snapshot, so a question asked after another shares its snapshot
     * rather than taking a second one.
     */
    private latest: Project | undefined = undefined
    private latestSnapshot: Snapshot | undefined = undefined

    /**
     * Snapshots a later one replaced, released once no call is in flight (`hold`).
     *
     * THE CHECKER PROCESS KEEPS EVERY SNAPSHOT UNTIL IT IS RELEASED — `updateSnapshot` releases
     * nothing — and each holds a whole program and checker. Dropped unreleased, a kept session grew
     * without bound: an `abide lsp` checker reached 59 GB in two hours of watcher-driven snapshots.
     * Released the moment it is replaced, a question still being answered over it throws, so the
     * release waits for the last call out.
     */
    private retired: Snapshot[] = []
    private inFlight = 0

    /**
     * Marks a call in flight until the returned value is disposed (`using`); the last one out
     * releases what was retired meanwhile. `ask` holds for as long as its question runs.
     */
    hold(): Disposable {
        this.inFlight += 1
        return {
            [Symbol.dispose]: () => {
                this.inFlight -= 1
                if (this.inFlight === 0) this.releaseRetired()
            },
        }
    }

    private retire(snapshot: Snapshot): void {
        this.retired.push(snapshot)
        if (this.inFlight === 0) this.releaseRetired()
    }

    private releaseRetired(): void {
        for (const snapshot of this.retired) {
            // A process that has stopped answering rejects the release, and dies with what it held.
            const release = snapshot.dispose().catch(() => {})
            this.releasing.add(release)
            void release.finally(() => this.releasing.delete(release))
        }
        this.retired = []
    }

    /** Releases sent and not yet answered, which `close` lets finish before ending the connection. */
    private releasing = new Set<Promise<void>>()

    /**
     * Paths edited or deleted on disk since the last snapshot, or `everything`.
     *
     * WHAT THE AUTHOR CHANGED ON DISK since the last snapshot, for a host kept across compiles
     * (`abide dev`). The checker caches every file it has read and is told only about the shadows
     * this class writes, so an edit to a module a page imports answered with the type it had when
     * the host opened: a name made reactive in a `.ts` stayed static, and a handler exported
     * since was not there. `everything` is the edit nobody could name, and drops the whole cache.
     */
    private edits = { present: [] as string[], deleted: [] as string[] }
    private everything = false

    /**
     * How many snapshots this host has taken.
     *
     * SNAPSHOTS TAKEN, and it is a counter rather than a timing because that is the only form of
     * this claim that survives a loaded machine. One per build is the contract; one per FILE is
     * the shape that made the checker 99.8% of compile time, and it reports the same answers.
     */
    snapshots = 0

    /**
     * A directory's listing as the checker sees it, with this host's shadows added.
     *
     * The shadow has to appear in its directory's listing or it is not a root of the project and
     * the checker never reads it.
     */
    private entriesIn(
        directory: string,
    ): { files: string[]; directories: string[] } | undefined {
        // TWO PATHS TO ONE DIRECTORY ARE ONE DIRECTORY. A raw string compare said otherwise on a
        // doubled separator, a trailing slash or a relative path, and the shadow then appeared in
        // nobody's listing — so the checker never read it and the refusal below blamed the app's
        // tsconfig for a path this class had mangled.
        const here = this.keyOf(directory)
        this.listed.add(here)
        const mine: string[] = []
        // The key is the checker's where it is registered, so only the incoming directory needs
        // keying — one `toPath` a call rather than one a shadow.
        for (const [key, shadow] of this.shadows)
            if (dirname(key) === here) mine.push(basename(shadow.path))
        if (mine.length === 0) return undefined

        const files: string[] = []
        const directories: string[] = []
        // A DIRECTORY THAT IS NOT THERE IS A LISTING OF THE SHADOWS ALONE, not a throw. The
        // checker calls this over the api and a throw crosses back as a remote error, which
        // PANICS the checker process — so a directory deleted between the glob and the ask took
        // the whole command down with it. `abide dev` is where that happens as a matter of
        // course: a generator that rewrites a tree of pages deletes every one of them first, and
        // the watcher fires while it is doing it.
        let entries: Dirent[]
        try {
            entries = readdirSync(directory, { withFileTypes: true })
        } catch (thrown) {
            if ((thrown as { code?: unknown }).code !== 'ENOENT') throw thrown
            return { files: mine, directories: [] }
        }
        // THE LISTING ALREADY KNOWS. A `statSync` per entry was N syscalls for an answer
        // `readdirSync` hands back with the name, and it THREW on a dangling symlink — an Emacs
        // `.#page.abide` lock beside a page took the whole build down with it.
        for (const entry of entries) {
            // A symlink is the one entry the listing cannot answer for, and a dangling one has no
            // answer at all — which is a file as far as this is concerned.
            if (entry.isSymbolicLink()) {
                let followed = false
                try {
                    followed = statSync(
                        join(directory, entry.name),
                    ).isDirectory()
                } catch {
                    // Dangling: a file, as `followed` already says.
                }
                if (followed) directories.push(entry.name)
                else files.push(entry.name)
                continue
            }
            if (entry.isDirectory()) directories.push(entry.name)
            else files.push(entry.name)
        }
        for (const name of mine) if (!files.includes(name)) files.push(name)
        return { files, directories }
    }

    /**
     * Records the paths a watcher saw move, for the next snapshot to invalidate.
     *
     * THE PATHS A WATCHER SAW MOVE, or `undefined` where it saw a move and could not say where.
     * A file that is there is reported CREATED AND CHANGED: `changed` alone leaves a new file out
     * of the project's root set (a `.d.ts` nothing imports is never read), and `created` alone
     * leaves an edited file's cached text in place. A directory is dropped wholesale, because the
     * checker is not told what was under it.
     */
    edited(paths: string[] | undefined): void {
        if (paths === undefined) {
            this.everything = true
            return
        }
        for (const path of paths) {
            let directory: boolean
            try {
                directory = statSync(path).isDirectory()
            } catch {
                this.edits.deleted.push(path)
                // A `.abide` that is gone takes its shadows with it, or the checker keeps a page
                // nobody has as a root of the project for the rest of the session — and a page
                // importing it goes on reading the props its checked module declared.
                const gone = this.keyOf(path)
                for (const [key, shadow] of this.shadows)
                    if (
                        ShadowMap.isShadowOf(key, gone) ||
                        key.startsWith(`${gone}/`)
                    ) {
                        this.shadows.delete(key)
                        this.edits.deleted.push(shadow.path)
                    }
                continue
            }
            // A FILE IN A DIRECTORY THE CHECKER HAS NEVER LISTED is a directory move the watcher
            // reported as the file alone — a save that creates `late/` and the page in it
            // at once — and the listing it already holds of the parent does not have it.
            if (directory || !this.listed.has(this.keyOf(dirname(path))))
                this.everything = true
            else this.edits.present.push(path)
        }
    }

    /** Every directory the checker has asked this host to list (`entriesIn`). */
    private listed = new Set<string>()

    /**
     * ONE SNAPSHOT TAKES EVERY EDIT WITH IT: the shadows written for it and whatever moved on disk.
     */
    private async snapshot(
        created: string[],
        changed: string[],
    ): Promise<Project | undefined> {
        const edits = this.edits
        const everything = this.everything
        this.edits = { present: [], deleted: [] }
        this.everything = false
        this.snapshots += 1
        // AN EDIT NOBODY COULD NAME DROPS THE CACHE, and the files created with it are still named
        // after it: a dropped cache re-reads what the project already listed, and a shadow written
        // for a page in a directory it never listed is not among them.
        if (everything)
            this.retire(
                await this.api.updateSnapshot({
                    openProjects: [this.opened],
                    fileChanges: { invalidateAll: true },
                }),
            )
        const snapshot = await this.api.updateSnapshot({
            openProjects: [this.opened],
            fileChanges: {
                created: [...created, ...edits.present],
                changed: [...changed, ...edits.present],
                deleted: edits.deleted,
            },
        })
        if (this.latestSnapshot !== undefined) this.retire(this.latestSnapshot)
        this.latestSnapshot = snapshot
        this.latest = snapshot.getProjects()[0]
        return this.latest
    }

    /** Whether the last snapshot still answers: there is one, and nothing has moved since. */
    private get current(): boolean {
        return (
            this.latest !== undefined &&
            !this.everything &&
            this.edits.present.length === 0 &&
            this.edits.deleted.length === 0
        )
    }

    private async currentProject(
        created: string[] = [],
        changed: string[] = [],
    ): Promise<Project | undefined> {
        return created.length === 0 && changed.length === 0 && this.current
            ? this.latest
            : await this.snapshot(created, changed)
    }

    /**
     * 34.25, 23.19 — where `source` is a dependency's file, makes `path` — it, or what it lowers to
     * — a root of the opened config, telling `edit` the config moved where it was not one already.
     * The app's own is a root already: telling the config it moved reloads the project.
     */
    openOutside(source: string, path: string, edit: ShadowEdit): void {
        if (placeOf(this.belowRoot(source)) !== 'dependency') return
        if (this.outside.has(path)) return
        this.outside.add(path)
        if (!edit.changed.includes(this.opened)) edit.changed.push(this.opened)
    }

    /**
     * `question` asked of the project, held until it is answered — or `undefined` where the checker
     * opened none.
     *
     * THE ONE WAY A QUESTION REACHES THE CHECKER. The project is the one `edit` moves to — the last
     * snapshot where nothing moved since — or, `latest`, the last snapshot as it stands: an editor's
     * question is asked of the program its check registered, whatever a watcher heard since.
     *
     * THE SNAPSHOT IS THE HOST'S, AND A QUESTION IS ANY MODULE'S: what a handler declares
     * (`declaredExports`) is asked of the same snapshot the reads were, taken only where something
     * moved since. 23.19 — a module of `modules` a mount places is a package's, which the app's
     * `include` does not reach: it is made a root, as a mounted `.abide`'s shadow is.
     */
    async ask<Answer>(
        question: (project: Project) => Promise<Answer>,
        asking: {
            edit?: ShadowEdit
            modules?: readonly string[]
            latest?: boolean
        } = {},
    ): Promise<Answer | undefined> {
        using _held = this.hold()
        const project = asking.latest
            ? this.latest
            : await this.projectWith(
                  asking.modules ?? [],
                  asking.edit ?? { created: [], changed: [] },
              )
        return project === undefined ? undefined : await question(project)
    }

    private async projectWith(
        modules: readonly string[],
        edit: ShadowEdit,
    ): Promise<Project | undefined> {
        for (const path of modules) {
            const canonical = this.canonical(path)
            this.openOutside(canonical, canonical, edit)
        }
        const project = await this.currentProject(edit.created, edit.changed)
        if (project === undefined || modules.length === 0) return project
        // A KEPT HOST HEARS OF A FILE ONLY AS A WATCHER REPORTS IT, and one saved into a
        // directory made since the last snapshot is reported as the directory: it is no root yet,
        // and is told to the next snapshot as created.
        const found = await Promise.all(
            modules.map((path) => project.program.getSourceFile(path)),
        )
        const missing: string[] = []
        for (let at = 0; at < modules.length; at += 1)
            if (found[at] === undefined) missing.push(modules[at] as string)
        return missing.length === 0
            ? project
            : await this.currentProject(missing, [...missing])
    }

    /**
     * The checker's tree of `path` in `project`, or a refusal naming `file` — the one the author
     * wrote — and what cannot be done without it.
     *
     * The file has to be INSIDE the opened project or the checker never reads it. Refusing loudly
     * rather than answering nothing: no reads is a file whose every name lowers as written, which
     * renders `[object Object]` where a value was due — a wrong page, with nothing about it saying
     * so — and no exports is a handler that never answers.
     */
    async sourceFile(
        project: Project,
        path: string,
        file: string,
        unanswered: string,
    ): Promise<SourceFile> {
        const sourceFile = await project.program.getSourceFile(path)
        if (sourceFile === undefined)
            throw new Error(
                `abide: ${file} is not inside the project ${this.tsconfig}, so ${unanswered}. Give the app a tsconfig whose include reaches it.`,
            )
        return sourceFile
    }

    /**
     * THE APP'S OWN FILES the checker holds as roots: under `within`, and neither a dependency nor a
     * declaration file. Resolved against the tsconfig's directory; a caller asking `holds` keys it.
     */
    rootsUnder(project: Project, within: string): string[] {
        const root = `${this.canonical(within)}/`
        const roots: string[] = []
        for (const path of project.rootFiles) {
            const canonical = this.canonical(path)
            if (
                canonical.startsWith(root) &&
                !path.includes('/node_modules/') &&
                !path.endsWith('.d.ts')
            )
                roots.push(canonical)
        }
        return roots
    }

    /**
     * A relative path from the checker is relative to the API's own cwd, which is the tsconfig's
     * directory rather than the process's.
     */
    canonical(path: string): string {
        return resolve(dirname(this.tsconfig), path)
    }

    /**
     * Where the checker holds a `.abide`'s projection, once its reads have registered it.
     *
     * 16.70 — what a `<script server>` binds is read off it as a `.ts` module's exports are.
     */
    projectionOf(abidePath: string): string {
        return `${this.canonical(abidePath)}${SHADOW_SUFFIX}`
    }

    /** Whether the checker reads `path` out of this host rather than off the disk. */
    holds(path: string): boolean {
        return this.shadows.has(this.keyOf(path))
    }

    /**
     * A file the checker reads out of this host, reported to `edit` only when it is new, its text
     * moved, or a stand-in answered for it until now.
     *
     * A file STAYS registered for the life of the host and the snapshot is told it changed.
     * Deleting and re-adding under the same path does not invalidate the source-file cache, and the
     * checker then answers about the PREVIOUS file at these offsets — right-looking types for the
     * wrong names, with nothing to say so.
     */
    write(path: string, text: string, edit: ShadowEdit): void {
        const key = this.keyOf(path)
        const previous = this.shadows.get(key)
        const stoodIn = this.stoodIn.delete(key)
        if (previous === undefined) edit.created.push(path)
        if (stoodIn || (previous !== undefined && previous.text !== text))
            edit.changed.push(path)
        this.shadows.set(key, { path, text })
    }

    /** The lowering a diagnosis last registered for the `.abide` at `path`, whatever its text. */
    lowered(path: string): LoweredFile | undefined {
        return this.lowerings.get(this.keyOf(path))
    }

    /** Keeps `lowered` as its file's lowering, for the questions asked of it later. */
    keep(lowered: LoweredFile): void {
        this.lowerings.set(this.keyOf(lowered.map.abidePath), lowered)
    }

    /**
     * Closes the checker, and ends its process.
     *
     * KILLED, NOT LEFT TO END ITSELF. The API's own close only ends the process's stdin, and a
     * `tsgo` that does not read the end of it lives on with this process's stderr in hand — one
     * outlived its build by eight hours, and anything reading that build's stderr to its end
     * (`abide build 2>&1 | tee`, a test's pipe) waits as long. The API holds the process on a
     * private field and forgets it as it closes, so it is taken first; `typeSession.test.ts` gates
     * that the field is still where this reads it.
     *
     * THE CLIENT IS CLOSED, NOT THE API: the API's close first asks the process to drop each
     * snapshot, and one that has stopped answering never settles it. The client's asks nothing —
     * it ends the connection, which rejects what was in flight — and the snapshots die with the
     * process.
     */
    async close(): Promise<void> {
        const client = (
            this.api as unknown as {
                client: {
                    process?: { kill(): boolean }
                    close(): Promise<void>
                }
            }
        ).client
        const child = client.process
        // A release still being written when the connection ends is a write after end, thrown
        // where nothing catches it. Bounded, for the same process that has stopped answering.
        if (this.releasing.size > 0)
            await Promise.race([
                Promise.allSettled(this.releasing),
                Bun.sleep(RELEASE_GRACE_MS),
            ])
        await client.close()
        child?.kill()
    }
}

// How long `close` waits on releases in flight before ending the connection under them.
const RELEASE_GRACE_MS = 1000

// What the checker asks for when it resolves an import of `x.abide` (`standIn`).
const DECLARATION_SUFFIX = '.abide.d.ts'
// Beside the app's tsconfig, so `extends` and every path in it resolve as they would from there.
const SESSION_CONFIG = 'tsconfig.abide-session.json'
const EXPORTED_DECLARATION_SUFFIX = '.d.abide.ts'

function isFile(path: string): boolean {
    try {
        return statSync(path).isFile()
    } catch {
        return false
    }
}
