// 38.222 — THE MIGRATION OFF `refuse.named`'s POSITIONAL STATUS: a refusal is declared by its name and
// its options, the status among them beside the message and the schema, from the release this
// migration is keyed to on.
//
// A SCAN, NOT A PARSE, as `toJob` is. A call is rewritten where `refuse.named` is read as a member and
// its second argument is not an object literal already; an argument written `undefined` is dropped,
// and a fourth that is not an object literal written in place is spread into the options.

import { SyntaxKind } from 'typescript/unstable/ast'

import { type CodeRewrite, rewriteCode } from './rewriteCode.ts'
import {
    afterTypeArguments,
    closerOf,
    nesting,
    type Token,
    tokenize,
} from './tokenize.ts'

/** 38.222 — `text`, a file at `path`, with each `refuse.named`'s status and message moved into its options. */
export function toRefuseNamed(text: string, path: string): string {
    return rewriteCode(text, path, TO_REFUSE_NAMED)
}

const TO_REFUSE_NAMED: CodeRewrite = {
    word: 'named',
    module: refusalsMoved,
}

/** A module with each `refuse.named(name, status, message, options)` written `refuse.named(name, { … })`. */
function refusalsMoved(code: string): string {
    if (!code.includes('refuse')) return code
    const tokens = tokenize(code)
    let out = ''
    let last = 0
    for (let at = 2; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (
            token.text !== 'named' ||
            tokens[at - 1]?.kind !== SyntaxKind.DotToken ||
            tokens[at - 2]?.text !== 'refuse'
        )
            continue
        const open = afterTypeArguments(tokens, at + 1)
        if (tokens[open]?.kind !== SyntaxKind.OpenParenToken) continue
        const close = closerOf(tokens, open)
        const args = argumentsOf(code, tokens, open, close)
        if (
            args.length < 2 ||
            (args[1] as string).startsWith('{') ||
            args.length > 4
        )
            continue
        const [name, status, message, options] = args as [
            string,
            string,
            string | undefined,
            string | undefined,
        ]
        const properties: string[] = []
        if (status !== 'undefined') properties.push(`status: ${status}`)
        if (message !== undefined && message !== 'undefined')
            properties.push(`message: ${message}`)
        if (options !== undefined)
            if (options.startsWith('{') && options.endsWith('}')) {
                const inner = options.slice(1, -1).trim().replace(/,\s*$/, '')
                if (inner !== '') properties.push(dedented(inner))
            } else properties.push(`...${options}`)
        const call = code.slice(
            (tokens[open] as Token).end,
            (tokens[close] as Token).start,
        )
        out += code.slice(last, (tokens[open] as Token).end)
        if (!call.includes('\n'))
            out +=
                properties.length === 0
                    ? name
                    : `${name}, { ${properties.join(', ')} }`
        else {
            // Written one argument to a line: the name stays on the call's line, the options open
            // there, and each property takes the line an argument had.
            const lineStart = code.lastIndexOf('\n', token.start) + 1
            const base = /^[ \t]*/.exec(code.slice(lineStart))?.[0] ?? ''
            const indent = `${base}    `
            out +=
                properties.length === 0
                    ? name
                    : `${name}, {\n${properties
                          .map((property) => indent + property)
                          .join(',\n')},\n${base}}`
        }
        last = (tokens[close] as Token).start
        at = close
    }
    return out + code.slice(last)
}

/** The text of each depth-0 argument of the call opened at `open` and closed at `close`, trimmed. */
function argumentsOf(
    code: string,
    tokens: readonly Token[],
    open: number,
    close: number,
): string[] {
    const args: string[] = []
    let depth = 0
    let from = (tokens[open] as Token).end
    for (let index = open + 1; index < close; index += 1) {
        const token = tokens[index] as Token
        depth += nesting(token.kind)
        if (depth === 0 && token.kind === SyntaxKind.CommaToken) {
            args.push(code.slice(from, token.start).trim())
            from = token.end
        }
    }
    const tail = code.slice(from, (tokens[close] as Token).start).trim()
    if (tail !== '') args.push(tail)
    return args
}

/** `text` with every line after its first moved four spaces left: a property lifted out of the options object an argument held sits one level shallower. */
function dedented(text: string): string {
    return text.replace(/\n {4}/g, '\n')
}
