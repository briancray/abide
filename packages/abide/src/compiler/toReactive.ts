// 38.233 — THE MIGRATION OFF `reactive.derived`: a body handed to `reactive` is what it derives (4.20),
// so every `reactive.derived` is `reactive`. A scan, as `toDerived` is: what is renamed is the member
// `derived` of the name the file imported abide's `reactive` as — never another object's `derived`.
// It runs after 38.232, which reads every `reactive` call as the value form it was until now.

import { SyntaxKind } from 'typescript/unstable/ast'

import { isAbideSpecifier } from './hookCalls.ts'
import { rewriteCode } from './rewriteCode.ts'
import { importStatements } from './splitImports.ts'
import { type Token, tokenize } from './tokenize.ts'

/** 38.233 — `text`, a file at `path`, with abide's `reactive.derived` spelled `reactive`. */
export function toReactive(text: string, path: string): string {
    return rewriteCode(text, path, {
        word: 'derived',
        module: (code) => {
            const name = reactiveAs([code])
            return name === undefined ? code : renamed(code, name)
        },
        // A PAGE'S SCRIPTS ARE ONE SCOPE: a nested per-arm `<script>` reads what the top-level one imports.
        scripts: (blocks) => {
            const name = reactiveAs(blocks)
            return name === undefined
                ? blocks
                : blocks.map((block) => renamed(block, name))
        },
    })
}

/** The name `blocks` import abide's `reactive` as, or `undefined` where none does. */
export function reactiveAs(blocks: string[]): string | undefined {
    for (const block of blocks)
        for (const statement of importStatements(block))
            if (!statement.typeOnly && isAbideSpecifier(statement.specifier))
                for (const binding of statement.bindings)
                    if (!binding.typeOnly && binding.imported === 'reactive')
                        return binding.local
    return undefined
}

/** `code` with each `name.derived` that is not itself a member read as `name`. */
function renamed(code: string, name: string): string {
    const tokens = tokenize(code)
    const spans: { start: number; end: number }[] = []
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (token.kind !== SyntaxKind.Identifier || token.text !== name)
            continue
        if (tokens[at - 1]?.kind === SyntaxKind.DotToken) continue
        const member = tokens[at + 2]
        if (
            tokens[at + 1]?.kind !== SyntaxKind.DotToken ||
            member?.text !== 'derived'
        )
            continue
        spans.push({ start: token.end, end: member.end })
    }
    let out = code
    for (let index = spans.length - 1; index >= 0; index -= 1) {
        const span = spans[index] as { start: number; end: number }
        out = out.slice(0, span.start) + out.slice(span.end)
    }
    return out
}
