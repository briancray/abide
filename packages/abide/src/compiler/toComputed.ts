// 38.223 — THE MIGRATION TO `computed`: every `memo(…)` handed a body that declares no parameter is a
// `computed(…)` from the release this migration is keyed to on, since `memo` no longer reads a body's
// parameters to decide its form (11.1, 11.2). A body handed by name is left for the checker, whose
// declaration only it reads, and a `memo` declaring a source's option stays one: a `computed` takes
// none (11.81).

import { SyntaxKind } from 'typescript/unstable/ast'

import { closesArrow, renameBodyCalls } from './renameBodyCalls.ts'
import { rewriteCode } from './rewriteCode.ts'
import {
    afterTypeArguments,
    argumentCommas,
    closerOf,
    type Token,
} from './tokenize.ts'
import { propertiesAt, SOURCED } from './toSourceOptions.ts'

/** 38.223 — `text`, a file at `path`, with each `memo` handed a body declaring no parameter renamed `computed`. */
export function toComputed(text: string, path: string): string {
    return rewriteCode(text, path, TO_COMPUTED)
}

/** Whether the argument starting at `at` is a body written in place that declares no parameter. */
function isBodyWithoutParameter(tokens: Token[], at: number): boolean {
    let first = tokens[at] as Token | undefined
    if (first === undefined) return false
    let next = at
    if (first.text === 'async') {
        next += 1
        first = tokens[next]
        if (first === undefined) return false
    }
    if (first.kind === SyntaxKind.FunctionKeyword) {
        next += 1
        if (tokens[next]?.kind === SyntaxKind.AsteriskToken) next += 1
        if (tokens[next]?.kind === SyntaxKind.Identifier) next += 1
        next = afterTypeArguments(tokens, next)
        return emptyParameters(tokens, next)
    }
    if (first.kind === SyntaxKind.LessThanToken)
        next = afterTypeArguments(tokens, next)
    if (tokens[next]?.kind !== SyntaxKind.OpenParenToken) return false
    return (
        emptyParameters(tokens, next) &&
        closesArrow(tokens, closerOf(tokens, next))
    )
}

/** Whether the `(` at `open` closes at once: a list of no parameters. */
function emptyParameters(tokens: Token[], open: number): boolean {
    return (
        tokens[open]?.kind === SyntaxKind.OpenParenToken &&
        tokens[open + 1]?.kind === SyntaxKind.CloseParenToken
    )
}

/** Whether the call whose first argument starts at `at` declares an option only a source takes. */
function declaresSourced(tokens: Token[], at: number): boolean {
    const second = argumentCommas(tokens, at - 1)[0]
    if (second === undefined) return false
    const properties = propertiesAt(tokens, second + 1) ?? []
    return properties.some(({ key }) => SOURCED.has(key.text))
}

const TO_COMPUTED = renameBodyCalls(
    'memo',
    'computed',
    (tokens, at) =>
        isBodyWithoutParameter(tokens, at) && !declaresSourced(tokens, at),
)
