// 38.225 — THE MIGRATION TO `fetchAndHandle`: `fetchData` is renamed where a file imports it from
// abide, at the import and at every use — a member access (`x.fetchData`) and a name an app declared
// itself are left. A scan, as `toMemo` is.

import { SyntaxKind } from 'typescript/unstable/ast'

import { isAbideSpecifier } from './hookCalls.ts'
import { rewriteCode } from './rewriteCode.ts'
import { importStatements } from './splitImports.ts'
import { type Token, tokenize } from './tokenize.ts'

/** 38.225 — `text`, a file at `path`, with abide's `fetchData` renamed `fetchAndHandle`. */
export function toFetchAndHandle(text: string, path: string): string {
    return rewriteCode(text, path, { word: 'fetchData', module: renamed })
}

function renamed(code: string): string {
    let imported = false
    for (const statement of importStatements(code))
        if (isAbideSpecifier(statement.specifier))
            for (const binding of statement.bindings)
                if (binding.imported === 'fetchData') imported = true
    if (!imported) return code
    const starts: number[] = []
    const tokens = tokenize(code)
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (token.kind !== SyntaxKind.Identifier || token.text !== 'fetchData')
            continue
        if (tokens[at - 1]?.kind === SyntaxKind.DotToken) continue
        starts.push(token.start)
    }
    let out = code
    for (let index = starts.length - 1; index >= 0; index -= 1) {
        const start = starts[index] as number
        out = `${out.slice(0, start)}fetchAndHandle${out.slice(start + 'fetchData'.length)}`
    }
    return out
}
