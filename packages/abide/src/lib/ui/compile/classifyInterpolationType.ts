import type ts from 'typescript'
import type { InterpolationKind } from './types/InterpolationKind.ts'

/*
Whether a type carries the well-known `Symbol.asyncIterator` member. That member's
property is mangled to the escaped name `__@asyncIterator@<id>`, so an exact-name
`getPropertyOfType(t, '__@asyncIterator')` misses it and `ts.getPropertyNameFor
KnownSymbolName` isn't exported — a prefix scan over the type's properties is the
only reliable check (validated against the installed TS).
*/
function hasAsyncIterator(type: ts.Type, checker: ts.TypeChecker): boolean {
    for (const property of checker.getPropertiesOfType(type)) {
        if ((property.escapedName as string).startsWith('__@asyncIterator')) {
            return true
        }
    }
    return false
}

/*
Classifies a template interpolation's checker type into how it binds at runtime.
Strips nullability and splits a union, then for each constituent tests async
iterables FIRST (an async generator is also thenable-adjacent, so order matters),
then a thenable (a callable `then` member), falling back to `sync`.
*/
export function classifyInterpolationType(
    type: ts.Type,
    at: ts.Node,
    checker: ts.TypeChecker,
): InterpolationKind {
    const nonNullable = type.getNonNullableType()
    const constituents = nonNullable.isUnion() ? nonNullable.types : [nonNullable]
    for (const constituent of constituents) {
        if (hasAsyncIterator(constituent, checker)) {
            return 'asyncIterable'
        }
        const then = checker.getPropertyOfType(constituent, 'then')
        if (
            then !== undefined &&
            checker.getTypeOfSymbolAtLocation(then, at).getCallSignatures().length > 0
        ) {
            return 'promise'
        }
    }
    return 'sync'
}
