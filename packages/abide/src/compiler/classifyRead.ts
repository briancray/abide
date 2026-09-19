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
    // `write` and `update` are 31.4, and 31.9 where `path` is not empty.
    shape: 'value' | 'asWritten' | 'call' | 'shorthand' | 'write' | 'update'
    // What the rewrite replaces: the name, or a whole write or update from its first token.
    from: number
    to: number
    // A write's operator without its `=` (`''` for `=` itself); an update's `+` or `-`.
    operator: string
    prefix: boolean
    // An update whose value nothing reads — the statement form, and a `for`'s incrementor.
    discarded: boolean
    arguments: number
    // 31.9 — the member path between the name and the write: a property's name, or the span of a
    // computed segment, which may itself hold reads.
    path: { name: string | undefined; start: number; end: number }[]
    value: Span | undefined
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
