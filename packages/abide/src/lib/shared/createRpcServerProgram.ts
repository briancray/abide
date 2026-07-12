import { resolve } from 'node:path'
import ts from 'typescript'
import { HTTP_METHODS } from './HTTP_METHODS.ts'
import { jsonSchemaForType } from './jsonSchemaForType.ts'
import { loadProjectTsConfig } from './loadProjectTsConfig.ts'
import type { ErrorJsonSchemas } from './types/ErrorJsonSchemas.ts'
import type { HttpMethod } from './types/HttpMethod.ts'
import type { InputCoercion } from './types/InputCoercion.ts'
import type { OutputWirePlan } from './types/OutputWirePlan.ts'
import type { ReturnBody } from './types/ReturnBody.ts'
import type { WireKind } from './types/WireKind.ts'

const RPC_HELPERS = new Set<string>(HTTP_METHODS)
const NUMBER_FLAGS = ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral
const BOOLEAN_FLAGS = ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral
const BIGINT_FLAGS = ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral
const NULLISH_FLAGS = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void
// Only `undefined`/`void` make a property OPTIONAL (a `T | null` is a required-but-nullable field).
const OPTIONALITY_FLAGS = ts.TypeFlags.Undefined | ts.TypeFlags.Void

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
    The input-args wire codec plan (ADR-0028 scalars, ADR-0029 structured): the endpoint's wire
    `Args` type read off the exported RemoteFunction's call signature, projected to the
    number/boolean/date/bigint/set/map fields parseArgs revives a plain-JSON wire value into. Reads
    `InferInput` (the wire shape the schema validates), so a self-coercing schema whose input is
    loose is correctly left uncoerced. undefined when the export call or its Args type can't be
    resolved, or no field is a recognized WireKind — the caller then stamps no plan, so a GET field
    stays a string exactly as today.
    */
    inputCoercionForModule(modulePath: string): InputCoercion | undefined
    /*
    The output-args wire codec plan (ADR-0029 output path): the endpoint's success RESPONSE body type
    (resolved the same way `returnBodyForModule`/`walkSuccessBodies` read it — unwrap `Promise`, drop
    the `TypedError` branches) projected to the structured `date`/`bigint`/`set`/`map` fields the
    client proxy revives from a decoded response. The response-side sibling of
    `inputCoercionForModule`: it is baked onto the CLIENT `remoteProxy` stub (not the server
    `defineRpc`), so an abide client revives a `Set`/`Map`/`bigint`/`Date` the server encoded to
    honest JSON. Only the structured kinds are listed — `number`/`boolean` already ride as their JSON
    type. undefined when the export call or its success body can't be resolved, or no field is a
    structured WireKind, so the client bakes no plan and a response array stays an array.
    */
    outputWirePlanForModule(modulePath: string): OutputWirePlan | undefined
    /*
    The endpoint's success-BODY type (ADR-0030), read from the handler's return type the same way
    streaming detection reads it: unwrap `Promise`, drop the `TypedError` branches, take each
    success `TypedResponse<Body>` body. `type` is that body rendered as a TS type string; a
    streaming endpoint reports `streaming: true` and the per-FRAME type (the `AsyncIterable`
    element) so a surface describes one streamed item. This is the output-side sibling of
    `inputCoercionForModule` — the handler's return is the single source for the generated surfaces
    (`.d.ts`/OpenAPI 200/MCP outputSchema) instead of a hand-written `schemas.output`. undefined
    when the export call or its handler body type can't be resolved, so a consumer falls open to an
    author-declared `schemas.output`.
    */
    returnBodyForModule(modulePath: string): ReturnBody | undefined
    /*
    The endpoint's success-body projected to JSON Schema (ADR-0030 D2), for the OpenAPI 200 / MCP
    outputSchema / inspector surface when the author declared no `schemas.output` validator. Resolves
    the same success-body `ts.Type`(s) `returnBodyForModule` reads — unwrap `Promise`, drop the
    `TypedError` branches, frame-unwrap a streaming body — then projects each through
    `jsonSchemaForType`, combining multiple success branches under `anyOf`. undefined when no body
    resolves or the projection is bare permissive `{}`, so a surface omits the schema exactly as today
    when no `schemas.output` is declared. The build stamps the resolved schema into the server
    `defineRpc` call (like the ADR-0028 `coerce` plan) so the runtime registry can carry it.
    */
    returnBodySchemaForModule(modulePath: string): Record<string, unknown> | undefined
    /*
    The endpoint's typed-error branches surfaced as a status-keyed JSON-Schema map (ADR-0030) — the
    error-branch sibling of `returnBodySchemaForModule`. Walks the SAME return union but KEEPS the
    `TypedError` branches success projection drops: for each, reads the `error.typed(name, status,
    schema?)` brand's numeric `status` and projects the error's `data` type (its schema's
    `~standard.types.input`) through `jsonSchemaForType`. Errors sharing a status combine under
    `anyOf`; a nullary error (no data) contributes a bare `{}` so the status still surfaces. undefined
    when no handler signature resolves or the handler declares no typed errors, so a consumer omits
    the error responses exactly as today. The build stamps the resolved map into the server
    `defineRpc` call (like `outputJsonSchema`) so the runtime registry can carry it to OpenAPI.
    */
    errorSchemasForModule(modulePath: string): ErrorJsonSchemas | undefined
    /*
    The endpoint's INPUT args projected to JSON Schema (ADR-0030 input side — the input-surface
    sibling of `returnBodySchemaForModule`), for the OpenAPI parameters/request body / MCP
    inputSchema / inspector input surface when the author declared no `schemas.input` VALIDATOR.
    Resolves the SAME wire `Args` bag `inputCoercionForModule` reads — the exported RemoteFunction's
    first call-signature parameter, with the multipart `FormData` member dropped — then projects each
    property through `jsonSchemaForType` into an object schema. File-typed properties are EXCLUDED
    exactly as `filesSchema` keeps File parts out of the `inputSchema` projection (a File has no
    honest JSON-Schema form). This is a SHAPE description only: it is never wired into runtime
    validation, so it can never produce a 422 — an author who wants that still declares
    `schemas.input`, which also OVERRIDES this projection on every surface. undefined when no call
    signature / Args bag resolves or every property is excluded, so the surface behaves as today. The
    build stamps the resolved schema into the server `defineRpc` call so the runtime registry carries
    it.
    */
    inputSchemaForModule(modulePath: string): Record<string, unknown> | undefined
    /*
    The top-level statements the CLIENT rpc module must retain — reachability rooted at the endpoint
    `opts` argument, resolved through the binder/checker rather than by scanning source text. On the
    client an rpc is only a `remoteProxy` fetch, so the handler and every declaration/import only it
    reaches is dead; but `opts` (schemas/cache/stream) is a LIVE expression that may reference
    imported values and module-level consts (e.g. a `const inputSchema = z.object(...)` under
    `schemas.input`), so those — and what THEY reach — must survive. Returns each kept statement's
    source text in source order (imports + declarations transitively reachable from `opts`),
    EXCLUDING the exported rpc statement itself (it becomes the `remoteProxy` line) and, naturally,
    the rpc-helper import (`opts` never names it). An endpoint with no `opts` returns `[]` — a bare
    `remoteProxy` needs nothing. undefined when the module or its rpc call can't be resolved, so the
    caller falls open to the keep-the-file char-scan rewrite (ADR-0022 D2 legacy path).
    */
    clientKeepForModule(modulePath: string): string[] | undefined
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
    const query = <T>(
        modulePath: string,
        read: (call: ResolvedRpcCall) => T | undefined,
    ): T | undefined => {
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
        inputCoercionForModule(modulePath) {
            return query(modulePath, (call) => inputCoercionPlan(checker, call.node))
        },
        outputWirePlanForModule(modulePath) {
            return query(modulePath, (call) => outputWirePlan(checker, call.node))
        },
        returnBodyForModule(modulePath) {
            return query(modulePath, (call) => handlerReturnBody(checker, call.node))
        },
        returnBodySchemaForModule(modulePath) {
            return query(modulePath, (call) => returnBodyJsonSchema(checker, call.node))
        },
        errorSchemasForModule(modulePath) {
            return query(modulePath, (call) => errorBranchSchemas(checker, call.node))
        },
        inputSchemaForModule(modulePath) {
            return query(modulePath, (call) => inputArgsJsonSchema(checker, call.node))
        },
        clientKeepForModule(modulePath) {
            /* Needs the SourceFile alongside the call (statement walk), so it resolves both itself
               rather than going through `query` (which yields only the call). Same fail-open
               contract: an unresolved module / any checker throw yields undefined. */
            try {
                const sourceFile = program.getSourceFile(modulePath)
                if (sourceFile === undefined) {
                    return undefined
                }
                const call = resolveRpcCall(checker, sourceFile)
                if (call === undefined) {
                    return undefined
                }
                return clientKeepStatements(checker, sourceFile, call.node)
            } catch {
                return undefined
            }
        },
    }
}

/*
The top-level statements the client rpc module retains, rooted at the endpoint `opts` argument
(ADR-0022 addendum). Builds a reachability graph over the module's top-level bindings — each binding
symbol → its declaring statement, plus which top-level symbols each statement references — then
marks every statement reachable from `opts` and returns the marked ones' source text in source
order. The exported rpc statement is excluded (it becomes the `remoteProxy` line); everything the
handler alone reaches is simply never marked, so it drops out.
*/
function clientKeepStatements(
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
    call: ts.CallExpression,
): string[] {
    const opts = call.arguments[1]
    // No opts → the client module needs nothing but the bare remoteProxy call.
    if (opts === undefined) {
        return []
    }
    // The exported rpc statement becomes the remoteProxy line, so it is never a retained statement.
    const exportStatement = enclosingTopLevelStatement(call, sourceFile)
    // Every top-level binding symbol → the statement that declares it (the export statement's own
    // bindings excluded so a self-reference can't re-admit it).
    const declaringStatement = new Map<ts.Symbol, ts.Statement>()
    for (const statement of sourceFile.statements) {
        if (statement === exportStatement) {
            continue
        }
        for (const symbol of topLevelBindingSymbols(checker, statement)) {
            declaringStatement.set(symbol, statement)
        }
    }
    // Mark from opts outward: a statement is kept once any of its bindings is referenced by opts or
    // by an already-kept statement (transitive closure via the work queue).
    const kept = new Set<ts.Statement>()
    const queue: ts.Node[] = [opts]
    while (queue.length > 0) {
        const node = queue.pop() as ts.Node
        for (const symbol of referencedTopLevelSymbols(checker, node, declaringStatement)) {
            const statement = declaringStatement.get(symbol)
            if (statement !== undefined && !kept.has(statement)) {
                kept.add(statement)
                queue.push(statement)
            }
        }
    }
    const texts: string[] = []
    for (const statement of sourceFile.statements) {
        if (kept.has(statement)) {
            texts.push(statement.getText(sourceFile))
        }
    }
    return texts
}

/* The top-level statement enclosing `node` — walk parents until the one whose parent is the source
   file. */
function enclosingTopLevelStatement(node: ts.Node, sourceFile: ts.SourceFile): ts.Statement {
    let current: ts.Node = node
    while (current.parent !== undefined && current.parent !== sourceFile) {
        current = current.parent
    }
    return current as ts.Statement
}

/*
The binding symbols a top-level statement introduces — an import's clause names (default /
namespace / each named element), a variable statement's declaration names (destructuring patterns
walked to their leaves), and a function/class declaration's name. A statement that binds nothing
(a bare side-effect `import './x'`, an expression statement) contributes no symbol and so is never
reachable from opts — exactly the server-only setup the client drops.
*/
function topLevelBindingSymbols(checker: ts.TypeChecker, statement: ts.Statement): ts.Symbol[] {
    const names: ts.Node[] = []
    if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause
        if (clause?.name !== undefined) {
            names.push(clause.name)
        }
        const bindings = clause?.namedBindings
        if (bindings !== undefined) {
            if (ts.isNamespaceImport(bindings)) {
                names.push(bindings.name)
            } else {
                for (const element of bindings.elements) {
                    names.push(element.name)
                }
            }
        }
    } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
            collectBindingNames(declaration.name, names)
        }
    } else if (
        (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
        statement.name !== undefined
    ) {
        names.push(statement.name)
    }
    const symbols: ts.Symbol[] = []
    for (const name of names) {
        const symbol = checker.getSymbolAtLocation(name)
        if (symbol !== undefined) {
            symbols.push(symbol)
        }
    }
    return symbols
}

/* The leaf identifiers of a binding name — a plain identifier is itself; a destructuring pattern
   (`{ a, b: { c } }`, `[x, ...rest]`) descends to each bound identifier. */
function collectBindingNames(name: ts.BindingName, out: ts.Node[]): void {
    if (ts.isIdentifier(name)) {
        out.push(name)
        return
    }
    for (const element of name.elements) {
        if (ts.isBindingElement(element)) {
            collectBindingNames(element.name, out)
        }
    }
}

/*
The top-level binding symbols referenced within `node` — every identifier in the subtree whose
resolved symbol is a known top-level binding. An import alias resolves to the same local symbol at
its use site and its declaration, so uses match declarations; a property name (`obj.map`) resolves
to a property symbol, not a top-level one, so it can't false-match. Over-inclusion is safe (it only
keeps more), so a bare identifier scan needs no scope analysis.
*/
function referencedTopLevelSymbols(
    checker: ts.TypeChecker,
    node: ts.Node,
    declaringStatement: Map<ts.Symbol, ts.Statement>,
): ts.Symbol[] {
    const found: ts.Symbol[] = []
    const consider = (symbol: ts.Symbol | undefined): void => {
        if (symbol !== undefined && declaringStatement.has(symbol)) {
            found.push(symbol)
        }
    }
    const visit = (current: ts.Node): void => {
        // A shorthand `{ schemas }` resolves to the object PROPERTY symbol at its location, not the
        // referenced binding — so read the value symbol explicitly, else the used import is missed
        // (the one unsafe direction: a dropped-but-needed statement).
        if (ts.isShorthandPropertyAssignment(current)) {
            consider(checker.getShorthandAssignmentValueSymbol(current))
        } else if (ts.isIdentifier(current)) {
            consider(checker.getSymbolAtLocation(current))
        }
        ts.forEachChild(current, visit)
    }
    visit(node)
    return found
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

/*
The rpc export's success-body descriptor (ADR-0030), projected from the handler's return type the
same way `handlerReturnsStream` reads it — unwrap one `Promise` layer, then walk the return union.
This mirrors `RpcHelper`'s `SuccessBody<R>`: a `TypedError` branch (its `__abideError` brand) is an
error response and is dropped; every success `TypedResponse<Body>` (its `__body` phantom) yields its
body. A branch is a streaming body when the body is async-iterable, in which case its per-FRAME type
(the `AsyncIterable` element) is taken and the descriptor marked streaming. undefined when no handler
call signature or no success body resolves — the caller falls open to an author-declared schema.
*/
function handlerReturnBody(
    checker: ts.TypeChecker,
    call: ts.CallExpression,
): ReturnBody | undefined {
    const rendered: string[] = []
    let streaming = false
    const resolved = walkSuccessBodies(checker, call, (part, isStreaming) => {
        if (isStreaming) {
            streaming = true
        }
        // An untagged Response (no `__body` phantom) has an `unknown` success body — SuccessBody's fallback.
        pushUnique(rendered, part === undefined ? 'unknown' : checker.typeToString(part))
    })
    if (!resolved || rendered.length === 0) {
        return undefined
    }
    return { type: rendered.join(' | '), streaming }
}

/*
The rpc export's success body projected to JSON Schema (ADR-0030 D2) — the output-surface sibling of
`handlerReturnBody`, walking the identical success-body constituents but projecting each through
`jsonSchemaForType` instead of rendering a TS string. Multiple success branches combine under `anyOf`;
an untagged/unprojectable body contributes the permissive `{}`. undefined when no handler signature
resolves or the combined schema is bare permissive `{}` — the caller falls open to an author-declared
`schemas.output`.
*/
function returnBodyJsonSchema(
    checker: ts.TypeChecker,
    call: ts.CallExpression,
): Record<string, unknown> | undefined {
    const schemas: Record<string, unknown>[] = []
    const resolved = walkSuccessBodies(checker, call, (part) => {
        const projected = part === undefined ? undefined : jsonSchemaForType(checker, part)
        pushUniqueSchema(schemas, projected ?? {})
    })
    if (!resolved || schemas.length === 0) {
        return undefined
    }
    const [onlySchema] = schemas
    const combined =
        schemas.length === 1 && onlySchema !== undefined ? onlySchema : { anyOf: schemas }
    return Object.keys(combined).length === 0 ? undefined : combined
}

/*
Walks a handler's success-body constituents, shared by `handlerReturnBody` (renders each to a TS
string) and `returnBodyJsonSchema` (projects each to JSON Schema) so the two surfaces stay congruent.
Unwraps one `Promise`, then over the return union drops the `TypedError` branches (their `__abideError`
brand) and, for each success `TypedResponse<Body>` (its `__body` phantom), visits every meaningful body
part — frame-unwrapped and flagged streaming when async-iterable. `visit` receives undefined for an
untagged Response (its body is `unknown`). Returns false when no handler call signature resolves, so
callers fail open.
*/
function walkSuccessBodies(
    checker: ts.TypeChecker,
    call: ts.CallExpression,
    visit: (part: ts.Type | undefined, streaming: boolean) => void,
): boolean {
    const members = returnUnionMembers(checker, call)
    if (members === undefined) {
        return false
    }
    for (const member of members) {
        if (member.getProperty('__abideError') !== undefined) {
            continue
        }
        const bodyProperty = member.getProperty('__body')
        if (bodyProperty === undefined) {
            visit(undefined, false)
            continue
        }
        const declaration = bodyProperty.valueDeclaration ?? bodyProperty.declarations?.[0]
        if (declaration === undefined) {
            visit(undefined, false)
            continue
        }
        // The `__body?` phantom is optional, so reading its type adds a spurious `| undefined`;
        // drop the nullish members (indistinguishable from an authored optional body — the surface
        // describes the present value's shape either way).
        const bodyType = checker.getTypeOfSymbolAtLocation(bodyProperty, declaration)
        for (const part of meaningfulMembers(bodyType)) {
            if (typeIsAsyncIterable(checker, part)) {
                visit(asyncIterableElement(checker, part) ?? part, true)
            } else {
                visit(part, false)
            }
        }
    }
    return true
}

/* The handler's return-type union members — the shared front of both the success walk
   (`walkSuccessBodies`) and the error walk (`errorBranchSchemas`): resolve the handler call
   signature, unwrap one `Promise` layer, then split the union (a lone return is a one-member list).
   undefined when no handler call signature resolves, so both callers fail open. */
function returnUnionMembers(
    checker: ts.TypeChecker,
    call: ts.CallExpression,
): ts.Type[] | undefined {
    const handler = call.arguments[0]
    if (handler === undefined) {
        return undefined
    }
    const signature = checker.getTypeAtLocation(handler).getCallSignatures()[0]
    if (signature === undefined) {
        return undefined
    }
    const returnType = unwrapPromise(checker, checker.getReturnTypeOfSignature(signature))
    return returnType.isUnion() ? returnType.types : [returnType]
}

/*
The handler's typed-error branches projected to a status-keyed JSON-Schema map (ADR-0030) — the
error-branch sibling of `returnBodyJsonSchema`, walking the SAME return union but keeping the
`TypedError` members the success walk drops. For each `__abideError`-branded branch it reads the
brand's numeric `entry.status` (a literal, captured by `error.typed`'s `Status` type param) and
projects the error's `data` type (its schema's `~standard.types.input`) through `jsonSchemaForType`.
Branches sharing a status combine their distinct data schemas under `anyOf`; a nullary error (no
`data`) contributes a bare `{}` so the status still surfaces. undefined when no handler signature
resolves or no typed-error branch is present, so the caller stamps nothing and the surface omits the
error responses exactly as today.
*/
function errorBranchSchemas(
    checker: ts.TypeChecker,
    call: ts.CallExpression,
): ErrorJsonSchemas | undefined {
    const members = returnUnionMembers(checker, call)
    if (members === undefined) {
        return undefined
    }
    // Status → its collected distinct data schemas (empty when only nullary errors share the status).
    const byStatus = new Map<number, Record<string, unknown>[]>()
    for (const member of members) {
        const brand = member.getProperty('__abideError')
        if (brand === undefined) {
            continue
        }
        const entry = memberType(checker, checker.getTypeOfSymbol(brand), 'entry')
        if (entry === undefined) {
            continue
        }
        const status = numberLiteral(memberType(checker, entry, 'status'))
        if (status === undefined) {
            continue
        }
        let schemas = byStatus.get(status)
        if (schemas === undefined) {
            schemas = []
            byStatus.set(status, schemas)
        }
        const dataSchema = errorDataSchema(checker, memberType(checker, entry, 'data'))
        if (dataSchema !== undefined) {
            pushUniqueSchema(schemas, dataSchema)
        }
    }
    if (byStatus.size === 0) {
        return undefined
    }
    const result: ErrorJsonSchemas = {}
    for (const [status, schemas] of byStatus) {
        const [onlySchema] = schemas
        result[status] =
            schemas.length === 0
                ? {}
                : schemas.length === 1 && onlySchema !== undefined
                  ? onlySchema
                  : { anyOf: schemas }
    }
    return result
}

/* An error branch's `data` type projected to JSON Schema — navigates the schema brand's phantom
   `~standard.types.input` (the data payload the `error.typed` constructor receives) and projects it
   via `jsonSchemaForType`. undefined for a nullary error (its `entry.data` is `undefined`, so the
   `~standard` chain doesn't resolve) or an unprojectable/permissive data type, so the status
   surfaces without a content schema. */
function errorDataSchema(
    checker: ts.TypeChecker,
    dataType: ts.Type | undefined,
): Record<string, unknown> | undefined {
    if (dataType === undefined) {
        return undefined
    }
    const standard = memberType(checker, dataType, '~standard')
    if (standard === undefined) {
        return undefined
    }
    // `types` is `{ input; output } | undefined` (the spec's optional phantom) — take the non-nullish member.
    const types = memberType(checker, standard, 'types')
    if (types === undefined) {
        return undefined
    }
    const input = memberType(checker, nonNullishType(types), 'input')
    if (input === undefined) {
        return undefined
    }
    return jsonSchemaForType(checker, input)
}

/* A named property's type, read location-free off a resolved type. undefined when the type has no
   such property — the phantom-navigation guard for the error brand's nested `entry`/`status`/`data`
   / `~standard`/`types`/`input` chain. */
function memberType(checker: ts.TypeChecker, type: ts.Type, name: string): ts.Type | undefined {
    const symbol = type.getProperty(name)
    return symbol === undefined ? undefined : checker.getTypeOfSymbol(symbol)
}

/* A type's numeric-literal value (e.g. `404`), or undefined when it isn't a single number literal
   (a widened `number`, a union, or undefined) — so a computed error status the type can't pin down
   is skipped rather than guessed. */
function numberLiteral(type: ts.Type | undefined): number | undefined {
    if (type === undefined || (type.flags & ts.TypeFlags.NumberLiteral) === 0) {
        return undefined
    }
    return (type as ts.NumberLiteralType).value
}

/* Drops the nullish members of a `T | undefined` union, returning the lone survivor; else the type
   unchanged (a non-union or a genuine multi-member union stays as-is). Used to strip the spec's
   optional `types?` phantom down to its concrete `Types` object. */
function nonNullishType(type: ts.Type): ts.Type {
    if (!type.isUnion()) {
        return type
    }
    const kept = type.types.filter((member) => (member.flags & NULLISH_FLAGS) === 0)
    const [onlyKept] = kept
    return kept.length === 1 && onlyKept !== undefined ? onlyKept : type
}

/* The non-nullish constituents of a body type — a single-element list for a non-union, else the
   union's members with `undefined`/`null`/`void` dropped (the `__body?` phantom's optionality). All
   members nullish (an unusual `undefined`-only body) keeps them so something still renders. */
function meaningfulMembers(type: ts.Type): ts.Type[] {
    if (!type.isUnion()) {
        return [type]
    }
    const kept = type.types.filter((member) => (member.flags & NULLISH_FLAGS) === 0)
    return kept.length > 0 ? kept : type.types
}

/* The element type of an `AsyncIterable<Frame>` (or the AsyncIterableIterator/AsyncGenerator a
   generator produces) — the per-frame type `jsonl()`/`sse()` streams. undefined when the type isn't
   one of those references, so the caller renders the whole body instead. */
function asyncIterableElement(checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined {
    const name = type.getSymbol()?.name
    if (name === 'AsyncIterable' || name === 'AsyncIterableIterator' || name === 'AsyncGenerator') {
        return checker.getTypeArguments(type as ts.TypeReference)[0]
    }
    return undefined
}

/* Appends `value` only when not already present, so a union of identical success branches renders
   once (the rendered list stays a small monomorphic string array). */
function pushUnique(list: string[], value: string): void {
    if (!list.includes(value)) {
        list.push(value)
    }
}

/* Appends a projected schema only when structurally new, so identical success branches contribute one
   `anyOf` member. Dedup by serialization — the schema objects are small plain data, and this build
   path runs once per rpc. */
function pushUniqueSchema(list: Record<string, unknown>[], schema: Record<string, unknown>): void {
    const serialized = JSON.stringify(schema)
    if (!list.some((existing) => JSON.stringify(existing) === serialized)) {
        list.push(schema)
    }
}

/*
The wire codec plan for an rpc export's input args (ADR-0028 scalars, ADR-0029 structured). The
export's type is its RemoteFunction; its call signature's first parameter is the wire `Args` type
(`InferInput` of the input schema, or the handler's annotated param when schemaless). Each
number/boolean/date/bigint/set/map field of that Args object becomes a plan entry; every other
field is omitted. undefined when the RemoteFunction has no call signature, the Args aren't a
single object type, or no field is a recognized WireKind — the caller then ships no plan (today's
string-through behavior).
*/
function inputCoercionPlan(
    checker: ts.TypeChecker,
    call: ts.CallExpression,
): InputCoercion | undefined {
    const signature = checker.getTypeAtLocation(call).getCallSignatures()[0]
    if (signature === undefined) {
        return undefined
    }
    const parameter = signature.getParameters()[0]
    if (parameter === undefined) {
        return undefined
    }
    const argsType = argsBagType(checker.getTypeOfSymbolAtLocation(parameter, call))
    if (argsType === undefined) {
        return undefined
    }
    const plan: InputCoercion = {}
    for (const property of argsType.getProperties()) {
        const kind = wireKind(checker, checker.getTypeOfSymbolAtLocation(property, call))
        if (kind !== undefined) {
            plan[property.getName()] = kind
        }
    }
    /* An empty plan (no codec-eligible field) ships nothing, so no opts are injected. */
    return Object.keys(plan).length === 0 ? undefined : plan
}

/*
The wire codec plan for an rpc export's success RESPONSE body (ADR-0029 output path) — the
response-side sibling of `inputCoercionPlan`. Walks the handler's success-body constituents the same
way the ADR-0030 surfaces do (`walkSuccessBodies` — unwrap `Promise`, drop the `TypedError` branches)
and, for each OBJECT body, reads each property's `WireKind` and keeps only the STRUCTURED kinds
(`date`/`bigint`/`set`/`map`) the client revives — `number`/`boolean` already ride as their JSON type.
A streaming body is skipped (its frame encoding is deferred). undefined when no handler signature
resolves or no structured field is present, so the client bakes no plan.
*/
function outputWirePlan(
    checker: ts.TypeChecker,
    call: ts.CallExpression,
): OutputWirePlan | undefined {
    const plan: OutputWirePlan = {}
    const resolved = walkSuccessBodies(checker, call, (part, streaming) => {
        /* Frame-level encoding for jsonl()/sse() is deferred (ADR-0029), and an untagged Response
           body is `unknown` — neither yields a top-level field plan. */
        if (streaming || part === undefined) {
            return
        }
        for (const property of part.getProperties()) {
            const kind = wireKind(checker, checker.getTypeOfSymbol(property))
            if (kind === 'date' || kind === 'bigint' || kind === 'set' || kind === 'map') {
                plan[property.getName()] = kind
            }
        }
    })
    if (!resolved || Object.keys(plan).length === 0) {
        return undefined
    }
    return plan
}

/*
The rpc export's INPUT args projected to JSON Schema (ADR-0030 input side) — the input-surface
sibling of `returnBodyJsonSchema`. Resolves the SAME wire `Args` bag `inputCoercionPlan` reads (the
exported RemoteFunction's first call-signature parameter, `FormData` dropped by `argsBagType`), then
builds an object schema, projecting each property through `jsonSchemaForType`. A File-typed property
is EXCLUDED exactly as `filesSchema` keeps File parts out of the `inputSchema` projection — a File has
no honest JSON-Schema form, so the multipart body advertises binaries generically instead. A property
is required unless it is `?` optional or its type bears `undefined`. This is purely a SHAPE
description: the surfaces consume it for docs, never for runtime validation, so it can't cause a 422.
undefined when no call signature / single-object Args bag resolves or every property is excluded, so
the caller stamps nothing and the surface falls open to an author-declared `schemas.input`.
*/
function inputArgsJsonSchema(
    checker: ts.TypeChecker,
    call: ts.CallExpression,
): Record<string, unknown> | undefined {
    const signature = checker.getTypeAtLocation(call).getCallSignatures()[0]
    if (signature === undefined) {
        return undefined
    }
    const parameter = signature.getParameters()[0]
    if (parameter === undefined) {
        return undefined
    }
    const argsType = argsBagType(checker.getTypeOfSymbolAtLocation(parameter, call))
    if (argsType === undefined) {
        return undefined
    }
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const property of argsType.getProperties()) {
        const propertyType = checker.getTypeOfSymbolAtLocation(property, call)
        if (isFileType(propertyType)) {
            continue
        }
        // jsonSchemaForType collapses a bare permissive projection to undefined; restore `{}` so an
        // unprojectable property still appears as an "any JSON" field of the object.
        properties[property.getName()] = jsonSchemaForType(checker, propertyType) ?? {}
        const optional =
            (property.flags & ts.SymbolFlags.Optional) !== 0 || bearsOptionality(propertyType)
        if (!optional) {
            required.push(property.getName())
        }
    }
    if (Object.keys(properties).length === 0) {
        return undefined
    }
    const schema: Record<string, unknown> = { type: 'object', properties }
    if (required.length > 0) {
        schema.required = required
    }
    return schema
}

/* True when a type is (or, across a union, contains) `File`/`Blob` — the multipart binary members
   excluded from the input-schema projection, mirroring how `filesSchema` stays out of `inputSchema`. */
function isFileType(type: ts.Type): boolean {
    if (type.isUnion()) {
        return type.types.some((member) => isFileType(member))
    }
    const name = type.getSymbol()?.name
    return name === 'File' || name === 'Blob'
}

/* True when a property's type bears `undefined`/`void` — an implicit optional even without the `?`
   modifier (mirrors jsonSchemaForType's own `bearsUndefined` so the two projections agree). */
function bearsOptionality(type: ts.Type): boolean {
    if (type.isUnion()) {
        return type.types.some((member) => (member.flags & OPTIONALITY_FLAGS) !== 0)
    }
    return (type.flags & OPTIONALITY_FLAGS) !== 0
}

/*
The object `Args` constituent of a RemoteCallable parameter. Every rpc call signature types its
first parameter `Args | FormData` (the multipart upload escape hatch), so the FormData and any
nullish members are dropped and the lone remaining type returned. undefined when the arg is not
a single object type — a no-input rpc (`Args = undefined`) or a FormData-only body — so no plan
is produced.
*/
function argsBagType(parameterType: ts.Type): ts.Type | undefined {
    if (!parameterType.isUnion()) {
        return parameterType
    }
    const kept = parameterType.types.filter(
        (member) => member.getSymbol()?.name !== 'FormData' && (member.flags & NULLISH_FLAGS) === 0,
    )
    return kept.length === 1 ? kept[0] : undefined
}

/*
A field's wire codec kind, or undefined when it isn't codec-eligible. Unwraps `T | undefined` (an
optional field) and a `T[]` (a repeated query key / JSON array whose ELEMENTS revive per item) to
the target type, then classifies: a pure `number`/`boolean`/`bigint` by its type flag, a `Date`/
`Set`/`Map` by its symbol identity through the checker. Anything else — a string, a `number |
string` union, a plain object — → undefined, so it stays its JSON form and the schema decides. The
symbol checks are top-level only: a `Set` NESTED in another value is not descended into (ADR-0029
defers recursive descent).
*/
function wireKind(checker: ts.TypeChecker, type: ts.Type): WireKind | undefined {
    const bare = unwrapOptional(type)
    const target = arrayElement(checker, bare) ?? bare
    if (isKind(target, NUMBER_FLAGS)) {
        return 'number'
    }
    if (isKind(target, BOOLEAN_FLAGS)) {
        return 'boolean'
    }
    if (isKind(target, BIGINT_FLAGS)) {
        return 'bigint'
    }
    const symbolName = target.getSymbol()?.name
    if (symbolName === 'Date') {
        return 'date'
    }
    if (symbolName === 'Set' || symbolName === 'ReadonlySet') {
        return 'set'
    }
    if (symbolName === 'Map' || symbolName === 'ReadonlyMap') {
        return 'map'
    }
    return undefined
}

/* Drops the nullish members of a `T | undefined` optional; returns the lone survivor, else the
   type unchanged (a genuine multi-member union stays as-is for isKind to reject). */
function unwrapOptional(type: ts.Type): ts.Type {
    if (!type.isUnion()) {
        return type
    }
    const kept = type.types.filter((member) => (member.flags & NULLISH_FLAGS) === 0)
    const [onlyKept] = kept
    return kept.length === 1 && onlyKept !== undefined ? onlyKept : type
}

/* The element type of a `T[]`/`readonly T[]`, so a repeated query key (`?tag=1&tag=2`) coerces
   per element; undefined for a non-array (tuples included — their element type is heterogeneous). */
function arrayElement(checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined {
    const name = type.getSymbol()?.name
    if (name === 'Array' || name === 'ReadonlyArray') {
        return checker.getTypeArguments(type as ts.TypeReference)[0]
    }
    return undefined
}

/* True when every meaningful (non-nullish) member of the type matches `mask` — so `number`,
   `number | undefined`, and a `1 | 2` literal union all read as number; a `number | string`
   union does not. A bare `boolean` is a `true | false` union, handled by the recursion. */
function isKind(type: ts.Type, mask: ts.TypeFlags): boolean {
    if (type.isUnion()) {
        const meaningful = type.types.filter((member) => (member.flags & NULLISH_FLAGS) === 0)
        return meaningful.length > 0 && meaningful.every((member) => isKind(member, mask))
    }
    return (type.flags & mask) !== 0
}
