import { resolve } from 'node:path'
import ts from 'typescript'
import { loadProjectTsConfig } from './loadProjectTsConfig.ts'
import type { HttpMethod } from './types/HttpMethod.ts'
import type { InputCoercion } from './types/InputCoercion.ts'
import type { ReturnBody } from './types/ReturnBody.ts'

const RPC_HELPERS = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
const NUMBER_FLAGS = ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral
const BOOLEAN_FLAGS = ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral
const NULLISH_FLAGS = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void

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
    /*
    The input-args coercion plan (ADR-0028): the endpoint's wire `Args` type read off the
    exported RemoteFunction's call signature, projected to the numeric/boolean fields parseArgs
    must coerce a string query/form value into. Reads `InferInput` (the wire shape the schema
    validates), so a self-coercing schema whose input is loose is correctly left uncoerced.
    undefined when the export call or its Args type can't be resolved, or no field is
    numeric/boolean — the caller then stamps no plan, so a GET field stays a string exactly as
    today.
    */
    inputCoercionForModule(modulePath: string): InputCoercion | undefined
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
        outboxForModule(modulePath) {
            return query(modulePath, (call) => outboxLiteral(checker, call.node))
        },
        inputCoercionForModule(modulePath) {
            return query(modulePath, (call) => inputCoercionPlan(checker, call.node))
        },
        returnBodyForModule(modulePath) {
            return query(modulePath, (call) => handlerReturnBody(checker, call.node))
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
    const handler = call.arguments[0]
    if (handler === undefined) {
        return undefined
    }
    const signature = checker.getTypeAtLocation(handler).getCallSignatures()[0]
    if (signature === undefined) {
        return undefined
    }
    const returnType = unwrapPromise(checker, checker.getReturnTypeOfSignature(signature))
    const members = returnType.isUnion() ? returnType.types : [returnType]
    const rendered: string[] = []
    let streaming = false
    for (const member of members) {
        // A TypedError branch is an error response, not a success body — drop it.
        if (member.getProperty('__abideError') !== undefined) {
            continue
        }
        const bodyProperty = member.getProperty('__body')
        if (bodyProperty === undefined) {
            // An untagged Response has no phantom body — its success body is `unknown` (SuccessBody's fallback).
            pushUnique(rendered, 'unknown')
            continue
        }
        const declaration = bodyProperty.valueDeclaration ?? bodyProperty.declarations?.[0]
        if (declaration === undefined) {
            pushUnique(rendered, 'unknown')
            continue
        }
        const bodyType = checker.getTypeOfSymbolAtLocation(bodyProperty, declaration)
        // The `__body?` phantom is optional, so reading its type adds a spurious `| undefined`;
        // drop the nullish members before rendering (indistinguishable from an authored optional
        // body, which the surface treats the same — the present value's shape).
        for (const part of meaningfulMembers(bodyType)) {
            if (typeIsAsyncIterable(checker, part)) {
                streaming = true
                pushUnique(
                    rendered,
                    checker.typeToString(asyncIterableElement(checker, part) ?? part),
                )
            } else {
                pushUnique(rendered, checker.typeToString(part))
            }
        }
    }
    if (rendered.length === 0) {
        return undefined
    }
    return { type: rendered.join(' | '), streaming }
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

/*
The coercion plan for an rpc export's input args (ADR-0028). The export's type is its
RemoteFunction; its call signature's first parameter is the wire `Args` type (`InferInput` of
the input schema, or the handler's annotated param when schemaless). Each numeric/boolean field
of that Args object becomes a plan entry; every other field is omitted. undefined when the
RemoteFunction has no call signature, the Args aren't a single object type, or no field is
coercible — the caller then ships no plan (today's string-through behavior).
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
        const kind = coercionKind(checker, checker.getTypeOfSymbolAtLocation(property, call))
        if (kind !== undefined) {
            plan[property.getName()] = kind
        }
    }
    /* An empty plan (no coercible field) ships nothing, so no opts are injected. */
    return Object.keys(plan).length === 0 ? undefined : plan
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
A field's coercion kind, or undefined when it must not be coerced. Unwraps `T | undefined` (an
optional field) and a `T[]` (a repeated query key arrays into a list) to the target type, then
classifies: a pure `number` (or numeric-literal union) → 'number', a pure `boolean` → 'boolean',
anything else — a string, a `number | string` union, an object, a Date — → undefined, so it
stays a string and the schema decides.
*/
function coercionKind(checker: ts.TypeChecker, type: ts.Type): 'number' | 'boolean' | undefined {
    const target = arrayElement(checker, unwrapOptional(type)) ?? type
    if (isKind(target, NUMBER_FLAGS)) {
        return 'number'
    }
    if (isKind(target, BOOLEAN_FLAGS)) {
        return 'boolean'
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
    return kept.length === 1 ? kept[0] : type
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
