import { type Dirent, readdirSync, statSync } from 'node:fs' // Bun exposes no sync directory listing of its own
import { basename, dirname, join, resolve } from 'node:path' // Bun exposes no path helpers of its own
import { type Node, SyntaxKind, type TypeNode } from 'typescript/unstable/ast'
import {
    isArrayLiteralExpression,
    isArrowFunction,
    isCallExpression,
    isExportAssignment,
    isFunctionDeclaration,
    isFunctionExpression,
    isIdentifier,
    isImportDeclaration,
    isMethodDeclaration,
    isNamedImports,
    isNewExpression,
    isObjectBindingPattern,
    isObjectLiteralExpression,
    isParenthesizedExpression,
    isPropertyAccessExpression,
    isPropertyAssignment,
    isReturnStatement,
    isTypeAliasDeclaration,
    isVariableDeclaration,
    isVariableStatement,
} from 'typescript/unstable/ast/is'
import {
    API,
    type Symbol as CheckedSymbol,
    type Checker,
    ObjectFlags,
    type ObjectType,
    type Project,
    SymbolFlags,
    type Type,
    TypeFlags,
    type TypeReference,
    type UnionOrIntersectionType,
} from 'typescript/unstable/async'
import type { Mount } from '#server/answerRpc.ts'
import type { Method } from '#shared/rpc.ts'
import {
    classifyPropRead,
    classifyRead,
    newRead,
    provePosition,
    type Read,
    slotFacts,
} from './classifyRead.ts'
import type { AbideFile } from './parseAbide.ts'
import { projectShadow, type Span } from './projectShadow.ts'

// Where 31.3 gets its answer. A `.abide` file is projected into a SHADOW `.ts` held in a virtual
// filesystem and never written to disk, and TypeScript's own checker is asked what each declared
// name's type is. That is the whole reason the checker is here rather than a local inference over
// annotations: the corpus writes `let rows = reactive([...])` with no annotation anywhere, so the
// answer comes from the initializer's INFERRED type or it does not come at all.
//
// The API is the ASYNC one on purpose. `typescript/unstable/sync` reads `child.stdout._handle.fd`
// and bun exposes no fd on a child pipe, so the sync channel cannot connect. The async channel is
// a stream and needs nothing.

// Whether a script can bind a name at all — a file that cannot is never handed to the checker.
const DECLARES = /\b(?:const|let|var|import)\b/

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

    // The project as of the last snapshot, so a question asked after `readsFor` shares its snapshot
    // rather than taking a second one.
    private project: Project | undefined = undefined

    // WHAT THE AUTHOR CHANGED ON DISK since the last snapshot, for a session kept across compiles
    // (`abide dev`). The checker caches every file it has read and is told only about the shadows
    // this class writes, so an edit to a module a page imports answered with the type it had when
    // the session opened: a name made reactive in a `.ts` stayed static, and a handler exported
    // since was not there. `everything` is the edit nobody could name, and drops the whole cache.
    private edits = { present: [] as string[], deleted: [] as string[] }
    private everything = false

    // SNAPSHOTS TAKEN, and it is a counter rather than a timing because that is the only form of
    // this claim that survives a loaded machine. One per build is the contract; one per FILE is
    // the shape that made the checker 99.8% of compile time, and it reports the same answers.
    snapshots = 0

    // The shadow has to appear in its directory's listing or it is not a root of the project and
    // the checker never reads it.
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

    // THE PATHS A WATCHER SAW MOVE, or `undefined` where it saw a move and could not say where.
    // A file that is there is reported CREATED AND CHANGED: `changed` alone leaves a new file out
    // of the project's root set (a `.d.ts` nothing imports is never read), and `created` alone
    // leaves an edited file's cached text in place. A directory is dropped wholesale, because the
    // checker is not told what was under it.
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
                // A `.abide` that is gone takes its shadow with it, or the checker keeps a page
                // nobody has as a root of the project for the rest of the session.
                for (const shadowPath of this.shadows.keys())
                    if (
                        shadowPath === `${this.canonical(path)}.shadow.ts` ||
                        shadowPath.startsWith(`${this.canonical(path)}/`)
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

    // ONE SNAPSHOT TAKES EVERY EDIT WITH IT: the shadows written for it and whatever moved on disk.
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

    // Whether the last snapshot still answers: there is one, and nothing has moved since.
    private get current(): boolean {
        return (
            this.project !== undefined &&
            !this.everything &&
            this.edits.present.length === 0 &&
            this.edits.deleted.length === 0
        )
    }

    // A relative path from the checker is relative to the API's own cwd, which is the tsconfig's
    // directory rather than the process's.
    private canonical(path: string): string {
        return resolve(dirname(this.tsconfig), path)
    }

    // THE READS IN `file`: every occurrence of a name bound to a `Reactive` (31.3), classified, in
    // its projection (`projectShadow`). Everything else is left exactly as written. ONE FILE; a
    // build wants `readsFor`.
    async reads(abidePath: string, file: AbideFile): Promise<Read[]> {
        const answers = await this.readsFor([{ path: abidePath, file }])
        return answers[0] ?? []
    }

    // EVERY FILE IN ONE SNAPSHOT, which is the whole of the compiler's build time. Measured at
    // 19.7 ms a file taking a snapshot each against 0.8 ms a file sharing one — 25x, because
    // adding a file to the project's root set is what costs, not asking about it.
    //
    // THE CHECKER'S OWN TREE ANSWERS BOTH QUESTIONS. Which names the file binds is its top-level
    // `const`/`let`/`var` statements and its imports — an inner block's name is not the page's — and
    // which occurrences reach one is the references to that symbol. A parameter, a row's item, a
    // key, a member, a label and a class field of the same spelling are other symbols, and are
    // absent. What each reference DOES — a read, a write, an update, a shorthand — is read off its
    // parents by `classifyRead`, so no token walk re-derives the grammar.
    async readsFor(
        sources: { path: string; file: AbideFile }[],
    ): Promise<Read[][]> {
        // Per source, its shadow's path and where its scripts end, or '' where nothing is declared.
        const queries: {
            shadowPath: string
            scriptsEnd: number
            slots: readonly Span[]
        }[] = []
        const created: string[] = []
        const changed: string[] = []

        for (const source of sources) {
            const projection = projectShadow(source.file)
            // 34.2 — A `<script module>` DECLARES NAMES TOO, and the `<script>` under it is inside
            // that scope on both sides. The projection holds both from offset 0.
            const scripts = projection.text.slice(0, projection.scripts.end)
            // A TEMPLATE POSITION IS A QUESTION TOO (14.2): a file that declares nothing but
            // writes `{format(total)}` has a position only the checker can prove static.
            const slots = [...projection.slots.values()]
            if (!DECLARES.test(scripts) && slots.length === 0) {
                queries.push({ shadowPath: '', scriptsEnd: 0, slots })
                continue
            }
            // CANONICAL AT THE KEY, not at the comparison. A doubled separator or a relative
            // path is the same file and a raw string is not the same string — registered as it
            // arrived, the shadow appeared in nobody's directory listing AND named a file the
            // checker could not open, and the refusal below blamed the app's tsconfig for it.
            const shadowPath = `${this.canonical(source.path)}.shadow.ts`
            // A shadow STAYS registered for the life of the session and the snapshot is told it
            // changed. Deleting and re-adding under the same path does not invalidate the
            // source-file cache, and the checker then answers about the PREVIOUS file at these
            // offsets — right-looking types for the wrong names, with nothing to say so.
            // AN UNCHANGED SHADOW IS NOT REPORTED, which is what a kept session saves on a save:
            // the one page that moved is re-read rather than all of them.
            const previous = this.shadows.get(shadowPath)
            if (previous === undefined) created.push(shadowPath)
            else if (previous !== projection.text) changed.push(shadowPath)
            this.shadows.set(shadowPath, projection.text)
            queries.push({
                shadowPath,
                scriptsEnd: projection.scripts.end,
                slots,
            })
        }

        const answers: Read[][] = sources.map(() => [])
        if (queries.every((query) => query.shadowPath === '')) return answers

        const project =
            created.length === 0 && changed.length === 0 && this.current
                ? this.project
                : await this.snapshot(created, changed)
        if (project === undefined) return answers
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
                if (names.length === 0) {
                    await props
                    await proveSlots(
                        checker,
                        sourceFile,
                        query.slots,
                        answers[at] as Read[],
                    )
                    ;(answers[at] as Read[]).sort(byPosition)
                    return
                }
                const symbols = await checker.getSymbolAtLocation(names)
                const reactive = await Promise.all(
                    symbols.map(async (symbol) =>
                        symbol !== undefined &&
                        (await isReactiveSymbol(checker, abide, symbol))
                            ? symbol
                            : undefined,
                    ),
                )
                await dropValueHolders(checker, names, reactive)
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
                for (const resolved of nodes)
                    for (const node of resolved) {
                        if (node === undefined) continue
                        const read = classifyRead(node)
                        if (read === undefined) continue
                        reads.push(read)
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
                await proveSlots(checker, sourceFile, query.slots, reads)
                reads.sort(byPosition)
            }),
        )
        return answers
    }

    // 19.16 — EVERY VALUE EACH MODULE EXPORTS, and the method of the abide call that declares it, or
    // `undefined` where it is not one. The checker's own export table, so a name exported apart from
    // its declaration, under another name or from another module is the same export it is to an
    // importer; and the callee's own symbol, so `GET` imported under another name or through a
    // namespace is abide's, and an app's own function of that spelling is not. A type is not an
    // export here: it is erased, and has no address to answer at.
    async handlersIn(paths: string[]): Promise<DeclaredExport[][]> {
        const project = this.current
            ? this.project
            : await this.snapshot([], [])
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
                        const target = await aliased(checker, exported)
                        if ((target.flags & SymbolFlags.Value) === 0)
                            return undefined
                        const declared = await declaringMethod(
                            checker,
                            target,
                            methodsPath,
                            socketPath,
                        )
                        return {
                            name: exported.name,
                            method: declared?.method,
                            ui: declared?.ui ?? true,
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

    close(): void {
        this.api.close()
    }
}

// Where abide declares the five methods: `GET` is `declare('GET')` there and nowhere else.
const METHODS_SOURCE = new URL('../shared/rpc.ts', import.meta.url).pathname
// And where it declares `socket` (18.1), which a module under `server/sockets` exports.
const SOCKET_SOURCE = new URL('../shared/socket.ts', import.meta.url).pathname

// What declared an export: one of the five methods, or `socket`.
type Declared = Mount['method']
type DeclaredExport = Pick<Mount, 'name' | 'ui'> & {
    method: Declared | undefined
}
const METHODS = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

function aliased(
    checker: Checker,
    symbol: CheckedSymbol,
): Promise<CheckedSymbol> {
    return (symbol.flags & SymbolFlags.Alias) === 0
        ? Promise.resolve(symbol)
        : checker.getAliasedSymbol(symbol)
}

// The method of the abide call a value is declared by — `const x = GET(…)` or `export default
// GET(…)` — or `undefined` where it is declared any other way.
async function declaringMethod(
    checker: Checker,
    symbol: CheckedSymbol,
    methodsPath: string | undefined,
    socketPath: string | undefined,
): Promise<{ method: Declared; ui: boolean } | undefined> {
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
    const method = await aliased(checker, named)
    const ui = !withheldFromUi(call)
    if (
        method.name === 'socket' &&
        socketPath !== undefined &&
        method.valueDeclaration?.path === socketPath
    )
        return { method: 'SOCKET', ui }
    return METHODS.has(method.name) &&
        methodsPath !== undefined &&
        method.valueDeclaration?.path === methodsPath
        ? { method: method.name as Method, ui }
        : undefined
}

// 20.4 — `clients: { ui: false }` written on the declaration, which is what the build can read without
// running it: a browser is then handed no wrapper, and importing the handler from `#ui` is 16.30's
// compile error. An options object built elsewhere is not read, and leaves the wrapper in place.
function withheldFromUi(call: Node & { arguments?: readonly Node[] }): boolean {
    const options = call.arguments?.[1]
    if (options === undefined || !isObjectLiteralExpression(options))
        return false
    for (const property of options.properties) {
        if (!isPropertyAssignment(property) || !isIdentifier(property.name))
            continue
        if (property.name.text !== 'clients') continue
        const clients = property.initializer
        if (!isObjectLiteralExpression(clients)) return false
        for (const member of clients.properties)
            if (
                isPropertyAssignment(member) &&
                isIdentifier(member.name) &&
                member.name.text === 'ui'
            )
                return member.initializer.kind === SyntaxKind.FalseKeyword
    }
    return false
}

// 31.3 — THE DECLARED TYPE OF THE POSITION A READ STANDS IN, where it is one of the three the
// clause names: a call's parameter, an annotated binding, an annotated return. An array literal
// passes its position through, because `watch([a, b], …)` is the parameter's own shape. Anything
// else is `undefined` and stays a read.
//
// THE PARAMETER IS ASKED OF THE SIGNATURE'S TARGET, the generic declaration, and never of the
// instantiated one: `structuredClone<T>(value: T)` INFERS `T` from this very argument, and an
// instantiated signature would call the argument a `Reactive` because it already is one in the
// shadow.
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

// 14.2 — EVERY TEMPLATE POSITION THE CHECKER CAN PROVE READS NOTHING REACTIVE, marked with a
// zero-width `static` read at its start. Everything else is bound, which is the inversion: the old
// question — does it NAME a `Reactive` — let `{big()}` over a function reading `n` be written once.
//
// A PROOF IS THREE THINGS: no reactive read inside the span, a syntax that runs no author code
// but through the answers it hands back (`provePosition`), and those answers. Every member it reads
// resolves to a plain property — a getter is code, and a member of `any` resolves to nothing — and
// every value a coercion or the position itself turns into a string is a primitive, whose
// conversion runs nothing either.
//
// ASKED IN TWO BATCHES A FILE, the checker's round trip being what costs. Each position's own tree
// also says what needs no type at all: its `raw` callees and its refused `await` (`slotFacts`).
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

// Every member of the type is a primitive, whose string conversion and comparison run no code.
// `any` and `unknown` are not: what they hold at runtime is anything.
async function isPrimitiveTyped(type: Type): Promise<boolean> {
    const members =
        (type.flags & TypeFlags.Union) !== 0
            ? await (type as UnionOrIntersectionType).getTypes()
            : [type]
    for (const member of members)
        if ((member.flags & (TypeFlags.Primitive | TypeFlags.Never)) === 0)
            return false
    return true
}

// A member read that runs no code: every declaration of it is a data property, an enum member or a
// module's own binding. A getter is code, and a member the checker cannot resolve — every member
// of `any` — is nothing it can vouch for.
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

// 31.3 — A BINDING OF A READ HOLDS THE VALUE, and the checker cannot see that. It types the SHADOW,
// where `let shown = total` is the `Reactive` itself; the lowering reads `total` there, because an
// un-annotated binding is not a position 31.3 holds in, so `shown` is handed the VALUE. Asked of
// the shadow alone, `shown` was then classified a `Reactive` too and every use of it lowered to
// `shown()` — a call on a number. Declared or imported, the name it binds from is the same case.
//
// SO THE ANSWER IS CORRECTED WHERE THE TWO PART COMPANY: an un-annotated binding whose initializer
// hands on a reactive name as its value — through parentheses, a type-only wrapper, a conditional's
// arms or a logical operand, the positions a read is the value in — is not a `Reactive`. A chain
// falls out: `let c = b` names `b`, which the shadow typed as one, so `c` holds the value too. An
// annotated binding is 31.3's own hold and is left alone, and so is a call: `turns(...)` is a
// `Reactive` in the lowered program exactly as it is in the shadow.
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

// The names an initializer's value can BE, as opposed to names it merely uses: `a` in `(a)`,
// `a as T`, `c ? a : b` and `a ?? b`, but not in `f(a)` or `a.b`.
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

// Where abide declares `Reactive` and `props`, found in the project the way `METHODS_SOURCE` is.
const REACTIVE_SOURCE = new URL(
    '../shared/reactive/Reactive.ts',
    import.meta.url,
).pathname
const PROPS_SOURCE = new URL('../shared/props.ts', import.meta.url).pathname

// 31.3 — A `Reactive` IS TOLD BY ITS DECLARATION, never by how it prints. Every instantiation of
// abide's `Reactive` carries the symbol of the one type literal it is declared as, whatever alias
// or re-export the app reached it through — so `type Counter = Reactive<number>` is one, and an
// app's own type that happens to be spelled `Reactive` is not. `undefined` where the project never
// reaches abide, and then nothing in it is one. `props` is abide's file as the checker names it.
type Abide = { reactive: CheckedSymbol | undefined; props: string | undefined }

async function abideIn(project: Project): Promise<Abide> {
    const [declares, props] = await Promise.all([
        project.program.getSourceFile(REACTIVE_SOURCE),
        project.program.getSourceFile(PROPS_SOURCE),
    ])
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
    return { reactive, props: props?.path }
}

// A union is `Reactive`-typed only where EVERY member is, `null` and `undefined` aside: `s.set`
// takes `Accepted | Promise<Accepted> | Reactive<Accepted>`, and a position that also takes a
// plain value is one where a read is what was meant. An intersection with a `Reactive` in it is
// one. `lists` has `Reactive<X>[]` count too, being the shape a list of sources is declared as —
// a parameter's question, and never a name's: a name holding an array is read as the array.
async function isReactiveType(
    checker: Checker,
    abide: Abide,
    type: Type,
    lists: boolean,
): Promise<boolean> {
    if (abide.reactive === undefined) return false
    const members =
        (type.flags & TypeFlags.Union) !== 0
            ? await (type as UnionOrIntersectionType).getTypes()
            : [type]
    let reactive = false
    for (const member of members) {
        if ((member.flags & (TypeFlags.Undefined | TypeFlags.Null)) !== 0)
            continue
        if (!(await isReactiveMember(checker, abide.reactive, member, lists)))
            return false
        reactive = true
    }
    return reactive
}

// `getSymbol` is answered from the client's cache once a symbol has been seen, so past the first
// `Reactive` in a snapshot this is no round-trip at all.
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

// 33 — WHAT `props<Props>()` BINDS, and it is a second question from 31.3's rather than a case of
// it: a prop is not a `Reactive` and is not typed as one (33.6), so no type answers this. The
// CALLEE does: abide's own `props`, which an app's function of that spelling is not. The pattern
// is flat (33.14), and every name it binds is one accessor (33.4).
//
// THREE KINDS OF READ COME BACK: the call itself, which lowers to the record the caller passed;
// each default, which lowers to an accessor answering it; and every occurrence of every name the
// pattern bound.
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
    const bound: Node[] = []
    for (let at = 0; at < calls.length; at += 1) {
        const symbol = named[at]
        if (symbol === undefined) continue
        const callee = await aliased(checker, symbol)
        if (callee.valueDeclaration?.path !== abide.props) continue
        const { pattern, call } = calls[at] as { pattern: Node; call: Node }
        reads.push(newRead(call.getStart(), call.end, 'props'))
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
            if (element.initializer !== undefined) {
                const open = element.initializer.getStart()
                reads.push(newRead(open, open, 'defaultOpen'))
                reads.push(
                    newRead(
                        element.initializer.end,
                        element.initializer.end,
                        'defaultClose',
                    ),
                )
            }
            bound.push(name)
        }
    }
    if (bound.length === 0) return

    const symbols = await checker.getSymbolAtLocation(bound)
    const found = await Promise.all(
        symbols.map(async (symbol) =>
            symbol === undefined
                ? { reactive: false, nodes: [] }
                : {
                      // 33.7 — A PROP DECLARED AS A `Reactive` is the caller's own, and is read and
                      // written by name as one — through its accessor.
                      reactive: await isReactiveSymbol(checker, abide, symbol),
                      nodes: await Promise.all(
                          (
                              await checker.getReferencesToSymbolInFile(
                                  shadowPath,
                                  symbol,
                              )
                          ).map((reference) => reference.resolve()),
                      ),
                  },
        ),
    )
    for (const { reactive, nodes } of found)
        for (const node of nodes) {
            if (node === undefined) continue
            if (!reactive) {
                const read = classifyPropRead(node)
                if (read !== undefined) reads.push(read)
                continue
            }
            // The binding itself is the pattern's, and not a use of the name.
            if (node.parent?.kind === SyntaxKind.BindingElement) continue
            const read = classifyRead(node)
            if (read === undefined) continue
            read.through = true
            reads.push(read)
        }
}

async function isReactiveSymbol(
    checker: Checker,
    abide: Abide,
    symbol: CheckedSymbol,
): Promise<boolean> {
    const type = await checker.getTypeOfSymbol(symbol)
    return type !== undefined && isReactiveType(checker, abide, type, false)
}

// ASCENDING, AND AN INSERTION KNOWS WHICH SIDE IT IS ON. A default's open stands at the same
// offset as the first read inside it — `currency = fallback` — and a sort by offset alone leaves
// which comes first to the order the two passes happened to push in.
function byPosition(left: Read, right: Read): number {
    return left.start - right.start || side(left) - side(right)
}

function side(read: Read): number {
    if (read.shape === 'defaultOpen') return -1
    return read.shape === 'defaultClose' ? 1 : 0
}
