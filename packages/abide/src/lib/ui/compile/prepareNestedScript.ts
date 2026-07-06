import ts from 'typescript'
import { NESTED_REACTIVE_BINDINGS } from './resolveReactiveExport.ts'
import { signalCallee } from './signalCallee.ts'

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
            /* `effect`/`watch` bind no readable value (they return a disposer, not a cell), so
               they never join the deref scope; every other recognised primitive
               (state/linked/computed/props) does. */
            if (
                callee !== undefined &&
                callee !== 'effect' &&
                callee !== 'watch' &&
                ts.isIdentifier(declaration.name)
            ) {
                names.add(declaration.name.text)
            }
        }
    }
    return names
}

/* The PLAIN (non-reactive) local names a nested branch `<script>` declares at its top
   level — a `const title = deriveLocal()` that is neither a signal nor an effect/watch.
   These must shadow a same-named component signal so a later reference in the script or
   branch reads the nearer local, not `$$model.read("title")`; registered as `plain`
   shadows (bare locals), the counterpart to `nestedBindingNames`' `derived` cells. */
export function nestedPlainLocalNames(code: string): Set<string> {
    const source = ts.createSourceFile('nested.ts', code, ts.ScriptTarget.Latest, true)
    const names = new Set<string>()
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) {
            continue
        }
        for (const declaration of statement.declarationList.declarations) {
            /* Reactive declarations are the `derived` cells `nestedBindingNames` owns; a
               plain identifier declaration with a non-reactive callee (or no call) is a
               local. Skip destructuring patterns — the reactive path does too. */
            const callee = signalCallee(declaration, NESTED_REACTIVE_BINDINGS)
            const isReactive = callee !== undefined && callee !== 'effect' && callee !== 'watch'
            if (!isReactive && ts.isIdentifier(declaration.name)) {
                names.add(declaration.name.text)
            }
        }
    }
    return names
}
