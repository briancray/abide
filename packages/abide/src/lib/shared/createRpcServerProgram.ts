import { resolve } from 'node:path'
import ts from 'typescript'
import { loadProjectTsConfig } from './loadProjectTsConfig.ts'
import type { HttpMethod } from './types/HttpMethod.ts'

const RPC_HELPERS = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])

export type RpcServerProgram = {
    /*
    Whether the rpc module at `modulePath` has a STREAMING handler, decided through the
    type graph: the handler's return type resolves to a `TypedResponse<AsyncIterable<…>>`
    (the branded shape only `jsonl()`/`sse()` produce). Returns true/false when the export
    call site and a call signature are found — INCLUDING when the stream is produced through
    a wrapper function, the case the char-scan `detectStreaming` misses. undefined when the
    module or its export call can't be resolved, so the caller fails open to the scan.
    */
    streamingForModule(modulePath: string): boolean | undefined
    /*
    The rpc's HTTP method, read from the export binding's helper SYMBOL (aliases and
    re-exports followed through the checker) rather than the callee's source text. So an
    `import { GET as read }` / a re-exported helper resolves to `GET`, where the `RPC_EXPORT`
    regex — keyed on the literal helper name — misses it. undefined when the export call or
    its helper symbol can't be resolved, so the caller fails open to `detectRpcMethod`.
    */
    methodForModule(modulePath: string): HttpMethod | undefined
    /*
    The `outbox` opt's statically-known boolean, read from the opts object's property TYPE
    through the checker. `true`/`false` when the property resolves to a boolean literal —
    including through an imported const (`outbox: OUTBOX_ENABLED` where `OUTBOX_ENABLED` is
    `true`), which the `OUTBOX_OPT` regex (inline-literal only) can't read; `false` when the
    call carries no opts or no `outbox` key. undefined when the export call can't be resolved
    or the property's type isn't a boolean literal (a genuinely computed value), so the caller
    fails open to `detectDurable` — which rejects a non-literal loudly.
    */
    outboxForModule(modulePath: string): boolean | undefined
}

/*
Warms one `ts.Program` over every `.ts` under `rpcDir`, reused across every rpc transform
in the root (ADR-0025 D1 — the server-side mirror of the UI shadow program). The handler's
transitive imports resolve on demand through the default compiler host, so the type queries
see the real `jsonl()`/`sse()` return shape, the aliased helper's origin symbol, and an
imported const's literal type. Type queries only — never emits, never reports diagnostics; a
module that fails to type-check still yields its answers. Building is the expensive step (a
few hundred ms once per root), so the resolver plugin caches it per-root and builds it lazily
on the first rpc transform.
*/
export function createRpcServerProgram(cwd: string, rpcDir: string): RpcServerProgram {
    const rpcFiles = [...new Bun.Glob('**/*.ts').scanSync({ cwd: rpcDir, onlyFiles: true })].map(
        (relative) => resolve(rpcDir, relative),
    )
    const { options } = loadProjectTsConfig(cwd)
    const program = ts.createProgram({ rootNames: rpcFiles, options })
    const checker = program.getTypeChecker()
    /* Every query fails open to its char-scan/regex counterpart: an unresolved module or any
       checker throw yields undefined so a type-resolution hiccup never breaks a build (ADR-0025
       D3). */
    const query = <T>(modulePath: string, read: (call: ResolvedRpcCall) => T | undefined): T | undefined => {
        try {
            const sourceFile = program.getSourceFile(modulePath)
            if (sourceFile === undefined) {
                return undefined
            }
            const call = resolveRpcCall(checker, sourceFile)
            if (call === undefined) {
                return undefined
            }
            return read(call)
        } catch {
            return undefined
        }
    }
    return {
        streamingForModule(modulePath) {
            return query(modulePath, (call) => handlerReturnsStream(checker, call.node))
        },
        methodForModule(modulePath) {
            return query(modulePath, (call) => call.method)
        },
        outboxForModule(modulePath) {
            return query(modulePath, (call) => outboxLiteral(checker, call.node))
        },
    }
}

type ResolvedRpcCall = {
    /* The exported `<METHOD>(handler, opts?)` CallExpression. */
    node: ts.CallExpression
    /* The method the callee's helper symbol resolves to (alias/re-export followed). */
    method: HttpMethod
}

/*
The module's exported rpc call — the initializer of `export const <name> = <helper>(…)` whose
callee resolves (through the checker, following import aliases and re-exports) to one of the
rpc helper symbols. Scoped to top-level exported const initializers, so a nested `jsonl(` in a
handler body can't match and an aliased helper (`import { GET as read }`) still resolves. undefined
when no such export exists — the caller falls back to the char-scan.
*/
function resolveRpcCall(
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
): ResolvedRpcCall | undefined {
    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) {
            continue
        }
        const isExported = statement.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
        if (!isExported) {
            continue
        }
        for (const declaration of statement.declarationList.declarations) {
            const initializer = declaration.initializer
            if (initializer === undefined || !ts.isCallExpression(initializer)) {
                continue
            }
            const method = methodOfCallee(checker, initializer.expression)
            if (method !== undefined) {
                return { node: initializer, method }
            }
        }
    }
    return undefined
}

/*
The HTTP method a call's callee names — the origin helper symbol's name, following import
aliases and re-exports through the checker (so `read` from `import { GET as read }` yields
`GET`). Falls back to the callee's own identifier text when the symbol doesn't resolve, so a
bare `GET(` still reads as `GET` even if type resolution hiccups. undefined when neither is an
rpc helper.
*/
function methodOfCallee(checker: ts.TypeChecker, callee: ts.Expression): HttpMethod | undefined {
    if (!ts.isIdentifier(callee)) {
        return undefined
    }
    let symbol = checker.getSymbolAtLocation(callee)
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) {
        symbol = checker.getAliasedSymbol(symbol)
    }
    const resolvedName = symbol?.getName()
    if (resolvedName !== undefined && RPC_HELPERS.has(resolvedName)) {
        return resolvedName as HttpMethod
    }
    if (RPC_HELPERS.has(callee.text)) {
        return callee.text as HttpMethod
    }
    return undefined
}

/*
The `outbox` opt's boolean value, read from the opts (second) argument's property type. `false`
when the call has no opts arg or no `outbox` property (a resolvable non-durable rpc, so the
caller doesn't needlessly defer to the scan). undefined when the property's type isn't a boolean
literal — a genuinely computed value the caller must reject via the scan's literal check.
*/
function outboxLiteral(checker: ts.TypeChecker, call: ts.CallExpression): boolean | undefined {
    const opts = call.arguments[1]
    if (opts === undefined) {
        return false
    }
    const property = checker.getTypeAtLocation(opts).getProperty('outbox')
    if (property === undefined) {
        return false
    }
    return booleanLiteral(checker, checker.getTypeOfSymbolAtLocation(property, opts))
}

/* A type's boolean-literal value (`true`/`false`), or undefined when it isn't a single boolean
   literal (`boolean`, a widened value, or a non-boolean). typeToString renders a boolean literal
   as exactly `'true'`/`'false'`. */
function booleanLiteral(checker: ts.TypeChecker, type: ts.Type): boolean | undefined {
    if ((type.flags & ts.TypeFlags.BooleanLiteral) === 0) {
        return undefined
    }
    return checker.typeToString(type) === 'true'
}

/*
The rpc export's handler return type, tested for the streaming brand. undefined when no handler
call signature is found — the caller falls back to the char-scan. A resolvable handler that
returns a plain value yields `false` (definitively not streaming), so a warm program does not
needlessly defer to the scan for ordinary handlers.
*/
function handlerReturnsStream(
    checker: ts.TypeChecker,
    call: ts.CallExpression,
): boolean | undefined {
    const handler = call.arguments[0]
    if (handler === undefined) {
        return undefined
    }
    const signature = checker.getTypeAtLocation(handler).getCallSignatures()[0]
    if (signature === undefined) {
        return undefined
    }
    const returnType = unwrapPromise(checker, checker.getReturnTypeOfSignature(signature))
    return returnTypeIsStreaming(checker, returnType)
}

/* An async handler returns `Promise<TypedResponse<…>>`; unwrap one Promise layer so the
   brand check sees the response type. */
function unwrapPromise(checker: ts.TypeChecker, type: ts.Type): ts.Type {
    if (type.getSymbol()?.name === 'Promise') {
        const inner = checker.getTypeArguments(type as ts.TypeReference)[0]
        if (inner !== undefined) {
            return inner
        }
    }
    return type
}

/* True when the type is (or, across a union of return branches, contains) a
   `TypedResponse<AsyncIterable<…>>` — a `__body` phantom property whose type is async-iterable.
   `jsonl()`/`sse()` are the only constructors of that shape, so this is congruent by
   construction with the RemoteCallable streaming conditional. */
function returnTypeIsStreaming(checker: ts.TypeChecker, type: ts.Type): boolean {
    if (type.isUnion()) {
        return type.types.some((member) => returnTypeIsStreaming(checker, member))
    }
    const bodyProperty = type.getProperty('__body')
    if (bodyProperty === undefined) {
        return false
    }
    const declaration = bodyProperty.valueDeclaration ?? bodyProperty.declarations?.[0]
    if (declaration === undefined) {
        return false
    }
    return typeIsAsyncIterable(
        checker,
        checker.getTypeOfSymbolAtLocation(bodyProperty, declaration),
    )
}

/* Async-iterable iff the type exposes a `[Symbol.asyncIterator]` member — the computed
   well-known symbol surfaces as an `__@asyncIterator@<n>` property name. Recurses through a
   union so `AsyncIterable<A> | AsyncIterable<B>` still counts. */
function typeIsAsyncIterable(checker: ts.TypeChecker, type: ts.Type): boolean {
    if (type.isUnion()) {
        return type.types.some((member) => typeIsAsyncIterable(checker, member))
    }
    for (const property of checker.getPropertiesOfType(type)) {
        if (property.getName().includes('asyncIterator')) {
            return true
        }
    }
    return false
}
