import ts from 'typescript'
import { REACTIVE_CALLEES } from './REACTIVE_CALLEES.ts'

const factory = ts.factory

/* The reactive primitives that must be reached through a scope. A bare call to one of
   these is a compile error: a reactive primitive is owned by a scope and the surface must
   show it (`scope().state(...)`), so a reader always sees the scope interaction. `effect`
   is here too — a reaction is scope-owned (it tears down with the scope), so it joins the
   one surface; unlike the cells it stays a runtime call (`scope().effect(...)` passes
   through to the `effect` helper), not a doc slot. */
const SCOPE_PRIMITIVES: ReadonlySet<string> = new Set(['state', 'linked', 'computed', 'effect'])

/* The primitive names a top-level `const { state, computed } = scope()` destructure binds.
   Such a name is scope-bound — its bare call below is the destructured method, not a stray
   global — so it is exempt from the bare-primitive error. Only a destructure of a `scope()`
   call counts (receiver-agnostic on the callee name, matching signalCallee); an aliased
   binding (`{ state: s }`) is not recognised, so the canonical name must be kept. */
function scopeDestructuredPrimitives(source: ts.SourceFile): Set<string> {
    const bound = new Set<string>()
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) {
            continue
        }
        for (const declaration of statement.declarationList.declarations) {
            if (
                signalCallee(declaration) === 'scope' &&
                ts.isObjectBindingPattern(declaration.name)
            ) {
                for (const element of declaration.name.elements) {
                    if (
                        element.propertyName === undefined &&
                        ts.isIdentifier(element.name) &&
                        SCOPE_PRIMITIVES.has(element.name.text)
                    ) {
                        bound.add(element.name.text)
                    }
                }
            }
        }
    }
    return bound
}

/* Throws on a bare scope primitive (`state(0)` instead of `scope().state(0)`) or on the
   removed `prop(...)` reader — props are now read by destructuring `props()`. Walks all
   calls, so a stray one nested in a function is caught too, not just top-level declarations.
   A primitive destructured from `scope()` at the top is scope-bound and exempt. */
function assertScopedPrimitives(source: ts.SourceFile): void {
    const scopeBound = scopeDestructuredPrimitives(source)
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            const name = node.expression.text
            if (SCOPE_PRIMITIVES.has(name) && !scopeBound.has(name)) {
                throw new Error(
                    `abide: bare \`${name}(...)\` is not allowed — a reactive primitive lives on a scope. Use \`scope().${name}(...)\` (or a captured handle: \`const s = scope(); s.${name}(...)\`).`,
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

  let count = scope().state(0)
  let items = scope().state([])
  const total = scope().computed(() => count() + items.length)

This walks the already-parsed script once to collect the binding names, then returns
a `ts.TransformerFactory` that rewrites the declarations onto a shared `model`
document: each plain `state(initial)` becomes an initialising assignment (`model.x =
initial`, in source order so a later state can read an earlier one), each `computed`
and destructured prop becomes a `scope().derive` slot, and `linked` /
`state(initial, transform)` stay `.value` cells routed onto the scope. Returning a
TRANSFORMER (not rebuilt source text) lets the caller (`lowerScript`) chain it with
reference renaming and doc-access lowering over ONE parsed tree — no print-then-reparse
between passes. Plain `state` becomes `model.x` access that `lowerDocAccess` lowers to
patches/reads. No reactive declarations → an identity transformer (the explicit
`const model = doc(...)` form still works).
*/
export function desugarSignals(source: ts.SourceFile): {
    transformer: ts.TransformerFactory<ts.SourceFile>
    stateNames: Set<string>
    derivedNames: Set<string>
    computedNames: Set<string>
} {
    assertScopedPrimitives(source)
    const stateNames = new Set<string>()
    const derivedNames = new Set<string>()
    const computedNames = new Set<string>()
    /* A `props()` destructure must be lowered even when it declares no reactive binding
       (a rest-only `const { ...rest } = props()`), so track its presence on its own. */
    let hasPropsDestructure = false
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) {
            continue
        }
        for (const declaration of statement.declarationList.declarations) {
            const callee = signalCallee(declaration)
            if (callee === 'props') {
                /* `const {…, ...rest} = props()` — each named binding is a read-only computed
                   over the parent thunk (read as `name()`); a `...rest` binding stays a plain
                   const (a `restProps` bag), so it joins no reactive set. */
                if (!ts.isObjectBindingPattern(declaration.name)) {
                    throw new Error(
                        'abide: `props()` must be destructured — `const { a, b } = props()`',
                    )
                }
                hasPropsDestructure = true
                for (const binding of propsDestructure(declaration).bindings) {
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

    const hasReactive =
        stateNames.size > 0 ||
        derivedNames.size > 0 ||
        computedNames.size > 0 ||
        hasPropsDestructure

    const transformer: ts.TransformerFactory<ts.SourceFile> = () => (root) => {
        if (!hasReactive) {
            return root
        }
        const statements: ts.Statement[] = []
        /* A shared `model = scope()` host for the state slots, prepended once. */
        if (stateNames.size > 0) {
            statements.push(
                constDeclaration(
                    'model',
                    factory.createCallExpression(factory.createIdentifier('scope'), undefined, []),
                ),
            )
        }
        for (const statement of root.statements) {
            statements.push(...loweredStatement(statement))
        }
        return factory.updateSourceFile(root, statements)
    }

    return { transformer, stateNames, derivedNames, computedNames }
}

/* The lowered form of a top-level statement: state slots → `model.x = init`
   assignments, computed → `scope().derive` consts, props → derive consts (+ restProps),
   cells → `scope().<callee>(...)` consts; anything else passes through verbatim. The
   per-statement dispatch mirrors the name-collection pass. */
function loweredStatement(statement: ts.Statement): ts.Statement[] {
    return (
        stateAssignmentStatements(statement) ??
        computedStatements(statement) ??
        propsStatements(statement) ??
        cellStatements(statement) ?? [statement]
    )
}

/* `const NAME = <init>` — a fresh const declaration reusing the original initializer node. */
function constDeclaration(name: string, initializer: ts.Expression): ts.VariableStatement {
    return factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
            [factory.createVariableDeclaration(name, undefined, undefined, initializer)],
            ts.NodeFlags.Const,
        ),
    )
}

/* `scope().<method>(...args)` — the reactive method routed onto the ambient scope. */
function scopeMethodCall(method: string, args: readonly ts.Expression[]): ts.CallExpression {
    return factory.createCallExpression(
        factory.createPropertyAccessExpression(
            factory.createCallExpression(factory.createIdentifier('scope'), undefined, []),
            method,
        ),
        undefined,
        args,
    )
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
function cellStatements(statement: ts.Statement): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
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
        statements.push(constDeclaration(declaration.name.text, scopeMethodCall(callee, args)))
    }
    return statements
}

/* `let total = computed(compute)` → `const total = scope().derive("total", compute)`
   — a computed doc slot whose reader the references lower to `total()`. */
function computedStatements(statement: ts.Statement): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (
            !ts.isIdentifier(declaration.name) ||
            signalCallee(declaration) !== 'computed' ||
            !isComputedSlot(declaration)
        ) {
            return undefined
        }
        const name = declaration.name.text
        const compute =
            (declaration.initializer as ts.CallExpression).arguments[0] ??
            factory.createArrowFunction(
                undefined,
                undefined,
                [],
                undefined,
                factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                factory.createIdentifier('undefined'),
            )
        statements.push(
            constDeclaration(
                name,
                scopeMethodCall('derive', [factory.createStringLiteral(name), compute]),
            ),
        )
    }
    return statements
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

/* The destructure of a `const {…, ...rest} = props()` pattern — its named bindings
   plus an optional rest binding (the unconsumed props, gathered by `restProps`).
   Nested destructuring has no single prop key, so it throws a legible compile error. */
function propsDestructure(declaration: ts.VariableDeclaration): {
    bindings: PropsBinding[]
    rest: string | undefined
} {
    const pattern = declaration.name as ts.ObjectBindingPattern
    const bindings: PropsBinding[] = []
    let rest: string | undefined
    for (const element of pattern.elements) {
        if (element.dotDotDotToken !== undefined) {
            if (!ts.isIdentifier(element.name)) {
                throw new Error('abide: `...rest` in `props()` must bind a plain name')
            }
            rest = element.name.text
            continue
        }
        if (!ts.isIdentifier(element.name)) {
            throw new Error('abide: nested destructuring in `props()` is not supported')
        }
        bindings.push({
            local: element.name.text,
            key: propsBindingKey(element),
            initializer: element.initializer,
        })
    }
    return { bindings, rest }
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

/* If `statement` is a `const {…, ...rest} = props()` destructure, returns one reactive
   computed per named binding — `scope().derive("name", () => $props["key"]?.() ?? default)`,
   read as `name()` — plus a `const rest = restProps($props, [consumed])` for a rest
   binding; otherwise undefined. The `?? default` applies the binding's `= default`
   fallback when the prop is absent. */
function propsStatements(statement: ts.Statement): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (signalCallee(declaration) !== 'props' || !ts.isObjectBindingPattern(declaration.name)) {
            return undefined
        }
        const { bindings, rest } = propsDestructure(declaration)
        for (const { local, key, initializer } of bindings) {
            /* `$props["key"]?.()` — the parent thunk, optionally called. */
            const read = factory.createCallChain(
                factory.createElementAccessExpression(
                    factory.createIdentifier('$props'),
                    factory.createStringLiteral(key),
                ),
                factory.createToken(ts.SyntaxKind.QuestionDotToken),
                undefined,
                [],
            )
            /* `?? default` only when the binding declared a `= default` fallback. */
            const body =
                initializer === undefined
                    ? read
                    : factory.createBinaryExpression(
                          read,
                          factory.createToken(ts.SyntaxKind.QuestionQuestionToken),
                          factory.createParenthesizedExpression(initializer),
                      )
            const thunk = factory.createArrowFunction(
                undefined,
                undefined,
                [],
                undefined,
                factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                body,
            )
            statements.push(
                constDeclaration(
                    local,
                    scopeMethodCall('derive', [factory.createStringLiteral(local), thunk]),
                ),
            )
        }
        /* The rest bag gathers every prop not named above (and not `$children`). */
        if (rest !== undefined) {
            const consumed = bindings.map((binding) => factory.createStringLiteral(binding.key))
            statements.push(
                constDeclaration(
                    rest,
                    factory.createCallExpression(factory.createIdentifier('restProps'), undefined, [
                        factory.createIdentifier('$props'),
                        factory.createArrayLiteralExpression(consumed),
                    ]),
                ),
            )
        }
    }
    return statements
}

/* If `statement` declares `state(...)` bindings, returns `model.<name> = <init>`
   assignment statements (one per declaration); otherwise undefined. */
function stateAssignmentStatements(statement: ts.Statement): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !isPlainStateSlot(declaration)) {
            /* Only a plain `state(initial)` becomes a slot; `state(initial, transform)`
               (and everything else) is a `.value` cell — pass it through so the
               runtime call (and its transform) survives. */
            return undefined
        }
        const initial =
            (declaration.initializer as ts.CallExpression).arguments[0] ??
            factory.createIdentifier('undefined')
        statements.push(
            factory.createExpressionStatement(
                factory.createAssignment(
                    factory.createPropertyAccessExpression(
                        factory.createIdentifier('model'),
                        declaration.name.text,
                    ),
                    initial,
                ),
            ),
        )
    }
    return statements
}
