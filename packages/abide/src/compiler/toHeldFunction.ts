// 38.232 — THE MIGRATION OFF A FUNCTION `reactive` HELD: a function handed to `reactive` is a body from
// the release this migration is keyed to on (4.20), so one the app held is handed back by a body that
// answers it, `reactive(() => fn)`. What reads as a function is `isBody`'s, as 38.215 reads it, and
// it runs ahead of 38.233, which turns every `reactive.derived` body into a `reactive` call.

import { SyntaxKind } from 'typescript/unstable/ast'

import { isBody } from './renameBodyCalls.ts'
import { rewriteCode } from './rewriteCode.ts'
import { afterTypeArguments, type Token, tokenize } from './tokenize.ts'
import { reactiveAs } from './toReactive.ts'

/** 38.232 — `text`, a file at `path`, with each function abide's `reactive` holds wrapped in a body. */
export function toHeldFunction(text: string, path: string): string {
    return rewriteCode(text, path, {
        word: 'reactive',
        // A PAGE'S SCRIPTS ARE ONE SCOPE: a nested per-arm `<script>` reads what the top-level one imports.
        scripts: (blocks) => {
            const name = reactiveAs(blocks)
            return name === undefined
                ? blocks
                : blocks.map((block) => wrapped(block, name))
        },
    })
}

/** `code` with the first argument of each `name(…)` call that is a function handed back by a body. */
function wrapped(code: string, name: string): string {
    const tokens = tokenize(code)
    const starts: number[] = []
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (token.kind !== SyntaxKind.Identifier || token.text !== name)
            continue
        if (tokens[at - 1]?.kind === SyntaxKind.DotToken) continue
        const open = afterTypeArguments(tokens, at + 1)
        if (tokens[open]?.kind !== SyntaxKind.OpenParenToken) continue
        if (isBody(tokens, open + 1, code))
            starts.push((tokens[open + 1] as Token).start)
    }
    let out = code
    for (let index = starts.length - 1; index >= 0; index -= 1) {
        const start = starts[index] as number
        out = `${out.slice(0, start)}() => ${out.slice(start)}`
    }
    return out
}
