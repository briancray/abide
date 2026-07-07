import ts from 'typescript'
import { type ReactiveImportBindings, reactiveImportBindings } from './resolveReactiveExport.ts'
import { signalCallee } from './signalCallee.ts'

const factory = ts.factory

/* Throws on the removed `prop(...)` reader — props are now read by destructuring `props()`.
   Walks all calls, so a stray one nested in a function is caught too. Bare reactive
   primitives (`state(0)`) are the SURFACE now (recognised by import binding + lowered), so
   they no longer throw — only the withdrawn `prop` reader does. */
function assertNoRemovedReaders(source: ts.SourceFile): void {
    const visit = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'prop'
        ) {
            throw new Error(
                'abide: `prop(...)` has been removed — read props by destructuring `props()`, e.g. `const { name } = props()` (with a default: `const { name = fallback } = props()`).',
            )
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
    assertNoRemovedReaders(source)
    /* The file's reactive import bindings — each local (alias-safe) mapped to its
       canonical primitive. The single recognition authority: every callee below resolves
       against these import bindings and nothing else. */
    const bindings = reactiveImportBindings(source)
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
            const callee = signalCallee(declaration, bindings)
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
            if (isPlainStateSlot(declaration, bindings)) {
                /* Plain `state(initial)` → a serializable `model` doc slot. */
                stateNames.add(declaration.name.text)
            } else if (isComputedSlot(declaration, bindings)) {
                /* Read-only `computed(compute)` → a computed `scope().derive` doc slot,
                   referenced as `name()` (its string-free reader): a function of other
                   paths, recomputed via the graph, never stored/serialized. */
                computedNames.add(declaration.name.text)
            } else if (callee === 'linked' || callee === 'state') {
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
        /* A shared `$$model = scope()` host for the state slots, prepended once. The doc
           base is `$$`-reserved so a user variable named `model` can never collide. */
        if (stateNames.size > 0) {
            statements.push(
                constDeclaration(
                    '$$model',
                    factory.createCallExpression(factory.createIdentifier('scope'), undefined, []),
                ),
            )
        }
        for (const statement of root.statements) {
            statements.push(...loweredStatement(statement, bindings))
        }
        return factory.updateSourceFile(root, statements)
    }

    return { transformer, stateNames, derivedNames, computedNames }
}

/* The lowered form of a top-level statement: state slots → `model.x = init`
   assignments, computed → `scope().derive` consts, props → derive consts (+ restProps),
   cells → `scope().<callee>(...)` consts; anything else passes through verbatim. The
   per-statement dispatch mirrors the name-collection pass. */
function loweredStatement(
    statement: ts.Statement,
    bindings: ReactiveImportBindings,
): ts.Statement[] {
    rejectMixedDeclaration(statement, bindings)
    return (
        stateAssignmentStatements(statement, bindings) ??
        computedStatements(statement, bindings) ??
        propsStatements(statement, bindings) ??
        cellStatements(statement, bindings) ?? [statement]
    )
}

/* Each lowering function above is all-or-nothing per VariableStatement: it returns
   undefined the moment one declaration doesn't match its kind, so the whole statement
   passes through verbatim. A statement mixing a reactive declaration with a differently-
   lowered one (`let count = state(0), step = 5`) therefore ships literal — but the
   collection pass already registered `count`, so references lower to `$$model.read("count")`
   with no `$$model.count = 0` seed (silent undefined). Reject it with a legible error so
   the author splits the declarations; a checker-free compiler must fail loud, not
   mis-lower silently. Same-kind lists (`let a = state(0), b = state(1)`) are fine. */
function rejectMixedDeclaration(statement: ts.Statement, bindings: ReactiveImportBindings): void {
    if (!ts.isVariableStatement(statement)) {
        return
    }
    const kinds = new Set(
        statement.declarationList.declarations.map((declaration) =>
            loweringKind(declaration, bindings),
        ),
    )
    /* Any two distinct kinds break: each lowering function bails on the non-matching
       declaration, so the statement ships verbatim. A uniform list (size 1) is fine. */
    if (kinds.size > 1) {
        throw new Error(
            'abide: declare each reactive signal in its own statement — a `let`/`const` that mixes a reactive declaration (state/linked/computed/props) with another kind cannot be lowered as one statement.',
        )
    }
}

/* The lowering bucket a single declaration falls into — mirrors the name-collection
   dispatch so `rejectMixedDeclaration` can detect a statement spanning more than one. */
function loweringKind(
    declaration: ts.VariableDeclaration,
    bindings: ReactiveImportBindings,
): 'state' | 'computed' | 'props' | 'cell' | 'plain' {
    const callee = signalCallee(declaration, bindings)
    if (callee === 'props') {
        return 'props'
    }
    if (isPlainStateSlot(declaration, bindings)) {
        return 'state'
    }
    if (isComputedSlot(declaration, bindings)) {
        return 'computed'
    }
    if (callee === 'linked' || callee === 'state') {
        return 'cell'
    }
    return 'plain'
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
function isComputedSlot(
    declaration: ts.VariableDeclaration,
    bindings: ReactiveImportBindings,
): boolean {
    const initializer = declaration.initializer
    return (
        signalCallee(declaration, bindings) === 'computed' &&
        initializer !== undefined &&
        ts.isCallExpression(initializer) &&
        initializer.arguments.length === 1
    )
}

/* A `.value`-cell signal declaration — a `linked` or a `state(initial, transform)` —
   routed onto the scope: `linked(seed)` → `const x = scope().linked(seed)`. The cell
   stays a standalone non-serializing cell (its refs stay `name.value`); the rewrite only
   removes the bare runtime import so the sole reactive surface is `scope()`. */
function cellStatements(
    statement: ts.Statement,
    bindings: ReactiveImportBindings,
): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
    for (const declaration of statement.declarationList.declarations) {
        const callee = signalCallee(declaration, bindings)
        if (
            !ts.isIdentifier(declaration.name) ||
            (callee !== 'linked' && callee !== 'state') ||
            isPlainStateSlot(declaration, bindings)
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
function computedStatements(
    statement: ts.Statement,
    bindings: ReactiveImportBindings,
): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (
            !ts.isIdentifier(declaration.name) ||
            signalCallee(declaration, bindings) !== 'computed' ||
            !isComputedSlot(declaration, bindings)
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
function isPlainStateSlot(
    declaration: ts.VariableDeclaration,
    bindings: ReactiveImportBindings,
): boolean {
    return signalCallee(declaration, bindings) === 'state' && !hasTransform(declaration)
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
function propsStatements(
    statement: ts.Statement,
    bindings: ReactiveImportBindings,
): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (
            signalCallee(declaration, bindings) !== 'props' ||
            !ts.isObjectBindingPattern(declaration.name)
        ) {
            return undefined
        }
        const { bindings: propBindings, rest } = propsDestructure(declaration)
        for (const { local, key, initializer } of propBindings) {
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
        /* The rest bag gathers every prop not named above (and not `children`). */
        if (rest !== undefined) {
            const consumed = propBindings.map((binding) => factory.createStringLiteral(binding.key))
            statements.push(
                constDeclaration(
                    rest,
                    factory.createCallExpression(
                        factory.createIdentifier('$$restProps'),
                        undefined,
                        [
                            factory.createIdentifier('$props'),
                            factory.createArrayLiteralExpression(consumed),
                        ],
                    ),
                ),
            )
        }
    }
    return statements
}

/* If `statement` declares `state(...)` bindings, returns `model.<name> = <init>`
   assignment statements (one per declaration); otherwise undefined. */
function stateAssignmentStatements(
    statement: ts.Statement,
    bindings: ReactiveImportBindings,
): ts.Statement[] | undefined {
    if (!ts.isVariableStatement(statement)) {
        return undefined
    }
    const statements: ts.Statement[] = []
    for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !isPlainStateSlot(declaration, bindings)) {
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
                        factory.createIdentifier('$$model'),
                        declaration.name.text,
                    ),
                    initial,
                ),
            ),
        )
    }
    return statements
}
