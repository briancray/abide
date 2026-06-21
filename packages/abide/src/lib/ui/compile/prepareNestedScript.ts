import ts from 'typescript'
import { REACTIVE_CALLEES } from './REACTIVE_CALLEES.ts'

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
            const callee = signalCallee(declaration)
            if (
                callee !== undefined &&
                REACTIVE_CALLEES.has(callee) &&
                ts.isIdentifier(declaration.name)
            ) {
                names.add(declaration.name.text)
            }
        }
    }
    return names
}

/* The callee name of a `NAME = state(...)` / `computed(...)` / `linked(...)` declaration —
   bare or the explicit scope form (`scope().state(...)` / `c.state(...)`), receiver-agnostic. */
function signalCallee(declaration: ts.VariableDeclaration): string | undefined {
    const initializer = declaration.initializer
    if (initializer === undefined || !ts.isCallExpression(initializer)) {
        return undefined
    }
    const callee = initializer.expression
    if (ts.isIdentifier(callee)) {
        return callee.text
    }
    if (ts.isPropertyAccessExpression(callee)) {
        return callee.name.text
    }
    return undefined
}
