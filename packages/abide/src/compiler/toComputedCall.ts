// 38.224 — THE MIGRATION OFF A HANDLER CALL READ AS A VALUE: a page's `const deal = getDeal({ id })`
// held the `Reactive` a call handed back, and a call now answers a promise (16.3). Wrapped as
// `computed(() => getDeal({ id }))`, the page holds the handler's value as it did (16.107).
//
// A SCAN, NOT A PARSE, as `toMemo` is, and narrower than every call: a declaration whose whole
// initializer is one call of a name a page imports by default from a `.handler.ts` file — the
// handler convention — or of abide's `health`. A call written anywhere else, an `await` before it,
// or one handed on as an argument, is left: what it reads there is an answer, not a value.

import { SyntaxKind } from 'typescript/unstable/ast'

import { SHARED_SPECIFIER } from '#shared/SPECIFIERS.ts'

import { isAbideSpecifier } from './hookCalls.ts'
import { rewriteCode, type Splice, spliced } from './rewriteCode.ts'
import { importStatements, namedImports } from './splitImports.ts'
import { closerOf, type Token, tokenize } from './tokenize.ts'

/** 38.224 — `text`, a page at `path`, with each handler call a declaration holds wrapped in `computed`. */
export function toComputedCall(text: string, path: string): string {
    if (!path.endsWith('.abide')) return text
    return rewriteCode(text, path, {
        word: 'import',
        module: wrapped,
        scripts: (blocks) => {
            // A PAGE'S SCRIPTS ARE ONE SCOPE: a nested script calls what the top-level one imports.
            const handlers = new Set<string>()
            for (const block of blocks)
                for (const name of handlersIn(block)) handlers.add(name)
            const codes = blocks.map((block) => wrapCalls(block, handlers))
            for (let index = 0; index < codes.length; index += 1) {
                if (codes[index] === blocks[index]) continue
                const host = abideImporter(codes)
                if (host !== undefined)
                    codes[host] = withComputed(codes[host] as string)
                else
                    codes[index] =
                        `\nimport { computed } from '${SHARED_SPECIFIER}'\n${codes[index]}`
                break
            }
            return codes
        },
    })
}

function wrapped(code: string): string {
    const handlers = handlersIn(code)
    const out = wrapCalls(code, handlers)
    return out === code ? code : withComputed(out)
}

/** The names `code` imports a handler by: a `.handler.ts` file's default, and abide's `health`. */
function handlersIn(code: string): Set<string> {
    const names = new Set<string>()
    for (const statement of importStatements(code)) {
        if (statement.typeOnly) continue
        const handlerFile = /\.handler(\.ts)?$/.test(statement.specifier)
        for (const binding of statement.bindings) {
            if (handlerFile && binding.imported === 'default')
                names.add(binding.written)
            if (
                isAbideSpecifier(statement.specifier) &&
                binding.imported === 'health'
            )
                names.add(binding.written)
        }
    }
    return names
}

/** `code` with each `const`/`let` initialized by one call of a name in `handlers` wrapped. */
function wrapCalls(code: string, handlers: Set<string>): string {
    if (handlers.size === 0) return code
    const tokens = tokenize(code)
    const edits: Splice[] = []
    for (let at = 0; at + 3 < tokens.length; at += 1) {
        const keyword = tokens[at] as Token
        if (
            keyword.kind !== SyntaxKind.ConstKeyword &&
            keyword.kind !== SyntaxKind.LetKeyword
        )
            continue
        if (tokens[at + 1]?.kind !== SyntaxKind.Identifier) continue
        if (tokens[at + 2]?.kind !== SyntaxKind.EqualsToken) continue
        const callee = tokens[at + 3] as Token
        if (callee.kind !== SyntaxKind.Identifier || !handlers.has(callee.text))
            continue
        const open = at + 4
        if (tokens[open]?.kind !== SyntaxKind.OpenParenToken) continue
        const close = closerOf(tokens, open)
        if (close === -1) continue
        // The call is the whole initializer: what follows ends the declaration.
        const after = tokens[close + 1]
        if (
            after !== undefined &&
            after.kind !== SyntaxKind.SemicolonToken &&
            !code
                .slice((tokens[close] as Token).end, after.start)
                .includes('\n')
        )
            continue
        const end = (tokens[close] as Token).end
        edits.push({
            start: callee.start,
            end,
            text: `computed(() => ${code.slice(callee.start, end)})`,
        })
    }
    return spliced(code, edits)
}

/** Which of `codes` imports from abide by name in braces, where `computed` can join it. */
function abideImporter(codes: string[]): number | undefined {
    for (let index = 0; index < codes.length; index += 1)
        for (const statement of importStatements(codes[index] as string))
            if (!statement.typeOnly && statement.specifier === SHARED_SPECIFIER)
                return index
    return undefined
}

/** `code` with `computed` among what it imports from `@abide/abide`, added where it is missing. */
function withComputed(code: string): string {
    for (const statement of importStatements(code)) {
        if (statement.typeOnly || statement.specifier !== SHARED_SPECIFIER)
            continue
        const names = statement.bindings.map((binding) => binding.written)
        if (names.includes('computed')) return code
        const open = code.indexOf('{', statement.start)
        const close = code.indexOf('}', open)
        if (open === -1 || close > statement.end) continue
        const list = namedImports(code, statement, [...names, 'computed'])
        return spliced(code, [list])
    }
    return `import { computed } from '${SHARED_SPECIFIER}'\n${code}`
}
