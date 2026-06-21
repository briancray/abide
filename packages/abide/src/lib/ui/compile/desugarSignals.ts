import ts from 'typescript'
import { REACTIVE_CALLEES } from './REACTIVE_CALLEES.ts'
import { renameSignalRefs } from './renameSignalRefs.ts'

/* The reactive primitives that must be reached through a scope. A bare call to one of
   these is a compile error: reactive state is owned by a scope and the surface must show
   it (`scope().state(...)`), so a reader always sees the scope interaction. */
const SCOPE_PRIMITIVES: ReadonlySet<string> = new Set(['state', 'linked', 'computed'])

/* Throws on a bare scope primitive (`state(0)` instead of `scope().state(0)`) or on the
   removed `prop(...)` reader — props are now read by destructuring `props()`. Walks all
   calls, so a stray one nested in a function is caught too, not just top-level declarations. */
function assertScopedPrimitives(source: ts.SourceFile): void {
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            const name = node.expression.text
            if (SCOPE_PRIMITIVES.has(name)) {
                throw new Error(
                    `abide: bare \`${name}(...)\` is not allowed — reactive state lives on a scope. Use \`scope().${name}(...)\` (or a captured handle: \`const s = scope(); s.${name}(...)\`).`,
                )
            }
            if (name === 'prop') {
                throw new Error(
                    'abide: `prop(...)` has been removed — read props by destructuring `props()`, e.g. `const { name } = props()` (with a default: `const { name = fallback } = props()`).',
                )
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
}

/*
Desugars the signal surface into the document form. A component's `<script>`
declares reactive state as signals:

  let count = state(0)
  let items = state([])
  const total = computed(() => count + items.length)

This collects the binding names, turns each plain `state(initial)` declaration
into an initialising assignment on a shared `model` document (in source order, so
a later state can read an earlier one), keeps the rest, then renames every
reference through `renameSignalRefs`. Plain `state` becomes `model.x` access that
`lowerDocAccess` lowers to patches/reads — the document substrate's deep,
fine-grained, serializable reactivity for free. `linked`, `computed`, and
`state(initial, transform)` stay verbatim as runtime `.value` cells (referenced
as `name.value`): they own no doc slot, so they reseed/recompute on resume rather
than serialize. No reactive declarations → the script is returned untouched (the
explicit `const model = doc(...)` form still works).
*/
export function desugarSignals(scriptBody: string): {
    code: string
    stateNames: Set<string>
    derivedNames: Set<string>
    computedNames: Set<string>
} {
    const source = ts.createSourceFile('script.ts', scriptBody, ts.ScriptTarget.Latest, true)
    assertScopedPrimitives(source)
    const stateNames = new Set<string>()
    const derivedNames = new Set<string>()
    const computedNames = new Set<string>()
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) {
            continue
        }
        for (const declaration of statement.declarationList.declarations) {
            const callee = signalCallee(declaration)
            if (callee === 'props') {
                /* `const {…} = props()` — each destructured binding is a read-only
                   computed over the parent thunk, read as `name()`. */
                if (!ts.isObjectBindingPattern(declaration.name)) {
                    throw new Error(
                        'abide: `props()` must be destructured — `const { a, b } = props()`',
                    )
                }
                for (const binding of propsBindings(declaration)) {
                    computedNames.add(binding.local)
                }
                continue
            }
            if (!ts.isIdentifier(declaration.name)) {
                continue
            }
            if (isPlainStateSlot(declaration)) {
                /* Plain `state(initial)` → a serializable `model` doc slot. */
                stateNames.add(declaration.name.text)
            } else if (isComputedSlot(declaration)) {
                /* Read-only `computed(compute)` → a computed `scope().derive` doc slot,
                   referenced as `name()` (its string-free reader): a function of other
                   paths, recomputed via the graph, never stored/serialized. */
                computedNames.add(declaration.name.text)
            } else if (callee !== undefined && REACTIVE_CALLEES.has(callee)) {
                /* `.value` cells: `linked` and `state(initial, transform)` — they own
                   a local store, so they stay cells (`computed` is always the read-only
                   slot above; there is no writable-computed cell). */
                derivedNames.add(declaration.name.text)
            }
        }
    }
    if (stateNames.size === 0 && derivedNames.size === 0 && computedNames.size === 0) {
        return { code: scriptBody, stateNames, derivedNames, computedNames }
    }

    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    const lines: string[] = []
    if (stateNames.size > 0) {
        lines.push('const model = scope()')
    }
    for (const statement of source.statements) {
        const stateAssignments = stateDeclarationAssignments(statement, printer, source)
        const computedDeclarations = computedDeclarationLines(statement, printer, source)
        const propsDestructure = propsDestructureLines(statement, printer, source)
        const cellDeclarations = cellDeclarationLines(statement, printer, source)
        if (stateAssignments !== undefined) {
            lines.push(...stateAssignments)
        } else if (computedDeclarations !== undefined) {
            lines.push(...computedDeclarations)
        } else if (propsDestructure !== undefined) {
            lines.push(...propsDestructure)
        } else if (cellDeclarations !== undefined) {
            lines.push(...cellDeclarations)
        } else {
            lines.push(printer.printNode(ts.EmitHint.Unspecified, statement, source))
        }
    }
    return {
        code: renameSignalRefs(lines.join('\n'), stateNames, derivedNames, computedNames),
        stateNames,
        derivedNames,
        computedNames,
    }
}

/* True for a read-only computed slot — `computed(compute)` with no write-through
   `set`. The writable `computed(compute, set)` lens keeps a `.value` cell (handled by
   the caller). */
function isComputedSlot(declaration: ts.VariableDeclaration): boolean {
    const initializer = declaration.initializer
    return (
        signalCallee(declaration) === 'computed' &&
        initializer !== undefined &&
        ts.isCallExpression(initializer) &&
        initializer.arguments.length === 1
    )
}

/* A `.value`-cell signal declaration — a `linked` or a `state(initial, transform)` —
   routed onto the scope: `linked(seed)` → `const x = scope().linked(seed)`. The cell
   stays a standalone non-serializing cell (its refs stay `name.value`); the rewrite only
   removes the bare runtime import so the sole reactive surface is `scope()`. */
function cellDeclarationLines(
    statement: ts.Statement,
    printer: ts.Printer,
    source: ts.SourceFile,
): string[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const lines: string[] = []
    for (const declaration of statement.declarationList.declarations) {
        const callee = signalCallee(declaration)
        if (
            !ts.isIdentifier(declaration.name) ||
            (callee !== 'linked' && callee !== 'state') ||
            isPlainStateSlot(declaration)
        ) {
            return undefined
        }
        const args = (declaration.initializer as ts.CallExpression).arguments
            .map((argument) => printer.printNode(ts.EmitHint.Unspecified, argument, source))
            .join(', ')
        lines.push(`const ${declaration.name.text} = scope().${callee}(${args})`)
    }
    return lines
}

/* `let total = computed(compute)` → `const total = scope().derive("total", compute)`
   — a computed doc slot whose reader the references lower to `total()`. */
function computedDeclarationLines(
    statement: ts.Statement,
    printer: ts.Printer,
    source: ts.SourceFile,
): string[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const lines: string[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (
            !ts.isIdentifier(declaration.name) ||
            signalCallee(declaration) !== 'computed' ||
            !isComputedSlot(declaration)
        ) {
            return undefined
        }
        const compute = (declaration.initializer as ts.CallExpression).arguments[0]
        const computeText =
            compute === undefined
                ? '() => undefined'
                : printer.printNode(ts.EmitHint.Unspecified, compute, source)
        lines.push(
            `const ${declaration.name.text} = scope().derive(${JSON.stringify(declaration.name.text)}, ${computeText})`,
        )
    }
    return lines
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

/* The callee name of a reactive declaration, else undefined. Recognises both the bare
   form (`NAME = state(...)`) and the explicit scope form (`NAME = scope().state(...)` or
   `NAME = c.state(...)` for any scope handle `c`) — receiver-agnostic: the METHOD name is
   what marks the binding reactive. Since `scope()` is the ambient scope (one object per
   level), the receiver is irrelevant to lowering — the slot keys off the binding name and
   lands on the same `model`, so the explicit form lowers exactly like the bare one. */
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

/* One destructured prop: the local binding name, the parent prop key it reads, and
   the optional `= default` expression (the fallback when the prop is absent). */
type PropsBinding = { local: string; key: string; initializer: ts.Expression | undefined }

/* The bindings of a `const {…} = props()` pattern. Rest (`...rest`) and nested
   destructuring have no single prop key, so they throw a legible compile error. */
function propsBindings(declaration: ts.VariableDeclaration): PropsBinding[] {
    const pattern = declaration.name as ts.ObjectBindingPattern
    return pattern.elements.map((element) => {
        if (element.dotDotDotToken !== undefined) {
            throw new Error('abide: `...rest` in `props()` destructuring is not supported')
        }
        if (!ts.isIdentifier(element.name)) {
            throw new Error('abide: nested destructuring in `props()` is not supported')
        }
        return {
            local: element.name.text,
            key: propsBindingKey(element),
            initializer: element.initializer,
        }
    })
}

/* The parent prop key a binding element reads — its rename source (`name: alias` →
   `name`) or, absent a rename, the local name itself. */
function propsBindingKey(element: ts.BindingElement): string {
    const propertyName = element.propertyName
    if (propertyName === undefined) {
        return (element.name as ts.Identifier).text
    }
    if (
        ts.isIdentifier(propertyName) ||
        ts.isStringLiteralLike(propertyName) ||
        ts.isNumericLiteral(propertyName)
    ) {
        return propertyName.text
    }
    throw new Error('abide: computed prop keys in `props()` destructuring are not supported')
}

/* If `statement` is a `const {…} = props()` destructure, returns one reactive
   computed per binding — `scope().derive("name", () => $props["key"]?.() ?? default)`
   — read as `name()`; otherwise undefined. The `?? default` applies the binding's
   `= default` fallback when the prop is absent. */
function propsDestructureLines(
    statement: ts.Statement,
    printer: ts.Printer,
    source: ts.SourceFile,
): string[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const lines: string[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (signalCallee(declaration) !== 'props' || !ts.isObjectBindingPattern(declaration.name)) {
            return undefined
        }
        for (const { local, key, initializer } of propsBindings(declaration)) {
            const fallback =
                initializer === undefined
                    ? ''
                    : ` ?? (${printer.printNode(ts.EmitHint.Unspecified, initializer, source)})`
            lines.push(
                `const ${local} = scope().derive(${JSON.stringify(local)}, () => $props[${JSON.stringify(key)}]?.()${fallback})`,
            )
        }
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
