// 38.219 — THE MIGRATION OFF A JOB'S NAME ARGUMENT AND `runNow`: a `job` is handed its options
// alone, its name among them, and what runs it ahead of its schedule is `run`, from the release this
// migration is keyed to on.
//
// A SCAN, NOT A PARSE, as `toKey` is. A name is whatever a `job` call's first argument is where its
// second is an object literal written in place; options built anywhere else are values only the
// checker can follow, and are left for it to name. `runNow` is renamed wherever it is read as a
// member, since a `Job` is handed across files.

import { SyntaxKind } from 'typescript/unstable/ast'

import { type CodeRewrite, rewriteCode } from './rewriteCode.ts'
import { argumentCommas, type Token, tokenize } from './tokenize.ts'

/** 38.219 — `text`, a file at `path`, with each `job`'s name moved into its options and each `runNow` named `run`. */
export function toJob(text: string, path: string): string {
    const moved = rewriteCode(text, path, TO_JOB)
    // A page's markup expressions are no script block, and read a `Job` by member as a script does.
    return path.endsWith('.abide')
        ? moved.replace(MEMBER_RUN_NOW, '$1run')
        : moved
}

const MEMBER_RUN_NOW = /(\??\.\s*)runNow\b/g

const TO_JOB: CodeRewrite = {
    // Every `job` call is handed a `run`, and `runNow` holds it.
    word: 'run',
    module: jobsMoved,
}

/** A module with each `job`'s name moved into its options and each `.runNow` read as `.run`. */
function jobsMoved(code: string): string {
    if (!code.includes('runNow') && !code.includes('job')) return code
    const tokens = tokenize(code)
    let out = ''
    let last = 0
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (token.kind !== SyntaxKind.Identifier) continue
        const before = tokens[at - 1]?.kind
        const member =
            before === SyntaxKind.DotToken ||
            before === SyntaxKind.QuestionDotToken
        if (token.text === 'runNow' && member) {
            out += code.slice(last, token.start) + 'run'
            last = token.end
            continue
        }
        if (token.text !== 'job' || member) continue
        const open = at + 1
        if (tokens[open]?.kind !== SyntaxKind.OpenParenToken) continue
        // A first argument and a comma after it, or -1.
        const first = argumentCommas(tokens, open)[0] ?? -1
        const comma = first > open + 1 ? first : -1
        const options = tokens[comma + 1]
        if (comma === -1 || options?.kind !== SyntaxKind.OpenBraceToken)
            continue
        const name = code.slice(
            (tokens[open + 1] as Token).start,
            (tokens[comma - 1] as Token).end,
        )
        // The name opens the options, on a line of its own where their first property is.
        const gap = code.slice(options.end, tokens[comma + 2]?.start)
        const lineAt = gap.lastIndexOf('\n')
        const property =
            lineAt === -1
                ? ` name: ${name},`
                : `\n${gap.slice(lineAt + 1)}name: ${name},`
        out += code.slice(last, (tokens[open] as Token).end) + '{' + property
        last = options.end
        at = comma + 1
    }
    return out + code.slice(last)
}
