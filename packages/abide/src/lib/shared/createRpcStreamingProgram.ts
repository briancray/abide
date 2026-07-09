import { resolve } from 'node:path'
import ts from 'typescript'
import { loadProjectTsConfig } from './loadProjectTsConfig.ts'

const RPC_HELPERS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])

export type RpcStreamingProgram = {
    /*
    Whether the rpc module at `modulePath` has a STREAMING handler, decided through the
    type graph: the handler's return type resolves to a `TypedResponse<AsyncIterable<…>>`
    (the branded shape only `jsonl()`/`sse()` produce). Returns true/false when the export
    call site and a call signature are found — INCLUDING when the stream is produced through
    a wrapper function, the case the char-scan `detectStreaming` misses. undefined when the
    module or its export call can't be resolved, so the caller fails open to the scan.
    */
    streamingForModule(modulePath: string): boolean | undefined
}

/*
Warms one `ts.Program` over every `.ts` under `rpcDir`, reused across every rpc transform
in the root (ADR-0025 D1 — the server-side mirror of the UI shadow program). The handler's
transitive imports resolve on demand through the default compiler host, so the return-type
query sees `jsonl()`/`sse()`'s real `TypedResponse<AsyncIterable<…>>` type. Type queries only
— never emits, never reports diagnostics; a module that fails to type-check still yields its
return type. Building is the expensive step (a few hundred ms once per root), so the resolver
plugin caches it per-root and builds it lazily on the first rpc transform.
*/
export function createRpcStreamingProgram(cwd: string, rpcDir: string): RpcStreamingProgram {
    const rpcFiles = [...new Bun.Glob('**/*.ts').scanSync({ cwd: rpcDir, onlyFiles: true })].map(
        (relative) => resolve(rpcDir, relative),
    )
    const { options } = loadProjectTsConfig(cwd)
    const program = ts.createProgram({ rootNames: rpcFiles, options })
    const checker = program.getTypeChecker()
    return {
        streamingForModule(modulePath) {
            try {
                const sourceFile = program.getSourceFile(modulePath)
                if (sourceFile === undefined) {
                    return undefined
                }
                return handlerReturnsStream(checker, sourceFile)
            } catch {
                /* Any checker throw fails open to the scan — a type-resolution hiccup must
                   never break a build (ADR-0025 D3). */
                return undefined
            }
        },
    }
}

/*
The rpc export's handler return type, tested for the streaming brand. undefined when no
`export const <name> = <METHOD>(handler, …)` call or no handler call signature is found —
the caller falls back to the char-scan. A resolvable handler that returns a plain value
yields `false` (definitively not streaming), so a warm program does not needlessly defer
to the scan for ordinary handlers.
*/
function handlerReturnsStream(
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
): boolean | undefined {
    const call = findRpcCall(sourceFile)
    const handler = call?.arguments[0]
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

/* The first `<METHOD>(…)` call whose callee is a bare rpc-helper identifier (`GET(`, or
   `GET<…>(` — the type arguments hang off the same CallExpression). Top-down, so the export's
   own helper call is reached before descending into its handler body (where a nested `jsonl(`
   would otherwise match first). */
function findRpcCall(sourceFile: ts.SourceFile): ts.CallExpression | undefined {
    let found: ts.CallExpression | undefined
    const visit = (node: ts.Node): void => {
        if (found !== undefined) {
            return
        }
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            RPC_HELPERS.has(node.expression.text)
        ) {
            found = node
            return
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return found
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
