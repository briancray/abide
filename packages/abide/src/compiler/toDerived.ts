// 38.228 — THE MIGRATION TO `reactive.derived`: `reactive.derived` is a member of `reactive` rather than an
// export of its own, so every use of abide's `computed` is `reactive.derived`, and `reactive` is
// imported where it was not. A scan, as `toMemo` is: what is renamed is the name the file imported
// abide's `computed` as, wherever it is a value — never a member (`x.computed`) or an object's key.
//
// A PAGE'S SCRIPTS ARE ONE SCOPE: a nested per-arm `<script>` reads what the top-level one imports, so
// a use is renamed in every block once any block imports it.

import { SyntaxKind } from 'typescript/unstable/ast'

import { abideBindings, isAbideSpecifier, localOf } from './hookCalls.ts'
import { rewriteCode, type Splice, spliced } from './rewriteCode.ts'
import {
    type ImportStatement,
    importStatements,
    namedImports,
} from './splitImports.ts'
import { type Token, tokenize } from './tokenize.ts'

/** 38.228 — `text`, a file at `path`, with abide's `computed` spelled `reactive.derived`. */
export function toDerived(text: string, path: string): string {
    return rewriteCode(text, path, {
        word: 'computed',
        module: (code) => migrated([code])[0] as string,
        scripts: (blocks) => migrated(blocks),
    })
}

function migrated(blocks: string[]): string[] {
    const bindings = abideBindings(blocks)
    const computedAs = localOf(bindings, 'computed')
    const reactiveAs = localOf(bindings, 'reactive')
    if (computedAs === undefined) return blocks
    const spelled = `${reactiveAs ?? 'reactive'}.derived`
    let joined = reactiveAs !== undefined
    return blocks.map((block) => {
        const edits: Splice[] = []
        const statements = importStatements(block)
        for (const statement of statements) {
            if (statement.typeOnly || !isAbideSpecifier(statement.specifier))
                continue
            if (!statement.bindings.some(isComputed)) continue
            edits.push(rewrittenImport(block, statement, !joined))
            joined = true
        }
        const tokens = tokenize(block)
        for (let at = 0; at < tokens.length; at += 1) {
            const token = tokens[at] as Token
            if (
                token.kind !== SyntaxKind.Identifier ||
                token.text !== computedAs ||
                inImport(statements, token.start) ||
                !isValueUse(tokens, at)
            )
                continue
            edits.push({ start: token.start, end: token.end, text: spelled })
        }
        const out = spliced(block, edits)
        return out
    })
}

function isComputed(binding: { imported: string; typeOnly: boolean }) {
    return binding.imported === 'computed' && !binding.typeOnly
}

function inImport(statements: ImportStatement[], at: number): boolean {
    for (const statement of statements)
        if (at >= statement.start && at < statement.end) return true
    return false
}

/** Whether the name at `at` is read as a value: not a member, and not an object's key. */
function isValueUse(tokens: Token[], at: number): boolean {
    const before = tokens[at - 1]?.kind
    if (
        before === SyntaxKind.DotToken ||
        before === SyntaxKind.QuestionDotToken
    )
        return false
    const after = tokens[at + 1]?.kind
    const opensMember =
        before === SyntaxKind.OpenBraceToken || before === SyntaxKind.CommaToken
    // `{ computed: … }` names a key, and `{ computed }` destructures or spells one: neither is ours.
    if (
        opensMember &&
        (after === SyntaxKind.ColonToken ||
            after === SyntaxKind.CommaToken ||
            after === SyntaxKind.CloseBraceToken)
    )
        return false
    return true
}

/**
 * The import `statement` without abide's `computed`, and with `reactive` where `adding` — dropped
 * whole where nothing is left of it.
 */
function rewrittenImport(
    block: string,
    statement: ImportStatement,
    adding: boolean,
): Splice {
    const named = statement.bindings.filter(
        (binding) => binding.imported !== 'default' && binding.imported !== '*',
    )
    const kept = named
        .filter((binding) => !isComputed(binding))
        .map((binding) => binding.written)
    if (adding) kept.push('reactive')
    if (kept.length === 0 && named.length === statement.bindings.length) {
        const end =
            block[statement.end] === '\n' ? statement.end + 1 : statement.end
        return { start: statement.start, end, text: '' }
    }
    return namedImports(block, statement, kept)
}
