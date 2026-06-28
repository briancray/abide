import ts from 'typescript'
import { UI_RUNTIME_IMPORTS } from './UI_RUNTIME_IMPORTS.ts'

/*
Independent backstop on the per-component dead-import filter (`compileModule`). The filter
decides which runtime helpers to import by reading the generated output's identifiers; if it
ever undercounts — as a raw token scan once did, mis-reading the tail of a module after a
`${…}` template substitution — a helper gets CALLED but never imported, and the bundle throws
`ReferenceError` the instant `build()` runs. The router escalates that into a reload loop, so
the failure is both opaque and unrecoverable.

This re-derives the same question a DIFFERENT way (so it can't share the filter's blind spot):
walk the final module's AST, find every call whose callee is a bare runtime-helper identifier,
and require that name to be imported or locally bound. A helper name inside a string / template /
comment is not a `CallExpression` callee, so a docs component quoting framework code
(`mount(...)` in a snippet) never false-positives. Compile-time only; never on the hot path.
*/
export function assertRuntimeHelpersBound(module: string, context: string): void {
    /* The EMITTED local names (the `$$` alias when set) — codegen calls those, and the
       aliased import binds them, so the bound/called check must use the same form. */
    const helperNames = new Set(UI_RUNTIME_IMPORTS.map((entry) => entry.alias ?? entry.name))
    const source = ts.createSourceFile(
        'module.ts',
        module,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
    )
    /* Names a bare call can resolve to: every import binding plus every declared name.
       Collected generously (any identifier in a binding position) — over-approximating the
       bound set only risks missing a defect, never raising a false alarm on valid output. */
    const bound = new Set<string>()
    const calledHelpers: { name: string; position: number }[] = []
    const visit = (node: ts.Node): void => {
        if (
            (ts.isVariableDeclaration(node) ||
                ts.isFunctionDeclaration(node) ||
                ts.isParameter(node) ||
                ts.isBindingElement(node) ||
                ts.isImportSpecifier(node) ||
                ts.isImportClause(node) ||
                ts.isNamespaceImport(node)) &&
            node.name !== undefined &&
            ts.isIdentifier(node.name)
        ) {
            bound.add(node.name.text)
        }
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            helperNames.has(node.expression.text)
        ) {
            calledHelpers.push({
                name: node.expression.text,
                position: node.expression.getStart(source),
            })
        }
        node.forEachChild(visit)
    }
    visit(source)

    const unbound = calledHelpers.find((call) => !bound.has(call.name))
    if (unbound !== undefined) {
        const { line, character } = source.getLineAndCharacterOfPosition(unbound.position)
        throw new Error(
            `[abide] ${context} calls runtime helper \`${unbound.name}\` at line ${line + 1}:${character + 1} but never imports it — the dead-import filter dropped it. Please report this with the component source.\nOutput:\n${module}`,
        )
    }
}
