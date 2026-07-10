import ts from 'typescript'
import type { TemplateNode } from './types/TemplateNode.ts'

/* One hoistable await: the node whose promise-start moves to the SSR prefix, and the
   `$flightN` const name that holds the in-flight promise. */
export type HoistedFlight = {
    node: Extract<TemplateNode, { kind: 'await' }>
    name: string
}

/*
ADR-0034 — the SSR-only pass that picks which `await` blocks may start their promise in the
synchronous render prefix so independent flights overlap instead of serializing. An await is
HOISTABLE iff its promise is evaluable at prefix time and its content is unconditionally rendered:

  1. Its promise's referenced identifiers avoid every enclosing TEMPLATE-LOCAL binder (a `{#for}`
     item/index, a `{:then}`/`{:catch}`/`then v` value, a snippet param, a nested `<script>`
     local) — those don't exist in the prefix — AND every ASYNC-CELL name (`cellReadNames`, still
     pending at prefix time).
  2. It is not inside a CONDITIONALLY-rendered branch (`{#if}`/`{#switch}`/`{#try}`, a snippet/slot
     body, or another await's pending/then/catch branch) — starting its flight eagerly would fetch
     for a branch that may never render, or surface an error prematurely.
  3. It is STATICALLY-SINGLE: on the top-level spine, or inside a single-element-literal
     `{#for k of [expr] by k}` whose body renders exactly once (so one hoisted flight == one row).

Fail-closed: identifiers are over-collected and any doubt blocks the hoist, so a mis-classified
row-local flight can never collapse a multi-row `{#for}` to one shared value. Server-only — the
returned nodes are rewired only in `generateSSR`; the client build and the wire are untouched.
*/
export function hoistableAwaits(
    nodes: TemplateNode[],
    cellReadNames: ReadonlySet<string>,
): HoistedFlight[] {
    const flights: HoistedFlight[] = []
    const counter = { next: 0 }
    walkList(nodes, new Set<string>(), false, false, cellReadNames, flights, counter)
    return flights
}

/* Walk a sibling list left-to-right so a nested `<script>`'s declared locals extend the binder
   set for the siblings that follow it (they are in that script's lexical scope). */
function walkList(
    list: TemplateNode[],
    binders: ReadonlySet<string>,
    conditional: boolean,
    multiRow: boolean,
    cellReadNames: ReadonlySet<string>,
    flights: HoistedFlight[],
    counter: { next: number },
): void {
    /* A running binder set for this list: a `<script>` sibling adds its top-level declarations,
       so a later sibling's await that reads one is (conservatively) not hoistable. */
    let listBinders = binders
    for (const node of list) {
        if (node.kind === 'script') {
            listBinders = union(listBinders, declaredNames(node.code))
            continue
        }
        walkNode(node, listBinders, conditional, multiRow, cellReadNames, flights, counter)
    }
}

function walkNode(
    node: TemplateNode,
    binders: ReadonlySet<string>,
    conditional: boolean,
    multiRow: boolean,
    cellReadNames: ReadonlySet<string>,
    flights: HoistedFlight[],
    counter: { next: number },
): void {
    if (node.kind === 'await') {
        /* Hoistability is judged in the INCOMING context — the block's promise starts when the
           block mounts (its pending branch always renders), so it is not gated by its own
           branches, only by an enclosing conditional/multi-row. */
        if (
            !conditional &&
            !multiRow &&
            promiseIsPrefixEvaluable(node.promise, binders, cellReadNames)
        ) {
            flights.push({ node, name: `$flight${counter.next++}` })
        }
        /* The resolved/catch/pending branches are conditionally shown and bind the resolved value
           (`node.as` for `{#await p then v}`; a `{:then v}`/`{:catch e}` branch binds via its own
           `as`, added when that branch node is walked). */
        const inner = node.as === undefined ? binders : union(binders, new Set([node.as]))
        walkList(node.children, inner, true, multiRow, cellReadNames, flights, counter)
        return
    }
    if (node.kind === 'each') {
        /* Row/index bindings are template-local; the body is multi-row unless the source is a
           single-element array literal (then it renders exactly once). `{#for await}` drains a
           stream — its body is still per-frame, so treat it as multi-row. */
        const rowBinders = new Set<string>()
        rowBinders.add(node.as)
        if (node.index !== undefined) {
            rowBinders.add(node.index)
        }
        const rowMulti = multiRow || node.async === true || !isSingleElementLiteral(node.items)
        walkList(
            node.children,
            union(binders, rowBinders),
            conditional,
            rowMulti,
            cellReadNames,
            flights,
            counter,
        )
        return
    }
    if (
        node.kind === 'if' ||
        node.kind === 'switch' ||
        node.kind === 'case' ||
        node.kind === 'try'
    ) {
        /* Conditionally-rendered subtrees — never hoist a flight out of them. */
        walkList(node.children, binders, true, multiRow, cellReadNames, flights, counter)
        return
    }
    if (node.kind === 'branch') {
        const inner = node.as === undefined ? binders : union(binders, new Set([node.as]))
        walkList(node.children, inner, true, multiRow, cellReadNames, flights, counter)
        return
    }
    if (node.kind === 'snippet') {
        /* A snippet is a builder called conditionally; its params are locals. */
        const params =
            node.params === undefined
                ? new Set<string>()
                : declaredNames(`const [${node.params}] = []`)
        walkList(
            node.children,
            union(binders, params),
            true,
            multiRow,
            cellReadNames,
            flights,
            counter,
        )
        return
    }
    if (node.kind === 'component') {
        /* Slot content is a fresh, lazily-built scope rendered at the child's `<slot>`. */
        walkList(node.children, binders, true, multiRow, cellReadNames, flights, counter)
        return
    }
    if (node.kind === 'element' && 'children' in node) {
        walkList(node.children, binders, conditional, multiRow, cellReadNames, flights, counter)
    }
}

/* True when EVERY referenced identifier of `promise` is prefix-evaluable: none is a template-local
   binder and none is an async-cell name. Over-collects identifiers, so any doubt fails closed. */
function promiseIsPrefixEvaluable(
    promise: string,
    binders: ReadonlySet<string>,
    cellReadNames: ReadonlySet<string>,
): boolean {
    for (const name of referencedIdentifiers(promise)) {
        if (binders.has(name) || cellReadNames.has(name)) {
            return false
        }
    }
    return true
}

/* Every identifier read as a value in `code` — excludes property member names (`.name`) and object
   literal keys, which are not free variable references. Deliberately generous elsewhere: an inner
   arrow's param is still collected, so a promise shadowing a binder name inside a callback is judged
   NOT hoistable rather than risk a false hoist. */
function referencedIdentifiers(code: string): Set<string> {
    const names = new Set<string>()
    let source: ts.SourceFile
    try {
        source = ts.createSourceFile('promise.ts', code, ts.ScriptTarget.Latest, true)
    } catch {
        /* Unparseable expression → treat as non-hoistable by returning a sentinel the caller's
           binder check can never clear; simplest is a name no scope defines. */
        return new Set(['\0unparseable'])
    }
    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node)) {
            visit(node.expression)
            return
        }
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
            visit(node.initializer)
            return
        }
        if (ts.isIdentifier(node)) {
            names.add(node.text)
            return
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    return names
}

/* Top-level declared names of a code block — a nested `<script>`'s locals, or a snippet's params
   parsed as a destructuring pattern. Best-effort; on a parse miss returns empty (fail-open on the
   binder side is safe here because a script's names only ADD conservatism when present). */
function declaredNames(code: string): Set<string> {
    const names = new Set<string>()
    let source: ts.SourceFile
    try {
        source = ts.createSourceFile('script.ts', code, ts.ScriptTarget.Latest, true)
    } catch {
        return names
    }
    const collectBinding = (name: ts.BindingName): void => {
        if (ts.isIdentifier(name)) {
            names.add(name.text)
            return
        }
        for (const element of name.elements) {
            if (ts.isBindingElement(element)) {
                collectBinding(element.name)
            }
        }
    }
    for (const statement of source.statements) {
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                collectBinding(declaration.name)
            }
        } else if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
            names.add(statement.name.text)
        }
    }
    return names
}

/* A single-element array literal like `[remountKey]` — the only `{#for}` source that renders its
   body exactly once, so a hoisted flight inside it maps to one row (no shared-flight hazard). */
function isSingleElementLiteral(items: string): boolean {
    let source: ts.SourceFile
    try {
        source = ts.createSourceFile('items.ts', items, ts.ScriptTarget.Latest, true)
    } catch {
        return false
    }
    const statement = source.statements[0]
    if (
        statement === undefined ||
        source.statements.length !== 1 ||
        !ts.isExpressionStatement(statement) ||
        !ts.isArrayLiteralExpression(statement.expression)
    ) {
        return false
    }
    const elements = statement.expression.elements
    return elements.length === 1 && !ts.isSpreadElement(elements[0] as ts.Expression)
}

function union(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
    const result = new Set(a)
    for (const value of b) {
        result.add(value)
    }
    return result
}
