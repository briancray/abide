// 23.24, 23.25 — A PARAM FILE, READ AND NEVER RUN. `<NAME>.param.ts` says what a segment naming
// `NAME` accepts, and the build carries that into both route tables as a regex literal, so the
// file is read off its tokens: one `export const NAME = /…/`, nothing else. A file that does
// anything more could only be honoured by running it, and nothing about building a route table is
// a reason to run app code.
//
// 30.36 — THE DOT-SEGMENT FLOOR IS WRITTEN INTO THE SOURCE rather than tested beside it, so the walk
// holds one test per part whatever the segment names: a matcher can lift the period default (30.34)
// and still never admit `.` or `..`, which the URL parser collapses into another route.

import { SyntaxKind } from 'typescript/unstable/ast'

import { tokenize } from './tokenize.ts'

/** The name a param file declares: its file name before `.param.ts`. */
export function paramNameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1, -'.param.ts'.length)
}

/**
 * The anchored source of the matcher the param file at `relative` declares, or why it declares none.
 *
 * Anchored as `^(?!\.\.?$)(?:…)$`: the whole part, percent-decoded, and never a dot-segment.
 */
export function matcherOf(relative: string, text: string): string | Error {
    const name = paramNameOf(relative)
    const tokens = tokenize(text)
    const kinds: SyntaxKind[] = []
    for (const token of tokens)
        if (token.kind !== SyntaxKind.EndOfFile) kinds.push(token.kind)
    const declared =
        kinds.length >= 5 &&
        kinds.length <= 6 &&
        kinds[0] === SyntaxKind.ExportKeyword &&
        kinds[1] === SyntaxKind.ConstKeyword &&
        kinds[2] === SyntaxKind.Identifier &&
        kinds[3] === SyntaxKind.EqualsToken &&
        kinds[4] === SyntaxKind.RegularExpressionLiteral &&
        (kinds.length === 5 || kinds[5] === SyntaxKind.SemicolonToken)
    if (!declared)
        return new Error(
            `abide: ${relative} must hold one \`export const ${name} = /…/\` and nothing else, an import included. RULEBOOK 23.24.`,
        )
    const exported = (tokens[2] as { text: string }).text
    if (exported !== name)
        return new Error(
            `abide: ${relative} exports ${exported}, and a param file exports the name it is filed under, ${name}. RULEBOOK 23.24.`,
        )
    const literal = (tokens[4] as { text: string }).text
    const close = literal.lastIndexOf('/')
    if (close !== literal.length - 1)
        return new Error(
            `abide: ${relative} carries the flag ${literal.slice(close + 1)}, and a matcher carries none: a route, OpenAPI and a JSON Schema's \`pattern\` would each read it differently. RULEBOOK 23.24.`,
        )
    const body = literal.slice(1, close)
    const runaway = runawayIn(body)
    if (runaway !== undefined)
        return new Error(
            `abide: ${relative} carries ${runaway}, which can take time exponential in a part's length on an address made to. RULEBOOK 23.25.`,
        )
    return `^(?!\\.\\.?$)(?:${body})$`
}

/**
 * 23.25 — what in a regex's source can backtrack without bound, or `undefined`.
 *
 * A repetition with no upper bound (`*`, `+`, `{n,}`) of a group that itself holds one, and a
 * backreference. Read character by character rather than parsed: a class and an escape are skipped
 * as single atoms, which is all the shape the two questions need.
 */
export function runawayIn(body: string): string | undefined {
    // One entry per open group: whether it holds an unbounded repetition.
    const holds: boolean[] = [false]
    // Whether the atom just read is a group holding one.
    let groupHolding = false
    for (let at = 0; at < body.length; at += 1) {
        const char = body[at] as string
        if (char === '\\') {
            const next = body[at + 1] ?? ''
            if ((next >= '1' && next <= '9') || next === 'k')
                return 'a backreference'
            at += 1
            groupHolding = false
            continue
        }
        if (char === '[') {
            at += 1
            while (at < body.length && body[at] !== ']')
                at += body[at] === '\\' ? 2 : 1
            groupHolding = false
            continue
        }
        if (char === '(') {
            holds.push(false)
            groupHolding = false
            continue
        }
        if (char === ')') {
            const inner = holds.pop() ?? false
            if (inner) holds[holds.length - 1] = true
            groupHolding = inner
            continue
        }
        const unbounded =
            char === '*' ||
            char === '+' ||
            (char === '{' && /^\{\d+,\}/.test(body.slice(at)))
        if (unbounded) {
            if (groupHolding) return 'a repetition of a group that repeats'
            holds[holds.length - 1] = true
            groupHolding = false
            continue
        }
        // A bounded `{n}` or `{n,m}` repeats a group a fixed number of times, and keeps what it
        // repeats as the atom a following quantifier would apply to.
        if (char === '{') {
            const end = body.indexOf('}', at)
            if (end !== -1) at = end
            continue
        }
        if (char === '?') continue
        groupHolding = false
    }
    return undefined
}
