import ts from 'typescript'
import { REACTIVE_CALLEES } from './REACTIVE_CALLEES.ts'
import { renameSignalRefs } from './renameSignalRefs.ts'

/*
Desugars the signal surface into the document form. A component's `<script>`
declares reactive state as signals:

  let count = state(0)
  let items = state([])
  const total = derived(() => count + items.length)

This collects the binding names, turns each plain `state(initial)` declaration
into an initialising assignment on a shared `model` document (in source order, so
a later state can read an earlier one), keeps the rest, then renames every
reference through `renameSignalRefs`. Plain `state` becomes `model.x` access that
`lowerDocAccess` lowers to patches/reads — the document substrate's deep,
fine-grained, serializable reactivity for free. `linked`, `derived`, and
`state(initial, transform)` stay verbatim as runtime `.value` cells (referenced
as `name.value`): they own no doc slot, so they reseed/recompute on resume rather
than serialize. No reactive declarations → the script is returned untouched (the
explicit `const model = doc(...)` form still works).
*/
export function desugarSignals(scriptBody: string): {
    code: string
    stateNames: Set<string>
    derivedNames: Set<string>
} {
    const source = ts.createSourceFile('script.ts', scriptBody, ts.ScriptTarget.Latest, true)
    const stateNames = new Set<string>()
    const derivedNames = new Set<string>()
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) {
            continue
        }
        for (const declaration of statement.declarationList.declarations) {
            const callee = signalCallee(declaration)
            if (!ts.isIdentifier(declaration.name)) {
                continue
            }
            if (isPlainStateSlot(declaration)) {
                /* Plain `state(initial)` → a serializable `model` doc slot. */
                stateNames.add(declaration.name.text)
            } else if (callee !== undefined && REACTIVE_CALLEES.has(callee)) {
                /* `.value` cells, referenced as `name.value`: `linked`, `derived`, a
                   `prop` (reads like a read-only derived), and `state(initial, transform)`
                   (the transform must run on writes, so it can't be a bare doc slot). */
                derivedNames.add(declaration.name.text)
            }
        }
    }
    if (stateNames.size === 0 && derivedNames.size === 0) {
        return { code: scriptBody, stateNames, derivedNames }
    }

    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    const lines: string[] = []
    if (stateNames.size > 0) {
        lines.push('const model = doc({})')
    }
    for (const statement of source.statements) {
        const stateAssignments = stateDeclarationAssignments(statement, printer, source)
        const propDeclarations = propDeclarationLines(statement, printer, source)
        if (stateAssignments !== undefined) {
            lines.push(...stateAssignments)
        } else if (propDeclarations !== undefined) {
            lines.push(...propDeclarations)
        } else {
            lines.push(printer.printNode(ts.EmitHint.Unspecified, statement, source))
        }
    }
    return {
        code: renameSignalRefs(lines.join('\n'), stateNames, derivedNames),
        stateNames,
        derivedNames,
    }
}

/* True for `state(initial, transform)` — the write-coercion transform forces a
   `.value` cell (writes run it) rather than a bare, serializable doc slot. */
function hasTransform(declaration: ts.VariableDeclaration): boolean {
    const initializer = declaration.initializer
    return (
        initializer !== undefined &&
        ts.isCallExpression(initializer) &&
        initializer.arguments.length >= 2
    )
}

/* A plain `state(initial)` with no transform → a serializable `model` doc slot;
   every other reactive declaration is a `.value` cell. The one rule shared by the
   name-collection pass and the slot lowering. */
function isPlainStateSlot(declaration: ts.VariableDeclaration): boolean {
    return signalCallee(declaration) === 'state' && !hasTransform(declaration)
}

/* The callee name of a `NAME = state(...)` / `derived(...)` declaration, else undefined. */
function signalCallee(declaration: ts.VariableDeclaration): string | undefined {
    const initializer = declaration.initializer
    if (
        initializer !== undefined &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression)
    ) {
        return initializer.expression.text
    }
    return undefined
}

/* If `statement` declares `prop(...)` bindings, returns a reactive derived over
   the parent-supplied `$props` thunk for each; otherwise undefined. The optional
   call (`?.()`) tolerates an omitted prop. */
function propDeclarationLines(
    statement: ts.Statement,
    printer: ts.Printer,
    source: ts.SourceFile,
): string[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const lines: string[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (signalCallee(declaration) !== 'prop' || !ts.isIdentifier(declaration.name)) {
            return undefined
        }
        const key = (declaration.initializer as ts.CallExpression).arguments[0]
        const keyText =
            key === undefined ? "''" : printer.printNode(ts.EmitHint.Unspecified, key, source)
        lines.push(`const ${declaration.name.text} = derived(() => $props[${keyText}]?.())`)
    }
    return lines
}

/* If `statement` declares `state(...)` bindings, returns `model.<name> = <init>`
   assignment lines (one per declaration); otherwise undefined. */
function stateDeclarationAssignments(
    statement: ts.Statement,
    printer: ts.Printer,
    source: ts.SourceFile,
): string[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const assignments: string[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !isPlainStateSlot(declaration)) {
            /* Only a plain `state(initial)` becomes a slot; `state(initial, transform)`
               (and everything else) is a `.value` cell — print it verbatim so the
               runtime call (and its transform) survives. */
            return undefined
        }
        const initial = (declaration.initializer as ts.CallExpression).arguments[0]
        const initialText =
            initial === undefined
                ? 'undefined'
                : printer.printNode(ts.EmitHint.Unspecified, initial, source)
        assignments.push(`model.${declaration.name.text} = ${initialText}`)
    }
    return assignments
}
