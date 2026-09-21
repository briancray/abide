import { type Dirent, readdirSync, statSync } from 'node:fs' // Bun exposes no sync directory listing of its own
import { basename, dirname, join, resolve } from 'node:path' // Bun exposes no path helpers of its own
import type { Node, TypeNode } from 'typescript/unstable/ast'
import {
    isArrayLiteralExpression,
    isArrowFunction,
    isCallExpression,
    isFunctionDeclaration,
    isFunctionExpression,
    isIdentifier,
    isMethodDeclaration,
    isNewExpression,
    isObjectBindingPattern,
    isParenthesizedExpression,
    isReturnStatement,
    isVariableDeclaration,
    isVariableStatement,
} from 'typescript/unstable/ast/is'
import {
    API,
    type Checker,
    type Type,
    TypeFlags,
    type UnionType,
} from 'typescript/unstable/async'
import { classifyPropRead, classifyRead, type Read } from './classifyRead.ts'
import type { AbideFile } from './parseAbide.ts'
import { projectShadow } from './projectShadow.ts'

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

// Whether a script can declare a name at all — a file that cannot is never handed to the checker.
const DECLARES = /\b(?:const|let|var)\b/

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
    // THE CHECKER'S OWN TREE ANSWERS BOTH QUESTIONS. Which names the file declares is its
    // top-level `const`/`let`/`var` statements — an inner block's name is not the page's — and
    // which occurrences reach one is the references to that symbol. A parameter, a row's item, a
    // key, a member, a label and a class field of the same spelling are other symbols, and are
    // absent. What each reference DOES — a read, a write, an update, a shorthand — is read off its
    // parents by `classifyRead`, so no token walk re-derives the grammar.
    async readsFor(
        sources: { path: string; file: AbideFile }[],
    ): Promise<Read[][]> {
        // Per source, its shadow's path and where its scripts end, or '' where nothing is declared.
        const queries: { shadowPath: string; scriptsEnd: number }[] = []
        const created: string[] = []
        const changed: string[] = []

        for (const source of sources) {
            const projection = projectShadow(source.file)
            // 34.2 — A `<script module>` DECLARES NAMES TOO, and the `<script>` under it is inside
            // that scope on both sides. The projection holds both from offset 0.
            const scripts = projection.text.slice(0, projection.scripts.end)
            if (!DECLARES.test(scripts)) {
                queries.push({ shadowPath: '', scriptsEnd: 0 })
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
            ;(this.shadows.has(shadowPath) ? changed : created).push(shadowPath)
            this.shadows.set(shadowPath, projection.text)
            queries.push({ shadowPath, scriptsEnd: projection.scripts.end })
        }

        const answers: Read[][] = sources.map(() => [])
        if (created.length === 0 && changed.length === 0) return answers

        this.snapshots += 1
        const snapshot = await this.api.updateSnapshot({
            openProjects: [this.tsconfig],
            fileChanges: { created, changed },
        })
        const project = snapshot.getProjects()[0]
        if (project === undefined) return answers
        const checker = project.checker

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
                for (const statement of sourceFile.statements) {
                    if (statement.getStart() >= query.scriptsEnd) break
                    if (!isVariableStatement(statement)) continue
                    for (const declaration of statement.declarationList
                        .declarations) {
                        const name = declaration.name
                        if (!isIdentifier(name) || spelled.has(name.text))
                            continue
                        spelled.add(name.text)
                        names.push(name)
                    }
                }
                // 33's pass runs whatever 31.3's found: a `props` pattern binds no name the walk
                // above collects — `const { amount } = props()` declares a PATTERN — so a file
                // whose only declaration is one would have returned with its props unread.
                const props = propsReads(
                    checker,
                    sourceFile,
                    query.shadowPath,
                    query.scriptsEnd,
                    answers[at] as Read[],
                )
                if (names.length === 0) {
                    await props
                    ;(answers[at] as Read[]).sort(byPosition)
                    return
                }
                const symbols = await checker.getSymbolAtLocation(names)
                const reactive = await Promise.all(
                    symbols.map(async (symbol) => {
                        if (symbol === undefined) return undefined
                        const type = await checker.getTypeOfSymbol(symbol)
                        if (type === undefined) return undefined
                        const text = await checker.typeToString(type)
                        return text.startsWith(REACTIVE_PREFIX)
                            ? symbol
                            : undefined
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
                                            (await isReactiveTyped(
                                                checker,
                                                type,
                                            ))
                                        )
                                            read.shape = 'asWritten'
                                    },
                                ),
                            )
                    }
                await Promise.all(holding)
                await props
                reads.sort(byPosition)
            }),
        )
        return answers
    }

    close(): void {
        this.api.close()
    }
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

// A union is `Reactive`-typed only where EVERY member is, `null` and `undefined` aside: `s.set`
// takes `Accepted | Promise<Accepted> | Reactive<Accepted>`, and a position that also takes a
// plain value is one where a read is what was meant. `Reactive<X>[]` counts, being the shape a
// list of sources is declared as.
async function isReactiveTyped(checker: Checker, type: Type): Promise<boolean> {
    const members =
        (type.flags & TypeFlags.Union) !== 0
            ? await (type as UnionType).getTypes()
            : [type]
    let reactive = false
    for (const member of members) {
        if ((member.flags & (TypeFlags.Undefined | TypeFlags.Null)) !== 0)
            continue
        if (!(await checker.typeToString(member)).startsWith(REACTIVE_PREFIX))
            return false
        reactive = true
    }
    return reactive
}

// 33 — WHAT `props<Props>()` BINDS, and it is a second question from 31.3's rather than a case of
// it: a prop is not a `Reactive` and is not typed as one (33.6), so no type answers this. The
// SPELLING does. `props` is the name 33 gives the call, the pattern is flat (33.14), and every
// name it binds is one accessor (33.4).
//
// THREE KINDS OF READ COME BACK: the call itself, which lowers to the record the caller passed;
// each default, which lowers to an accessor answering it; and every occurrence of every name the
// pattern bound.
async function propsReads(
    checker: Checker,
    sourceFile: { statements: readonly Node[] },
    shadowPath: string,
    scriptsEnd: number,
    reads: Read[],
): Promise<void> {
    const bound: Node[] = []
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
            reads.push(spliced(call.getStart(), call.end, 'props'))
            const pattern = declaration.name
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
                    reads.push(spliced(open, open, 'defaultOpen'))
                    reads.push(
                        spliced(
                            element.initializer.end,
                            element.initializer.end,
                            'defaultClose',
                        ),
                    )
                }
                bound.push(name)
            }
        }
    }
    if (bound.length === 0) return

    const symbols = await checker.getSymbolAtLocation(bound)
    const found = await Promise.all(
        symbols.map(async (symbol) =>
            symbol === undefined
                ? []
                : Promise.all(
                      (
                          await checker.getReferencesToSymbolInFile(
                              shadowPath,
                              symbol,
                          )
                      ).map((reference) => reference.resolve()),
                  ),
        ),
    )
    for (const references of found)
        for (const node of references) {
            if (node === undefined) continue
            const read = classifyPropRead(node)
            if (read !== undefined) reads.push(read)
        }
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

// A read that is a SPLICE rather than a name: the span it replaces, and what it becomes. A span of
// zero width is an INSERTION, and the walk goes on from where it stood.
function spliced(start: number, end: number, shape: Read['shape']): Read {
    return {
        start,
        end,
        shape,
        from: start,
        to: end,
        operator: '',
        prefix: false,
        discarded: false,
        arguments: 0,
        path: [],
        value: undefined,
    }
}
