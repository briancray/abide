import ts from 'typescript'
import { COMPOUND_ASSIGNMENT_OPERATORS } from './COMPOUND_ASSIGNMENT_OPERATORS.ts'

/*
Rewrites references to a component's signal bindings into the document form the
rest of the pipeline understands: a `state` binding `count` becomes `$$model.count`
(data access `docAccessTransformer` then lowers to a patch/read), and a `computed`
binding `total` becomes `total.value`. Only value-position identifiers are
touched — declaration names, parameter names, and property names are collected
into a skip set first, and object shorthand (`{ count }`) is expanded to
`{ count: $$model.count }`. This is the bridge from the signal surface the author
writes to the patch substrate underneath.

The rewrite is lexically scope-aware: a reference whose name is re-bound by an
enclosing scope (a function/arrow parameter or a nested local declaration) refers
to that inner binding, not the component signal, so it is left untouched. Without
this, a callback like `list.map(option => option.toUpperCase())` in a component
that also has an `option` prop (`const { option } = props()`) would have its loop
variable rewritten to `option()` and blow up at runtime (`option is not a function`).

Exposed as a `ts.TransformerFactory`, so the script pipeline can chain it with
`docAccessTransformer` over a SINGLE parsed tree (see `lowerScript`) instead of
print-then-reparse between passes.
*/
/* `$$readCell(name)` — the unified cell read (peek async / `.value` sync). */
function cellReadCall(name: string): ts.Expression {
    return ts.factory.createCallExpression(ts.factory.createIdentifier('$$readCell'), undefined, [
        ts.factory.createIdentifier(name),
    ])
}

/* `$$writeCell(name, value)` — the unified cell write (`.value =` sync / `.set(...)` async). */
function writeCellCall(name: string, value: ts.Expression): ts.Expression {
    return ts.factory.createCallExpression(ts.factory.createIdentifier('$$writeCell'), undefined, [
        ts.factory.createIdentifier(name),
        value,
    ])
}

export function signalRefsTransformer(
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    computedNames: ReadonlySet<string> = new Set(),
    /* Block-local signal bindings (an `await` `then` / keyed `each` value param, a nested
       `<script>` declaration) — a nearer lexical scope than the component signals, so a
       name here shadows a same-named `state`/`computed`/`derived` and derefs as a cell. */
    blockLocal: ReadonlySet<string> = new Set(),
    /* Block-local PLAIN bindings — an SSR `await` `then` value bound as a real JS local
       holding the plain resolved value, not a reactive cell. Like `blockLocal` it shadows
       a same-named component signal (it is a nearer lexical scope), but it derefs as the
       bare identifier, not `.value`: SSR declares `const foo = <resolved>`, so a reference
       reads the local directly. Seeded into the root shadow set so it is left untouched. */
    blockLocalPlain: ReadonlySet<string> = new Set(),
    /* Component signals read through `$$readCell(name)` — every `linked` and every async
       `computed` (see `desugarSignals`). A nearer lexical binding of the same name shadows
       them like any other signal. */
    cellReadNames: ReadonlySet<string> = new Set(),
): ts.TransformerFactory<ts.SourceFile> {
    /* The signal names that a nested binding can shadow — only these matter for
       scope tracking, so we ignore every other local binding. */
    const signalNames = new Set<string>([
        ...stateNames,
        ...derivedNames,
        ...computedNames,
        ...cellReadNames,
        ...blockLocal,
        /* `scope` is the author-facing reactive entry (`scope().state(...)`), lowered to the
           reserved `$$scope` import so a user variable named `scope` can never collide — but
           shadowably: a `const scope`/param `scope` re-binds it for that subtree and is left
           untouched, exactly like a signal name. */
        'scope',
    ])
    return (context) => (root) => {
        /* The identifier nodes that are names, not value reads — collected by walking
           each parent and recording its name children (`parent.name`, a label, a
           specifier). Read structurally, NOT via `child.parent`, so it holds on
           synthesized nodes too — `desugar`'s rewritten declarations carry no parent
           pointers, and chaining this transformer after `desugarTransformer` over one
           tree must still classify their refs correctly. */
        const nameSlots = collectNameSlots(root)
        /* Each visitor carries the set of signal names shadowed by the scopes it sits
           inside; entering a scope that re-binds a signal name produces a fresh visitor
           with that name added, so shadowing is per-branch (a sibling scope is unaffected). */
        const makeVisitor = (shadowed: ReadonlySet<string>): ts.Visitor => {
            const visit = (node: ts.Node): ts.Node => {
                /* Type space never holds a value read. A type alias, an interface, or any
                   type annotation can name a signal — a prop-type member `option?: …`, a
                   `typeof x` — without it being a runtime reference. Leave the whole type
                   subtree untouched so it isn't rewritten into a call/access (`option()`)
                   and emitted as broken code (types erase at build anyway). */
                if (
                    ts.isTypeAliasDeclaration(node) ||
                    ts.isInterfaceDeclaration(node) ||
                    ts.isTypeNode(node)
                ) {
                    return node
                }
                /* Import/export specifiers are binding/module names, never value reads.
                   An aliased import whose original name collides with a signal
                   (`import { pending as p }` next to a `pending` prop) would otherwise
                   have its `pending` specifier rewritten to the reader form, corrupting
                   the declaration. Leave the whole subtree untouched. */
                if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
                    return node
                }
                /* An assignment to a `linked` cell (a `cellReadNames` name) — its read form
                   is `$$readCell(name)`, a call, so it can't sit on an assignment's left.
                   Lower the write to `$$writeCell(name, value)`, which dispatches `.value =`
                   (sync `State`) vs `.set(...)` (async `AsyncState`). A compound/logical
                   assignment folds the current value in through the read form. `state` and
                   `derived` writes stay on their own paths (`$$model.replace` / `.value =`). */
                if (
                    ts.isBinaryExpression(node) &&
                    ts.isIdentifier(node.left) &&
                    cellReadNames.has(node.left.text) &&
                    !shadowed.has(node.left.text)
                ) {
                    const target = node.left.text
                    const right = ts.visitNode(node.right, visit) as ts.Expression
                    if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
                        return writeCellCall(target, right)
                    }
                    const binary = COMPOUND_ASSIGNMENT_OPERATORS.get(node.operatorToken.kind)
                    if (binary !== undefined) {
                        return writeCellCall(
                            target,
                            ts.factory.createBinaryExpression(cellReadCall(target), binary, right),
                        )
                    }
                }
                /* `draft++` / `++draft` / `draft--` on a `linked` cell → a `$$writeCell` of the
                   stepped value, mirroring the `+= 1` shape (the bare `++` would otherwise land
                   on `$$readCell(draft)`, an invalid lvalue). */
                if (
                    (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
                    (node.operator === ts.SyntaxKind.PlusPlusToken ||
                        node.operator === ts.SyntaxKind.MinusMinusToken) &&
                    ts.isIdentifier(node.operand) &&
                    cellReadNames.has(node.operand.text) &&
                    !shadowed.has(node.operand.text)
                ) {
                    const step =
                        node.operator === ts.SyntaxKind.PlusPlusToken
                            ? ts.SyntaxKind.PlusToken
                            : ts.SyntaxKind.MinusToken
                    return writeCellCall(
                        node.operand.text,
                        ts.factory.createBinaryExpression(
                            cellReadCall(node.operand.text),
                            step,
                            ts.factory.createNumericLiteral(1),
                        ),
                    )
                }
                /* Shorthand `{ count }` → `{ count: $$model.count }` / `{ total: total.value }`,
                   unless a nearer scope shadows the name. */
                if (ts.isShorthandPropertyAssignment(node) && !shadowed.has(node.name.text)) {
                    const replacement = referenceFor(
                        node.name.text,
                        stateNames,
                        derivedNames,
                        computedNames,
                        blockLocal,
                        cellReadNames,
                    )
                    if (replacement !== undefined) {
                        return ts.factory.createPropertyAssignment(node.name.text, replacement)
                    }
                }
                if (ts.isIdentifier(node) && !nameSlots.has(node) && !shadowed.has(node.text)) {
                    const replacement = referenceFor(
                        node.text,
                        stateNames,
                        derivedNames,
                        computedNames,
                        blockLocal,
                        cellReadNames,
                    )
                    if (replacement !== undefined) {
                        return replacement
                    }
                }
                /* Recurse with the scope this node introduces folded in (same visitor when
                   it adds no shadowing name, so unscoped subtrees allocate nothing extra). */
                const inner = extendShadowed(node, shadowed, signalNames)
                return ts.visitEachChild(
                    node,
                    inner === shadowed ? visit : makeVisitor(inner),
                    context,
                )
            }
            return visit
        }
        return ts.visitNode(root, makeVisitor(new Set(blockLocalPlain))) as ts.SourceFile
    }
}

/*
Collects every identifier NODE that occupies a name/label/specifier slot — a position
that DECLARES, NAMES, or LABELS rather than READS. Walks each PARENT and records its
name children (`parent.name`, a label, a specifier), so it reads structure top-down
and never touches `child.parent` — it therefore holds on synthesized nodes (e.g.
`desugar`'s rewritten declarations), which carry no parent pointers. The visitor then
rewrites any identifier NOT in this set (rewrite is the default — value reads appear
under almost any expression parent and can't be allow-listed), so this set is the
exhaustive list of non-read slots. It is positional, so `pending` in
`import { pending as p }` and `pending` in `pending(query)` are told apart by where
they sit. A non-read slot missing here would be misread as a value read and rewritten
into broken syntax, so completeness is NOT self-evident — it is guarded empirically by
the syntax fuzz corpus (`uiCompileSyntaxFuzz.test.ts`), which transpiles each pass's
output and fails on any corruption.
*/
function collectNameSlots(root: ts.Node): Set<ts.Node> {
    const slots = new Set<ts.Node>()
    const add = (name: ts.Node | undefined): void => {
        if (name !== undefined && ts.isIdentifier(name)) {
            slots.add(name)
        }
    }
    const visit = (node: ts.Node): void => {
        /* `obj.NAME` — the member name; the object side (`.expression`) is the read. */
        if (ts.isPropertyAccessExpression(node)) {
            add(node.name)
        }
        /* `NAME: value`, and method/property/accessor/enum-member names in classes,
           object literals, and type members. */
        if (
            ts.isPropertyAssignment(node) ||
            ts.isMethodDeclaration(node) ||
            ts.isPropertyDeclaration(node) ||
            ts.isGetAccessorDeclaration(node) ||
            ts.isSetAccessorDeclaration(node) ||
            ts.isMethodSignature(node) ||
            ts.isPropertySignature(node) ||
            ts.isEnumMember(node)
        ) {
            add(node.name)
        }
        /* Declaration names: const/let/var, parameters, named functions and classes. */
        if (
            ts.isVariableDeclaration(node) ||
            ts.isParameter(node) ||
            ts.isFunctionDeclaration(node) ||
            ts.isFunctionExpression(node) ||
            ts.isClassDeclaration(node) ||
            ts.isClassExpression(node)
        ) {
            add(node.name)
        }
        /* A destructure element binds (`{ a }` / `[a]`) or renames (`{ a: b }`): both
           the bound name and the source key are names, not reads. */
        if (ts.isBindingElement(node)) {
            add(node.name)
            add(node.propertyName)
        }
        /* Labels: `NAME:` and `break NAME` / `continue NAME`. */
        if (ts.isLabeledStatement(node)) {
            add(node.label)
        }
        if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
            add(node.label)
        }
        /* Import/export specifier and clause names. */
        if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) {
            add(node.name)
            add(node.propertyName)
        }
        if (ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isNamespaceExport(node)) {
            add(node.name)
        }
        ts.forEachChild(node, visit)
    }
    visit(root)
    return slots
}

/* The shadowed-name set for `node`'s children: the parent set plus any signal name
   that `node` re-binds as a new scope. Returns the parent set unchanged (same
   reference) when `node` introduces no colliding binding, so the caller can skip
   allocating a new visitor. */
function extendShadowed(
    node: ts.Node,
    shadowed: ReadonlySet<string>,
    signalNames: ReadonlySet<string>,
): ReadonlySet<string> {
    const introduced = new Set<string>()
    collectScopeBindings(node, introduced)
    const added = [...introduced].filter((name) => signalNames.has(name) && !shadowed.has(name))
    if (added.length === 0) {
        return shadowed
    }
    return new Set<string>([...shadowed, ...added])
}

/* The names `node` binds when it opens a lexical scope — function/arrow parameters
   (and the function's own name), block-level `let`/`const`/`function`/`class`,
   `for`-header declarations, and the `catch` binding. Only names bound directly at
   this scope; deeper scopes are folded in as the walk descends into them. */
function collectScopeBindings(node: ts.Node, into: Set<string>): void {
    const parameters = functionParameters(node)
    if (parameters !== undefined) {
        for (const parameter of parameters) {
            collectBindingNames(parameter.name, into)
        }
        if (
            (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
            node.name !== undefined
        ) {
            into.add(node.name.text)
        }
        return
    }
    if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node)) {
        const statements = ts.isCaseBlock(node)
            ? node.clauses.flatMap((clause) => [...clause.statements])
            : node.statements
        for (const statement of statements) {
            collectStatementBindings(statement, into)
        }
        return
    }
    if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
        collectBindingNames(node.variableDeclaration.name, into)
        return
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
        const initializer = node.initializer
        if (initializer !== undefined && ts.isVariableDeclarationList(initializer)) {
            for (const declaration of initializer.declarations) {
                collectBindingNames(declaration.name, into)
            }
        }
    }
}

/* The names a single block-level statement binds: `var`/`let`/`const`, and named
   `function`/`class` declarations. */
function collectStatementBindings(statement: ts.Statement, into: Set<string>): void {
    if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
            collectBindingNames(declaration.name, into)
        }
    }
    if (
        (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
        statement.name !== undefined
    ) {
        into.add(statement.name.text)
    }
}

/* Every identifier bound by a binding name — a plain identifier or the leaves of a
   destructuring pattern (object/array, including rest elements). */
function collectBindingNames(name: ts.BindingName, into: Set<string>): void {
    if (ts.isIdentifier(name)) {
        into.add(name.text)
        return
    }
    for (const element of name.elements) {
        if (ts.isBindingElement(element)) {
            collectBindingNames(element.name, into)
        }
    }
}

/* The parameter list of a function-like node, or undefined if `node` is not one. */
function functionParameters(node: ts.Node): ts.NodeArray<ts.ParameterDeclaration> | undefined {
    if (
        ts.isArrowFunction(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)
    ) {
        return node.parameters
    }
    return undefined
}

/* `$$model.<name>` for a state binding, `<name>()` for a computed doc-slot (the
   string-free reader `scope().derive` returns), `<name>.value` for a runtime cell
   (linked / lens / transform-state), else undefined. A `blockLocal` binding shadows
   any same-named component signal — it is a nearer lexical scope — so it derefs as a
   cell (`<name>.value`) regardless of a colliding `state`/`computed`/`derived`.
   `children` is an ordinary destructured prop now — it rewrites via the `derivedNames`
   branch below like any other, with no special case. */
function referenceFor(
    name: string,
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    computedNames: ReadonlySet<string>,
    blockLocal: ReadonlySet<string> = new Set(),
    cellReadNames: ReadonlySet<string> = new Set(),
): ts.Expression | undefined {
    if (blockLocal.has(name)) {
        return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(name), 'value')
    }
    /* The author-facing reactive entry `scope` lowers to its reserved `$$scope` import (the
       value read only — a `.scope` member or a shadowing local is never reached here). */
    if (name === 'scope') {
        return ts.factory.createIdentifier('$$scope')
    }
    /* A `linked` / async `computed` cell → `$$readCell(name)`: one read shape that peeks an
       async cell and reads `.value` off a sync one. */
    if (cellReadNames.has(name)) {
        return ts.factory.createCallExpression(
            ts.factory.createIdentifier('$$readCell'),
            undefined,
            [ts.factory.createIdentifier(name)],
        )
    }
    if (stateNames.has(name)) {
        return ts.factory.createPropertyAccessExpression(
            ts.factory.createIdentifier('$$model'),
            name,
        )
    }
    if (computedNames.has(name)) {
        return ts.factory.createCallExpression(ts.factory.createIdentifier(name), undefined, [])
    }
    if (derivedNames.has(name)) {
        return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(name), 'value')
    }
    return undefined
}
