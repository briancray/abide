import ts from 'typescript'
import {
    NESTED_REACTIVE_BINDINGS,
    type ReactiveImportBindings,
    type ReactivePrimitive,
    resolveReactiveExport,
} from './resolveReactiveExport.ts'

/*
The signal binding names a `<script>` nested in a control-flow branch declares
(`state`/`linked`/`computed`). The back-end adds them to the deref scope so both the
script body and the branch's markup rewrite `{a}` → `a.value` — these stay PLAIN
signals (local to the branch's render, owned by its scope, re-seeded from the
in-scope data each mount), unlike the top-level component script which desugars to
the serializable `doc`.
*/
export function nestedBindingNames(code: string): Set<string> {
    const source = ts.createSourceFile('nested.ts', code, ts.ScriptTarget.Latest, true)
    const names = new Set<string>()
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) {
            continue
        }
        for (const declaration of statement.declarationList.declarations) {
            const callee = signalCallee(declaration, NESTED_REACTIVE_BINDINGS)
            /* `effect` binds no readable value (returns void), so it never joins the deref
               scope; every other recognised primitive (state/linked/computed/props) does. */
            if (callee !== undefined && callee !== 'effect' && ts.isIdentifier(declaration.name)) {
                names.add(declaration.name.text)
            }
        }
    }
    return names
}

/* The canonical primitive a `NAME = state(...)` / `state.linked(...)` declaration resolves
   to — import-resolution is the sole recognition path (alias-safe). The legacy
   `scope().state(...)` / captured-handle member form is no longer recognised. */
function signalCallee(
    declaration: ts.VariableDeclaration,
    bindings: ReactiveImportBindings,
): ReactivePrimitive | undefined {
    const initializer = declaration.initializer
    if (initializer === undefined || !ts.isCallExpression(initializer)) {
        return undefined
    }
    return resolveReactiveExport(initializer.expression, bindings)
}
