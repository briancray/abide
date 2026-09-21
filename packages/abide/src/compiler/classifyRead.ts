import { type Node, SyntaxKind } from 'typescript/unstable/ast'
import {
    isBinaryExpression,
    isCallExpression,
    isElementAccessExpression,
    isExpressionStatement,
    isForStatement,
    isPostfixUnaryExpression,
    isPrefixUnaryExpression,
    isPropertyAccessExpression,
    isShorthandPropertyAssignment,
} from 'typescript/unstable/ast/is'
import type { Span } from './projectShadow.ts'
import { REACTIVE_MEMBERS } from './REACTIVE_MEMBERS.ts'

// ONE OCCURRENCE OF A NAME BOUND TO A `Reactive`, and what it lowers as. The ROLE is read off the
// checker's own syntax tree, so what a write's right-hand side is, where a statement ends and
// whether `{ n }` is a literal are TypeScript's answers rather than a token walk's guess at them.
// Every offset is into the file's projection (`projectShadow`).
//
// THE SHAPE IS FIXED: every field on every read, so `Lowering`'s splice sees one hidden class.
export type Read = {
    // The name's own span.
    start: number
    end: number
    // `value` lowers to `n()`; `asWritten` stays as written (`n.set(v)`, 31.5); `call` is the
    // explicit `n()` (31.7), which `arguments` says was given any; `shorthand` is `{ n }`;
    // `write` and `update` are 31.4, and 31.11 where `path` is not empty.
    // 33's three: the `props<Props>()` call, which lowers to the record the caller passed, and the
    // pair that brackets a binding element's initializer, which together make a default an
    // accessor. The pair are INSERTIONS — zero-width, so what stands between them goes on being
    // lowered by the same walk, and a default reading a `Reactive` still reads it.
    shape:
        | 'value'
        | 'asWritten'
        | 'call'
        | 'shorthand'
        | 'write'
        | 'update'
        | 'props'
        | 'defaultOpen'
        | 'defaultClose'
    // What the rewrite replaces: the name, or a whole write or update from its first token.
    from: number
    to: number
    // A write's operator without its `=` (`''` for `=` itself); an update's `+` or `-`.
    operator: string
    prefix: boolean
    // An update whose value nothing reads — the statement form, and a `for`'s incrementor.
    discarded: boolean
    arguments: number
    // 31.11 — the member path between the name and the write: a property's name, or the span of a
    // computed segment, which may itself hold reads.
    path: { name: string | undefined; start: number; end: number }[]
    value: Span | undefined
}

// ONE OCCURRENCE OF A NAME THE `props` PATTERN BOUND (33.4, 33.9). Every one of them is a read of
// that key's accessor, which is where this parts company with `classifyRead`: `onsave()` is the
// prop's own value being CALLED and lowers to `onsave()()`, where the same spelling on a
// `Reactive` is 31.7's explicit read; and `amount.set` is the value's member, there being no
// `Reactive` face on a plain prop at all (33.6).
export function classifyPropRead(node: Node): Read | undefined {
    const parent = node.parent
    switch (parent.kind) {
        case SyntaxKind.BindingElement:
            // The binding itself, and the key it renames from — neither is a read.
            if ((parent as { name?: Node }).name === node) return undefined
            if ((parent as { propertyName?: Node }).propertyName === node)
                return undefined
            break
        case SyntaxKind.ImportSpecifier:
        case SyntaxKind.ImportClause:
        case SyntaxKind.NamespaceImport:
        case SyntaxKind.ExportSpecifier:
        case SyntaxKind.TypeQuery:
            return undefined
    }
    // 33.5, 33.6 — A PROP IS A LIVE READ AND HAS NO WRITE. `const` already refuses this in the
    // checker; a `let` pattern does not, and lowering it as a read would emit `amount() = 5` —
    // a module that does not parse, reported against the emitter rather than against the page.
    if (
        (isBinaryExpression(parent) &&
            parent.left === node &&
            parent.operatorToken.kind >= SyntaxKind.FirstAssignment &&
            parent.operatorToken.kind <= SyntaxKind.LastAssignment) ||
        ((isPrefixUnaryExpression(parent) ||
            isPostfixUnaryExpression(parent)) &&
            (parent.operator === SyntaxKind.PlusPlusToken ||
                parent.operator === SyntaxKind.MinusMinusToken))
    )
        throw new Error(
            `abide: ${(node as { text?: string }).text ?? ''} is a prop, which is a live read of the caller's expression and has no write. RULEBOOK 33.5, 33.6.`,
        )
    const start = node.getStart()
    const read: Read = {
        start,
        end: node.end,
        shape: isShorthandPropertyAssignment(parent) ? 'shorthand' : 'value',
        from: start,
        to: node.end,
        operator: '',
        prefix: false,
        discarded: false,
        arguments: 0,
        path: [],
        value: undefined,
    }
    return read
}

// `undefined` for an occurrence that is not a read at all: the declaration itself, an import or
// export specifier, and a `typeof n` in a type.
export function classifyRead(node: Node): Read | undefined {
    const parent = node.parent
    switch (parent.kind) {
        case SyntaxKind.VariableDeclaration:
            if ((parent as { name?: Node }).name === node) return undefined
            break
        case SyntaxKind.ImportSpecifier:
        case SyntaxKind.ImportClause:
        case SyntaxKind.NamespaceImport:
        case SyntaxKind.ExportSpecifier:
        case SyntaxKind.TypeQuery:
            return undefined
    }
    const start = node.getStart()
    const read: Read = {
        start,
        end: node.end,
        shape: 'value',
        from: start,
        to: node.end,
        operator: '',
        prefix: false,
        discarded: false,
        arguments: 0,
        path: [],
        value: undefined,
    }

    if (isCallExpression(parent) && parent.expression === node) {
        read.shape = 'call'
        read.arguments = parent.arguments.length
        return read
    }
    if (isShorthandPropertyAssignment(parent)) {
        read.shape = 'shorthand'
        return read
    }

    // The member path, walked up while the name stands on the LEFT of each access.
    let top: Node = node
    while (true) {
        const up = top.parent
        if (isPropertyAccessExpression(up) && up.expression === top) {
            // 31.5 — the `Reactive`'s own member is the API, and no path.
            if (top === node && REACTIVE_MEMBERS.has(up.name.text)) {
                read.shape = 'asWritten'
                return read
            }
            read.path.push({
                name: up.name.text,
                start: up.name.getStart(),
                end: up.name.end,
            })
        } else if (isElementAccessExpression(up) && up.expression === top)
            read.path.push({
                name: undefined,
                start: up.argumentExpression.getStart(),
                end: up.argumentExpression.end,
            })
        else break
        top = up
    }

    const outer = top.parent
    if (
        isBinaryExpression(outer) &&
        outer.left === top &&
        outer.operatorToken.kind >= SyntaxKind.FirstAssignment &&
        outer.operatorToken.kind <= SyntaxKind.LastAssignment
    ) {
        read.shape = 'write'
        read.operator = outer.operatorToken.getText().slice(0, -1)
        read.to = outer.end
        read.value = { start: outer.right.getStart(), end: outer.right.end }
        return read
    }
    if (
        (isPrefixUnaryExpression(outer) || isPostfixUnaryExpression(outer)) &&
        (outer.operator === SyntaxKind.PlusPlusToken ||
            outer.operator === SyntaxKind.MinusMinusToken)
    ) {
        read.shape = 'update'
        read.operator = outer.operator === SyntaxKind.PlusPlusToken ? '+' : '-'
        read.prefix = isPrefixUnaryExpression(outer)
        read.from = outer.getStart()
        read.to = outer.end
        const holder = outer.parent
        read.discarded =
            isExpressionStatement(holder) ||
            (isForStatement(holder) && holder.incrementor === outer)
        return read
    }
    // A path that ends in anything else is a read of the value, whose members follow it.
    read.path.length = 0
    return read
}
