import { type Dirent, readdirSync, statSync } from 'node:fs' // Bun exposes no sync directory listing of its own
import { basename, dirname, join, resolve } from 'node:path' // Bun exposes no path helpers of its own
import { type Node, NodeFlags, SyntaxKind } from 'typescript/unstable/ast'
import {
    API,
    type Symbol as CheckedSymbol,
    type Checker,
    NodeBuilderFlags,
    type Project,
    SignatureKind,
    SymbolFlags,
} from 'typescript/unstable/async'
import { fileKind, routeOf } from '#shared/routePattern.ts'
import { aliasedSymbol } from './aliasedSymbol.ts'
import { AMBIENT_SOURCES, ambientReadsIn } from './ambientReadsIn.ts'
import { argsDefaultsIn } from './argsDefaultsIn.ts'
import { type CheckerAnswer, UNCHECKED } from './CheckerAnswer.ts'
import {
    COMPONENT_MODULE,
    COMPONENT_STAND_IN,
    checkedShadow,
} from './checkedShadow.ts'
import type { Finding } from './Finding.ts'
import { CHECKED_VALUES } from './Lowering.ts'
import { diagnosisAt, lineOf } from './lineOf.ts'
import type { AbideFile } from './parseAbide.ts'
import { projectShadow } from './projectShadow.ts'
import { abideIn } from './reactiveTypes.ts'
import type { ParsedSource, ReadSource } from './readSources.ts'
import { readsIn, type ShadowSpans } from './readsIn.ts'
import { CHECKED_SUFFIX, ShadowMap } from './ShadowMap.ts'
import { templateWarnings } from './templateWarnings.ts'

// Where 31.3 gets its answer. A `.abide` file is projected into a SHADOW `.ts` held in a virtual
// filesystem and never written to disk, and TypeScript's own checker is asked what each declared
// name's type is. That is the whole reason the checker is here rather than a local inference over
// annotations: the corpus writes `let rows = reactive([...])` with no annotation anywhere, so the
// answer comes from the initializer's INFERRED type or it does not come at all.
//
// The API is the ASYNC one on purpose. `typescript/unstable/sync` reads `child.stdout._handle.fd`
// and bun exposes no fd on a child pipe, so the sync channel cannot connect. The async channel is
// a stream and needs nothing.

/** Whether a script can bind a name at all — a file that cannot is never handed to the checker. */
const DECLARES = /\b(?:const|let|var|import)\b/

/** A TypeScript checker session over an app, asked about its `.abide` files through shadows. */
export class TypeSession {
    private api: API
    /** The `tsconfig` the session was opened on, which a file outside its project is refused by. */
    readonly tsconfig: string
    /**
     * Per checker key, the text the checker reads for a file this session wrote, and the path it
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
    private keyOf: (path: string) => string
    /**
     * Per `.abide` path as the checker keys it (`keyOf`), what `diagnose` last lowered it to —
     * kept for `inspect` alone.
     *
     * THE ONE THING CARRIED FROM ONE CALL TO ANOTHER, because an editor's hover is a request of
     * its own that arrives after the check that lowered the file, and has to map its offset
     * through the lowering the checker's program holds rather than one made again. Everything a
     * check's own caller needs of the lowering, `diagnose` hands back.
     */
    private loweredForInspect = new Map<
        string,
        { text: string; map: ShadowMap }
    >()

    private constructor(
        api: API,
        tsconfig: string,
        keyOf: (path: string) => string,
    ) {
        this.api = api
        this.tsconfig = tsconfig
        this.keyOf = keyOf
    }

    /**
     * Checked-module paths a stand-in answered for, without the `.abide` being lowered.
     *
     * 38.40 — A `.abide` THIS SESSION HAS NOT LOWERED IS STILL A MODULE ANOTHER CAN IMPORT. What its
     * checked module exports does not depend on what the component holds (`COMPONENT_MODULE`), so an
     * editor checking one page resolves the components it imports without lowering each of them.
     * Remembered, so the lowering that replaces a stand-in is reported as a change to it.
     */
    private stoodIn = new Set<string>()

    private standIn(name: string): string | undefined {
        if (!name.endsWith(`.abide${CHECKED_SUFFIX}`)) return undefined
        try {
            if (!statSync(name.slice(0, -CHECKED_SUFFIX.length)).isFile())
                return undefined
        } catch {
            return undefined
        }
        this.stoodIn.add(this.keyOf(name))
        return COMPONENT_MODULE
    }

    /** Opens a session on the project `tsconfig` configures. */
    static async open(tsconfig: string): Promise<TypeSession> {
        const api = new API({
            cwd: dirname(tsconfig),
            fs: {
                readFile: (name) =>
                    session.shadows.get(session.keyOf(name))?.text ??
                    session.standIn(name),
                fileExists: (name) =>
                    session.shadows.has(session.keyOf(name)) ||
                    session.standIn(name) !== undefined
                        ? true
                        : undefined,
                getAccessibleEntries: (directory) =>
                    session.entriesIn(directory),
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
        const session = new TypeSession(api, tsconfig, toPath)
        return session
    }

    /**
     * The project as of the last snapshot, so a question asked after `readsFor` shares its snapshot
     * rather than taking a second one.
     */
    private latest: Project | undefined = undefined

    /**
     * Paths edited or deleted on disk since the last snapshot, or `everything`.
     *
     * WHAT THE AUTHOR CHANGED ON DISK since the last snapshot, for a session kept across compiles
     * (`abide dev`). The checker caches every file it has read and is told only about the shadows
     * this class writes, so an edit to a module a page imports answered with the type it had when
     * the session opened: a name made reactive in a `.ts` stayed static, and a handler exported
     * since was not there. `everything` is the edit nobody could name, and drops the whole cache.
     */
    private edits = { present: [] as string[], deleted: [] as string[] }
    private everything = false

    /**
     * How many snapshots this session has taken.
     *
     * SNAPSHOTS TAKEN, and it is a counter rather than a timing because that is the only form of
     * this claim that survives a loaded machine. One per build is the contract; one per FILE is
     * the shape that made the checker 99.8% of compile time, and it reports the same answers.
     */
    snapshots = 0

    /**
     * A directory's listing as the checker sees it, with this session's shadows added.
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
            if (directory) this.everything = true
            else this.edits.present.push(path)
        }
    }

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
        const snapshot = await this.api.updateSnapshot({
            openProjects: [this.tsconfig],
            fileChanges: everything
                ? { invalidateAll: true }
                : {
                      created: [...created, ...edits.present],
                      changed: [...changed, ...edits.present],
                      deleted: edits.deleted,
                  },
        })
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
     * The project as of every edit so far, for a job to ask its questions of.
     *
     * THE SNAPSHOT IS THE SESSION'S, AND A QUESTION IS ANY MODULE'S: what a handler declares
     * (`declaredExports`) is asked of the same snapshot the reads were, taken only where something
     * moved since.
     */
    project(): Promise<Project | undefined> {
        return this.currentProject()
    }

    /**
     * THE APP'S OWN FILES the checker holds as roots: under `within`, and neither a dependency nor a
     * declaration file. Resolved against the tsconfig's directory; a caller asking `shadows` keys it.
     */
    private rootsUnder(project: Project, within: string): string[] {
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
    private canonical(path: string): string {
        return resolve(dirname(this.tsconfig), path)
    }

    /**
     * A file the checker reads out of `shadows`, reported to the next snapshot only when it is new,
     * its text moved, or a stand-in answered for it until now.
     */
    private register(
        path: string,
        text: string,
        created: string[],
        changed: string[],
    ): void {
        const key = this.keyOf(path)
        const previous = this.shadows.get(key)
        const stoodIn = this.stoodIn.delete(key)
        if (previous === undefined) created.push(path)
        if (stoodIn || (previous !== undefined && previous.text !== text))
            changed.push(path)
        this.shadows.set(key, { path, text })
    }

    /**
     * The classified reactive reads in one `.abide` file.
     *
     * THE READS IN `file`: every occurrence of a name bound to a `Reactive` (31.3), classified, in
     * its projection (`projectShadow`). Everything else is left exactly as written. ONE FILE; a
     * build wants `readsFor`.
     */
    async reads(abidePath: string, file: AbideFile): Promise<CheckerAnswer> {
        const answered = await this.readsFor([{ path: abidePath, file }])
        return answered.answers[0] ?? UNCHECKED
    }

    /**
     * Reads and compiler warnings for every file, in one checker snapshot.
     *
     * EVERY FILE IN ONE SNAPSHOT, which is the whole of the compiler's build time. Measured at
     * 19.7 ms a file taking a snapshot each against 0.8 ms a file sharing one — 25x, because
     * adding a file to the project's root set is what costs, not asking about it. What each file's
     * shadow is asked is `readsIn`'s.
     *
     * WHAT IT HAS TO SAY THAT IS NOT A TYPE ERROR comes back beside the reads: the compiler's own
     * warnings (14.14 to 14.17, 31.13, 32.14), each on the `.abide` line where the source's text
     * was handed in.
     */
    async readsFor(
        sources: readonly (Pick<ParsedSource, 'path' | 'file'> & {
            text?: string
        })[],
    ): Promise<{ answers: CheckerAnswer[]; warnings: Diagnosis[] }> {
        const answered = await this.classify(sources)
        for (let at = 0; at < sources.length; at += 1) {
            const source = sources[at] as (typeof sources)[number]
            if (source.text !== undefined)
                answered.warnings.push(
                    ...templateWarnings(
                        source.path,
                        source.text,
                        source.file,
                        answered.answers[at] ?? UNCHECKED,
                    ),
                )
        }
        answered.warnings.sort(byPlace)
        return answered
    }

    private async classify(
        sources: readonly (Pick<ParsedSource, 'path' | 'file'> & {
            text?: string
        })[],
    ): Promise<{ answers: CheckerAnswer[]; warnings: Diagnosis[] }> {
        const warnings: Diagnosis[] = []
        // Per source, its shadow and what is asked of it, or `undefined` where nothing is declared.
        const queries: ({ map: ShadowMap; spans: ShadowSpans } | undefined)[] =
            []
        const created: string[] = []
        const changed: string[] = []

        // EVERY SOURCE PROJECTS BEFORE ANY SHADOW IS REGISTERED. A projection refuses (a top-level
        // `await`), and a shadow registered ahead of the refusal was in `shadows` with the lists
        // that would have reported it dropped — so the retry found nothing moved, and the checker
        // answered from the old shadow at the new one's offsets, or never had the file at all.
        const projected = sources.map((source) => ({
            source,
            projection: projectShadow(source.file),
        }))
        for (const { source, projection } of projected) {
            // 34.2 — A `<script module>` DECLARES NAMES TOO, and the `<script>` under it is inside
            // that scope on both sides. The projection holds both from offset 0.
            const scripts = projection.text.slice(0, projection.scripts.end)
            // A TEMPLATE POSITION IS A QUESTION TOO (14.2): a file that declares nothing but
            // writes `{format(total)}` has a position only the checker can prove static.
            if (!DECLARES.test(scripts) && projection.slots.size === 0) {
                queries.push(undefined)
                continue
            }
            // CANONICAL AT THE KEY, not at the comparison. A doubled separator or a relative
            // path is the same file and a raw string is not the same string — registered as it
            // arrived, the shadow appeared in nobody's directory listing AND named a file the
            // checker could not open, and the refusal below blamed the app's tsconfig for it.
            const map = new ShadowMap(
                this.canonical(source.path),
                projection.origins,
            )
            // A shadow STAYS registered for the life of the session and the snapshot is told it
            // changed. Deleting and re-adding under the same path does not invalidate the
            // source-file cache, and the checker then answers about the PREVIOUS file at these
            // offsets — right-looking types for the wrong names, with nothing to say so.
            // AN UNCHANGED SHADOW IS NOT REPORTED, which is what a kept session saves on a save:
            // the one page that moved is re-read rather than all of them.
            this.register(map.shadowPath, projection.text, created, changed)
            queries.push({
                map,
                spans: {
                    scriptsEnd: projection.scripts.end,
                    modules: projection.modules,
                    scripts: projection.scripts,
                    positions: projection.positions,
                },
            })
        }

        const answers = sources.map(() => UNCHECKED)
        if (queries.every((query) => query === undefined))
            return { answers, warnings }

        const project = await this.currentProject(created, changed)
        if (project === undefined) return { answers, warnings }
        const checker = project.checker
        const abide = await abideIn(project)

        await Promise.all(
            queries.map(async (query, at) => {
                if (query === undefined) return
                const source = sources[at] as (typeof sources)[number]
                const sourceFile = await project.program.getSourceFile(
                    query.map.shadowPath,
                )
                // The shadow has to be INSIDE the opened project or the checker never reads it.
                // Refusing loudly rather than answering nothing: no reads is a file whose every
                // name lowers as written, which renders `[object Object]` where a value was due —
                // a wrong page, with nothing about it saying so.
                if (sourceFile === undefined)
                    throw new Error(
                        `abide: ${source.path} is not inside the project ${this.tsconfig}, so no name in it can be typed (31.3). Give the app a tsconfig whose include reaches it.`,
                    )
                const read = await readsIn(
                    checker,
                    abide,
                    sourceFile,
                    query.map.shadowPath,
                    query.spans,
                    source.path,
                    source.file,
                )
                answers[at] = read.answer
                for (const warning of read.warnings)
                    warnings.push(
                        diagnosisAt(
                            source.path,
                            source.text,
                            query.map.toSource(
                                query.map.shadowPath,
                                warning.at,
                            ),
                            'warning',
                            warning.message,
                        ),
                    )
            }),
        )
        return { answers, warnings }
    }

    /**
     * What the build refuses and warns on in the app's `.ts` files and its `.abide` `sources`.
     *
     * 11.37 — `ambient`: every read of a request's ambient inside a `global` value's body, as errors.
     * 11.30 — `unkeyed`: every `args` defaulting a member its body's parameter does not, as warnings.
     * Both over every `.ts` under `within` and each of `sources` as the shadow `readsFor` registered
     * for it, because a keyed value is declared in a `.ts` as often as in a `.abide` — one walk of
     * the files for the two, each finding on its own line of the file an author wrote.
     */
    async lints(
        within: string,
        sources: readonly Omit<ParsedSource, 'quiet'>[],
    ): Promise<{ ambient: Diagnosis[]; unkeyed: Diagnosis[] }> {
        const ambient: Diagnosis[] = []
        const unkeyed: Diagnosis[] = []
        const project = await this.currentProject()
        if (project === undefined) return { ambient, unkeyed }
        const checker = project.checker
        const ambientPaths = new Map<string, string>()
        const declared = await Promise.all(
            AMBIENT_SOURCES.map((source) =>
                project.program.getSourceFile(source),
            ),
        )
        for (let at = 0; at < AMBIENT_SOURCES.length; at += 1) {
            const found = declared[at]?.path
            if (found !== undefined)
                ambientPaths.set(AMBIENT_SOURCES[at] as string, found)
        }
        const authored = new Map<
            string,
            { source: (typeof sources)[number]; map: ShadowMap }
        >()
        for (const source of sources) {
            const map = new ShadowMap(
                this.canonical(source.path),
                projectShadow(source.file).origins,
            )
            authored.set(this.keyOf(map.shadowPath), { source, map })
        }
        // A file of this session's own is one of `sources`' shadows or not walked at all: a
        // checked module is the lowering's, and placed nowhere an author wrote.
        const files: string[] = []
        for (const path of this.rootsUnder(project, within)) {
            const key = this.keyOf(path)
            if (authored.has(key) || !this.shadows.has(key)) files.push(path)
        }
        await Promise.all(
            files.map(async (path) => {
                const sourceFile = await project.program.getSourceFile(path)
                if (sourceFile === undefined) return
                const [reads, defaults] = await Promise.all([
                    ambientPaths.size === 0
                        ? []
                        : ambientReadsIn(checker, sourceFile, ambientPaths),
                    argsDefaultsIn(checker, sourceFile),
                ])
                if (reads.length === 0 && defaults.length === 0) return
                const shadow = authored.get(this.keyOf(path))
                const source = shadow?.source
                const text =
                    source === undefined
                        ? await Bun.file(path).text()
                        : source.text
                const place = (at: number): number =>
                    shadow === undefined ? at : shadow.map.toSource(path, at)
                for (const read of reads)
                    ambient.push(
                        diagnosisAt(
                            source?.path ?? path,
                            text,
                            place(read.at),
                            'error',
                            `abide: a \`global\` value's body reads \`${read.ambient}\`, which belongs to the request it was built in — every later request would be answered with this one's. Take it out of the body, or drop \`global\`. RULEBOOK 11.37.`,
                        ),
                    )
                for (const finding of defaults)
                    unkeyed.push(
                        diagnosisAt(
                            source?.path ?? path,
                            text,
                            place(finding.at),
                            'warning',
                            finding.message,
                        ),
                    )
            }),
        )
        ambient.sort(byPlace)
        unkeyed.sort(byPlace)
        return { ambient, unkeyed }
    }

    /**
     * The checker's diagnostics for each `.abide` source and the app's `.ts` roots.
     *
     * 38.3 — WHAT THE CHECKER SAYS ABOUT EACH FILE AS IT RUNS, placed on the `.abide` line. Each
     * source is checked as its lowered program (`checkedShadow`), which is registered for the life
     * of the session beside its shadow for the reason a shadow is; and every `.ts` root of the
     * project under `within` is checked as it stands, where `scripts` asks for them — an editor
     * asking about one page does not want the whole app. `sources` carry their text, which is what
     * a position is a line of. A `quiet` source is lowered and not reported on: a component an
     * editor's page imports, which is there for the props the page is held to (33.4).
     *
     * `refused` is the path of every source whose checked lowering refused, which `diagnoses` has
     * reported at its line — `abide check` emits the rest of the app without them.
     */
    async diagnose(
        sources: (Omit<ReadSource, 'quiet'> & { quiet?: boolean })[],
        within: string,
        scripts = true,
    ): Promise<{ diagnoses: Diagnosis[]; refused: Set<string> }> {
        const created: string[] = []
        const changed: string[] = []
        const checked: {
            source: (typeof sources)[number]
            map: ShadowMap
            refusals: readonly Finding[]
        }[] = []
        for (const source of sources) {
            const shadow = checkedShadow(source.file, source.answer)
            const map = new ShadowMap(
                this.canonical(source.path),
                projectShadow(source.file).origins,
                shadow.origins,
            )
            this.register(map.checkedPath, shadow.text, created, changed)
            checked.push({ source, map, refusals: shadow.refusals })
        }
        // 34.6 — WHAT THE BUNDLER RESOLVES AND THE CHECKER CANNOT: a stylesheet imported for its
        // effect. Declared in a file of its own at the app's root, which is a script, because a
        // pattern module can only be declared outside a module.
        this.register(
            `${this.canonical(within)}/${AMBIENT}`,
            AMBIENT_DECLARATIONS,
            created,
            changed,
        )
        // 30.26 — THE APP'S ROUTE TABLE, which `url`'s literal is held to: every page under the
        // root, declared into abide's own `Routes`. A module rather than a script, since only a
        // module augments one.
        this.register(
            `${this.canonical(within)}/${ROUTES_DECLARATION}`,
            routesDeclaration(within),
            created,
            changed,
        )
        const refusing = new Set<string>()
        for (const { source, refusals } of checked)
            if (refusals.length > 0) refusing.add(source.path)
        const project = await this.currentProject(created, changed)
        if (project === undefined) return { diagnoses: [], refused: refusing }
        const program = project.program
        // `path` is the file the author wrote, which for a checked module is not the file asked.
        const report = async (
            asked: string,
            path: string,
            place: (position: number) => { line: number; column: number },
        ): Promise<Diagnosis[]> => {
            const [syntactic, semantic] = await Promise.all([
                program.getSyntacticDiagnostics(asked),
                program.getSemanticDiagnostics(asked),
            ])
            const said: Diagnosis[] = []
            for (const diagnostic of [...syntactic, ...semantic])
                said.push({
                    path,
                    ...place(diagnostic.pos),
                    code: diagnostic.code,
                    category: CATEGORIES[diagnostic.category] ?? 'error',
                    // A checked module's own names are the lowering's, and read as the author's.
                    message: flatten(diagnostic).replaceAll(
                        `${CHECKED_VALUES}.`,
                        '',
                    ),
                })
            return said
        }
        const reports: Promise<Diagnosis[]>[] = []
        const refused: Diagnosis[] = []
        for (const { source, map, refusals } of checked) {
            this.loweredForInspect.set(this.keyOf(map.abidePath), {
                text: source.text,
                map,
            })
            if (source.quiet) continue
            // A refusal is at a projection offset (`Lowering.refusals`).
            for (const refusal of refusals)
                refused.push(
                    diagnosisAt(
                        source.path,
                        source.text,
                        map.toSource(map.shadowPath, refusal.at),
                        'error',
                        refusal.message,
                    ),
                )
            reports.push(
                report(map.checkedPath, source.path, (position) =>
                    lineOf(
                        source.text,
                        map.toSource(map.checkedPath, position),
                    ),
                ),
            )
        }
        const standing = scripts ? this.rootsUnder(project, within) : []
        for (const path of standing)
            if (!this.shadows.has(this.keyOf(path)))
                reports.push(
                    Bun.file(path)
                        .text()
                        .then((text) =>
                            report(path, path, (position) =>
                                lineOf(text, position),
                            ),
                        ),
                )
        const found = [...refused, ...(await Promise.all(reports)).flat()]
        found.sort(byPlace)
        return { diagnoses: found, refused: refusing }
    }

    /**
     * The hover signature, documentation and definitions of the name at `offset` in a `.abide`.
     *
     * 38.40 — WHAT THE NAME AT `offset` IN A `.abide` IS, asked of the program `diagnose` last lowered
     * it to: its type and documentation for a hover, and where it is declared for a jump. The
     * checked module is asked where the position was copied into it, which is what a member hangs
     * off — `regions.join` is `Array`'s — and the projection where the lowering rewrote it, so a
     * name read by name is the `Reactive` it was declared as.
     *
     * `text` IS WHAT THE EDITOR SHOWS, and an offset into it maps through a lowering of the same
     * text or not at all: a file the parser refuses keeps its last lowering, whose offsets have
     * moved under every edit since.
     */
    async inspect(
        path: string,
        text: string,
        offset: number,
    ): Promise<Inspection | undefined> {
        const lowered = this.loweredForInspect.get(this.keyOf(path))
        const project = this.latest
        if (
            lowered === undefined ||
            lowered.text !== text ||
            project === undefined
        )
            return undefined
        const asked = lowered.map.fromSource(offset)
        if (asked === undefined || !this.shadows.has(this.keyOf(asked.path)))
            return undefined
        const checker = project.checker
        const found = await checker.getSymbolAtPosition(
            asked.path,
            asked.position,
        )
        if (found === undefined) return undefined
        const symbol = await aliasedSymbol(checker, found)
        const declarations: Node[] = []
        for (const handle of symbol.declarations) {
            const node = await handle.resolve(project)
            if (node !== undefined) declarations.push(node)
        }
        // A `.abide` import resolves to its checked module's stand-in, which is the component.
        const component =
            symbol.name === COMPONENT_STAND_IN &&
            declarations[0]?.getSourceFile().fileName.endsWith(CHECKED_SUFFIX)
        const [signature, documentation] = component
            ? [
                  `(component) ${found.name}(props: ${await propsTypeOf(checker, symbol)})`,
                  '',
              ]
            : await Promise.all([
                  describe(project, symbol, declarations[0]),
                  symbol.getDocumentationComment(checker),
              ])
        const definitions: Place[] = []
        for (const node of declarations) {
            const named = (node as { name?: Node }).name ?? node
            const file = node.getSourceFile()
            definitions.push(
                this.placeOf(
                    file.fileName,
                    file.text,
                    named.getStart(file),
                    named.end,
                ),
            )
        }
        return {
            signature: signature.replaceAll(`${CHECKED_VALUES}.`, ''),
            documentation,
            definitions,
        }
    }

    /**
     * A span the checker read, placed in the file the author wrote.
     *
     * A span of a file the checker read, as the file the author wrote: a lowered `.abide` mapped
     * back through both of its maps, and one this session has not lowered — or a span of the
     * scaffolding a lowering adds, which the author never wrote — placed at its top.
     */
    private placeOf(
        fileName: string,
        text: string,
        start: number,
        end: number,
    ): Place {
        const canonical = this.canonical(fileName)
        const abidePath = ShadowMap.fileFor(canonical)
        if (abidePath === undefined)
            return {
                path: fileName,
                start: lineOf(text, start),
                end: lineOf(text, end),
            }
        const lowered = this.loweredForInspect.get(this.keyOf(abidePath))
        const placed = lowered?.map.spanToSource(canonical, start, end)
        if (lowered === undefined || placed === undefined) {
            const top = { line: 1, column: 1 }
            return { path: abidePath, start: top, end: top }
        }
        return {
            path: abidePath,
            start: lineOf(lowered.text, placed.start),
            end: lineOf(lowered.text, placed.end),
        }
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
        await client.close()
        child?.kill()
    }
}

const AMBIENT = 'abide-check.d.ts'
const ROUTES_DECLARATION = 'abide-routes.d.ts'
const URL_SOURCE = Bun.fileURLToPath(new URL('../shared/url', import.meta.url))

/** 30.26 — every page under `root` as a key of abide's `Routes`, or nothing where it has none. */
function routesDeclaration(root: string): string {
    const routes = new Set<string>()
    routesUnder(root, '', routes)
    let keys = ''
    for (const route of [...routes].sort())
        keys += `        ${JSON.stringify(route)}: true\n`
    return `export {}\ndeclare module ${JSON.stringify(URL_SOURCE)} {\n    interface Routes {\n${keys}    }\n}\n`
}
/**
 * The routes of the pages under `directory`, added to `routes`.
 *
 * A WALK RATHER THAN A GLOB, because it runs on every check and a glob descends `node_modules` and
 * the build before a filter can drop them — 15.6 ms against 5.7 from this repo's root, same pages.
 */
function routesUnder(
    directory: string,
    relative: string,
    routes: Set<string>,
): void {
    let entries: Dirent[]
    try {
        entries = readdirSync(directory, { withFileTypes: true })
    } catch {
        return
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue
        const path = `${relative}${entry.name}`
        if (entry.isDirectory())
            routesUnder(join(directory, entry.name), `${path}/`, routes)
        else if (fileKind(path) === 'page') routes.add(routeOf(path))
    }
}
const AMBIENT_DECLARATIONS = `declare module '*.css' {}
`

/**
 * One thing the checker said, placed in the file the author wrote.
 *
 * 38.3 — line and column from 1.
 */
export type Diagnosis = {
    path: string
    line: number
    column: number
    code: number
    category: 'error' | 'warning' | 'suggestion' | 'message'
    message: string
}

/**
 * Where something is in a file the author wrote, line and column from 1.
 *
 * 38.40.
 */
export type Place = {
    path: string
    start: { line: number; column: number }
    end: { line: number; column: number }
}

/**
 * The name under a cursor: how it is declared, what its doc comment says, and where.
 *
 * 38.40.
 */
export type Inspection = {
    signature: string
    documentation: string
    definitions: Place[]
}

/**
 * The props type a component's tag is held to, printed.
 *
 * 33.4 — the record its stand-in is called with.
 */
async function propsTypeOf(
    checker: Checker,
    component: CheckedSymbol,
): Promise<string> {
    const type = await checker.getTypeOfSymbol(component)
    const call =
        type === undefined
            ? undefined
            : (await checker.getSignaturesOfType(type, SignatureKind.Call))[0]
    const record =
        call === undefined ? undefined : await checker.getParameterType(call, 0)
    return record === undefined
        ? 'any'
        : checker.typeToString(record, undefined, NodeBuilderFlags.NoTruncation)
}

/**
 * How a hover spells a symbol, as tsserver does: the keyword it was declared with, its name, and its
 * type — a function's first signature, with how many more it has.
 */
async function describe(
    project: Project,
    symbol: CheckedSymbol,
    declaration: Node | undefined,
): Promise<string> {
    const checker = project.checker
    const flags = symbol.flags
    const name = symbol.name
    if (flags & SymbolFlags.Interface) return `interface ${name}`
    if (flags & SymbolFlags.Class) return `class ${name}`
    if (flags & SymbolFlags.TypeAlias)
        return `type ${name} = ${await checker.typeToString(
            await checker.getDeclaredTypeOfSymbol(symbol),
            undefined,
            NodeBuilderFlags.NoTruncation,
        )}`
    const type = await checker.getTypeOfSymbol(symbol)
    if (type === undefined) return name
    if (flags & (SymbolFlags.Function | SymbolFlags.Method)) {
        const signatures = await checker.getSignaturesOfType(
            type,
            SignatureKind.Call,
        )
        const first = signatures[0]
        const declared =
            first === undefined
                ? undefined
                : await checker.signatureToSignatureDeclaration(
                      first,
                      SyntaxKind.MethodSignature,
                      undefined,
                      NodeBuilderFlags.NoTruncation,
                  )
        if (declared !== undefined) {
            const printed = (await project.emitter.printNode(declared))
                .trim()
                .replace(/;$/, '')
            const more = signatures.length - 1
            return `${flags & SymbolFlags.Function ? 'function' : '(method)'} ${name}${printed}${
                more > 0 ? ` (+${more} overload${more === 1 ? '' : 's'})` : ''
            }`
        }
    }
    const spelled = await checker.typeToString(
        type,
        undefined,
        NodeBuilderFlags.NoTruncation,
    )
    let keyword = '(property)'
    if (flags & SymbolFlags.Function) keyword = 'function'
    else if (flags & SymbolFlags.Method) keyword = '(method)'
    else if (declaration?.kind === SyntaxKind.Parameter) keyword = '(parameter)'
    else if (flags & SymbolFlags.Variable) {
        const list = declaration?.parent.flags ?? 0
        keyword =
            list & NodeFlags.Const
                ? 'const'
                : list & NodeFlags.Let
                  ? 'let'
                  : 'var'
    }
    return `${keyword} ${name}: ${spelled}`
}

function byPlace(one: Diagnosis, two: Diagnosis): number {
    return (
        one.path.localeCompare(two.path) ||
        one.line - two.line ||
        one.column - two.column
    )
}

/** Indexed by the API's `DiagnosticCategory`. */
const CATEGORIES = ['warning', 'error', 'suggestion', 'message'] as const

function flatten(diagnostic: {
    text: string
    messageChain?:
        | readonly { text: string; messageChain?: unknown }[]
        | undefined
}): string {
    let message = diagnostic.text
    const chain = diagnostic.messageChain ?? []
    for (const link of chain)
        message += `\n  ${flatten(link as Parameters<typeof flatten>[0]).replaceAll('\n', '\n  ')}`
    return message
}
