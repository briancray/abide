import { SyntaxKind } from 'typescript/unstable/ast'
import { isContextualKeyword, type Token, tokenise } from './tokenise.ts'

/**
 * Splits a `<script>` into its import statements and the rest of its body.
 *
 * A `<script>` block is per-instance setup (34.1), so its body is emitted INSIDE the component
 * function — but an `import` is only legal at the top of a module. This splits the two so the
 * imports can be hoisted and everything else stays where the author put it.
 *
 * WHERE AN IMPORT BEGINS AND ENDS IS READ OFF the one tokeniser, which carries the template
 * re-scan a bare `` ` `` needs, so an import after a template literal is still found.
 *
 * With `landed`, every specifier the build moved is rewritten where it stands, a static import's
 * and an `import('…')`'s alike (`landedSpecifier`) — so the two cannot land in different places.
 */
export function splitImports(
    script: string,
    lane: '' | '.client' = '',
    landed?: ReadonlyMap<string, string>,
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
        if (span.dynamic) {
            if (landed === undefined) continue
            const moved = landedSpecifier(span.specifier, lane, landed)
            if (moved === undefined) continue
            body += `${script.slice(at, span.literal + 1)}${moved}`
            at = span.end - 1
            continue
        }
        const moved =
            landed === undefined
                ? undefined
                : landedSpecifier(span.specifier, lane, landed)
        imports +=
            moved === undefined
                ? `${script.slice(span.start, span.end)}\n`
                : `${script.slice(span.start, span.literal + 1)}${moved}${script.slice(span.literalEnd - 1, span.end)}\n`
        // AN IMPORT IS A STATEMENT AND EXCISING IT REMOVES A SEPARATOR. `const x = f()` with an
        // import under it and `[1, 2].forEach(g)` under that becomes `const x = f()` followed by
        // a `[` that automatic semicolon insertion does NOT break — it reads as `f()[2]`, a
        // different program with nothing about it saying so. The empty statement left in its
        // place is the separator the import was.
        body += `${script.slice(at, span.start)};`
        at = span.end
        // The `;` an import may end with would otherwise be left behind beside the one above.
        if (script[at] === ';') at += 1
    }
    return { imports, body: body + script.slice(at) }
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
    literal: number
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
    const tokens = tokenise(source)
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
                        literal: literal.start,
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
            literal: specifier.start,
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
        if (span.specifier.endsWith('.abide'))
            found.push({
                specifier: span.specifier,
                closingQuote: span.literalEnd - 1,
            })
    return found
}

/**
 * Every relative specifier a script imports, re-exports or `import('…')`s, as written, other than
 * a `.abide` one.
 *
 * 34.14 — what the build rewrites to the path from the compiled module back to the source.
 */
export function relativeSpecifiers(script: string): string[] {
    const specifiers: string[] = []
    if (!script.includes('./')) return specifiers
    for (const span of importSpans(script))
        if (
            (span.specifier.startsWith('./') ||
                span.specifier.startsWith('../')) &&
            !span.specifier.endsWith('.abide')
        )
            specifiers.push(span.specifier)
    return specifiers
}

/**
 * Every import declaration in a script: its text and where it starts.
 *
 * `import …` alone — an `export … from` binds nothing in the script it stands in.
 */
function importDeclarations(script: string): { text: string; start: number }[] {
    const declarations: { text: string; start: number }[] = []
    if (!script.includes('import')) return declarations
    for (const span of importSpans(script))
        if (!span.dynamic && script.startsWith('import', span.start))
            declarations.push({
                text: script.slice(span.start, span.end),
                start: span.start,
            })
    return declarations
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
    for (const declaration of importDeclarations(script)) {
        const tokens = tokenise(declaration.text)
        const last = tokens.findLastIndex(
            (token) => token.kind === SyntaxKind.StringLiteral,
        )
        if (last === -1) continue
        const specifier = (tokens[last] as Token).text.slice(1, -1)
        for (let at = 1; at < last; at += 1) {
            const token = tokens[at] as Token
            if (token.kind === SyntaxKind.FromKeyword) break
            if (token.kind === SyntaxKind.AsKeyword) continue
            if (
                token.kind !== SyntaxKind.Identifier &&
                !isContextualKeyword(token.kind)
            )
                continue
            const next = tokens[at + 1] as Token
            // A name followed by `as` is renamed, and a modifier is followed by what it modifies.
            if (next.kind === SyntaxKind.AsKeyword) continue
            if (
                token.text === 'type' &&
                (next.kind === SyntaxKind.Identifier ||
                    next.kind === SyntaxKind.OpenBraceToken ||
                    next.kind === SyntaxKind.AsteriskToken ||
                    isContextualKeyword(next.kind))
            )
                continue
            names.push({ name: token.text, specifier })
        }
    }
    return names
}

/**
 * Where the build moved `specifier`: a `.abide` one to the lane's compiled module for it, and a
 * relative one to its source — or `undefined` where it stays as written.
 *
 * 32.17 — A `.abide` IMPORT IS AN IMPORT OF THE MODULE THAT FILE COMPILES TO, and which of the two
 * it is is the LANE's business: the server module renders the child, the client module mounts it.
 * WHERE that module is, is the build's: `landed` maps a specifier to the path, relative and
 * without an extension, the build resolved it to (`componentGraph`) — and a `.abide` specifier it
 * does not map keeps the path as written.
 *
 * 34.14 — `landed` maps any other relative specifier to the path from the module, in the output
 * tree, back to the file the author meant, which the output tree does not hold.
 */
function landedSpecifier(
    specifier: string,
    lane: '' | '.client',
    landed: ReadonlyMap<string, string>,
): string | undefined {
    if (specifier.endsWith('.abide'))
        return `${landed.get(specifier) ?? specifier.slice(0, -'.abide'.length)}${lane}.ts`
    return landed.get(specifier)
}

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
            /^import \{([^}]*)\} from ('abide'|"abide")\s*;?$/gm,
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
