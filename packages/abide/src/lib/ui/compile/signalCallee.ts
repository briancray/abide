import ts from 'typescript'
import {
    type ReactiveImportBindings,
    type ReactivePrimitive,
    resolveReactiveExport,
} from './resolveReactiveExport.ts'

/*
The canonical reactive primitive a `NAME = state(...)` declaration's callee resolves to,
else undefined. Import-resolution is the SOLE recognition path (alias-safe: an
`import { state as s }` still resolves `s(...)` to `state`); the legacy member forms are
not recognised. Shared by the desugar, shadow type-check, and nested-script passes so all
three agree on what is reactive — a divergence here silently mis-classifies a declaration.
*/
export function signalCallee(
    declaration: ts.VariableDeclaration,
    bindings: ReactiveImportBindings,
): ReactivePrimitive | undefined {
    const initializer = declaration.initializer
    if (initializer === undefined || !ts.isCallExpression(initializer)) {
        return undefined
    }
    return resolveReactiveExport(initializer.expression, bindings)
}
