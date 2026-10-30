import type { CallExpression, Node } from 'typescript/unstable/ast'
import { SyntaxKind } from 'typescript/unstable/ast'
import {
    isArrayLiteralExpression,
    isCallExpression,
    isExportAssignment,
    isFunctionDeclaration,
    isIdentifier,
    isNoSubstitutionTemplateLiteral,
    isObjectLiteralExpression,
    isPropertyAccessExpression,
    isPropertyAssignment,
    isStringLiteral,
    isVariableDeclaration,
} from 'typescript/unstable/ast/is'
import {
    type Checker,
    ObjectFlags,
    type ObjectType,
    type Project,
    SignatureKind,
    type Symbol as CheckedSymbol,
    SymbolFlags,
    type Type,
    TypeFlags,
    type TypeReference,
    type UnionOrIntersectionType,
} from 'typescript/unstable/async'

import type { Mount } from '#server/answerRpc.ts'
import type { CopyOptions } from '#shared/CopyOptions.ts'
import {
    type Defaults,
    defaultsInSource,
} from '#shared/reactive/parameterDefaults.ts'
import type { Method } from '#shared/rpc.ts'

import { aliasedSymbol } from './aliasedSymbol.ts'
import { defaultedMembers, parameterPattern } from './argsDefaultsIn.ts'
import {
    argsSchemaOf,
    DEEPEST,
    resultSchemaOf,
    type Walk,
} from './argsSchemaOf.ts'
import { diagnosisAt } from './lineOf.ts'
import { isReactiveCall, METHODS, optionNamed } from './reactiveOptions.ts'
import {
    abideIn,
    boundInitializer,
    isReactiveMember,
    valueTypeOf,
} from './reactiveTypes.ts'
import type { Refusals } from './Refusals.ts'
import type { Diagnosis } from './TypeSession.ts'

/**
 * Every value each module exports, with the abide method that declares it.
 *
 * 16.73 — EVERY VALUE EACH MODULE EXPORTS, and the method of the abide call that declares it, or
 * `undefined` where it is not one. The checker's own export table, so a name exported apart from
 * its declaration, under another name or from another module is the same export it is to an
 * importer; and the callee's own symbol, so `GET` imported under another name or through a
 * namespace is abide's, and an app's own function of that spelling is not. A type is not an
 * export here: it is erased, and has no address to answer at.
 *
 * `projectName` is the tsconfig the project was opened on, which a module outside it is refused by.
 * 38.33 — WHAT IS REFUSED OF A MODULE IS REFUSED AT ITS FILE, `named[at]` for `paths[at]`, every
 * export read either way: a module with a refusal is `undefined`, so nothing refuses it twice.
 */
export async function declaredExports(
    project: Project,
    projectName: string,
    paths: readonly string[],
    named: readonly string[],
    refusals: Refusals,
): Promise<(DeclaredExport[] | undefined)[]> {
    const checker = project.checker
    // ABIDE'S FILE AS THE CHECKER NAMES IT, not as this module does: it canonicalizes a path to
    // the disk's case rules, so on a case-insensitive disk `/Users/…/Code` comes back
    // `/users/…/code` and a string compared against `import.meta.url` never matched.
    const methodsPath = (await project.program.getSourceFile(METHODS_SOURCE))
        ?.path
    const abide = await abideIn(project)
    return allSettled(
        paths.map(async (path, at) => {
            const file = named[at] as string
            const sourceFile = await project.program.getSourceFile(path)
            if (sourceFile === undefined) {
                refusals.at(
                    file,
                    new Error(
                        `abide: ${path} is not inside the project ${projectName}, so what it exports cannot be read (RULEBOOK 16.73). Give the app a tsconfig whose include reaches it.`,
                    ),
                )
                return undefined
            }
            const module = await checker.getSymbolAtLocation(sourceFile)
            if (module === undefined) return []
            const exports = await checker.getExportsOfModule(module)
            let refused = false
            const found = await allSettled(
                exports.map(async (exported) => {
                    try {
                        const target = await aliasedSymbol(checker, exported)
                        if ((target.flags & SymbolFlags.Value) === 0)
                            return undefined
                        const declared = await declaringMethod(
                            checker,
                            target,
                            methodsPath,
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
                                    `abide: \`${value.parent.getText()}\` is not a value the build can read, so \`${exported.name}\`'s browser copy is built without it. Write it as a literal, or as a \`const\` whose type is one. RULEBOOK 18.15.`,
                                ),
                            )
                        }
                        // 19.9 — a handler's args, as its annotation types them.
                        const handlerType =
                            declared === undefined
                                ? undefined
                                : await checker.getTypeOfSymbol(target)
                        const value =
                            handlerType === undefined
                                ? undefined
                                : await valueOfRpc(checker, handlerType)
                        if (handlerType !== undefined && abide.reactive) {
                            const at = await nestedReactiveIn(
                                checker,
                                abide.reactive,
                                value,
                                '',
                                { seen: new Set(), depth: 0 },
                            )
                            if (at !== undefined)
                                throw new Error(
                                    `abide: ${path} — \`${exported.name}\` returns a \`Reactive\` at \`${at}\`, which the wire would carry as the function it is rather than the value it holds. Read it there, or return the \`Reactive\` itself to have it adopted (RULEBOOK 11.12). RULEBOOK 16.39.`,
                                )
                        }
                        return {
                            name: exported.name,
                            method: declared?.method,
                            ui: declared?.ui ?? true,
                            cli: declared?.cli ?? true,
                            mcp: declared?.mcp ?? true,
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
                            // 19.21 — a stream's chunks are framed one by one, never one JSON value.
                            result: declared?.copy?.stream
                                ? undefined
                                : await resultSchemaOf(checker, value),
                            unread,
                        }
                    } catch (thrown) {
                        refused = true
                        refusals.at(file, thrown)
                        return undefined
                    }
                }),
            )
            if (refused) return undefined
            const handlers: DeclaredExport[] = []
            for (const entry of found)
                if (entry !== undefined) handlers.push(entry)
            return handlers
        }),
    )
}

/** Where abide declares the five methods: `GET` is `declare('GET')` there and nowhere else. */
const METHODS_SOURCE = Bun.fileURLToPath(
    new URL('../shared/rpc.ts', import.meta.url),
)
/** What declared an export: one of the five methods. */
type Declared = Mount['method']
type DeclaredExport = Pick<
    Mount,
    | 'name'
    | 'ui'
    | 'cli'
    | 'mcp'
    | 'copy'
    | 'defaults'
    | 'args'
    | 'result'
    | 'description'
> & {
    method: Declared | undefined
    /** 18.15 — what its copy's options declare and the build could not read. */
    unread: Diagnosis[]
}

/**
 * The method of the abide call a value is declared by — `const x = GET(…)` or `export default
 * GET(…)` — or `undefined` where it is declared any other way.
 */
async function declaringMethod(
    checker: Checker,
    symbol: CheckedSymbol,
    methodsPath: string | undefined,
): Promise<
    | {
          method: Declared
          ui: boolean
          cli: boolean
          mcp: boolean
          description: string | undefined
          copy: CopyOptions | undefined
          unread: Node[]
          defaulted?: string[]
          defaults?: Defaults | undefined
      }
    | undefined
> {
    let declaration = await symbol.valueDeclaration?.resolve()
    let call =
        declaration === undefined
            ? undefined
            : isVariableDeclaration(declaration)
              ? declaration.initializer
              : isExportAssignment(declaration)
                ? declaration.expression
                : undefined
    // 16.73 — A BINDING NAMING ANOTHER BINDING is the call that one was declared by: `export const
    // named = drop` is `drop`'s handler under another name. Bounded, so a cycle the checker would
    // refuse anyway cannot spin here.
    for (
        let hops = 0;
        hops < 8 && call !== undefined && isIdentifier(call);
        hops += 1
    ) {
        const bound = await checker.getSymbolAtLocation(call)
        if (bound === undefined) return undefined
        declaration = await (
            await aliasedSymbol(checker, bound)
        ).valueDeclaration?.resolve()
        call =
            declaration !== undefined && isVariableDeclaration(declaration)
                ? declaration.initializer
                : undefined
    }
    if (call === undefined || !isCallExpression(call)) return undefined
    const callee = isPropertyAccessExpression(call.expression)
        ? call.expression.name
        : call.expression
    const named = await checker.getSymbolAtLocation(callee)
    if (named === undefined) return undefined
    const method = await aliasedSymbol(checker, named)
    const ui = declaredFor(call, 'ui') ?? true
    const description = describedAs(call)
    if (
        !METHODS.has(method.name) ||
        methodsPath === undefined ||
        method.valueDeclaration?.path !== methodsPath
    )
        return undefined
    const declared =
        method.name === 'GET'
            ? await declaredCopy(checker, call)
            : { copy: undefined, unread: [] }
    const body = await handlerBodyOf(checker, call.arguments[0])
    // 16.32 — A HANDLER RETURNING AN ASYNC GENERATOR ANSWERS A STREAM, and the browser's copy has to
    // read it as one rather than wait out the whole response: the one thing about it the build can
    // tell from its type and the wire cannot tell from its first byte in time. A mutation's stream is
    // read the same way.
    const returned = await awaitedReturnOf(checker, body)
    if (await isGenerator(checker, returned))
        declared.copy = { ...declared.copy, stream: true }
    // 16.37 — A HANDLER ANSWERING A WHOLE `Response` HAS NO VALUE A TOOL OR THE SHELL CAN PUBLISH, so
    // both default off where its `clients` does not say. Read off the type, since the runtime only
    // learns it by calling the handler; `page`, `redirect` and the stream helpers hand back what
    // they were given, and are not a `Response`.
    const answersResponse = await isResponse(returned)
    return {
        method: method.name as Method,
        ui,
        cli: declaredFor(call, 'cli') ?? !answersResponse,
        mcp: declaredFor(call, 'mcp') ?? !answersResponse,
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
 * 18.4 — WHAT A `GET`'s VALUE DECLARES THAT ITS BROWSER COPY BEHAVES BY, read off its declaration for
 * 20.4's reason: what the build can read without running it. The `reactive(…)` the `GET` is handed,
 * or the `GET`'s own options where it is handed a plain function (16.6), and the options object,
 * each written inline or bound to a name first. A value is
 * read off its TYPE, so `by: KEY` over a `const KEY = 'id'` carries `'id'` as `by: 'id'` does: a
 * string `by`, string `tags`, and an `identity` of abide's `structural`. A
 * function form has no serialization and stays the server's. 18.15 — anything else of `by` or `tags`
 * is handed back UNREAD, for the build to warn on.
 */
async function declaredCopy(
    checker: Checker,
    declaring: CallExpression,
): Promise<{ copy: CopyOptions | undefined; unread: Node[] }> {
    const unread: Node[] = []
    const handed = await boundValue(checker, declaring.arguments[0])
    const built =
        handed !== undefined &&
        isCallExpression(handed) &&
        isReactiveCall(handed)
            ? handed
            : declaring
    const options = await boundValue(checker, built.arguments[1])
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
        } else if (name === 'by' || name === 'tags') {
            const type = await checker.getTypeAtLocation(value)
            if (type === undefined) continue
            if (
                (await checker.getSignaturesOfType(type, SignatureKind.Call))
                    .length > 0
            )
                continue
            if (name === 'by' && type.isStringLiteralType())
                copy.by = type.value
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

/**
 * `Promise.all`, rejecting only once every promise has settled.
 *
 * A refusal thrown for one export ends the build, which closes the checker: a sibling's request
 * still in flight then writes to a closed pipe, and that throws from outside the build.
 */
async function allSettled<T>(promises: Promise<T>[]): Promise<T[]> {
    const settled = await Promise.allSettled(promises)
    const values: T[] = []
    for (const outcome of settled) {
        if (outcome.status === 'rejected') throw outcome.reason
        values.push(outcome.value)
    }
    return values
}

/**
 * What a handler's function returns, a promise's value in place of the promise: declared
 * `async function*`, an arrow, or a member naming one (`claudeCode.bridge`).
 */
async function awaitedReturnOf(
    checker: Checker,
    body: Node | undefined,
): Promise<Type | undefined> {
    if (body === undefined) return undefined
    const returned = await valueTypeOf(
        checker,
        isFunctionDeclaration(body) && body.name !== undefined
            ? body.name
            : body,
    )
    if (
        returned !== undefined &&
        ((returned as ObjectType).objectFlags & ObjectFlags.Reference) !== 0 &&
        (await returned.getSymbol())?.name === 'Promise'
    )
        return (await checker.getTypeArguments(returned as TypeReference))[0]
    return returned
}

/** Whether a handler's returned type is an async generator, and so streams (9.6). */
async function isGenerator(
    checker: Checker,
    returned: Type | undefined,
): Promise<boolean> {
    if (returned === undefined) return false
    // An async generator's own members: `sse(…)`'s `Values` and a `ReadableStream` are iterated
    // too, and neither is typed as a stream.
    let iterates = false
    let throws = false
    for (const member of await checker.getPropertiesOfType(returned)) {
        if (member.name.startsWith('__@asyncIterator@')) iterates = true
        else if (member.name === 'throw') throws = true
    }
    return iterates && throws
}

/**
 * Whether a handler's returned type is a `Response`, or a union with one in it.
 *
 * 16.37 — ANY ARM: an arm answering a whole `Response` has no value to publish however the others
 * answer, and leaving a surface off is what `clients` turns back on. Read by the type's own name,
 * which the lib's global and Bun's both carry.
 */
async function isResponse(returned: Type | undefined): Promise<boolean> {
    if (returned === undefined) return false
    if (returned.flags & TypeFlags.Union) {
        for (const member of await (
            returned as UnionOrIntersectionType
        ).getTypes())
            if (await isResponse(member)) return true
        return false
    }
    return (await returned.getSymbol())?.name === 'Response'
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

/** A node, or where it is a name, what the name was initialized with. */
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
 * What the build can read without running the handler, as `declaredFor` reads `clients` — for
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
 * What a handler call's inline `clients` declares for `surface`, or `undefined` where it does not.
 *
 * 20.4, 38.62 — written on the declaration, which is what the build can read without running it:
 * `ui: false` gives the file's browser copy no stand-in for it; `cli: false` keeps it off the
 * shell's listing, which reads the table the build wrote (38.7); and an explicit `true` overrides
 * 16.37's default. An options object built elsewhere, or a value that is not a literal, is not read.
 */
function declaredFor(
    call: Node & { arguments?: readonly Node[] },
    surface: 'ui' | 'cli' | 'mcp',
): boolean | undefined {
    const options = call.arguments?.[1]
    if (options === undefined || !isObjectLiteralExpression(options))
        return undefined
    const clients = optionNamed(options, 'clients')
    if (clients === undefined || !isObjectLiteralExpression(clients))
        return undefined
    const kind = optionNamed(clients, surface)?.kind
    return kind === SyntaxKind.FalseKeyword
        ? false
        : kind === SyntaxKind.TrueKeyword
          ? true
          : undefined
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
 * 16.39 — the path to the first `Reactive` nested in a handler's value, or `undefined`.
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
    walk: Walk<Set<number>>,
): Promise<string | undefined> {
    if (type === undefined || walk.depth >= DEEPEST) return undefined
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
    const inner: Walk<Set<number>> = { seen: walk.seen, depth: walk.depth + 1 }
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
