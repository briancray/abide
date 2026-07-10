import ts from 'typescript'
import { classifyInterpolationType } from './classifyInterpolationType.ts'

/* The two TypeScript diagnostics a bare async read (ADR-0032) raises spuriously in a template.
   2339 — a property "missing" on the un-awaited `Promise`/`AsyncIterable`; 2801 — a condition the
   raw promise makes "always defined". Both are correct against the raw type but wrong against the
   runtime PEEK (the resolved value, `undefined` while pending), which the shadow can't see. */
const PROPERTY_DOES_NOT_EXIST = 2339
const CONDITION_ALWAYS_DEFINED = 2801

/*
Whether a shadow diagnostic is one the ADR-0032 bare-async-read peek makes spurious. The runtime
lifts a promise/iterable sub-expression to a cell that reads the RESOLVED value (`undefined` while
pending), so `getFoo()?.name` composes on the resolved object and `{#if getFoo()}` holds while
pending — but the type-check shadow checks the RAW expression, where the property sits on the
un-awaited `Promise` and the promise reads as always-truthy. This recognises those two cases so the
caller can drop them:

  - 2339 (missing property): an OPTIONAL access (`?.`) on a promise/iterable-typed base whose
    property EXISTS on the awaited (promise) or frame (iterable) type — the peek's real member.
  - 2801 (always-defined condition): the flagged subject itself classifies as a promise/iterable —
    the peek is genuinely nullable (pending → `undefined`), so it is not always-defined.

Deliberately narrow so it never hides a real mistake: only these two codes; 2339 only via `?.`
(a bare `.name` on a promise stays an error, nudging toward the `?.` the peek needs) and only when
the property resolves on the awaited/frame type (a typo `?.namex` stays); 2801 only when the
subject is actually async (a bare `{#if someFn}` — a forgotten call — stays). Callers additionally
gate on the diagnostic mapping into the template region, so `<script>` code (where a forgotten
`await` must surface) is never touched.
*/
export function isSpuriousAsyncReadDiagnostic(
    shadowFile: ts.SourceFile,
    checker: ts.TypeChecker,
    code: number,
    start: number,
    length: number,
): boolean {
    if (code === PROPERTY_DOES_NOT_EXIST) {
        return isResolvedOptionalAsyncAccess(shadowFile, checker, start, length)
    }
    if (code === CONDITION_ALWAYS_DEFINED) {
        return isAsyncSubject(shadowFile, checker, start, length)
    }
    return false
}

/* A 2339 on the member of an optional (`?.`) access whose base is a promise/iterable and whose
   accessed property exists on the resolved value — the ADR-0032 peek, not an error. */
function isResolvedOptionalAsyncAccess(
    shadowFile: ts.SourceFile,
    checker: ts.TypeChecker,
    start: number,
    length: number,
): boolean {
    const access = enclosingOptionalAccess(deepestNodeAt(shadowFile, start, length))
    if (access === undefined) {
        return false
    }
    const resolved = resolvedAsyncType(access.expression, checker)
    if (resolved === undefined) {
        return false
    }
    const property = accessedPropertyName(access)
    return property !== undefined && checker.getPropertyOfType(resolved, property) !== undefined
}

/* A 2801 whose flagged subject classifies as a promise/iterable — the peek reads `undefined` while
   pending, so it is genuinely nullable, not always-defined. */
function isAsyncSubject(
    shadowFile: ts.SourceFile,
    checker: ts.TypeChecker,
    start: number,
    length: number,
): boolean {
    const node = deepestNodeAt(shadowFile, start, length)
    const kind = classifyInterpolationType(checker.getTypeAtLocation(node), node, checker)
    return kind === 'promise' || kind === 'asyncIterable'
}

/* The resolved value an async base peeks: a promise's awaited type, an iterable's frame type,
   `undefined` when the base isn't actually async. */
function resolvedAsyncType(base: ts.Node, checker: ts.TypeChecker): ts.Type | undefined {
    const baseType = checker.getTypeAtLocation(base)
    const kind = classifyInterpolationType(baseType, base, checker)
    if (kind === 'promise') {
        return checker.getAwaitedType(baseType)
    }
    if (kind === 'asyncIterable') {
        return asyncFrameType(baseType, base, checker)
    }
    return undefined
}

/* The deepest AST node whose range contains the diagnostic span. */
function deepestNodeAt(sourceFile: ts.SourceFile, start: number, length: number): ts.Node {
    let best: ts.Node = sourceFile
    const end = start + length
    const visit = (node: ts.Node): void => {
        if (node.getStart(sourceFile) <= start && node.getEnd() >= end) {
            best = node
            node.forEachChild(visit)
        }
    }
    visit(sourceFile)
    return best
}

/* The optional (`?.`) property/element access that OWNS `node` as its accessed member — walking
   up from the name identifier. `undefined` when `node` isn't the member of an optional access
   (a bare `.name`, or the base rather than the member). */
function enclosingOptionalAccess(
    node: ts.Node,
): ts.PropertyAccessExpression | ts.ElementAccessExpression | undefined {
    const parent = node.parent
    if (parent === undefined) {
        return undefined
    }
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        return parent.questionDotToken === undefined ? undefined : parent
    }
    if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) {
        return parent.questionDotToken === undefined ? undefined : parent
    }
    return undefined
}

/* The property name an access reads — the identifier for `a?.b`, the string literal for
   `a?.['b']`. A computed non-literal element access has no static name. */
function accessedPropertyName(
    access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
    if (ts.isPropertyAccessExpression(access)) {
        return access.name.text
    }
    return ts.isStringLiteralLike(access.argumentExpression)
        ? access.argumentExpression.text
        : undefined
}

/* The frame type of an `AsyncIterable<T>` — `T`, which is what the runtime peek reads (the latest
   frame). The named async-iterable types (`AsyncIterable`/`AsyncGenerator`/`AsyncIterableIterator`)
   all carry `T` as their first type argument, so read it directly; a structurally-typed iterable
   with no type arguments falls back to resolving `[Symbol.asyncIterator]().next()`'s yielded value.
   `location` is any node in the program, needed to resolve the iterator symbol's type. `undefined`
   when neither yields a frame, so the caller keeps the diagnostic. */
function asyncFrameType(
    type: ts.Type,
    location: ts.Node,
    checker: ts.TypeChecker,
): ts.Type | undefined {
    const directArgument = checker.getTypeArguments(type as ts.TypeReference)[0]
    if (directArgument !== undefined) {
        return directArgument
    }
    /* The `Symbol.asyncIterator` member mangles to `__@asyncIterator@<id>`, so match by prefix. */
    const iterator = checker
        .getPropertiesOfType(type)
        .find((property) => (property.escapedName as string).startsWith('__@asyncIterator'))
    if (iterator === undefined) {
        return undefined
    }
    const factory = checker.getTypeOfSymbolAtLocation(iterator, location).getCallSignatures()[0]
    const next = factory && checker.getPropertyOfType(factory.getReturnType(), 'next')
    const nextSignature =
        next && checker.getTypeOfSymbolAtLocation(next, location).getCallSignatures()[0]
    if (!nextSignature) {
        return undefined
    }
    /* `next()` resolves to `IteratorResult<T, TReturn>`, whose first type argument is the yielded
       `T` (its `value` PROPERTY widens to `T | TReturn` across the done/not-done union, so read the
       argument, not the property). */
    const result = checker.getAwaitedType(nextSignature.getReturnType())
    return result && checker.getTypeArguments(result as ts.TypeReference)[0]
}
