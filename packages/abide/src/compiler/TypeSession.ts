import { type Dirent, readdirSync, statSync } from 'node:fs' // Bun exposes no sync directory listing of its own
import { basename, dirname, join, resolve } from 'node:path' // Bun exposes no path helpers of its own
import {
    ModifierFlags,
    type Node,
    NodeFlags,
    SyntaxKind,
    type TypeNode,
} from 'typescript/unstable/ast'
import {
    isArrayLiteralExpression,
    isArrowFunction,
    isBinaryExpression,
    isCallExpression,
    isExportAssignment,
    isFunctionDeclaration,
    isFunctionExpression,
    isIdentifier,
    isImportDeclaration,
    isMethodDeclaration,
    isNamedImports,
    isNewExpression,
    isNoSubstitutionTemplateLiteral,
    isObjectBindingPattern,
    isObjectLiteralExpression,
    isParenthesizedExpression,
    isPropertyAccessExpression,
    isPropertyAssignment,
    isReturnStatement,
    isStringLiteral,
    isTypeAliasDeclaration,
    isVariableDeclaration,
    isVariableStatement,
} from 'typescript/unstable/ast/is'
import {
    API,
    type Symbol as CheckedSymbol,
    type Checker,
    NodeBuilderFlags,
    ObjectFlags,
    type ObjectType,
    type Project,
    SignatureKind,
    SymbolFlags,
    type Type,
    TypeFlags,
    type TypeParameter,
    type TypeReference,
    type UnionOrIntersectionType,
} from 'typescript/unstable/async'
import type { Mount } from '#server/answerRpc.ts'
import type { CopyOptions } from '#shared/CopyOptions.ts'
import {
    type Defaults,
    defaultsInSource,
} from '#shared/reactive/parameterDefaults.ts'
import { routeOf } from '#shared/routePattern.ts'
import type { Method } from '#shared/rpc.ts'
import { aliasedSymbol } from './aliasedSymbol.ts'
import { AMBIENT_SOURCES, ambientReadsIn } from './ambientReadsIn.ts'
import {
    argsDefaultsIn,
    defaultedMembers,
    parameterPattern,
} from './argsDefaultsIn.ts'
import { argsSchemaOf } from './argsSchemaOf.ts'
import {
    CHECKED_SUFFIX,
    type CheckedShadow,
    COMPONENT_MODULE,
    COMPONENT_STAND_IN,
    checkedShadow,
    copiedFrom,
    mapBack,
    mapForward,
} from './checkedShadow.ts'
import {
    classifyPropRead,
    classifyRead,
    newRead,
    provePosition,
    type Read,
    slotFacts,
} from './classifyRead.ts'
import { CHECKED_VALUES } from './Lowering.ts'
import { diagnosisAt, lineOf } from './lineOf.ts'
import type { AbideFile } from './parseAbide.ts'
import {
    type Origin,
    type Projection,
    projectShadow,
    type Span,
} from './projectShadow.ts'
import { REACTIVE_MEMBERS } from './REACTIVE_MEMBERS.ts'
import {
    isReactiveCall,
    optionNamed,
    reactiveOptions,
} from './reactiveOptions.ts'
import { templateWarnings } from './templateWarnings.ts'
import { trackingWarnings, type Warning } from './trackingWarnings.ts'

// Where 31.3 gets its answer. A `.abide` file is projected into a SHADOW `.ts` held in a virtual
// filesystem and never written to disk, and TypeScript's own checker is asked what each declared
// name's type is. That is the whole reason the checker is here rather than a local inference over
// annotations: the corpus writes `let rows = reactive([...])` with no annotation anywhere, so the
// answer comes from the initializer's INFERRED type or it does not come at all.
//
// The API is the ASYNC one on purpose. `typescript/unstable/sync` reads `child.stdout._handle.fd`
// and bun exposes no fd on a child pipe, so the sync channel cannot connect. The async channel is
// a stream and needs nothing.

/** What a `.abide`'s projection is registered with the checker as, beside the `.abide` itself. */
const SHADOW_SUFFIX = '.shadow.ts'

/** Whether a script can bind a name at all — a file that cannot is never handed to the checker. */
const DECLARES = /\b(?:const|let|var|import)\b/

/** A TypeScript checker session over an app, asked about its `.abide` files through shadows. */
export class TypeSession {
    private api: API
    private shadows = new Map<string, string>()
    /**
     * Per canonical `.abide` path, what `diagnose` last lowered it to, for `inspect` to map through.
     */
    private lowered = new Map<
        string,
        { text: string; projection: Projection; shadow: CheckedShadow }
    >()
    /** THE `.abide` BEHIND EACH SHADOW, for a finding in one to be placed in the other. */
    private authored = new Map<
        string,
        { path: string; text: string | undefined; origins: readonly Origin[] }
    >()

    private constructor(api: API) {
        this.api = api
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
        this.stoodIn.add(name)
        return COMPONENT_MODULE
    }

    /** Opens a session on the project `tsconfig` configures. */
    static async open(tsconfig: string): Promise<TypeSession> {
        const session = new TypeSession(
            new API({
                cwd: dirname(tsconfig),
                fs: {
                    readFile: (name) =>
                        session.shadows.get(name) ?? session.standIn(name),
                    fileExists: (name) =>
                        session.shadows.has(name) ||
                        session.standIn(name) !== undefined
                            ? true
                            : undefined,
                    getAccessibleEntries: (directory) =>
                        session.entriesIn(directory),
                },
            }),
        )
        session.tsconfig = tsconfig
        return session
    }

    private tsconfig = ''

    /**
     * The project as of the last snapshot, so a question asked after `readsFor` shares its snapshot
     * rather than taking a second one.
     */
    private project: Project | undefined = undefined

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
        const here = this.canonical(directory)
        const mine: string[] = []
        // The key is canonical where it is registered (`shadowPath` below), so only the
        // incoming directory needs resolving — one `resolve` a call rather than one a shadow.
        for (const path of this.shadows.keys())
            if (dirname(path) === here) mine.push(basename(path))
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
                const gone = this.canonical(path)
                for (const shadowPath of this.shadows.keys())
                    if (
                        shadowPath === `${gone}${SHADOW_SUFFIX}` ||
                        shadowPath === `${gone}${CHECKED_SUFFIX}` ||
                        shadowPath.startsWith(`${gone}/`)
                    ) {
                        this.shadows.delete(shadowPath)
                        this.edits.deleted.push(shadowPath)
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
        this.project = snapshot.getProjects()[0]
        return this.project
    }

    /** Whether the last snapshot still answers: there is one, and nothing has moved since. */
    private get current(): boolean {
        return (
            this.project !== undefined &&
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
            ? this.project
            : await this.snapshot(created, changed)
    }

    /**
     * THE APP'S OWN FILES the checker holds as roots: under `within`, and neither a dependency nor a
     * declaration file. Canonical, which is how a shadow is keyed.
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
        const previous = this.shadows.get(path)
        const stoodIn = this.stoodIn.delete(path)
        if (previous === undefined) created.push(path)
        if (stoodIn || (previous !== undefined && previous !== text))
            changed.push(path)
        this.shadows.set(path, text)
    }

    /**
     * The classified reactive reads in one `.abide` file.
     *
     * THE READS IN `file`: every occurrence of a name bound to a `Reactive` (31.3), classified, in
     * its projection (`projectShadow`). Everything else is left exactly as written. ONE FILE; a
     * build wants `readsFor`.
     */
    async reads(abidePath: string, file: AbideFile): Promise<Read[]> {
        const answers = await this.readsFor([{ path: abidePath, file }])
        return answers.reads[0] ?? []
    }

    /**
     * Reads and compiler warnings for every file, in one checker snapshot.
     *
     * EVERY FILE IN ONE SNAPSHOT, which is the whole of the compiler's build time. Measured at
     * 19.7 ms a file taking a snapshot each against 0.8 ms a file sharing one — 25x, because
     * adding a file to the project's root set is what costs, not asking about it.
     *
     * THE CHECKER'S OWN TREE ANSWERS BOTH QUESTIONS. Which names the file binds is its top-level
     * `const`/`let`/`var` statements and its imports — an inner block's name is not the page's — and
     * which occurrences reach one is the references to that symbol. A parameter, a row's item, a
     * key, a member, a label and a class field of the same spelling are other symbols, and are
     * absent. What each reference DOES — a read, a write, an update, a shorthand — is read off its
     * parents by `classifyRead`, so no token walk re-derives the grammar.
     *
     * WHAT IT HAS TO SAY THAT IS NOT A TYPE ERROR comes back beside the reads: the compiler's own
     * warnings (14.14 to 14.17, 31.13, 32.14), each on the `.abide` line where the source's text
     * was handed in.
     */
    async readsFor(
        sources: { path: string; file: AbideFile; text?: string }[],
    ): Promise<{ reads: Read[][]; warnings: Diagnosis[] }> {
        const answered = await this.classify(sources)
        for (let at = 0; at < sources.length; at += 1) {
            const source = sources[at] as (typeof sources)[number]
            if (source.text !== undefined)
                answered.warnings.push(
                    ...templateWarnings(
                        source.path,
                        source.text,
                        source.file,
                        answered.reads[at] ?? [],
                    ),
                )
        }
        answered.warnings.sort(byPlace)
        return answered
    }

    private async classify(
        sources: { path: string; file: AbideFile; text?: string }[],
    ): Promise<{ reads: Read[][]; warnings: Diagnosis[] }> {
        const warnings: Diagnosis[] = []
        // Per source, its shadow's path and where its scripts end, or '' where nothing is declared.
        const queries: {
            shadowPath: string
            scriptsEnd: number
            slots: readonly Span[]
            setups: readonly Span[]
            origins: readonly Origin[]
        }[] = []
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
            const slots = [...projection.slots.values()]
            if (!DECLARES.test(scripts) && slots.length === 0) {
                queries.push({
                    shadowPath: '',
                    scriptsEnd: 0,
                    slots,
                    setups: projection.setups,
                    origins: projection.origins,
                })
                continue
            }
            // CANONICAL AT THE KEY, not at the comparison. A doubled separator or a relative
            // path is the same file and a raw string is not the same string — registered as it
            // arrived, the shadow appeared in nobody's directory listing AND named a file the
            // checker could not open, and the refusal below blamed the app's tsconfig for it.
            const shadowPath = `${this.canonical(source.path)}${SHADOW_SUFFIX}`
            // A shadow STAYS registered for the life of the session and the snapshot is told it
            // changed. Deleting and re-adding under the same path does not invalidate the
            // source-file cache, and the checker then answers about the PREVIOUS file at these
            // offsets — right-looking types for the wrong names, with nothing to say so.
            // AN UNCHANGED SHADOW IS NOT REPORTED, which is what a kept session saves on a save:
            // the one page that moved is re-read rather than all of them.
            this.register(shadowPath, projection.text, created, changed)
            this.authored.set(shadowPath, {
                path: source.path,
                text: source.text,
                origins: projection.origins,
            })
            queries.push({
                shadowPath,
                scriptsEnd: projection.scripts.end,
                slots,
                setups: projection.setups,
                origins: projection.origins,
            })
        }

        const answers: Read[][] = sources.map(() => [])
        if (queries.every((query) => query.shadowPath === ''))
            return { reads: answers, warnings }

        const project = await this.currentProject(created, changed)
        if (project === undefined) return { reads: answers, warnings }
        const checker = project.checker
        const abide = await abideIn(project)

        await Promise.all(
            queries.map(async (query, at) => {
                if (query.shadowPath === '') return
                const sourceFile = await project.program.getSourceFile(
                    query.shadowPath,
                )
                // The shadow has to be INSIDE the opened project or the checker never reads it.
                // Refusing loudly rather than answering nothing: no reads is a file whose every
                // name lowers as written, which renders `[object Object]` where a value was due —
                // a wrong page, with nothing about it saying so.
                if (sourceFile === undefined)
                    throw new Error(
                        `abide: ${sources[at]?.path} is not inside the project ${this.tsconfig}, so no name in it can be typed (31.3). Give the app a tsconfig whose include reaches it.`,
                    )
                // A destructuring pattern binds names this does not see, and that is 31.12's case.
                const names: Node[] = []
                const spelled = new Set<string>()
                const bind = (name: Node): void => {
                    if (!isIdentifier(name) || spelled.has(name.text)) return
                    spelled.add(name.text)
                    names.push(name)
                }
                for (const statement of sourceFile.statements) {
                    if (statement.getStart() >= query.scriptsEnd) break
                    if (isVariableStatement(statement)) {
                        for (const declaration of statement.declarationList
                            .declarations)
                            bind(declaration.name)
                        continue
                    }
                    // 31.1 — AN IMPORT BINDS A NAME AS A DECLARATION DOES, and the clause does not
                    // tell the two apart: `onboarding` from `#shared/conversations` is read and
                    // written by name like the page's own. A NAMESPACE is not one of them — the
                    // name is bound to the module, and `ns.value` is a member of it.
                    if (!isImportDeclaration(statement)) continue
                    const clause = statement.importClause
                    if (
                        clause === undefined ||
                        clause.phaseModifier === SyntaxKind.TypeKeyword
                    )
                        continue
                    if (clause.name !== undefined) bind(clause.name)
                    const named = clause.namedBindings
                    if (named !== undefined && isNamedImports(named))
                        for (const element of named.elements)
                            if (!element.isTypeOnly) bind(element.name)
                }
                // 31.1 REACHES A BRANCH-LOCAL `<script>` (14.8), which stands inside the arm's braces
                // or the row's loop rather than at the top — and a name there is spelled apart from
                // the page's, since two arms may each declare their own `inner`.
                const topLevel = names.length
                if (query.setups.length > 0) {
                    const inSetup = (node: Node): boolean => {
                        const start = node.getStart()
                        for (const span of query.setups)
                            if (start >= span.start && start < span.end)
                                return true
                        return false
                    }
                    const visit = (node: Node): void => {
                        if (node.end <= query.scriptsEnd) return
                        // The script's own statements, as the top-level walk takes the page's: a
                        // declaration inside one of its functions is not a name the body reads.
                        if (inSetup(node)) {
                            if (isVariableStatement(node))
                                for (const declaration of node.declarationList
                                    .declarations)
                                    if (isIdentifier(declaration.name))
                                        names.push(declaration.name)
                            return
                        }
                        node.forEachChild(visit)
                    }
                    sourceFile.forEachChild(visit)
                }
                // 33's pass runs whatever 31.3's found: a `props` pattern binds no name the walk
                // above collects — `const { amount } = props()` declares a PATTERN — so a file
                // whose only declaration is one would have returned with its props unread.
                const props = propsReads(
                    checker,
                    abide,
                    sourceFile,
                    query.shadowPath,
                    query.scriptsEnd,
                    answers[at] as Read[],
                )
                // Awaited after the round trips below, so a 33.14 refusal would reject with nothing
                // listening and be reported unhandled; `await props` still throws it.
                props.catch(() => {})
                const params = routeParamsReads(
                    checker,
                    abide,
                    sourceFile,
                    sources[at]?.path ?? '',
                    answers[at] as Read[],
                )
                // No name is no round trip to ask about none.
                const symbols =
                    names.length === 0
                        ? []
                        : await checker.getSymbolAtLocation(names)
                const reactive = await Promise.all(
                    symbols.map(async (symbol) =>
                        symbol !== undefined &&
                        (await isReactiveSymbol(checker, abide, symbol))
                            ? symbol
                            : undefined,
                    ),
                )
                await dropValueHolders(checker, names, reactive)
                // 32.32 — A VALUE WHOSE `reactive(…)` DECLARES `by` keys a `{#for}` over it,
                // wherever the value is declared.
                const byValue = await Promise.all(
                    reactive.map(async (symbol) => {
                        if (symbol === undefined) return false
                        const options = reactiveOptions(
                            await boundInitializer(checker, symbol),
                        )
                        return (
                            options !== undefined &&
                            optionNamed(options, 'by') !== undefined
                        )
                    }),
                )
                const nodes = await Promise.all(
                    reactive.map(async (symbol) => {
                        if (symbol === undefined) return []
                        const references =
                            await checker.getReferencesToSymbolInFile(
                                query.shadowPath,
                                symbol,
                            )
                        return Promise.all(
                            references.map((reference) => reference.resolve()),
                        )
                    }),
                )
                const reads = answers[at] as Read[]
                const holding: Promise<void>[] = []
                const located: { node: Node; read: Read }[] = []
                for (let index = 0; index < nodes.length; index += 1)
                    for (const node of nodes[index] as (Node | undefined)[]) {
                        if (node === undefined) continue
                        const read = classifyRead(node)
                        if (read === undefined) continue
                        read.byValue = byValue[index] as boolean
                        read.local = index >= topLevel
                        reads.push(read)
                        located.push({ node, read })
                        if (read.shape === 'value')
                            holding.push(
                                declaredType(checker, node).then(
                                    async (type) => {
                                        if (
                                            type !== undefined &&
                                            (await isReactiveType(
                                                checker,
                                                abide,
                                                type,
                                                true,
                                            ))
                                        )
                                            read.shape = 'asWritten'
                                    },
                                ),
                            )
                    }
                await Promise.all(holding)
                await props
                await params
                await proveSlots(checker, sourceFile, query.slots, reads)
                reads.sort(byPosition)
                const source = sources[at] as (typeof sources)[number]
                const warned = await warningsFor(
                    checker,
                    located,
                    query.scriptsEnd,
                )
                for (const warning of warned)
                    warnings.push(
                        diagnosisAt(
                            source.path,
                            source.text,
                            mapBack(query.origins, warning.at),
                            'warning',
                            warning.message,
                        ),
                    )
            }),
        )
        return { reads: answers, warnings }
    }

    /**
     * Every read of a request's ambient inside a `global` value's body, as errors.
     *
     * 11.37 — every read of a request's ambient inside a `global` value's body, in the `.abide`
     * files `readsFor` was last handed and every `.ts` under `within`, each on its own line.
     */
    async ambientReads(within: string): Promise<Diagnosis[]> {
        const project = await this.currentProject()
        if (project === undefined) return []
        const paths = new Map<string, string>()
        const declared = await Promise.all(
            AMBIENT_SOURCES.map((source) =>
                project.program.getSourceFile(source),
            ),
        )
        for (let at = 0; at < AMBIENT_SOURCES.length; at += 1) {
            const found = declared[at]?.path
            if (found !== undefined)
                paths.set(AMBIENT_SOURCES[at] as string, found)
        }
        if (paths.size === 0) return []
        return this.findingsUnder(
            within,
            'error',
            async (checker, sourceFile) => {
                const found: Warning[] = []
                for (const read of await ambientReadsIn(
                    checker,
                    sourceFile,
                    paths,
                ))
                    found.push({
                        at: read.at,
                        message: `abide: a \`global\` value's body reads \`${read.ambient}\`, which belongs to the request it was built in — every later request would be answered with this one's. Take it out of the body, or drop \`global\`. RULEBOOK 11.37.`,
                    })
                return found
            },
        )
    }

    /**
     * Every `args` defaulting a member its body's parameter does not, as warnings.
     *
     * 11.30 — over the files `ambientReads` walks, for the same reason: a keyed value is declared
     * in a `.ts` as often as in a `.abide`.
     */
    argsDefaults(within: string): Promise<Diagnosis[]> {
        return this.findingsUnder(within, 'warning', argsDefaultsIn)
    }

    /**
     * What `find` says of each `.abide` `readsFor` was last handed and each `.ts` under `within`.
     *
     * Each finding on its own line of the file an author wrote.
     */
    private async findingsUnder(
        within: string,
        severity: 'error' | 'warning',
        find: (checker: Checker, sourceFile: Node) => Promise<Warning[]>,
    ): Promise<Diagnosis[]> {
        const project = await this.currentProject()
        if (project === undefined) return []
        const checker = project.checker
        const files: string[] = []
        for (const path of this.rootsUnder(project, within))
            if (
                !path.endsWith(CHECKED_SUFFIX) &&
                (this.authored.has(path) || !this.shadows.has(path))
            )
                files.push(path)
        const found = await Promise.all(
            files.map(async (path): Promise<Diagnosis[]> => {
                const sourceFile = await project.program.getSourceFile(path)
                if (sourceFile === undefined) return []
                const findings = await find(checker, sourceFile)
                if (findings.length === 0) return []
                const authored = this.authored.get(path)
                const text =
                    authored === undefined
                        ? await Bun.file(path).text()
                        : authored.text
                const origins = authored?.origins
                const said: Diagnosis[] = []
                for (const finding of findings)
                    said.push(
                        diagnosisAt(
                            authored?.path ?? path,
                            text,
                            origins === undefined
                                ? finding.at
                                : mapBack(origins, finding.at),
                            severity,
                            finding.message,
                        ),
                    )
                return said
            }),
        )
        return found.flat().sort(byPlace)
    }

    /**
     * Every value each module exports, with the abide method that declares it.
     *
     * 19.16 — EVERY VALUE EACH MODULE EXPORTS, and the method of the abide call that declares it, or
     * `undefined` where it is not one. The checker's own export table, so a name exported apart from
     * its declaration, under another name or from another module is the same export it is to an
     * importer; and the callee's own symbol, so `GET` imported under another name or through a
     * namespace is abide's, and an app's own function of that spelling is not. A type is not an
     * export here: it is erased, and has no address to answer at.
     */
    async handlersIn(paths: string[]): Promise<DeclaredExport[][]> {
        const project = await this.currentProject()
        if (project === undefined) return paths.map(() => [])
        const checker = project.checker
        // ABIDE'S FILE AS THE CHECKER NAMES IT, not as this module does: it canonicalises a path to
        // the disk's case rules, so on a case-insensitive disk `/Users/…/Code` comes back
        // `/users/…/code` and a string compared against `import.meta.url` never matched.
        const methodsPath = (
            await project.program.getSourceFile(METHODS_SOURCE)
        )?.path
        const socketPath = (await project.program.getSourceFile(SOCKET_SOURCE))
            ?.path
        const abide = await abideIn(project)
        return Promise.all(
            paths.map(async (path) => {
                const sourceFile = await project.program.getSourceFile(path)
                if (sourceFile === undefined)
                    throw new Error(
                        `abide: ${path} is not inside the project ${this.tsconfig}, so what it exports cannot be read (19.16). Give the app a tsconfig whose include reaches it.`,
                    )
                const module = await checker.getSymbolAtLocation(sourceFile)
                if (module === undefined) return []
                const exports = await checker.getExportsOfModule(module)
                const found = await Promise.all(
                    exports.map(async (exported) => {
                        const target = await aliasedSymbol(checker, exported)
                        if ((target.flags & SymbolFlags.Value) === 0)
                            return undefined
                        const declared = await declaringMethod(
                            checker,
                            target,
                            methodsPath,
                            socketPath,
                        )
                        const unread: Diagnosis[] = []
                        for (const value of declared?.unread ?? []) {
                            const file = value.getSourceFile()
                            unread.push(
                                diagnosisAt(
                                    file.fileName === sourceFile.fileName
                                        ? path
                                        : file.fileName,
                                    file.text,
                                    value.getStart(),
                                    'warning',
                                    `abide: \`${value.parent.getText()}\` is not a value the build can read, so \`${exported.name}\`'s browser copy is built without it. Write it as a literal, or as a \`const\` whose type is one. RULEBOOK 18.30.`,
                                ),
                            )
                        }
                        // 19.10 — a handler's args, as its annotation types them.
                        const handlerType =
                            declared === undefined ||
                            declared.method === 'SOCKET'
                                ? undefined
                                : await checker.getTypeOfSymbol(target)
                        if (handlerType !== undefined && abide.reactive) {
                            const at = await nestedReactiveIn(
                                checker,
                                abide.reactive,
                                await valueOfRpc(checker, handlerType),
                                '',
                                { seen: new Set(), depth: 0 },
                            )
                            if (at !== undefined)
                                throw new Error(
                                    `abide: ${path} — \`${exported.name}\` returns a \`Reactive\` at \`${at}\`, which the wire would carry as the function it is rather than the value it holds. Read it there, or return the \`Reactive\` itself to have it adopted (11.12). RULEBOOK 16.40.`,
                                )
                        }
                        return {
                            name: exported.name,
                            method: declared?.method,
                            ui: declared?.ui ?? true,
                            description: declared?.description,
                            copy: declared?.copy,
                            defaults: declared?.defaults,
                            args:
                                handlerType === undefined
                                    ? undefined
                                    : await argsSchemaOf(
                                          checker,
                                          handlerType,
                                          declared?.defaulted ?? [],
                                      ),
                            unread,
                        }
                    }),
                )
                const handlers: DeclaredExport[] = []
                for (const entry of found)
                    if (entry !== undefined) handlers.push(entry)
                return handlers
            }),
        )
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
     */
    async diagnose(
        sources: {
            path: string
            text: string
            file: AbideFile
            reads: Read[]
            quiet?: boolean
        }[],
        within: string,
        scripts = true,
    ): Promise<Diagnosis[]> {
        const created: string[] = []
        const changed: string[] = []
        const checked: {
            source: (typeof sources)[number]
            checkPath: string
            shadow: CheckedShadow
        }[] = []
        for (const source of sources) {
            const shadow = checkedShadow(source.file, source.reads)
            const checkPath = `${this.canonical(source.path)}${CHECKED_SUFFIX}`
            this.register(checkPath, shadow.text, created, changed)
            checked.push({ source, checkPath, shadow })
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
        const project = await this.currentProject(created, changed)
        if (project === undefined) return []
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
        for (const { source, checkPath, shadow } of checked) {
            const projection = projectShadow(source.file)
            this.lowered.set(this.canonical(source.path), {
                text: source.text,
                projection,
                shadow,
            })
            if (source.quiet) continue
            for (const refusal of shadow.refusals)
                refused.push(
                    diagnosisAt(
                        source.path,
                        source.text,
                        mapBack(projection.origins, refusal.at),
                        'error',
                        refusal.message,
                    ),
                )
            reports.push(
                report(checkPath, source.path, (position) =>
                    lineOf(
                        source.text,
                        mapBack(
                            projection.origins,
                            mapBack(shadow.origins, position),
                        ),
                    ),
                ),
            )
        }
        const standing = scripts ? this.rootsUnder(project, within) : []
        for (const path of standing)
            if (!this.shadows.has(path))
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
        return found
    }

    /**
     * Whether `diagnose` found a refusal in the checked lowering of `path`, which it has reported.
     */
    lowerRefused(path: string): boolean {
        const lowered = this.lowered.get(this.canonical(path))
        return lowered !== undefined && lowered.shadow.refusals.length > 0
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
        const abidePath = this.canonical(path)
        const lowered = this.lowered.get(abidePath)
        const project = this.project
        if (
            lowered === undefined ||
            lowered.text !== text ||
            project === undefined
        )
            return undefined
        const projected = mapForward(lowered.projection.origins, offset)
        if (projected === undefined) return undefined
        const checked = mapForward(lowered.shadow.origins, projected)
        const asked =
            checked === undefined
                ? `${abidePath}${SHADOW_SUFFIX}`
                : `${abidePath}${CHECKED_SUFFIX}`
        if (!this.shadows.has(asked)) return undefined
        const checker = project.checker
        const found = await checker.getSymbolAtPosition(
            asked,
            checked ?? projected,
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
        const suffix = canonical.endsWith(CHECKED_SUFFIX)
            ? CHECKED_SUFFIX
            : canonical.endsWith(`.abide${SHADOW_SUFFIX}`)
              ? SHADOW_SUFFIX
              : ''
        if (suffix === '')
            return {
                path: fileName,
                start: lineOf(text, start),
                end: lineOf(text, end),
            }
        const abidePath = canonical.slice(0, -suffix.length)
        const lowered = this.lowered.get(abidePath)
        const copied =
            lowered === undefined || suffix !== CHECKED_SUFFIX
                ? start
                : copiedFrom(lowered.shadow.origins, start)
        if (lowered === undefined || copied === undefined) {
            const top = { line: 1, column: 1 }
            return { path: abidePath, start: top, end: top }
        }
        const back = (position: number): number => {
            const projected =
                suffix === CHECKED_SUFFIX
                    ? mapBack(lowered.shadow.origins, position)
                    : position
            return mapBack(lowered.projection.origins, projected)
        }
        return {
            path: abidePath,
            start: lineOf(lowered.text, back(start)),
            end: lineOf(lowered.text, back(end)),
        }
    }

    close(): void {
        this.api.close()
    }
}

const AMBIENT = 'abide-check.d.ts'
const ROUTES_DECLARATION = 'abide-routes.d.ts'
const URL_SOURCE = new URL('../shared/url', import.meta.url).pathname

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
        else if (entry.name === 'page.abide' && path.includes('ui/pages/'))
            routes.add(routeOf(path))
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

/**
 * The tracking and type warnings a file's reactive reads earn.
 *
 * THE WARNINGS A FILE'S READS EARN. The syntax alone decides 14.14 to 14.16 (`trackingWarnings`);
 * 14.17 and 31.13 ask what a read hands back, which is the return of the `Reactive`'s call.
 */
async function warningsFor(
    checker: Checker,
    located: { node: Node; read: Read }[],
    templateStart: number,
): Promise<Warning[]> {
    const starts: { start: number; name: string }[] = []
    for (const { node, read } of located)
        if (READING.has(read.shape))
            starts.push({
                start: read.start,
                name: (node as { text?: string }).text ?? '',
            })
    const warnings: Warning[] = []
    const typed: Promise<void>[] = []
    for (const { node, read } of located) {
        const name = (node as { text?: string }).text ?? ''
        if (READING.has(read.shape))
            for (const warning of trackingWarnings(
                node,
                name,
                templateStart,
                starts,
            ))
                warnings.push(warning)
        const parent = node.parent
        const nullish =
            read.shape === 'value' &&
            isBinaryExpression(parent) &&
            parent.left === node &&
            parent.operatorToken.kind === SyntaxKind.QuestionQuestionToken
        const member =
            isPropertyAccessExpression(parent) &&
            parent.expression === node &&
            isIdentifier(parent.name) &&
            REACTIVE_MEMBERS.has(parent.name.text)
                ? parent.name.text
                : undefined
        if (!nullish && member === undefined) continue
        typed.push(
            valueTypeOf(checker, node).then(async (value) => {
                if (value === undefined) return
                // 14.17 — the fallback of a read that is never nullish is never taken: an unlanded
                // read is a hole the position fills, not an `undefined` (2.2).
                if (nullish && !(await admitsNullish(value)))
                    warnings.push({
                        at: read.start,
                        message: `abide: \`${name} ?? …\` never takes its fallback — a read of \`${name}\` is not undefined while it loads, and its type says it is not undefined after. Ask \`${name}.ready()\` to tell the two apart. RULEBOOK 14.17.`,
                    })
                if (member === undefined) return
                // Per member, because a union's properties are only those every member shares, and
                // `undefined` shares none — so `HTMLVideoElement | undefined` would declare no `error`.
                for (const held of await unionMembers(value)) {
                    if ((held.flags & NULLISH) !== 0) continue
                    for (const property of await checker.getPropertiesOfType(
                        held,
                    ))
                        if (property.name === member) {
                            const dot = (
                                parent as { questionDotToken?: unknown }
                            ).questionDotToken
                                ? '?.'
                                : '.'
                            warnings.push({
                                at: read.start,
                                message: `abide: \`${name}${dot}${member}\` reaches the Reactive's own \`${member}\`, and the value it holds has one too. Write \`${name}()${dot}${member}\` for the value's. RULEBOOK 31.13.`,
                            })
                            return
                        }
                }
            }),
        )
    }
    await Promise.all(typed)
    warnings.sort((one, two) => one.at - two.at)
    return warnings
}

/** The shapes that are a read of the value, which is what tracking is about. */
const READING: ReadonlySet<Read['shape']> = new Set([
    'value',
    'call',
    'shorthand',
])

/** What calling the `Reactive` a name holds hands back. */
async function valueTypeOf(
    checker: Checker,
    node: Node,
): Promise<Type | undefined> {
    const type = await checker.getTypeAtLocation(node)
    if (type === undefined) return undefined
    const [call] = await checker.getSignaturesOfType(type, SignatureKind.Call)
    return call === undefined
        ? undefined
        : checker.getReturnTypeOfSignature(call)
}

const NULLISH =
    TypeFlags.Null |
    TypeFlags.Undefined |
    TypeFlags.Void |
    TypeFlags.Any |
    TypeFlags.Unknown

async function admitsNullish(type: Type): Promise<boolean> {
    for (const member of await unionMembers(type))
        if ((member.flags & NULLISH) !== 0) return true
    return false
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

/** Where abide declares the five methods: `GET` is `declare('GET')` there and nowhere else. */
const METHODS_SOURCE = new URL('../shared/rpc.ts', import.meta.url).pathname
/** And where it declares `socket` (18.1), which a module under `server/sockets` exports. */
const SOCKET_SOURCE = new URL('../shared/socket.ts', import.meta.url).pathname

/** What declared an export: one of the five methods, or `socket`. */
type Declared = Mount['method']
type DeclaredExport = Pick<
    Mount,
    'name' | 'ui' | 'copy' | 'defaults' | 'args' | 'description'
> & {
    method: Declared | undefined
    /** 18.30 — what its copy's options declare and the build could not read. */
    unread: Diagnosis[]
}
const METHODS = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * The method of the abide call a value is declared by — `const x = GET(…)` or `export default
 * GET(…)` — or `undefined` where it is declared any other way.
 */
async function declaringMethod(
    checker: Checker,
    symbol: CheckedSymbol,
    methodsPath: string | undefined,
    socketPath: string | undefined,
): Promise<
    | {
          method: Declared
          ui: boolean
          description: string | undefined
          copy: CopyOptions | undefined
          unread: Node[]
          defaulted?: string[]
          defaults?: Defaults | undefined
      }
    | undefined
> {
    const declaration = await symbol.valueDeclaration?.resolve()
    const call =
        declaration === undefined
            ? undefined
            : isVariableDeclaration(declaration)
              ? declaration.initializer
              : isExportAssignment(declaration)
                ? declaration.expression
                : undefined
    if (call === undefined || !isCallExpression(call)) return undefined
    const callee = isPropertyAccessExpression(call.expression)
        ? call.expression.name
        : call.expression
    const named = await checker.getSymbolAtLocation(callee)
    if (named === undefined) return undefined
    const method = await aliasedSymbol(checker, named)
    const ui = !withheldFromUi(call)
    const description = describedAs(call)
    if (
        method.name === 'socket' &&
        socketPath !== undefined &&
        method.valueDeclaration?.path === socketPath
    )
        return {
            method: 'SOCKET',
            ui,
            description,
            copy: undefined,
            unread: [],
        }
    if (
        !METHODS.has(method.name) ||
        methodsPath === undefined ||
        method.valueDeclaration?.path !== methodsPath
    )
        return undefined
    const declared =
        method.name === 'GET'
            ? await declaredCopy(checker, call.arguments[0])
            : { copy: undefined, unread: [] }
    const body = await handlerBodyOf(checker, call.arguments[0])
    // 16.33 — A HANDLER DECLARED AS AN ASYNC GENERATOR ANSWERS A STREAM, and the browser's copy has to
    // read it as one rather than wait out the whole response: the one thing about it the build can
    // tell from its declaration and the wire cannot tell from its first byte in time.
    if (method.name === 'GET' && declaresStream(body))
        declared.copy = { ...declared.copy, stream: true }
    return {
        method: method.name as Method,
        ui,
        description,
        ...declared,
        defaulted: defaultedMembers(body),
        defaults: literalDefaults(body) ?? undefined,
    }
}

/**
 * The function a handler call is handed, followed through names and `reactive(…)`.
 *
 * What a handler call is handed, followed to its function — written inline, bound to a name,
 * declared as a function, or handed to `reactive` first — or what it is where it is no function.
 */
async function handlerBodyOf(
    checker: Checker,
    handed: Node | undefined,
): Promise<Node | undefined> {
    const node = await declarationOf(checker, handed)
    return node !== undefined && isCallExpression(node) && isReactiveCall(node)
        ? await declarationOf(checker, node.arguments[0])
        : node
}

const TRANSPILER = new Bun.Transpiler({ loader: 'ts' })

/**
 * The literal defaults a handler's parameter pattern writes, read as the runtime reads them.
 *
 * 11.29 — THE PATTERN'S OWN TEXT, TRANSPILED, through the reader the runtime uses on a body's
 * `toString()`: the server keys by what that reader makes of the handler, so the browser's copy is
 * handed the same answer rather than a second opinion of it. A default it cannot read is the
 * refusal the server would raise at import, raised here first.
 */
function literalDefaults(node: Node | undefined): Defaults | null {
    const pattern = parameterPattern(node)
    if (pattern === undefined) return null
    try {
        return defaultsInSource(
            TRANSPILER.transformSync(
                `export default (${pattern.getText()}) => 0`,
            ),
        )
    } catch (thrown) {
        throw new Error(
            `abide: ${pattern.getSourceFile().fileName}: ${(thrown as Error).message}`,
        )
    }
}

/**
 * The browser-copy options a `GET` declares, read statically, and the values that could not be.
 *
 * 18.19 — WHAT A `GET`'s VALUE DECLARES THAT ITS BROWSER COPY BEHAVES BY, read off its declaration for
 * 20.4's reason: what the build can read without running it. The `reactive(…)` the `GET` is handed,
 * and the options object it is handed, each written inline or bound to a name first. A value is
 * read off its TYPE, so `history: SIZE` over a `const SIZE = 3` carries 3 as `history: 3` does: a
 * string `by`, string `tags`, a number `history`, and an `identity` of abide's `structural`. A
 * function form has no serialisation and stays the server's. 18.30 — anything else of `by`, `tags`
 * or `history` is handed back UNREAD, for the build to warn on.
 */
async function declaredCopy(
    checker: Checker,
    handed: Node | undefined,
): Promise<{ copy: CopyOptions | undefined; unread: Node[] }> {
    const unread: Node[] = []
    const call = await boundValue(checker, handed)
    if (call === undefined || !isCallExpression(call) || !isReactiveCall(call))
        return { copy: undefined, unread }
    const options = await boundValue(checker, call.arguments[1])
    if (options === undefined || !isObjectLiteralExpression(options))
        return { copy: undefined, unread }
    const copy: CopyOptions = {}
    for (const property of options.properties) {
        if (!isPropertyAssignment(property) || !isIdentifier(property.name))
            continue
        const value = property.initializer
        const name = property.name.text
        if (name === 'identity') {
            if (
                isIdentifier(value) &&
                (await isAbideStructural(checker, value))
            )
                copy.identity = 'structural'
        } else if (name === 'by' || name === 'history' || name === 'tags') {
            const type = await checker.getTypeAtLocation(value)
            if (type === undefined) continue
            if (
                (await checker.getSignaturesOfType(type, SignatureKind.Call))
                    .length > 0
            )
                continue
            if (name === 'by' && type.isStringLiteralType())
                copy.by = type.value
            else if (name === 'history' && type.isNumberLiteralType())
                copy.history = type.value
            else if (name === 'tags') {
                const tags = await stringLiteralsOf(checker, value, type)
                if (tags === undefined) unread.push(value)
                else copy.tags = tags
            } else unread.push(value)
        }
    }
    return {
        copy: Object.keys(copy).length > 0 ? copy : undefined,
        unread,
    }
}

/** Whether a `GET`'s handler body (`handlerBodyOf`) is an `async function*`. */
function declaresStream(node: Node | undefined): boolean {
    return (
        node !== undefined &&
        (isFunctionExpression(node) || isFunctionDeclaration(node)) &&
        node.asteriskToken !== undefined &&
        (node.modifierFlags & ModifierFlags.Async) !== 0
    )
}

/** `boundValue`, and a function declaration where the name is one. */
async function declarationOf(
    checker: Checker,
    node: Node | undefined,
): Promise<Node | undefined> {
    if (node === undefined || !isIdentifier(node)) return node
    const named = await checker.getSymbolAtLocation(node)
    if (named === undefined) return undefined
    const declared = await (
        await aliasedSymbol(checker, named)
    ).valueDeclaration?.resolve()
    if (declared !== undefined && isFunctionDeclaration(declared))
        return declared
    return boundInitializer(checker, named)
}

/** A node, or where it is a name, what the name was initialised with. */
async function boundValue(
    checker: Checker,
    node: Node | undefined,
): Promise<Node | undefined> {
    if (node === undefined || !isIdentifier(node)) return node
    const named = await checker.getSymbolAtLocation(node)
    return named === undefined ? undefined : boundInitializer(checker, named)
}

/**
 * A list of names: an array literal of string-literal-typed elements, or a tuple type of string
 * literals (`as const`). `undefined` where it is anything else.
 */
async function stringLiteralsOf(
    checker: Checker,
    value: Node,
    type: Type,
): Promise<string[] | undefined> {
    const names: string[] = []
    if (isArrayLiteralExpression(value)) {
        for (const element of value.elements) {
            const each = await checker.getTypeAtLocation(element)
            if (each === undefined || !each.isStringLiteralType())
                return undefined
            names.push(each.value)
        }
        return names
    }
    if (!(await checker.isTupleType(type))) return undefined
    for (const each of await checker.getTypeArguments(type as TypeReference)) {
        if (!each.isStringLiteralType()) return undefined
        names.push(each.value)
    }
    return names
}

/**
 * What the value a symbol names was initialised with, through an import to the module that declares
 * it: `reactive(…)` in `const rows = reactive(…)`, wherever `rows` is read from.
 */
async function boundInitializer(
    checker: Checker,
    symbol: CheckedSymbol,
): Promise<Node | undefined> {
    const bound = await (
        await aliasedSymbol(checker, symbol)
    ).valueDeclaration?.resolve()
    return bound !== undefined && isVariableDeclaration(bound)
        ? bound.initializer
        : undefined
}

/**
 * Whether a name resolves to abide's own `structural` comparator.
 *
 * Abide's own comparator, by its symbol rather than its spelling: an app's function of the same name
 * is not the one the browser's copy would be handed.
 */
async function isAbideStructural(
    checker: Checker,
    named: Node,
): Promise<boolean> {
    const symbol = await checker.getSymbolAtLocation(named)
    if (symbol === undefined) return false
    const target = await aliasedSymbol(checker, symbol)
    return (
        target.name === 'structural' &&
        (target.valueDeclaration?.path ?? '').endsWith(
            '/shared/reactive/structural.ts',
        )
    )
}

/**
 * The `description` a handler call declares inline, where it is written as a literal.
 *
 * What the build can read without running the handler, as `withheldFromUi` reads `clients` — for
 * the shell, which lists the table the build wrote. A description built at run time still reaches
 * OpenAPI and MCP off the handler itself, and is not in the table.
 */
function describedAs(
    call: Node & { arguments?: readonly Node[] },
): string | undefined {
    const options = call.arguments?.[1]
    if (options === undefined || !isObjectLiteralExpression(options))
        return undefined
    const description = optionNamed(options, 'description')
    return description !== undefined &&
        (isStringLiteral(description) ||
            isNoSubstitutionTemplateLiteral(description))
        ? description.text
        : undefined
}

/**
 * Whether a handler call declares `clients: { ui: false }` inline.
 *
 * 20.4 — `clients: { ui: false }` written on the declaration, which is what the build can read without
 * running it: a browser is then handed no wrapper, and importing the handler from `#ui` is 16.30's
 * compile error. An options object built elsewhere is not read, and leaves the wrapper in place.
 */
function withheldFromUi(call: Node & { arguments?: readonly Node[] }): boolean {
    const options = call.arguments?.[1]
    if (options === undefined || !isObjectLiteralExpression(options))
        return false
    const clients = optionNamed(options, 'clients')
    return (
        clients !== undefined &&
        isObjectLiteralExpression(clients) &&
        optionNamed(clients, 'ui')?.kind === SyntaxKind.FalseKeyword
    )
}

/**
 * The declared type of the position a read stands in: a parameter, an annotated binding or return.
 *
 * 31.3 — THE DECLARED TYPE OF THE POSITION A READ STANDS IN, where it is one of the three the
 * clause names: a call's parameter, an annotated binding, an annotated return. An array literal
 * passes its position through, because `watch([a, b], …)` is the parameter's own shape. Anything
 * else is `undefined` and stays a read.
 *
 * THE PARAMETER IS ASKED OF THE SIGNATURE'S TARGET, the generic declaration, and never of the
 * instantiated one: `structuredClone<T>(value: T)` INFERS `T` from this very argument, and an
 * instantiated signature would call the argument a `Reactive` because it already is one in the
 * shadow.
 */
async function declaredType(
    checker: Checker,
    node: Node,
): Promise<Type | undefined> {
    let top = node
    while (
        isArrayLiteralExpression(top.parent) ||
        isParenthesizedExpression(top.parent)
    )
        top = top.parent
    const parent = top.parent
    if (
        (isCallExpression(parent) || isNewExpression(parent)) &&
        parent.expression !== top
    ) {
        const index = parent.arguments?.indexOf(top as never) ?? -1
        if (index < 0) return undefined
        const resolved = await checker.getResolvedSignature(parent)
        if (resolved === undefined) return undefined
        const signature = (await resolved.getTarget()) ?? resolved
        const parameters = await signature.getParameters()
        // A REST PARAMETER IS NOT ASKED: its type is the array it collects into, and the position
        // is one element of it. Nothing declares a `...Reactive[]` yet, so it stays a read.
        if (index >= parameters.length - 1 && signature.hasRestParameter)
            return undefined
        const parameter = parameters[index]
        return parameter === undefined
            ? undefined
            : checker.getTypeOfSymbol(parameter)
    }
    if (isVariableDeclaration(parent) && parent.initializer === top)
        return annotated(checker, parent.type)
    if (isReturnStatement(parent)) {
        let holder: Node = parent.parent
        while (
            holder !== undefined &&
            !isFunctionDeclaration(holder) &&
            !isFunctionExpression(holder) &&
            !isArrowFunction(holder) &&
            !isMethodDeclaration(holder)
        )
            holder = holder.parent
        return holder === undefined
            ? undefined
            : annotated(checker, (holder as { type?: TypeNode }).type)
    }
    if (isArrowFunction(parent) && parent.body === top)
        return annotated(checker, parent.type)
    return undefined
}

function annotated(
    checker: Checker,
    type: TypeNode | undefined,
): Promise<Type | undefined> {
    return type === undefined
        ? Promise.resolve(undefined)
        : checker.getTypeFromTypeNode(type)
}

/**
 * Marks each template position the checker proves reads nothing reactive with a `static` read.
 *
 * 14.2 — EVERY TEMPLATE POSITION THE CHECKER CAN PROVE READS NOTHING REACTIVE, marked with a
 * zero-width `static` read at its start. Everything else is bound, which is the inversion: the old
 * question — does it NAME a `Reactive` — let `{big()}` over a function reading `n` be written once.
 *
 * A PROOF IS THREE THINGS: no reactive read inside the span, a syntax that runs no author code
 * but through the answers it hands back (`provePosition`), and those answers. Every member it reads
 * resolves to a plain property — a getter is code, and a member of `any` resolves to nothing — and
 * every value a coercion or the position itself turns into a string is a primitive, whose
 * conversion runs nothing either.
 *
 * ASKED IN TWO BATCHES A FILE, the checker's round trip being what costs. Each position's own tree
 * also says what needs no type at all: its `raw` callees and its refused `await` (`slotFacts`).
 */
async function proveSlots(
    checker: Checker,
    sourceFile: Node,
    slots: readonly Span[],
    reads: Read[],
): Promise<void> {
    if (slots.length === 0) return
    // Each position's expression is the one its projection wrapped in parentheses, so the `(`
    // stands one before the span.
    const byOpen = new Map<number, Span>()
    for (const span of slots) byOpen.set(span.start - 1, span)
    const found: { span: Span; node: Node }[] = []
    const visit = (node: Node): void => {
        if (node.kind === SyntaxKind.ParenthesizedExpression) {
            const span = byOpen.get(node.getStart())
            if (span !== undefined) {
                found.push({
                    span,
                    node: (node as unknown as { expression: Node }).expression,
                })
                return
            }
        }
        node.forEachChild(visit)
    }
    visit(sourceFile)
    const rawCallees: Node[] = []
    for (const { node } of found) slotFacts(node, rawCallees)

    // Reads are unsorted here; a position holding one is not asked about.
    const read = (span: Span): boolean => {
        for (const one of reads)
            if (one.start >= span.start && one.start < span.end) return true
        return false
    }
    const candidates: {
        span: Span
        primitives: Node[]
        members: Node[]
    }[] = []
    const primitives: Node[] = []
    const members: Node[] = []
    for (const { span, node } of found) {
        if (read(span)) continue
        const own = { span, primitives: [] as Node[], members: [] as Node[] }
        if (!provePosition(node, own.primitives, own.members)) continue
        candidates.push(own)
        for (const one of own.primitives) primitives.push(one)
        for (const one of own.members) members.push(one)
    }
    // A `Reactive` the page named `raw` is a read, and the read's rewrite is the answer.
    if (rawCallees.length > 0) {
        const named = new Set<number>()
        for (const one of reads) named.add(one.start)
        for (const callee of rawCallees)
            if (!named.has(callee.getStart()))
                reads.push(newRead(callee.getStart(), callee.end, 'raw'))
    }
    if (candidates.length === 0) return
    const [types, symbols] = await Promise.all([
        primitives.length === 0
            ? Promise.resolve([])
            : checker.getTypeAtLocation(primitives),
        members.length === 0
            ? Promise.resolve([])
            : checker.getSymbolAtLocation(members),
    ])
    const primitive = await Promise.all(
        types.map((type) => type !== undefined && isPrimitiveTyped(type)),
    )
    let atPrimitive = 0
    let atMember = 0
    for (const candidate of candidates) {
        let proven = true
        for (let at = 0; at < candidate.primitives.length; at += 1)
            proven &&= primitive[atPrimitive + at] === true
        for (let at = 0; at < candidate.members.length; at += 1)
            proven &&= isPlainProperty(symbols[atMember + at])
        atPrimitive += candidate.primitives.length
        atMember += candidate.members.length
        if (proven)
            reads.push(
                newRead(candidate.span.start, candidate.span.start, 'static'),
            )
    }
}

/** A union's members, or the type alone where it is not one. */
async function unionMembers(type: Type): Promise<readonly Type[]> {
    return (type.flags & TypeFlags.Union) !== 0
        ? await (type as UnionOrIntersectionType).getTypes()
        : [type]
}

/**
 * Whether every member of the type passes, `null` and `undefined` aside, and one at least is left
 * to: an optional parameter is its type or `undefined`, and is still the type.
 */
async function everyPresentMember(
    type: Type,
    test: (member: Type) => Promise<boolean>,
): Promise<boolean> {
    let present = false
    for (const member of await unionMembers(type)) {
        if ((member.flags & (TypeFlags.Undefined | TypeFlags.Null)) !== 0)
            continue
        if (!(await test(member))) return false
        present = true
    }
    return present
}

/**
 * Every member of the type is a primitive, whose string conversion and comparison run no code.
 * `any` and `unknown` are not: what they hold at runtime is anything.
 */
async function isPrimitiveTyped(type: Type): Promise<boolean> {
    const members = await unionMembers(type)
    for (const member of members)
        if ((member.flags & (TypeFlags.Primitive | TypeFlags.Never)) === 0)
            return false
    return true
}

/**
 * A member read that runs no code: every declaration of it is a data property, an enum member or a
 * module's own binding. A getter is code, and a member the checker cannot resolve — every member
 * of `any` — is nothing it can vouch for.
 */
function isPlainProperty(symbol: CheckedSymbol | undefined): boolean {
    if (symbol === undefined) return false
    if ((symbol.flags & SymbolFlags.Accessor) !== 0) return false
    if (symbol.declarations.length === 0) return false
    for (const declaration of symbol.declarations)
        if (!PLAIN_DECLARATIONS.has(declaration.kind)) return false
    return true
}

const PLAIN_DECLARATIONS: ReadonlySet<SyntaxKind> = new Set([
    SyntaxKind.PropertySignature,
    SyntaxKind.PropertyDeclaration,
    SyntaxKind.PropertyAssignment,
    SyntaxKind.ShorthandPropertyAssignment,
    SyntaxKind.EnumMember,
    SyntaxKind.VariableDeclaration,
])

/**
 * Drops names that bind a reactive read's value, rather than the `Reactive`, from `reactive`.
 *
 * 31.3 — A BINDING OF A READ HOLDS THE VALUE, and the checker cannot see that. It types the SHADOW,
 * where `let shown = total` is the `Reactive` itself; the lowering reads `total` there, because an
 * un-annotated binding is not a position 31.3 holds in, so `shown` is handed the VALUE. Asked of
 * the shadow alone, `shown` was then classified a `Reactive` too and every use of it lowered to
 * `shown()` — a call on a number. Declared or imported, the name it binds from is the same case.
 *
 * SO THE ANSWER IS CORRECTED WHERE THE TWO PART COMPANY: an un-annotated binding whose initializer
 * hands on a reactive name as its value — through parentheses, a type-only wrapper, a conditional's
 * arms or a logical operand, the positions a read is the value in — is not a `Reactive`. A chain
 * falls out: `let c = b` names `b`, which the shadow typed as one, so `c` holds the value too. An
 * annotated binding is 31.3's own hold and is left alone, and so is a call: `turns(...)` is a
 * `Reactive` in the lowered program exactly as it is in the shadow.
 */
async function dropValueHolders(
    checker: Checker,
    names: readonly Node[],
    reactive: (CheckedSymbol | undefined)[],
): Promise<void> {
    const reactiveIds = new Set<number>()
    for (const symbol of reactive)
        if (symbol !== undefined) reactiveIds.add(symbol.id)
    const owners: number[] = []
    const leaves: Node[] = []
    for (let at = 0; at < names.length; at += 1) {
        const declaration = (names[at] as Node).parent
        if (
            reactive[at] === undefined ||
            !isVariableDeclaration(declaration) ||
            declaration.type !== undefined ||
            declaration.initializer === undefined
        )
            continue
        const before = leaves.length
        valueLeaves(declaration.initializer, leaves)
        for (let leaf = before; leaf < leaves.length; leaf += 1) owners.push(at)
    }
    if (leaves.length === 0) return
    const symbols = await checker.getSymbolAtLocation(leaves)
    for (let leaf = 0; leaf < leaves.length; leaf += 1) {
        const id = symbols[leaf]?.id
        if (id !== undefined && reactiveIds.has(id))
            reactive[owners[leaf] as number] = undefined
    }
}

/**
 * The names an initializer's value can BE, as opposed to names it merely uses: `a` in `(a)`,
 * `a as T`, `c ? a : b` and `a ?? b`, but not in `f(a)` or `a.b`.
 */
function valueLeaves(node: Node, leaves: Node[]): void {
    switch (node.kind) {
        case SyntaxKind.Identifier:
            leaves.push(node)
            return
        case SyntaxKind.ParenthesizedExpression:
        case SyntaxKind.AsExpression:
        case SyntaxKind.SatisfiesExpression:
        case SyntaxKind.NonNullExpression:
        case SyntaxKind.TypeAssertionExpression:
            valueLeaves(
                (node as unknown as { expression: Node }).expression,
                leaves,
            )
            return
        case SyntaxKind.ConditionalExpression: {
            const { whenTrue, whenFalse } = node as unknown as {
                whenTrue: Node
                whenFalse: Node
            }
            valueLeaves(whenTrue, leaves)
            valueLeaves(whenFalse, leaves)
            return
        }
        case SyntaxKind.BinaryExpression: {
            const { left, right, operatorToken } = node as unknown as {
                left: Node
                right: Node
                operatorToken: Node
            }
            if (operatorToken.kind === SyntaxKind.CommaToken) {
                valueLeaves(right, leaves)
                return
            }
            if (
                operatorToken.kind === SyntaxKind.QuestionQuestionToken ||
                operatorToken.kind === SyntaxKind.BarBarToken ||
                operatorToken.kind === SyntaxKind.AmpersandAmpersandToken
            ) {
                valueLeaves(left, leaves)
                valueLeaves(right, leaves)
            }
            return
        }
        default:
            return
    }
}

// Where abide declares `Reactive`, `props` and `Selection`, found in the project the way
// `METHODS_SOURCE` is.
const REACTIVE_SOURCE = new URL(
    '../shared/reactive/Reactive.ts',
    import.meta.url,
).pathname
const PROPS_SOURCE = new URL('../shared/props.ts', import.meta.url).pathname
const ROUTE_SOURCE = new URL('../shared/route.ts', import.meta.url).pathname
const SELECTION_SOURCE = new URL('../shared/reactive/index.ts', import.meta.url)
    .pathname

/**
 * Abide's own `Reactive`, `Selection` and `props` declarations, as this project's checker names
 * them.
 *
 * 31.3 — A `Reactive` IS TOLD BY ITS DECLARATION, never by how it prints. Every instantiation of
 * abide's `Reactive` carries the symbol of the one type literal it is declared as, whatever alias
 * or re-export the app reached it through — so `type Counter = Reactive<number>` is one, and an
 * app's own type that happens to be spelled `Reactive` is not. `undefined` where the project never
 * reaches abide, and then nothing in it is one. `props` is abide's file as the checker names it.
 */
type Abide = {
    /** 23.9 — abide's `route`, as the file the checker names it. */
    route: string | undefined
    reactive: CheckedSymbol | undefined
    /**
     * 31.14 — abide's `Selection` alias, which a position may be typed as rather than as a `Reactive`.
     */
    selection: CheckedSymbol | undefined
    props: string | undefined
}

async function abideIn(project: Project): Promise<Abide> {
    const [declares, props, selects, route] = await Promise.all([
        project.program.getSourceFile(REACTIVE_SOURCE),
        project.program.getSourceFile(PROPS_SOURCE),
        project.program.getSourceFile(SELECTION_SOURCE),
        project.program.getSourceFile(ROUTE_SOURCE),
    ])
    let selection: CheckedSymbol | undefined
    for (const statement of selects?.statements ?? [])
        if (
            isTypeAliasDeclaration(statement) &&
            statement.name.text === 'Selection'
        ) {
            selection = await project.checker.getSymbolAtLocation(
                statement.name,
            )
            break
        }
    let reactive: CheckedSymbol | undefined
    for (const statement of declares?.statements ?? [])
        if (
            isTypeAliasDeclaration(statement) &&
            statement.name.text === 'Reactive'
        ) {
            const literal = await project.checker.getTypeFromTypeNode(
                statement.type,
            )
            reactive = await literal?.getSymbol()
            break
        }
    return { route: route?.path, reactive, selection, props: props?.path }
}

/**
 * Whether a position's type is abide's `Reactive`, or a `Selection`.
 *
 * A union is `Reactive`-typed only where EVERY member is, `null` and `undefined` aside: `s.set`
 * takes `Accepted | Promise<Accepted> | Reactive<Accepted>`, and a position that also takes a
 * plain value is one where a read is what was meant. An intersection with a `Reactive` in it is
 * one. `lists` has `Reactive<X>[]` count too, being the shape a list of sources is declared as —
 * a parameter's question, and never a name's: a name holding an array is read as the array.
 */
async function isReactiveType(
    checker: Checker,
    abide: Abide,
    type: Type,
    lists: boolean,
): Promise<boolean> {
    if (abide.reactive === undefined) return false
    if (await isSelection(checker, abide, type)) return true
    const reactive = abide.reactive
    return everyPresentMember(type, (member) =>
        isReactiveMember(checker, reactive, member, lists),
    )
}

/**
 * Whether a type is abide's `Selection`, or a type parameter constrained by one.
 *
 * 31.14 — A POSITION TYPED AS A `Selection`, or as a type parameter constrained by one (the free
 * `refresh`, `invalidate`, `busy` and `ready` take `Chosen extends Selection`). A value is never a
 * selection of itself, so a read there hands `refresh` the invoice rather than the thing to reload.
 */
async function isSelection(
    checker: Checker,
    abide: Abide,
    type: Type,
): Promise<boolean> {
    const selection = abide.selection
    if (selection === undefined) return false
    return everyPresentMember(type, async (member) => {
        const declared =
            (member.flags & TypeFlags.TypeParameter) !== 0
                ? await checker.getConstraintOfTypeParameter(
                      member as TypeParameter,
                  )
                : member
        return (await declared?.getAliasSymbol())?.id === selection.id
    })
}

/**
 * Whether one union member is abide's `Reactive`, an intersection with one, or a list of them.
 *
 * `getSymbol` is answered from the client's cache once a symbol has been seen, so past the first
 * `Reactive` in a snapshot this is no round-trip at all.
 */
async function isReactiveMember(
    checker: Checker,
    reactive: CheckedSymbol,
    type: Type,
    lists: boolean,
): Promise<boolean> {
    if ((await type.getSymbol())?.id === reactive.id) return true
    if ((type.flags & TypeFlags.Intersection) !== 0) {
        for (const part of await (type as UnionOrIntersectionType).getTypes())
            if ((await part.getSymbol())?.id === reactive.id) return true
        return false
    }
    if (
        !lists ||
        ((type as ObjectType).objectFlags & ObjectFlags.Reference) === 0 ||
        !(await checker.isArrayType(type))
    )
        return false
    const [element] = await checker.getTypeArguments(type as TypeReference)
    return (await element?.getSymbol())?.id === reactive.id
}

/**
 * What a handler's value is, as its `Rpc` hands it back: the `Reactive` its call returns, read.
 *
 * `Kept<Awaited<…>>` has already adopted a `Reactive` returned whole (11.12), so what is left of
 * one here is nested.
 */
async function valueOfRpc(
    checker: Checker,
    rpc: Type,
): Promise<Type | undefined> {
    const [call] = await checker.getSignaturesOfType(rpc, SignatureKind.Call)
    const returned =
        call === undefined
            ? undefined
            : await checker.getReturnTypeOfSignature(call)
    if (returned === undefined) return undefined
    const [read] = await checker.getSignaturesOfType(
        returned,
        SignatureKind.Call,
    )
    return read === undefined
        ? undefined
        : checker.getReturnTypeOfSignature(read)
}

/**
 * 16.40 — the path to the first `Reactive` nested in a handler's value, or `undefined`.
 *
 * `.name` for a member, `[]` for an array's items and `[n]` for a tuple's. A callable that is not
 * a `Reactive` is not walked — it cannot be JSON, and a lib type's methods are most of what it is —
 * and nor is anything deeper than `argsSchemaOf`'s depth, for its reason.
 */
async function nestedReactiveIn(
    checker: Checker,
    reactive: CheckedSymbol,
    type: Type | undefined,
    path: string,
    walk: { seen: Set<number>; depth: number },
): Promise<string | undefined> {
    if (type === undefined || walk.depth > 8) return undefined
    if (type.flags & TypeFlags.Union) {
        for (const member of await (
            type as UnionOrIntersectionType
        ).getTypes()) {
            const found = await nestedReactiveIn(
                checker,
                reactive,
                member,
                path,
                walk,
            )
            if (found !== undefined) return found
        }
        return undefined
    }
    if (!(type.flags & (TypeFlags.Object | TypeFlags.Intersection)))
        return undefined
    if (
        walk.depth > 0 &&
        (await isReactiveMember(checker, reactive, type, false))
    )
        return path
    if (walk.seen.has(type.id)) return undefined
    walk.seen.add(type.id)
    const inner = { seen: walk.seen, depth: walk.depth + 1 }
    const [array, tuple, calls] = await Promise.all([
        checker.isArrayType(type),
        checker.isTupleType(type),
        checker.getSignaturesOfType(type, SignatureKind.Call),
    ])
    if (array || tuple) {
        const items = await checker.getTypeArguments(type as TypeReference)
        for (let at = 0; at < items.length; at += 1) {
            const found = await nestedReactiveIn(
                checker,
                reactive,
                items[at],
                `${path}${array ? '[]' : `[${at}]`}`,
                inner,
            )
            if (found !== undefined) return found
        }
        return undefined
    }
    if (calls.length > 0) return undefined
    const members = await checker.getPropertiesOfType(type)
    const types = await checker.getTypeOfSymbol(members)
    for (let at = 0; at < members.length; at += 1) {
        const found = await nestedReactiveIn(
            checker,
            reactive,
            types[at],
            `${path}.${(members[at] as CheckedSymbol).name}`,
            inner,
        )
        if (found !== undefined) return found
    }
    return undefined
}

/**
 * 23.9 — `route.params` in a page or a layout, read as what that file's own route promises.
 *
 * THE FILE IS THE ROUTE: `ui/pages/media/[id]/page.abide` only ever renders where `id` matched, so its
 * `route.params()` has an `id`, and a layout's has its own segments and whatever a page below adds.
 * Told by the symbol, as `props` is, so an app's own `route` is not abide's. Only the checker reads
 * these — the running module reads the one `route` every page shares.
 */
async function routeParamsReads(
    checker: Checker,
    abide: Abide,
    sourceFile: Node,
    abidePath: string,
    reads: Read[],
): Promise<void> {
    if (abide.route === undefined || !abidePath.includes('ui/pages/')) return
    const kind = abidePath.endsWith('/page.abide')
        ? 'page'
        : abidePath.endsWith('/layout.abide')
          ? 'layout'
          : undefined
    if (kind === undefined) return
    const accesses: Node[] = []
    const owners: Node[] = []
    const visit = (node: Node): void => {
        if (
            isPropertyAccessExpression(node) &&
            isIdentifier(node.expression) &&
            isIdentifier(node.name) &&
            node.name.text === 'params'
        ) {
            accesses.push(node)
            owners.push(node.expression)
        }
        node.forEachChild(visit)
    }
    sourceFile.forEachChild(visit)
    if (owners.length === 0) return
    const symbols = await checker.getSymbolAtLocation(owners)
    const pattern = routeOf(abidePath)
    for (let at = 0; at < accesses.length; at += 1) {
        const symbol = symbols[at]
        if (symbol === undefined) continue
        const declared = await aliasedSymbol(checker, symbol)
        if (declared.valueDeclaration?.path !== abide.route) continue
        const access = accesses[at] as Node
        const read = newRead(access.getStart(), access.end, 'routeParams')
        read.keys.push(pattern, kind)
        reads.push(read)
    }
}

/**
 * The reads a `props<Props>()` destructuring contributes, pushed onto `reads`.
 *
 * 33 — WHAT `props<Props>()` BINDS, and it is a second question from 31.3's rather than a case of
 * it: a prop is not a `Reactive` and is not typed as one, so no type answers this. The CALLEE
 * does: abide's own `props`, which an app's function of that spelling is not. The pattern is flat
 * (33.14), and every name it binds is one accessor (33.4).
 *
 * THREE KINDS OF READ COME BACK: the call itself, which lowers to the record the caller passed;
 * each default, which lowers to an accessor answering it; and every occurrence of every name the
 * pattern bound.
 *
 * 33.6, 33.7 — A PROP THE CHILD WRITES IS A CELL, and the child is the only side that can tell: a
 * name assigned, updated, or handed on as a `bind:` operand. Its key rides the call's read, its
 * default becomes a cell too, and every occurrence reads through the accessor as a `Reactive`.
 */
async function propsReads(
    checker: Checker,
    abide: Abide,
    sourceFile: { statements: readonly Node[] },
    shadowPath: string,
    scriptsEnd: number,
    reads: Read[],
): Promise<void> {
    // The spelling only says which calls are worth asking about; the callee says which are abide's.
    const calls: { pattern: Node; call: Node }[] = []
    const callees: Node[] = []
    for (const statement of sourceFile.statements) {
        if (statement.getStart() >= scriptsEnd) break
        if (!isVariableStatement(statement)) continue
        for (const declaration of statement.declarationList.declarations) {
            const call = declaration.initializer
            if (
                call === undefined ||
                !isCallExpression(call) ||
                !isIdentifier(call.expression) ||
                call.expression.text !== 'props'
            )
                continue
            calls.push({ pattern: declaration.name, call })
            callees.push(call.expression)
        }
    }
    if (calls.length === 0 || abide.props === undefined) return
    const named = await checker.getSymbolAtLocation(callees)
    // One entry per name a pattern binds: the key it takes, the call's read its key joins where
    // the child writes it, and its default's pair.
    const bound: Node[] = []
    const bindings: {
        key: string
        call: Read
        defaults: Read[]
        rest: boolean
    }[] = []
    for (let at = 0; at < calls.length; at += 1) {
        const symbol = named[at]
        if (symbol === undefined) continue
        const callee = await aliasedSymbol(checker, symbol)
        if (callee.valueDeclaration?.path !== abide.props) continue
        const { pattern, call } = calls[at] as { pattern: Node; call: Node }
        const callRead = newRead(call.getStart(), call.end, 'props')
        reads.push(callRead)
        // 33.3 — `const all = props()` is the untyped record itself, and there is no pattern
        // to walk. Its members are read through `all`, which the lowering leaves alone.
        if (!isObjectBindingPattern(pattern)) continue
        for (const element of pattern.elements) {
            // 33.14 — FLAT: a rename, a default and a rest element, and no nested pattern.
            const name = element.name
            if (name === undefined || !isIdentifier(name))
                throw new Error(
                    'abide: a props pattern is flat — a rename, a default and a rest element, and no nested pattern. RULEBOOK 33.14.',
                )
            const renamed = element.propertyName
            const key =
                renamed !== undefined && isIdentifier(renamed)
                    ? renamed.text
                    : name.text
            const defaults: Read[] = []
            if (element.initializer !== undefined) {
                const open = element.initializer.getStart()
                const opening = newRead(open, open, 'defaultOpen')
                opening.keys.push(key)
                callRead.keys.push(key)
                defaults.push(
                    opening,
                    newRead(
                        element.initializer.end,
                        element.initializer.end,
                        'defaultClose',
                    ),
                )
                reads.push(...defaults)
            } else if (element.dotDotDotToken === undefined) {
                // 33.4 — A PROP THE CALLER LEFT OUT IS `undefined`, and has no accessor to read it
                // through: every binding is given one, inert wherever the caller passed the key.
                const absent = newRead(name.end, name.end, 'absent')
                defaults.push(absent)
                reads.push(absent)
            }
            bound.push(name)
            bindings.push({
                key,
                call: callRead,
                defaults,
                rest: element.dotDotDotToken !== undefined,
            })
        }
    }
    if (bound.length === 0) return

    const symbols = await checker.getSymbolAtLocation(bound)
    const found = await Promise.all(
        symbols.map(async (symbol) =>
            symbol === undefined
                ? []
                : await Promise.all(
                      (
                          await checker.getReferencesToSymbolInFile(
                              shadowPath,
                              symbol,
                          )
                      ).map((reference) => reference.resolve()),
                  ),
        ),
    )
    for (let at = 0; at < found.length; at += 1) {
        const binding = bindings[at] as (typeof bindings)[number]
        if (binding.rest) {
            restReads(found[at] as (Node | undefined)[], reads)
            continue
        }
        const uses: Read[] = []
        let written = false
        for (const node of found[at] as (Node | undefined)[]) {
            // The binding itself is the pattern's, and not a use of the name.
            if (
                node === undefined ||
                node.parent?.kind === SyntaxKind.BindingElement
            )
                continue
            const read = classifyRead(node)
            if (read === undefined) continue
            if (
                read.shape === 'write' ||
                read.shape === 'update' ||
                isBindOperand(node)
            )
                written = true
            uses.push(read)
        }
        if (!written) {
            for (const node of found[at] as (Node | undefined)[]) {
                if (node === undefined) continue
                const read = classifyPropRead(node)
                if (read !== undefined) reads.push(read)
            }
            continue
        }
        binding.call.path.push({ name: binding.key, start: 0, end: 0 })
        for (const read of binding.defaults) read.through = true
        for (const read of uses) {
            read.through = true
            reads.push(read)
        }
    }
}

/**
 * 33.15 — the reads of a props rest element: `rest.note`, each read of the accessor it holds.
 *
 * THE REST ELEMENT IS THE RECORD OF ACCESSORS the caller passed, not one of them, so the name alone
 * is never called — `rest()` would call the record — and stands as written wherever it is handed
 * on whole. A member read is the key's accessor called, `?.` because a key the caller left out has
 * none (33.4), and `rest.note()` is that accessor called by hand, left alone as 31.7's is.
 */
function restReads(nodes: (Node | undefined)[], reads: Read[]): void {
    for (const node of nodes) {
        const member = node?.parent
        if (
            node === undefined ||
            member === undefined ||
            !isPropertyAccessExpression(member) ||
            member.expression !== node
        )
            continue
        const outer = member.parent
        if (isCallExpression(outer) && outer.expression === member) continue
        reads.push(newRead(node.getStart(), member.end, 'restMember'))
    }
}

/**
 * A name standing alone as a `bind:` operand, which the projection wraps in `__bind` on an element
 * and `__bound` on a component (`projectShadow`'s `openerOf` and `invocation`).
 */
function isBindOperand(node: Node): boolean {
    const parent = node.parent
    return (
        parent !== undefined &&
        isCallExpression(parent) &&
        isIdentifier(parent.expression) &&
        (parent.expression.text === '__bind' ||
            parent.expression.text === '__bound') &&
        parent.arguments[0] === node
    )
}

async function isReactiveSymbol(
    checker: Checker,
    abide: Abide,
    symbol: CheckedSymbol,
): Promise<boolean> {
    const type = await checker.getTypeOfSymbol(symbol)
    return type !== undefined && isReactiveType(checker, abide, type, false)
}

/**
 * Orders reads by offset, a default's open before a read at the same offset and its close after.
 *
 * ASCENDING, AND AN INSERTION KNOWS WHICH SIDE IT IS ON. A default's open stands at the same
 * offset as the first read inside it — `currency = fallback` — and a sort by offset alone leaves
 * which comes first to the order the two passes happened to push in.
 */
function byPosition(left: Read, right: Read): number {
    return left.start - right.start || side(left) - side(right)
}

function side(read: Read): number {
    if (read.shape === 'defaultOpen') return -1
    return read.shape === 'defaultClose' ? 1 : 0
}
