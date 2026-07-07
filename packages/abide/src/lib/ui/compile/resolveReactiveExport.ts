import ts from 'typescript'
import { ABIDE_PACKAGE_NAME } from '../../shared/ABIDE_PACKAGE_NAME.ts'

/* The reactive primitive an import binding resolves to — the single recognition
   vocabulary the desugarer, the nested-script scoper, and the shadow consume.
   `linked`/`computed` are reached as members of a `state` import (`state.linked`),
   so they are resolution results but carry no import specifier of their own. */
export type ReactivePrimitive = 'state' | 'linked' | 'computed' | 'effect' | 'watch' | 'props'

/* The `abide/ui/*` specifier each importable reactive primitive is published at,
   mapped to its canonical name. Built from the package name so a rename is one edit.
   `linked`/`computed` are members of `state`, not standalone imports. */
const REACTIVE_SPECIFIERS: Record<string, ReactivePrimitive> = {
    [`${ABIDE_PACKAGE_NAME}/ui/state`]: 'state',
    [`${ABIDE_PACKAGE_NAME}/ui/effect`]: 'effect',
    [`${ABIDE_PACKAGE_NAME}/ui/watch`]: 'watch',
    [`${ABIDE_PACKAGE_NAME}/ui/props`]: 'props',
}

/* The reactive import bindings a source file declares: each local binding (alias-safe)
   mapped to its canonical primitive, plus the set of locals bound to `state` (so a
   `state.linked` / `state.computed` member call resolves off the right root). Scans the
   file's `import` statements once — no checker, no `ts.Program`: recognition is purely
   syntactic, correct because abide has no barrels (a primitive is imported directly from
   its `abide/ui/*` module, never a re-export). */
export type ReactiveImportBindings = {
    direct: Map<string, ReactivePrimitive>
    stateRoots: Set<string>
}

/* The reactive bindings a nested `<template>` <script> resolves against. A nested script
   cannot carry its own import (imports are module-scoped, hoisted off the leading script or
   absent entirely), so it inherits the surface by the canonical names — the one recognition
   site that is name-based because imports structurally cannot reach it. */
export const NESTED_REACTIVE_BINDINGS: ReactiveImportBindings = {
    direct: new Map<string, ReactivePrimitive>([
        ['state', 'state'],
        ['effect', 'effect'],
        ['watch', 'watch'],
        ['props', 'props'],
    ]),
    stateRoots: new Set(['state']),
}

export function reactiveImportBindings(source: ts.SourceFile): ReactiveImportBindings {
    const direct = new Map<string, ReactivePrimitive>()
    const stateRoots = new Set<string>()
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue
        }
        const canonical = REACTIVE_SPECIFIERS[statement.moduleSpecifier.text]
        const named = statement.importClause?.namedBindings
        if (canonical === undefined || named === undefined || !ts.isNamedImports(named)) {
            continue
        }
        for (const element of named.elements) {
            /* The imported name (`propertyName` when aliased, else `name`) must be the
               module's canonical export; `name` is the local binding codegen resolves. */
            if ((element.propertyName ?? element.name).text !== canonical) {
                continue
            }
            direct.set(element.name.text, canonical)
            if (canonical === 'state') {
                stateRoots.add(element.name.text)
            }
        }
    }
    return { direct, stateRoots }
}

/* The reactive primitive a call's callee resolves to, or undefined. Every bare identifier
   resolves through the direct import bindings (alias-safe); a `stateRoot.linked` /
   `.computed` member call resolves off a local bound to `state`. Every other callee is
   undefined (a user's own function, an unrelated member access). */
export function resolveReactiveExport(
    callee: ts.Expression,
    bindings: ReactiveImportBindings,
): ReactivePrimitive | undefined {
    if (ts.isIdentifier(callee)) {
        return bindings.direct.get(callee.text)
    }
    if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        bindings.stateRoots.has(callee.expression.text) &&
        (callee.name.text === 'linked' || callee.name.text === 'computed')
    ) {
        return callee.name.text
    }
    return undefined
}
