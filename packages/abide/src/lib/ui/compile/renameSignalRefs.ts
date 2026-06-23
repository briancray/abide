import ts from 'typescript'

/*
Rewrites references to a component's signal bindings into the document form the
rest of the pipeline understands: a `state` binding `count` becomes `model.count`
(data access `lowerDocAccess` then lowers to a patch/read), and a `computed`
binding `total` becomes `total.value`. Only value-position identifiers are
touched — declaration names, parameter names, and property names are collected
into a skip set first, and object shorthand (`{ count }`) is expanded to
`{ count: model.count }`. This is the bridge from the signal surface the author
writes to the patch substrate underneath.

The rewrite is lexically scope-aware: a reference whose name is re-bound by an
enclosing scope (a function/arrow parameter or a nested local declaration) refers
to that inner binding, not the component signal, so it is left untouched. Without
this, a callback like `list.map(option => option.toUpperCase())` in a component
that also has an `option` prop (`const { option } = props()`) would have its loop
variable rewritten to `option()` and blow up at runtime (`option is not a function`).
*/
export function renameSignalRefs(
    code: string,
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    computedNames: ReadonlySet<string> = new Set(),
): string {
    const source = ts.createSourceFile('component.ts', code, ts.ScriptTarget.Latest, true)

    /* The signal names that a nested binding can shadow — only these matter for
       scope tracking, so we ignore every other local binding. */
    const signalNames = new Set<string>([...stateNames, ...derivedNames, ...computedNames])

    const result = ts.transform(source, [
        (context) => (root) => {
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
                    /* Shorthand `{ count }` → `{ count: model.count }` / `{ total: total.value }`,
                       unless a nearer scope shadows the name. */
                    if (ts.isShorthandPropertyAssignment(node) && !shadowed.has(node.name.text)) {
                        const replacement = referenceFor(
                            node.name.text,
                            stateNames,
                            derivedNames,
                            computedNames,
                        )
                        if (replacement !== undefined) {
                            return ts.factory.createPropertyAssignment(node.name.text, replacement)
                        }
                    }
                    if (ts.isIdentifier(node) && !isNameSlot(node) && !shadowed.has(node.text)) {
                        const replacement = referenceFor(
                            node.text,
                            stateNames,
                            derivedNames,
                            computedNames,
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
            return ts.visitNode(root, makeVisitor(new Set())) as ts.SourceFile
        },
    ])
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    const output = printer.printFile(result.transformed[0] as ts.SourceFile)
    result.dispose()
    return output
}

/*
True when `id` occupies a name/label/specifier slot of its parent — a position that
DECLARES, NAMES, or LABELS rather than READS. These are the only identifier positions
that are not value reads (type space and import/export subtrees are skipped wholesale
in the visitor above), so a name-slot identifier is left untouched and everything else
is a value read that rewrites.

Classifying by the identifier's slot in its parent — checked at visit time against the
live tree — rather than by a pre-collected node set is what makes a forgotten position
fail safe: an unrecognised parent kind falls through to `false`, so the identifier is
left exactly as written, never rewritten into broken syntax. The syntax fuzz corpus
guards the completeness of this list.
*/
function isNameSlot(id: ts.Identifier): boolean {
    const parent = id.parent
    if (parent === undefined) {
        return false
    }
    /* `obj.NAME` — the member name; the object side (`parent.expression`) is the read. */
    if (ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) {
        return parent.name === id
    }
    /* `NAME: value`, and method/property/accessor/enum-member names in classes,
       object literals, and type members. */
    if (
        ts.isPropertyAssignment(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isGetAccessorDeclaration(parent) ||
        ts.isSetAccessorDeclaration(parent) ||
        ts.isMethodSignature(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isEnumMember(parent)
    ) {
        return parent.name === id
    }
    /* Declaration names: const/let/var, parameters, named functions and classes. */
    if (
        ts.isVariableDeclaration(parent) ||
        ts.isParameter(parent) ||
        ts.isFunctionDeclaration(parent) ||
        ts.isFunctionExpression(parent) ||
        ts.isClassDeclaration(parent) ||
        ts.isClassExpression(parent)
    ) {
        return parent.name === id
    }
    /* A destructure element binds (`{ a }` / `[a]`) or renames (`{ a: b }`): both the
       bound name and the source key are names, not reads. */
    if (ts.isBindingElement(parent)) {
        return parent.name === id || parent.propertyName === id
    }
    /* Labels: `NAME:` and `break NAME` / `continue NAME`. */
    if (
        ts.isLabeledStatement(parent) ||
        ts.isBreakStatement(parent) ||
        ts.isContinueStatement(parent)
    ) {
        return parent.label === id
    }
    /* Import/export specifier and clause names (the surrounding declaration subtree is
       also skipped wholesale upstream, but a stray specifier here is a name too). */
    if (
        ts.isImportSpecifier(parent) ||
        ts.isExportSpecifier(parent) ||
        ts.isImportClause(parent) ||
        ts.isNamespaceImport(parent) ||
        ts.isNamespaceExport(parent)
    ) {
        return true
    }
    return false
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

/* `model.<name>` for a state binding, `<name>()` for a computed doc-slot (the
   string-free reader `scope().derive` returns), `<name>.value` for a runtime cell
   (linked / lens / transform-state), else undefined. */
function referenceFor(
    name: string,
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    computedNames: ReadonlySet<string>,
): ts.Expression | undefined {
    if (stateNames.has(name)) {
        return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('model'), name)
    }
    if (computedNames.has(name)) {
        return ts.factory.createCallExpression(ts.factory.createIdentifier(name), undefined, [])
    }
    if (derivedNames.has(name)) {
        return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(name), 'value')
    }
    return undefined
}
