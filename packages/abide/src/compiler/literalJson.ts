// A VALUE WRITTEN AS A LITERAL, READ AS THE JSON IT SPELLS — what the build can know of a value without
// running the module it is in: an object, an array, a string, a number, `true`, `false` or `null`,
// through `as const`, `satisfies` and parentheses. Anything else — a name, a call, a spread, a computed
// key — makes the whole value unreadable, since a document missing a member it was written with would
// check less than its author wrote.

import type { Node } from 'typescript/unstable/ast'
import { SyntaxKind } from 'typescript/unstable/ast'
import {
    isArrayLiteralExpression,
    isAsExpression,
    isIdentifier,
    isNoSubstitutionTemplateLiteral,
    isNumericLiteral,
    isObjectLiteralExpression,
    isParenthesizedExpression,
    isPrefixUnaryExpression,
    isPropertyAssignment,
    isSatisfiesExpression,
    isStringLiteral,
} from 'typescript/unstable/ast/is'

import type { JsonValue } from '#shared/JsonValue.ts'
import { putOwn } from '#shared/putOwn.ts'

/** The JSON `node` is written as, or `undefined` where any part of it is not a literal. */
export function literalJson(node: Node): JsonValue | undefined {
    if (
        isAsExpression(node) ||
        isSatisfiesExpression(node) ||
        isParenthesizedExpression(node)
    )
        return literalJson(node.expression)
    if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node))
        return node.text
    if (isNumericLiteral(node)) return numberOf(node.text)
    if (
        isPrefixUnaryExpression(node) &&
        node.operator === SyntaxKind.MinusToken &&
        isNumericLiteral(node.operand)
    )
        return -numberOf(node.operand.text)
    if (node.kind === SyntaxKind.TrueKeyword) return true
    if (node.kind === SyntaxKind.FalseKeyword) return false
    if (node.kind === SyntaxKind.NullKeyword) return null
    if (isArrayLiteralExpression(node)) {
        const items: JsonValue[] = []
        for (const element of node.elements) {
            const item = literalJson(element)
            if (item === undefined) return undefined
            items.push(item)
        }
        return items
    }
    if (isObjectLiteralExpression(node)) {
        const record: Record<string, JsonValue> = {}
        for (const property of node.properties) {
            if (!isPropertyAssignment(property)) return undefined
            const name = property.name
            const key =
                isIdentifier(name) || isStringLiteral(name)
                    ? name.text
                    : isNumericLiteral(name)
                      ? String(numberOf(name.text))
                      : undefined
            if (key === undefined) return undefined
            const value = literalJson(property.initializer)
            if (value === undefined) return undefined
            putOwn(record, key, value)
        }
        return record
    }
    return undefined
}

// A numeric literal's text keeps its separators (`150_000`), which `Number` refuses.
function numberOf(text: string): number {
    return Number(text.replaceAll('_', ''))
}
