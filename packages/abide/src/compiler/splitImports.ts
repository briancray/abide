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
 */
export function splitImports(script: string): {
    imports: string
    body: string
} {
    const spans = importSpans(script)
    if (spans.length === 0) return { imports: '', body: script }

    let imports = ''
    let body = ''
    let at = 0
    for (const span of spans) {
        imports += `${script.slice(span.start, span.end)}\n`
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

/**
 * Where each module-specifier statement begins and ends, with its specifier.
 *
 * `import … from '…'`, a bare `import '…'`, and `export … from '…'` — what `splitImports` lifts
 * out of the component body, because an import is only legal at the top of a module.
 *
 * AN `import` KEYWORD IS NOT ALWAYS A DECLARATION. `import(…)` is an expression and so is
 * `import.meta`, and neither is a case here: the scan runs only over the tokens an import CLAUSE
 * can hold (`IMPORT_CLAUSE`), so a `(` or a `.` ends it with no specifier found and the keyword is
 * left alone. The scan that special-cased `(` and ran on otherwise read `import.meta.url` as a
 * declaration looking for its specifier and swallowed every statement up to the next string
 * literal in the file — a write silently destroying a `Reactive` on one side, and a real
 * statement hoisted into the import block on the other.
 */
function importSpans(
    source: string,
): { start: number; end: number; specifier: string }[] {
    const tokens = tokenise(source)
    const spans: { start: number; end: number; specifier: string }[] = []
    for (let i = 0; i < tokens.length; i += 1) {
        const keyword = tokens[i] as Token
        let at = i + 1
        if (keyword.kind === SyntaxKind.ImportKeyword) {
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
            specifier: specifier.text.slice(1, -1),
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
 * Every `.abide` specifier a script imports or re-exports, as written.
 *
 * Read off the same spans the split lifts, so the build's import graph and the emitted imports are
 * one reading of the file.
 */
export function abideSpecifiers(script: string): string[] {
    const specifiers: string[] = []
    if (!script.includes('.abide')) return specifiers
    for (const span of importSpans(script))
        if (span.specifier.endsWith('.abide')) specifiers.push(span.specifier)
    return specifiers
}

/**
 * Rewrites each `.abide` specifier in `imports` to the lane's compiled module for it.
 *
 * 32.17 — A `.abide` IMPORT IS AN IMPORT OF THE MODULE THAT FILE COMPILES TO, and which of the two
 * it is is the LANE's business: the server module renders the child, the client module mounts it.
 * WHERE that module is, is the build's: `components` maps a specifier to the path, relative and
 * without an extension, the build resolved it to (`componentGraph`) — and a specifier it does not
 * map keeps the path as written, which is where a relative one lands anyway because the output
 * tree mirrors the source tree.
 */
export function componentImports(
    imports: string,
    lane: '' | '.client',
    components: ReadonlyMap<string, string>,
): string {
    return imports.includes('.abide')
        ? imports.replace(
              /(['"])([^'"\n]*)\.abide\1/g,
              (_whole, quote: string, stem: string) =>
                  `${quote}${components.get(`${stem}.abide`) ?? stem}${lane}.ts${quote}`,
          )
        : imports
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
