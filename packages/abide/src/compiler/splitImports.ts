import { SyntaxKind } from 'typescript/unstable/ast'

import { COMPONENT_QUERY, TEXT_QUERY } from '#server/MODULE_QUERIES.ts'

import { isContextualKeyword, type Token, tokenize } from './tokenize.ts'

/**
 * Splits a `<script>` into its import statements and the rest of its body.
 *
 * A `<script>` block is per-instance setup (34.1), so its body is emitted INSIDE the component
 * function — but an `import` is only legal at the top of a module. This splits the two so the
 * imports can be hoisted and everything else stays where the author put it.
 *
 * WHERE AN IMPORT BEGINS AND ENDS IS READ OFF the one tokenizer, which carries the template
 * re-scan a bare `` ` `` needs, so an import after a template literal is still found.
 *
 * Every specifier naming a face of a `.abide` is rewritten where it stands, a static import's and an
 * `import('…')`'s alike (`facedSpecifier`) — so the two cannot ask for different faces.
 */
export function splitImports(
    script: string,
    lane: Lane = 'component',
): {
    imports: string
    body: string
} {
    const spans = importSpans(script)
    if (spans.length === 0) return { imports: '', body: script }

    let imports = ''
    let body = ''
    let at = 0
    for (const span of spans) {
        const moved = facedSpecifier(span.specifier, lane)
        if (span.dynamic) {
            if (moved === undefined) continue
            body += `${script.slice(at, span.literalStart + 1)}${moved}`
            at = span.end - 1
            continue
        }
        imports +=
            moved === undefined
                ? `${script.slice(span.start, span.end)}\n`
                : `${script.slice(span.start, span.literalStart + 1)}${moved}${script.slice(span.literalEnd - 1, span.end)}\n`
        // AN IMPORT IS A STATEMENT AND EXCISING IT REMOVES A SEPARATOR. `const x = f()` with an
        // import under it and `[1, 2].forEach(g)` under that becomes `const x = f()` followed by
        // a `[` that automatic semicolon insertion does NOT break — it reads as `f()[2]`, a
        // different program with nothing about it saying so. The empty statement left in its
        // place is the separator the import was.
        // 38.97 — and as many lines as it spanned, so the body stays line for line with the
        // script it came from and a source map can read the one off the other.
        body += `${script.slice(at, span.start)};${'\n'.repeat(newlinesIn(script, span.start, span.end))}`
        at = span.end
        // The `;` an import may end with would otherwise be left behind beside the one above.
        if (script[at] === ';') at += 1
    }
    return { imports, body: body + script.slice(at) }
}

/** How many line breaks `text` holds between `start` and `end`. */
export function newlinesIn(text: string, start: number, end: number): number {
    let count = 0
    for (
        let at = text.indexOf('\n', start);
        at !== -1 && at < end;
        at = text.indexOf('\n', at + 1)
    )
        count += 1
    return count
}

// What can stand between `import` and its specifier. A token that cannot is a malformed import,
// and stopping there is what keeps one broken line from swallowing the statements after it.
//
// A CONTEXTUAL KEYWORD IN HERE IS A NAME. TypeScript's scanner answers `GetKeyword` for `get` and
// `TypeKeyword` for `type` wherever they stand, so `import { get } from './store.ts'` stopped the
// walk on its own binding, found no specifier, and `splitImports` left the statement in the
// component body — an `import` inside a function, a syntax error on a line nobody wrote. Every
// contextual keyword is a legal binding name and none of them can stand between `import` and its
// specifier as anything else, so the whole range answers here.
const IMPORT_CLAUSE = new Set<SyntaxKind>([
    SyntaxKind.Identifier,
    SyntaxKind.OpenBraceToken,
    SyntaxKind.CloseBraceToken,
    SyntaxKind.CommaToken,
    SyntaxKind.AsteriskToken,
    SyntaxKind.DefaultKeyword,
])

function inImportClause(kind: SyntaxKind): boolean {
    return IMPORT_CLAUSE.has(kind) || isContextualKeyword(kind)
}

/** One module specifier a script names, and where it stands. */
type ImportSpan = {
    /** Where the statement begins — or, for an `import('…')`, the literal does. */
    start: number
    /** Where the statement ends — or, for an `import('…')`, the literal does. */
    end: number
    /** Where the specifier's literal begins and ends, quotes included. */
    literalStart: number
    literalEnd: number
    specifier: string
    /** An `import('…')` with a literal specifier: an expression, left where it is written. */
    dynamic: boolean
}

/**
 * Where each module-specifier statement begins and ends, with its specifier — and each
 * `import('…')` that names its specifier as a literal.
 *
 * `import … from '…'`, a bare `import '…'`, and `export … from '…'` — what `splitImports` lifts
 * out of the component body, because an import is only legal at the top of a module.
 *
 * AN `import` KEYWORD IS NOT ALWAYS A DECLARATION. `import(…)` is an expression and so is
 * `import.meta`: the clause scan runs only over the tokens an import CLAUSE can hold
 * (`IMPORT_CLAUSE`), so a `(` or a `.` ends it with no specifier found and the keyword is left
 * alone. The scan that special-cased `(` and ran on otherwise read `import.meta.url` as a
 * declaration looking for its specifier and swallowed every statement up to the next string
 * literal in the file — a write silently destroying a `Reactive` on one side, and a real
 * statement hoisted into the import block on the other. `import(` followed by a literal is the
 * one expression read here, as `dynamic`: it names a module as a declaration does (34.15).
 */
function importSpans(source: string): ImportSpan[] {
    const tokens = tokenize(source)
    const spans: ImportSpan[] = []
    for (let i = 0; i < tokens.length; i += 1) {
        const keyword = tokens[i] as Token
        let at = i + 1
        if (keyword.kind === SyntaxKind.ImportKeyword) {
            if (
                (tokens[at] as Token | undefined)?.kind ===
                SyntaxKind.OpenParenToken
            ) {
                const literal = tokens[at + 1]
                if (literal?.kind === SyntaxKind.StringLiteral)
                    spans.push({
                        start: literal.start,
                        end: literal.end,
                        literalStart: literal.start,
                        literalEnd: literal.end,
                        specifier: literal.text.slice(1, -1),
                        dynamic: true,
                    })
                continue
            }
            while (
                at < tokens.length &&
                inImportClause((tokens[at] as Token).kind)
            )
                at += 1
        } else if (keyword.kind === SyntaxKind.ExportKeyword) {
            at = afterExportClause(tokens, at)
            if (at === -1) continue
        } else continue

        const specifier = tokens[at]
        if (specifier?.kind !== SyntaxKind.StringLiteral) continue
        spans.push({
            start: keyword.start,
            // THE SPECIFIER IS NOT THE END OF THE DECLARATION. `with { type: 'json' }` is part
            // of it, and a span that stopped at the specifier hoisted the import without its
            // attribute and left ` with { type: 'json' }` behind as a `with` statement, which is
            // illegal in a module and takes the whole file with it.
            end: endOfAttributes(tokens, at + 1, specifier.end, source),
            literalStart: specifier.start,
            literalEnd: specifier.end,
            specifier: specifier.text.slice(1, -1),
            dynamic: false,
        })
        i = at
    }
    return spans
}

/**
 * The index of the specifier in `export * from '…'` / `export { … } from '…'`, or -1.
 *
 * -1 where this `export` has no module specifier at all. A bare `export` is not hoistable — the
 * names it exports are declared in the body it would be lifted out of.
 */
function afterExportClause(tokens: Token[], from: number): number {
    let at = from
    if ((tokens[at] as Token | undefined)?.text === 'type') at += 1
    const head = tokens[at]
    if (head === undefined) return -1
    if (head.kind === SyntaxKind.AsteriskToken) {
        at += 1
        if ((tokens[at] as Token | undefined)?.kind === SyntaxKind.AsKeyword)
            at += 2
    } else if (head.kind === SyntaxKind.OpenBraceToken) {
        let depth = 0
        while (at < tokens.length) {
            const kind = (tokens[at] as Token).kind
            if (kind === SyntaxKind.OpenBraceToken) depth += 1
            else if (kind === SyntaxKind.CloseBraceToken) {
                depth -= 1
                if (depth === 0) {
                    at += 1
                    break
                }
            }
            at += 1
        }
    } else return -1
    if ((tokens[at] as Token | undefined)?.kind !== SyntaxKind.FromKeyword)
        return -1
    return at + 1
}

/**
 * The offset past a `with { … }` import-attributes clause, or `end` — the specifier's own end.
 *
 * `end` where there is no clause. THE CLAUSE OPENS WITH A BRACE and nothing else can stand between
 * the specifier and it, so a keyword with no `{` behind it is not one.
 *
 * `assert` IS THE SAME CLAUSE UNDER ITS EARLIER SPELLING AND IS NOT A KEYWORD: it scans as an
 * ordinary identifier, so only its POSITION tells the clause from a statement that merely begins
 * with the name. The grammar's own answer is `[no LineTerminator here] assert`, which is exactly
 * what the spelling was replaced for — matched on its text alone, an `assert` opening the NEXT
 * line took every token to the first balanced `}` for its attributes, so `splitImports` hoisted
 * the statements after the import into module scope.
 */
function endOfAttributes(
    tokens: Token[],
    from: number,
    end: number,
    source: string,
): number {
    const keyword = tokens[from]
    if (keyword === undefined) return end
    if (
        (tokens[from + 1] as Token | undefined)?.kind !==
        SyntaxKind.OpenBraceToken
    )
        return end
    if (keyword.kind !== SyntaxKind.WithKeyword) {
        if (keyword.text !== 'assert') return end
        if (source.slice(end, keyword.start).includes('\n')) return end
    }
    let depth = 0
    for (let at = from + 1; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (token.kind === SyntaxKind.OpenBraceToken) depth += 1
        else if (token.kind === SyntaxKind.CloseBraceToken) {
            depth -= 1
            if (depth === 0) return token.end
        } else if (depth === 0) return end
    }
    return end
}

/**
 * Every `.abide` specifier a script imports, re-exports or `import('…')`s, as written, with the
 * offset of its closing quote.
 *
 * Read off the same spans the split lifts, so the build's import graph, the emitted imports and
 * the checker's pointing at checked modules are one reading of the file.
 */
export function abideImports(
    script: string,
): { specifier: string; closingQuote: number }[] {
    const found: { specifier: string; closingQuote: number }[] = []
    if (!script.includes('.abide')) return found
    for (const span of importSpans(script))
        if (
            span.specifier.endsWith('.abide') &&
            // 34.21 — a `.abide` imported as text is its text, and no component edge.
            (span.dynamic ||
                !IMPORT_ATTRIBUTES.text.test(
                    script.slice(span.literalEnd, span.end),
                ))
        )
            found.push({
                specifier: span.specifier,
                closingQuote: span.literalEnd - 1,
            })
    return found
}

/** One name an import statement binds. */
export type ImportBinding = {
    /** `default`, `*`, or the name imported — a string literal's text where one is written. */
    imported: string
    local: string
    /** Under a `type` modifier, on the binding or on the whole statement: no value of its own. */
    typeOnly: boolean
    /** The binding as a statement's clause spells it, its own modifier kept: `type a as b`. */
    written: string
}

/**
 * Every static import statement a script makes: where it stands, what it names, and each binding,
 * read off the one tokenizer — so a comment or a line break inside the clause is trivia, as it is
 * to bun, and never part of a name.
 *
 * `attributes` is the statement's text after its specifier, a `with { … }` or nothing. A statement of
 * no shape this reads answers no bindings.
 */
export function importStatements(script: string): {
    start: number
    end: number
    specifier: string
    typeOnly: boolean
    attributes: string
    bindings: ImportBinding[]
}[] {
    const found: ReturnType<typeof importStatements> = []
    if (!script.includes('import')) return found
    for (const span of importSpans(script)) {
        if (span.dynamic || !script.startsWith('import', span.start)) continue
        const tokens = tokenize(script.slice(span.start, span.literalStart))
        const bindings: ImportBinding[] = []
        let at = 1
        // `type` modifies the statement unless it is the default's own name: `import type from`.
        const typeOnly =
            tokens[at]?.text === 'type' &&
            tokens[at + 1] !== undefined &&
            tokens[at + 1]?.kind !== SyntaxKind.FromKeyword &&
            tokens[at + 1]?.kind !== SyntaxKind.CommaToken
        if (typeOnly) at += 1
        const head = tokens[at]
        if (
            head !== undefined &&
            head.kind !== SyntaxKind.OpenBraceToken &&
            head.kind !== SyntaxKind.AsteriskToken &&
            (tokens[at + 1]?.kind === SyntaxKind.FromKeyword ||
                tokens[at + 1]?.kind === SyntaxKind.CommaToken)
        ) {
            bindings.push({
                imported: 'default',
                local: head.text,
                typeOnly,
                written: head.text,
            })
            at += tokens[at + 1]?.kind === SyntaxKind.CommaToken ? 2 : 1
        }
        if (tokens[at]?.kind === SyntaxKind.AsteriskToken) {
            const local = tokens[at + 2]?.text ?? ''
            bindings.push({
                imported: '*',
                local,
                typeOnly,
                written: `* as ${local}`,
            })
        } else if (tokens[at]?.kind === SyntaxKind.OpenBraceToken) {
            // Each element between the braces: `[type] imported [as local]`.
            let element: Token[] = []
            for (at += 1; at < tokens.length; at += 1) {
                const token = tokens[at] as Token
                const closed = token.kind === SyntaxKind.CloseBraceToken
                if (closed || token.kind === SyntaxKind.CommaToken) {
                    // `type as t` imports `type`; `type x` and `type x as y` modify.
                    const modified =
                        element[0]?.text === 'type' &&
                        (element.length === 2 || element.length === 4)
                    const name = element[modified ? 1 : 0]
                    if (name !== undefined) {
                        const imported =
                            name.kind === SyntaxKind.StringLiteral
                                ? name.text.slice(1, -1)
                                : name.text
                        let written = ''
                        for (const part of element)
                            written +=
                                written === '' ? part.text : ` ${part.text}`
                        bindings.push({
                            imported,
                            local: (element.at(-1) as Token).text,
                            typeOnly: typeOnly || modified,
                            written,
                        })
                    }
                    element = []
                    if (closed) break
                } else element.push(token)
            }
        }
        found.push({
            start: span.start,
            end: span.end,
            specifier: span.specifier,
            typeOnly,
            attributes: script.slice(span.literalEnd, span.end).trim(),
            bindings,
        })
    }
    return found
}

// The attribute a static import is read by: as text (34.21), or as a mount of routes (23.19).
export const IMPORT_ATTRIBUTES = {
    text: /\btype\s*:\s*['"]text['"]/,
    routes: /\btype\s*:\s*['"]routes['"]/,
} as const

/**
 * Every static import a script makes `with { type }`: the specifier, where the statement and its
 * literal begin, and where the attributes end.
 *
 * 34.21 — a text import's literal-to-end span is what the projection writes over with the specifier
 * the checker types a `string` (`SOURCE_SUFFIX`), and the emitters ask for as text
 * (`facedSpecifier`). 23.19 — a routes import's whole statement is what the projection blanks: a
 * mount is read by the build off the file, and neither bun nor the checker has a module to give it.
 */
export function attributedImports(
    script: string,
    type: keyof typeof IMPORT_ATTRIBUTES,
): ImportSpan[] {
    const found: ImportSpan[] = []
    if (!script.includes(type)) return found
    const attribute = IMPORT_ATTRIBUTES[type]
    for (const span of importSpans(script))
        if (
            !span.dynamic &&
            attribute.test(script.slice(span.literalEnd, span.end))
        )
            found.push(span)
    return found
}

/** What a file imported as text is written as once projected: `./X.abide` → `./X.abide.source`. */
export const SOURCE_SUFFIX = '.source'

/**
 * `source` with each module specifier — of a declaration, an `export … from` or an `import('…')` —
 * written as `rewrite` answers for it, and left as it is where `rewrite` answers `undefined`.
 */
export function respecified(
    source: string,
    rewrite: (specifier: string) => string | undefined,
): string {
    let out = ''
    let at = 0
    for (const span of importSpans(source)) {
        const written = rewrite(span.specifier)
        if (written === undefined) continue
        out += `${source.slice(at, span.literalStart + 1)}${written}`
        at = span.literalEnd - 1
    }
    return at === 0 ? source : out + source.slice(at)
}

/**
 * Every name a script's import declarations bind, with the specifier it is imported from.
 *
 * `x as y` binds `y`, a `type` modifier binds nothing of its own, and `* as ns` binds `ns`.
 */
export function importedNames(
    script: string,
): { name: string; specifier: string }[] {
    const names: { name: string; specifier: string }[] = []
    // `import …` alone — an `export … from` binds nothing in the script it stands in.
    for (const declaration of importStatements(script))
        for (const binding of declaration.bindings)
            names.push({
                name: binding.local,
                specifier: declaration.specifier,
            })
    return names
}

/**
 * The face of a `.abide` a specifier asks for, spelled on it (`MODULE_QUERIES`), or `undefined`
 * where the specifier stays as written.
 *
 * 34.14 — EVERY OTHER SPECIFIER STAYS AS WRITTEN: the compiled module is served at its `.abide`'s
 * own path, so bun resolves a relative, a `#` or a bare specifier from the file that wrote it.
 *
 * 32.17 — a component block's `.abide` import is of the module that file compiles to; a server
 * block's stays bare, for the face a module abide did not compile gets (34.16). 34.21 — a file the
 * projection marked as text is asked for as its text.
 */
function facedSpecifier(specifier: string, lane: Lane): string | undefined {
    if (specifier.endsWith(SOURCE_SUFFIX))
        return `${specifier.slice(0, -SOURCE_SUFFIX.length)}${TEXT_QUERY}`
    if (lane === 'component' && specifier.endsWith('.abide'))
        return `${specifier}${COMPONENT_QUERY}`
    return undefined
}

/**
 * Which face a block's imports are written for: a component's — its `<script>` and
 * `<script module>`, in either lane — or a server block's, whose `.abide` imports stay bare (34.16).
 */
export type Lane = 'component' | 'source'

/**
 * `imports` with `props` dropped from the abide import that names it.
 *
 * 33 — `props` IS COMPILED AWAY, so the import an author wrote for it is a name the emitted module
 * never calls. Left in, every component module imports the stub that exists to throw, and the
 * app's own tooling reports it unused in a file nobody wrote.
 */
export function withoutProps(imports: string): string {
    if (!imports.includes('props')) return imports
    return imports
        .replace(
            /^import \{([^}]*)\} from ('@abide\/abide'|"@abide\/abide")\s*;?$/gm,
            (_statement, clause: string, specifier: string) => {
                const kept: string[] = []
                for (const name of clause.split(','))
                    if (name.trim() !== 'props' && name.trim() !== '')
                        kept.push(name.trim())
                return kept.length === 0
                    ? ''
                    : `import { ${kept.join(', ')} } from ${specifier}`
            },
        )
        .replace(/\n{2,}/g, '\n')
}
