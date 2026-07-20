// `.abide` `<script>` SCOPE ANALYSIS + CELL-REFERENCE REWRITE (Stage 1, PR2) — BUILD/SERVER-SIDE ONLY.
//
// This module extends the role of `transformScript.ts`. Where the legacy transform relied on
// `with ($s)` + get/set accessors so a bare `count` proxied a signal, the AOT emitter needs LEXICAL
// identifiers: `let count = state(0)` stays a real binding and EVERY reference is rewritten — read
// `count` → `count.read()`, write `count = x` → `count.write(x)`. That reference rewrite
// (`rewriteCellRefs`) is the core new work here, built on the SAME TS7 scanner the legacy transform
// uses (`typescript/unstable/ast/scanner`). Like `transformScript.ts`, this runs at build time and
// during SSR and MUST NOT ship to the browser (it pulls in the TypeScript scanner).
//
// Design: we tokenise once into a flat `Tok[]` (with template-literal re-scanning so identifiers
// inside `${…}` are seen while the literal text between substitutions is not), then run pure array
// passes for bracket matching, object-literal classification, binding/shadow analysis, and finally a
// single left-to-right emit pass that copies source verbatim and only rewrites genuine cell
// references.
//
// ── Shadowing depth supported (documented) ──────────────────────────────────────────────────────
//   • `let`/`const`/`var` (simple identifier bindings): a binding at bracket-depth 0 is treated as
//     THE cell's own lexical declaration (name kept, references after it rewrite). A binding at
//     bracket-depth > 0 (inside a function body, block, for-header, etc.) SHADOWS the cell for the
//     rest of its enclosing block.
//   • `function` declaration/expression parameters (simple names) → shadow over the function body.
//   • Arrow-function parameters (`x =>` and `(a, b) =>`, simple names) → shadow over the arrow body
//     (block or expression).
//   • Declaration/param/function/class NAMES at their declaration site are never rewritten.
//   NOT supported (best-effort, documented): destructuring binding patterns (`const {n} = …`,
//   `({n}) =>`), `catch (n)` bindings, TS type annotations, and regex literals (the raw scanner does
//   not re-scan `/…/` — division is fine, regex bodies are not specially protected). Multi-line
//   statement/RHS boundaries follow the same line-break (ASI) heuristic as `transformScript.ts`.

import { SyntaxKind } from 'typescript/unstable/ast'
import { createScanner } from 'typescript/unstable/ast/scanner'
import type { Root } from './ast.ts'

const K = SyntaxKind

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// One import declaration's parsed shape (default, namespace, and named locals). Produced here by the
// scope analysis and consumed by the emitters (`emitSetup`/`emitServer`/`emitClient`).
export interface ImportBinding {
    specifier: string
    defaultLocal: string | null
    namespaceLocal: string | null
    named: { imported: string; local: string }[]
}

export type BindingKind = 'state' | 'computed' | 'linked' | 'const' | 'function' | 'prop' | 'import'

export interface Binding {
    name: string
    kind: BindingKind
}

export interface ScriptInfo {
    setupCode: string
    imports: ImportBinding[]
    bindings: Binding[]
    // Side-effect CSS imports (`import "./styles.css"`) — no bindings, dropped from the setup code but
    // preserved here so the CLIENT emitter can re-emit them verbatim (Bun.build bundles the CSS). The
    // SERVER emitter ignores them (CSS is client-only). Specifiers are kept as written; the client
    // bundle resolves relative ones against the page's source dir.
    cssImports: string[]
}

// A `.abide` component import (`import Card from "./Card.abide"`). The local stays lexical/`declared`
// (so `componentRef` returns the bare name) but is re-emitted as a REAL ES import at module top — the
// loader/bundler rewrites the specifier to the compiled component module — instead of being aliased
// off `$scope`. Only the default local is recorded (a `.abide` module's exports are
// `mount/hydrate/render` + the component default; named imports from a `.abide` file are not a thing).
export interface ComponentImport {
    local: string
    specifier: string
}

export interface ScopeAnalysis {
    module: ScriptInfo | null
    instance: ScriptInfo | null
    cellNames: Set<string>
    declared: Set<string>
    // All side-effect CSS import specifiers across module + instance scripts, in source order.
    cssImports: string[]
    // Default imports whose specifier ends in `.abide` (module + instance scripts, in source order).
    componentImports: ComponentImport[]
    // Pass-through framework/library imports (`abide/shared/online`, `abide/ui/bundled`, …) that are
    // NOT part of the fixed template scope — re-emitted as REAL ES imports at module top (resolved by
    // Bun.build on the client and the temp-module import on the server) instead of aliased off `$scope`.
    // This is the "M3b module-swap resolution": scope-provided primitives (state/props/route/…) still
    // route through `$scope`; everything else in `abide/shared|ui/*` resolves as a genuine module.
    moduleImports: ImportBinding[]
}

// Framework specifiers that MUST resolve through the injected `$scope` (request/instance-scoped:
// recording/seeded `state`, per-request `route`/`identity`, the client `navigate`, …) rather than a
// real module import. Every OTHER `abide/shared|ui/*` import is a pass-through real module (M3b).
const SCOPE_PROVIDED_SPECIFIERS = new Set<string>([
    'abide/ui/state',
    'abide/ui/props',
    'abide/ui/watch',
    'abide/shared/route',
    'abide/shared/url',
    'abide/ui/navigate',
    'abide/server/identity',
    'abide/server/request',
    'abide/server/cookies',
    'abide/server/context',
    'abide/server/server',
])

// A pass-through module import is an `abide/shared|ui/*` framework import that is NOT scope-provided
// and NOT a `.abide` component / `.css` side-effect. Its local is left lexical (`declared`) and the
// original statement is re-emitted verbatim by the client/server emitters.
function isPassThroughImport(specifier: string): boolean {
    if (specifier.endsWith('.abide') || specifier.endsWith('.css')) return false
    if (SCOPE_PROVIDED_SPECIFIERS.has(specifier)) return false
    return specifier.startsWith('abide/shared/') || specifier.startsWith('abide/ui/')
}

// Reconstruct an `import … from "spec";` statement from a parsed binding, faithfully re-expressing
// default / namespace / named (with `as` aliasing) clauses. Used to re-emit pass-through module
// imports as real ES imports in both emitters.
export function reconstructImport(binding: ImportBinding): string {
    const clauses: string[] = []
    if (binding.defaultLocal !== null) clauses.push(binding.defaultLocal)
    if (binding.namespaceLocal !== null) clauses.push(`* as ${binding.namespaceLocal}`)
    if (binding.named.length > 0) {
        const named = binding.named
            .map((entry) =>
                entry.imported === entry.local
                    ? entry.imported
                    : `${entry.imported} as ${entry.local}`,
            )
            .join(', ')
        clauses.push(`{ ${named} }`)
    }
    if (clauses.length === 0) return `import ${JSON.stringify(binding.specifier)};`
    return `import ${clauses.join(', ')} from ${JSON.stringify(binding.specifier)};`
}

// ---------------------------------------------------------------------------
// Tokeniser (shared) — one flat token stream with template-literal re-scanning
// ---------------------------------------------------------------------------

interface Tok {
    kind: SyntaxKind
    start: number
    end: number
    text: string
    nl: boolean // preceding line break (for ASI-style statement boundaries)
}

// The raw scanner does not track template nesting, so after the `}` that closes a `${…}` substitution
// it would mis-lex the following literal text as code. We drive `reScanTemplateToken` ourselves using a
// small frame stack: a `${` (TemplateHead) opens a template frame; the matching `}` re-scans into a
// TemplateMiddle (another substitution follows) or TemplateTail (template ends).
function tokenize(source: string): Tok[] {
    const scanner = createScanner(true, /* Standard */ 0, source)
    const tokens: Tok[] = []
    const frames: ('template' | 'brace')[] = []
    for (;;) {
        let kind = scanner.scan()
        if (kind === K.EndOfFile) break
        if (kind === K.CloseBraceToken && frames[frames.length - 1] === 'template') {
            kind = scanner.reScanTemplateToken(false)
            if (kind === K.TemplateTail) frames.pop()
            // TemplateMiddle: another substitution follows — keep the template frame.
        } else if (kind === K.TemplateHead) {
            frames.push('template')
        } else if (kind === K.OpenBraceToken) {
            frames.push('brace')
        } else if (kind === K.CloseBraceToken) {
            frames.pop()
        }
        tokens.push({
            kind,
            start: scanner.getTokenStart(),
            end: scanner.getTokenEnd(),
            text: scanner.getTokenText(),
            nl: scanner.hasPrecedingLineBreak(),
        })
    }
    return tokens
}

function isOpen(kind: SyntaxKind): boolean {
    return kind === K.OpenParenToken || kind === K.OpenBracketToken || kind === K.OpenBraceToken
}

function isClose(kind: SyntaxKind): boolean {
    return kind === K.CloseParenToken || kind === K.CloseBracketToken || kind === K.CloseBraceToken
}

// Index into a token array at a position that is provably in range (a bounded loop counter or a
// matched-bracket index). Throws instead of returning a silent `undefined`, preserving the
// crash-on-out-of-range semantics the previous `tokenAt(tokens, i)` assertions carried.
function tokenAt(tokens: Tok[], index: number): Tok {
    const token = tokens[index]
    if (token === undefined) throw new Error(`analyzeScope: token index out of range: ${index}`)
    return token
}

// As `tokenAt`, for the parallel numeric analysis arrays (`enclBraceOpen`, `bracketDepth`) whose
// length matches the token stream so an in-range token index is always in range here too.
function numberAt(values: number[], index: number): number {
    const value = values[index]
    if (value === undefined) throw new Error(`analyzeScope: array index out of range: ${index}`)
    return value
}

// ---------------------------------------------------------------------------
// Token-kind classification sets
// ---------------------------------------------------------------------------

// After one of these tokens, a following `{` opens an OBJECT LITERAL (value/expression position). Any
// other predecessor (identifier, `)`, `]`, `}`, `;`, `=>`, `else`/`do`/`try`, or start) → a block.
const PRECEDE_OBJECT: Set<SyntaxKind> = new Set([
    K.OpenParenToken,
    K.OpenBracketToken,
    K.CommaToken,
    K.ColonToken,
    K.QuestionToken,
    K.ExclamationToken,
    K.TildeToken,
    K.DotDotDotToken,
    K.EqualsToken,
    K.PlusEqualsToken,
    K.MinusEqualsToken,
    K.AsteriskEqualsToken,
    K.SlashEqualsToken,
    K.PercentEqualsToken,
    K.AsteriskAsteriskEqualsToken,
    K.AmpersandEqualsToken,
    K.BarEqualsToken,
    K.CaretEqualsToken,
    K.LessThanLessThanEqualsToken,
    K.GreaterThanGreaterThanEqualsToken,
    K.GreaterThanGreaterThanGreaterThanEqualsToken,
    K.AmpersandAmpersandEqualsToken,
    K.BarBarEqualsToken,
    K.QuestionQuestionEqualsToken,
    K.PlusToken,
    K.MinusToken,
    K.AsteriskToken,
    K.SlashToken,
    K.PercentToken,
    K.AsteriskAsteriskToken,
    K.AmpersandToken,
    K.BarToken,
    K.CaretToken,
    K.LessThanToken,
    K.GreaterThanToken,
    K.LessThanEqualsToken,
    K.GreaterThanEqualsToken,
    K.EqualsEqualsToken,
    K.EqualsEqualsEqualsToken,
    K.ExclamationEqualsToken,
    K.ExclamationEqualsEqualsToken,
    K.AmpersandAmpersandToken,
    K.BarBarToken,
    K.QuestionQuestionToken,
    K.LessThanLessThanToken,
    K.GreaterThanGreaterThanToken,
    K.GreaterThanGreaterThanGreaterThanToken,
    K.ReturnKeyword,
    K.TypeOfKeyword,
    K.VoidKeyword,
    K.DeleteKeyword,
    K.InKeyword,
    K.InstanceOfKeyword,
    K.NewKeyword,
    K.AwaitKeyword,
    K.YieldKeyword,
    K.CaseKeyword,
])

// Tokens that END a value/operand — used to tell a postfix `++`/`--` (follows a value) from a prefix
// one (does not).
const VALUE_END: Set<SyntaxKind> = new Set([
    K.Identifier,
    K.CloseParenToken,
    K.CloseBracketToken,
    K.NumericLiteral,
    K.BigIntLiteral,
    K.StringLiteral,
    K.NoSubstitutionTemplateLiteral,
    K.TemplateTail,
    K.RegularExpressionLiteral,
    K.ThisKeyword,
    K.SuperKeyword,
    K.TrueKeyword,
    K.FalseKeyword,
    K.NullKeyword,
    K.PlusPlusToken,
    K.MinusMinusToken,
])

// Compound-assignment token → the underlying binary operator string.
const COMPOUND_OP: Map<SyntaxKind, string> = new Map([
    [K.PlusEqualsToken, '+'],
    [K.MinusEqualsToken, '-'],
    [K.AsteriskEqualsToken, '*'],
    [K.SlashEqualsToken, '/'],
    [K.PercentEqualsToken, '%'],
    [K.AsteriskAsteriskEqualsToken, '**'],
    [K.AmpersandEqualsToken, '&'],
    [K.BarEqualsToken, '|'],
    [K.CaretEqualsToken, '^'],
    [K.LessThanLessThanEqualsToken, '<<'],
    [K.GreaterThanGreaterThanEqualsToken, '>>'],
    [K.GreaterThanGreaterThanGreaterThanEqualsToken, '>>>'],
    [K.AmpersandAmpersandEqualsToken, '&&'],
    [K.BarBarEqualsToken, '||'],
    [K.QuestionQuestionEqualsToken, '??'],
])

// A small allowlist of JS globals that `collectFreeIdentifiers` must NOT report as free (template)
// identifiers. Keywords (`true`, `null`, `this`, …) scan as their own token kinds, not `Identifier`,
// so they never reach the allowlist check.
const GLOBALS: Set<string> = new Set([
    'undefined',
    'NaN',
    'Infinity',
    'globalThis',
    'window',
    'document',
    'console',
    'Math',
    'JSON',
    'Object',
    'Array',
    'String',
    'Number',
    'Boolean',
    'Symbol',
    'BigInt',
    'Date',
    'RegExp',
    'Error',
    'Promise',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Proxy',
    'Reflect',
    'parseInt',
    'parseFloat',
    'isNaN',
    'isFinite',
    'encodeURIComponent',
    'decodeURIComponent',
    'encodeURI',
    'decodeURI',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'structuredClone',
    'Intl',
    'fetch',
    'URL',
    'URLSearchParams',
])

// TS *contextual* keywords the scanner tokenises as their own keyword kind (not `Identifier`) even
// though they are legal VALUE identifiers with no operator meaning in expression position — e.g. a
// template that refers to a binding literally named `type`, `accessor`, `object`, or `module` (TODO
// #18). Without this, a bare such reference is skipped by the free-identifier passes → never rewritten
// to `$scope.<name>` → `ReferenceError` at mount. This is an ALLOWLIST on purpose: the DANGEROUS
// contextual keywords that DO carry expression/operator/declaration meaning — `await`, `async`, `as`,
// `satisfies`, `of`, `yield`, `get`/`set` (accessors), `using`, `assert(s)`, `keyof`, `infer`, `is` —
// are deliberately EXCLUDED so we never misread `{await fn()}`, `x as T`, `for (a of b)`, `{ get x(){} }`
// as identifier references. Missing a safe one only leaves the (rare) bug in place; wrongly including a
// dangerous one would break real template syntax — so the set errs small.
const SAFE_VALUE_KEYWORDS: Set<SyntaxKind> = new Set([
    K.AbstractKeyword,
    K.AccessorKeyword,
    K.AnyKeyword,
    K.BooleanKeyword,
    K.DeclareKeyword,
    K.IntrinsicKeyword,
    K.ModuleKeyword,
    K.NamespaceKeyword,
    K.NeverKeyword,
    K.OutKeyword,
    K.ReadonlyKeyword,
    K.RequireKeyword,
    K.NumberKeyword,
    K.ObjectKeyword,
    K.StringKeyword,
    K.SymbolKeyword,
    K.TypeKeyword,
    K.UniqueKeyword,
    K.UnknownKeyword,
    K.FromKeyword,
    K.GlobalKeyword,
    K.BigIntKeyword,
    K.OverrideKeyword,
])

// A token usable as a value IDENTIFIER: a real `Identifier`, or one of the allowlisted contextual
// keywords above. Used by the binding collectors + free-identifier passes so a keyword-named binding
// is bound/shadowed correctly AND a keyword-named free reference is rewritten to `$scope.<name>`.
function isIdentifierLike(kind: SyntaxKind): boolean {
    return kind === K.Identifier || SAFE_VALUE_KEYWORDS.has(kind)
}

// ---------------------------------------------------------------------------
// Bracket matching + object-literal / depth classification (pure array pass)
// ---------------------------------------------------------------------------

interface BraceInfo {
    matchClose: Map<number, number> // open token index → close token index
    matchOpen: Map<number, number> // close token index → open token index
    enclBraceOpen: number[] // per token: index of nearest enclosing `{` (brace only), or -1
    isObjectBrace: Set<number> // `{` open-token indices classified as object literals
    bracketDepth: number[] // per token: enclosing bracket depth (all of (), [], {})
}

function analyzeBraces(tokens: Tok[]): BraceInfo {
    const n = tokens.length
    const matchClose = new Map<number, number>()
    const matchOpen = new Map<number, number>()
    const openStack: number[] = []
    for (let i = 0; i < n; i++) {
        const kind = tokenAt(tokens, i).kind
        if (isOpen(kind)) openStack.push(i)
        else if (isClose(kind)) {
            const open = openStack.pop()
            if (open !== undefined) {
                matchClose.set(open, i)
                matchOpen.set(i, open)
            }
        }
    }

    const enclBraceOpen: number[] = new Array(n).fill(-1)
    const braceStack: number[] = []
    for (let i = 0; i < n; i++) {
        const kind = tokenAt(tokens, i).kind
        if (kind === K.CloseBraceToken) braceStack.pop()
        enclBraceOpen[i] = braceStack.at(-1) ?? -1
        if (kind === K.OpenBraceToken) braceStack.push(i)
    }

    const bracketDepth: number[] = new Array(n).fill(0)
    let depth = 0
    for (let i = 0; i < n; i++) {
        const kind = tokenAt(tokens, i).kind
        if (isClose(kind)) {
            depth--
            bracketDepth[i] = depth
        } else {
            bracketDepth[i] = depth
            if (isOpen(kind)) depth++
        }
    }

    const isObjectBrace = new Set<number>()
    for (let i = 0; i < n; i++) {
        if (tokenAt(tokens, i).kind === K.OpenBraceToken) {
            const prev = i > 0 ? tokenAt(tokens, i - 1).kind : undefined
            if (prev === undefined || PRECEDE_OBJECT.has(prev)) isObjectBrace.add(i)
        }
    }

    return { matchClose, matchOpen, enclBraceOpen, isObjectBrace, bracketDepth }
}

// ---------------------------------------------------------------------------
// Binding + shadow analysis (pure array pass)
// ---------------------------------------------------------------------------

interface ShadowScope {
    name: string
    start: number // inclusive token index
    end: number // inclusive token index
}

interface Scopes {
    declNameIdx: Set<number> // token indices that are binding/declaration NAMES (never rewritten)
    shadows: ShadowScope[]
}

// Collect the simple identifiers bound by parameters within a `(` … `)` group (open/close token
// indices). Records the first identifier after `(` or a top-level `,`; skips defaults/types/
// destructuring (best-effort). `filter` decides which names matter.
function collectParamBindings(
    tokens: Tok[],
    open: number,
    close: number,
    filter: (name: string) => boolean,
): number[] {
    const params: number[] = []
    let depth = 0
    let expectName = true
    for (let j = open + 1; j < close; j++) {
        const t = tokenAt(tokens, j)
        const kind = t.kind
        if (isOpen(kind)) {
            depth++
            expectName = false
            continue
        }
        if (isClose(kind)) {
            depth--
            continue
        }
        if (depth !== 0) continue
        if (kind === K.CommaToken) {
            expectName = true
            continue
        }
        if (kind === K.DotDotDotToken) continue // `...rest` — name follows
        if (expectName) {
            if (isIdentifierLike(kind) && filter(t.text)) params.push(j)
            expectName = false
        }
    }
    return params
}

// Collect the simple identifiers bound by a `let`/`const`/`var` statement whose keyword is at index
// `kw`. Best-effort: destructuring patterns are skipped.
function collectVarBindings(
    tokens: Tok[],
    kw: number,
    filter: (name: string) => boolean,
): number[] {
    const names: number[] = []
    let depth = 0
    let mode: 'name' | 'after' | 'init' = 'name'
    for (let j = kw + 1; j < tokens.length; j++) {
        const t = tokenAt(tokens, j)
        const kind = t.kind
        if (depth === 0) {
            if (kind === K.SemicolonToken) break
            if (t.nl && j > kw + 1) break // statement boundary (ASI heuristic)
        }
        if (isOpen(kind)) {
            depth++
            if (mode === 'name') mode = 'init' // destructuring pattern — unsupported, skip its names
            continue
        }
        if (isClose(kind)) {
            if (depth === 0) break
            depth--
            continue
        }
        if (depth !== 0) continue
        if (mode === 'name') {
            if (isIdentifierLike(kind)) {
                if (filter(t.text)) names.push(j)
                mode = 'after'
            }
        } else if (mode === 'after') {
            if (kind === K.EqualsToken) mode = 'init'
            else if (kind === K.CommaToken) mode = 'name'
            else if (kind === K.OfKeyword || kind === K.InKeyword) break
        } else {
            if (kind === K.CommaToken) mode = 'name'
        }
    }
    return names
}

// Extent of an arrow-function EXPRESSION body starting at token `start`; returns the last body token
// index. Stops at a depth-0 comma/semicolon or when an enclosing bracket closes.
function arrowExprEnd(tokens: Tok[], start: number): number {
    let depth = 0
    let last = start
    for (let j = start; j < tokens.length; j++) {
        const kind = tokenAt(tokens, j).kind
        if (depth === 0 && (kind === K.CommaToken || kind === K.SemicolonToken))
            return j > start ? j - 1 : start
        if (isOpen(kind)) depth++
        else if (isClose(kind)) {
            if (depth === 0) return j > start ? j - 1 : start
            depth--
        }
        last = j
    }
    return last
}

function buildScopes(tokens: Tok[], braces: BraceInfo, filter: (name: string) => boolean): Scopes {
    const { matchClose, matchOpen, enclBraceOpen, bracketDepth } = braces
    const declNameIdx = new Set<number>()
    const shadows: ShadowScope[] = []
    const n = tokens.length

    const enclClose = (i: number): number => {
        const open = numberAt(enclBraceOpen, i)
        if (open === -1) return n - 1
        return matchClose.get(open) ?? n - 1
    }

    for (let i = 0; i < n; i++) {
        const kind = tokenAt(tokens, i).kind

        if (kind === K.LetKeyword || kind === K.ConstKeyword || kind === K.VarKeyword) {
            const idxs = collectVarBindings(tokens, i, filter)
            const isTopLevel = bracketDepth[i] === 0
            for (const idx of idxs) {
                declNameIdx.add(idx)
                // A top-level binding IS the cell's own declaration (no shadow); a nested one shadows it.
                if (!isTopLevel)
                    shadows.push({ name: tokenAt(tokens, idx).text, start: i, end: enclClose(i) })
            }
            continue
        }

        if (kind === K.FunctionKeyword) {
            let j = i + 1
            if (tokens[j] && tokenAt(tokens, j).kind === K.AsteriskToken) j++ // generator `*`
            let nameIdx = -1
            if (tokens[j] && isIdentifierLike(tokenAt(tokens, j).kind)) {
                nameIdx = j
                if (filter(tokenAt(tokens, j).text)) {
                    declNameIdx.add(j)
                    if (numberAt(bracketDepth, i) > 0)
                        shadows.push({ name: tokenAt(tokens, j).text, start: i, end: enclClose(i) })
                }
            }
            let p = nameIdx !== -1 ? nameIdx + 1 : j
            while (p < n && tokenAt(tokens, p).kind !== K.OpenParenToken) p++
            if (p < n && tokenAt(tokens, p).kind === K.OpenParenToken) {
                const close = matchClose.get(p)
                if (close !== undefined) {
                    const params = collectParamBindings(tokens, p, close, filter)
                    let b = close + 1
                    while (b < n && tokenAt(tokens, b).kind !== K.OpenBraceToken) b++
                    if (b < n && tokenAt(tokens, b).kind === K.OpenBraceToken) {
                        const bclose = matchClose.get(b) ?? n - 1
                        for (const pidx of params) {
                            declNameIdx.add(pidx)
                            shadows.push({
                                name: tokenAt(tokens, pidx).text,
                                start: b,
                                end: bclose,
                            })
                        }
                    } else {
                        for (const pidx of params) declNameIdx.add(pidx)
                    }
                }
            }
            continue
        }

        if (kind === K.ClassKeyword) {
            const j = i + 1
            if (
                tokens[j] &&
                isIdentifierLike(tokenAt(tokens, j).kind) &&
                filter(tokenAt(tokens, j).text)
            ) {
                declNameIdx.add(j)
                if (numberAt(bracketDepth, i) > 0)
                    shadows.push({ name: tokenAt(tokens, j).text, start: i, end: enclClose(i) })
            }
            continue
        }

        if (kind === K.EqualsGreaterThanToken) {
            const prev = i > 0 ? tokenAt(tokens, i - 1) : undefined
            let params: number[] = []
            if (prev) {
                if (prev.kind === K.CloseParenToken) {
                    const open = matchOpen.get(i - 1)
                    if (open !== undefined)
                        params = collectParamBindings(tokens, open, i - 1, filter)
                } else if (isIdentifierLike(prev.kind) && filter(prev.text)) {
                    params = [i - 1]
                }
            }
            const bodyStart = i + 1
            let bodyEnd: number
            if (tokens[bodyStart] && tokenAt(tokens, bodyStart).kind === K.OpenBraceToken) {
                bodyEnd = matchClose.get(bodyStart) ?? n - 1
            } else {
                bodyEnd = arrowExprEnd(tokens, bodyStart)
            }
            for (const pidx of params) {
                declNameIdx.add(pidx)
                shadows.push({ name: tokenAt(tokens, pidx).text, start: bodyStart, end: bodyEnd })
            }
        }
    }

    return { declNameIdx, shadows }
}

// Is token `idx` (an identifier `name`) inside a scope that shadows the same-named outer binding?
function isShadowed(shadows: ShadowScope[], name: string, idx: number): boolean {
    for (const scope of shadows) {
        if (scope.name === name && idx >= scope.start && idx <= scope.end) return true
    }
    return false
}

// ---------------------------------------------------------------------------
// rewriteCellRefs — the crux
// ---------------------------------------------------------------------------

// Extent of an assignment/compound RHS starting at token `start`; returns the last RHS token index.
// Stops at a depth-0 comma/semicolon, an enclosing bracket close, or a statement-boundary line break.
function rhsExtent(tokens: Tok[], start: number): number {
    let depth = 0
    let last = start
    for (let j = start; j < tokens.length; j++) {
        const t = tokenAt(tokens, j)
        const kind = t.kind
        if (depth === 0) {
            if (kind === K.CommaToken || kind === K.SemicolonToken) return j > start ? j - 1 : start
            if (t.nl && j > start) return j - 1
        }
        if (isOpen(kind)) depth++
        else if (isClose(kind)) {
            if (depth === 0) return j > start ? j - 1 : start
            depth--
        }
        last = j
    }
    return last
}

export function rewriteCellRefs(code: string, cellNames: Set<string>): string {
    if (cellNames.size === 0) return code
    const tokens = tokenize(code)
    if (tokens.length === 0) return code
    const braces = analyzeBraces(tokens)
    const { enclBraceOpen, isObjectBrace } = braces
    const { declNameIdx, shadows } = buildScopes(tokens, braces, (name) => cellNames.has(name))

    // Is `tokens[i]` (a cell-named Identifier) a genuine reference we should rewrite?
    const isCellRef = (i: number): boolean => {
        const prev = i > 0 ? tokenAt(tokens, i - 1).kind : undefined
        if (prev === K.DotToken || prev === K.QuestionDotToken) return false // member/property access
        if (declNameIdx.has(i)) return false // declaration / parameter name
        if (isShadowed(shadows, tokenAt(tokens, i).text, i)) return false
        return true
    }

    // Object-literal property key or method name (`{ n: … }`, `{ n() {} }`) — not a reference.
    const isObjectKey = (i: number): boolean => {
        const encl = numberAt(enclBraceOpen, i)
        if (encl === -1 || !isObjectBrace.has(encl)) return false
        const prev = i > 0 ? tokenAt(tokens, i - 1).kind : undefined
        if (prev !== K.OpenBraceToken && prev !== K.CommaToken) return false // property position only
        const next = tokens[i + 1]?.kind
        return next === K.ColonToken || next === K.OpenParenToken
    }

    // Object-literal shorthand (`{ n }`, `{ a, n }`) — a READ, rewritten to `n: n.read()`.
    const isObjectShorthand = (i: number): boolean => {
        const encl = numberAt(enclBraceOpen, i)
        if (encl === -1 || !isObjectBrace.has(encl)) return false
        const prev = i > 0 ? tokenAt(tokens, i - 1).kind : undefined
        if (prev !== K.OpenBraceToken && prev !== K.CommaToken) return false
        const next = tokens[i + 1]?.kind
        return next === K.CommaToken || next === K.CloseBraceToken
    }

    let out = ''
    let cursor = 0
    let seq = 0
    interface PendingClose {
        pos: number
        text: string
        seq: number
    }
    const pending: PendingClose[] = []

    // Copy source up to `upto`, injecting any scheduled close-parens at their source positions (inner
    // closes — higher seq at equal position — emitted first, so nesting stays balanced).
    const flush = (upto: number): void => {
        for (;;) {
            let bestIndex = -1
            let best: PendingClose | undefined
            for (const [k, c] of pending.entries()) {
                if (c.pos > upto) continue
                if (
                    best === undefined ||
                    c.pos < best.pos ||
                    (c.pos === best.pos && c.seq > best.seq)
                ) {
                    bestIndex = k
                    best = c
                }
            }
            if (best === undefined) break
            if (best.pos > cursor) {
                out += code.slice(cursor, best.pos)
                cursor = best.pos
            }
            out += best.text
            pending.splice(bestIndex, 1)
        }
        if (upto > cursor) {
            out += code.slice(cursor, upto)
            cursor = upto
        }
    }

    let i = 0
    while (i < tokens.length) {
        const t = tokenAt(tokens, i)
        const kind = t.kind

        // Prefix `++n` / `--n` targeting a cell.
        if (kind === K.PlusPlusToken || kind === K.MinusMinusToken) {
            const prev = i > 0 ? tokenAt(tokens, i - 1).kind : undefined
            const isPrefix = prev === undefined || !VALUE_END.has(prev)
            const next = tokens[i + 1]
            if (
                isPrefix &&
                next &&
                next.kind === K.Identifier &&
                cellNames.has(next.text) &&
                isCellRef(i + 1)
            ) {
                flush(t.start)
                const name = next.text
                const op = kind === K.PlusPlusToken ? '+' : '-'
                out += `${name}.write(${name}.read() ${op} 1)`
                cursor = next.end
                i += 2
                continue
            }
            i++
            continue
        }

        if (kind === K.Identifier && cellNames.has(t.text) && isCellRef(i)) {
            const name = t.text
            const next = tokens[i + 1]
            const nextKind = next?.kind

            if (isObjectKey(i)) {
                i++
                continue
            }

            if (isObjectShorthand(i)) {
                flush(t.start)
                out += `${name}: ${name}.read()`
                cursor = t.end
                i++
                continue
            }

            if (next !== undefined && next.kind === K.EqualsToken) {
                // `n = rhs` → `n.write(rhs)`
                flush(t.start)
                out += `${name}.write(`
                const end = rhsExtent(tokens, i + 2)
                pending.push({ pos: tokenAt(tokens, end).end, text: ')', seq: seq++ })
                cursor = next.end // skip `n` and `=`
                i += 2
                continue
            }

            if (next !== undefined && COMPOUND_OP.has(next.kind)) {
                // `n op= rhs` → `n.write(n.read() op (rhs))`
                flush(t.start)
                const op = COMPOUND_OP.get(next.kind)
                if (op === undefined) throw new Error('analyzeScope: missing compound operator')
                out += `${name}.write(${name}.read() ${op} (`
                const end = rhsExtent(tokens, i + 2)
                pending.push({ pos: tokenAt(tokens, end).end, text: '))', seq: seq++ })
                cursor = next.end
                i += 2
                continue
            }

            if (nextKind === K.GreaterThanToken) {
                // The scanner splits `>>=` / `>>>=` into single `>` tokens (generic/JSX support). Detect a
                // run of 2–3 `>` followed by `=` as a shift compound-assignment.
                let run = i + 1
                while (tokens[run] && tokenAt(tokens, run).kind === K.GreaterThanToken) run++
                const count = run - (i + 1)
                if (
                    (count === 2 || count === 3) &&
                    tokens[run] &&
                    tokenAt(tokens, run).kind === K.EqualsToken
                ) {
                    flush(t.start)
                    const op = count === 2 ? '>>' : '>>>'
                    out += `${name}.write(${name}.read() ${op} (`
                    const end = rhsExtent(tokens, run + 1)
                    pending.push({ pos: tokenAt(tokens, end).end, text: '))', seq: seq++ })
                    cursor = tokenAt(tokens, run).end // skip `n`, the `>` run, and `=`
                    i = run + 1
                    continue
                }
            }

            if (
                next !== undefined &&
                (next.kind === K.PlusPlusToken || next.kind === K.MinusMinusToken)
            ) {
                // postfix `n++` / `n--`
                flush(t.start)
                const op = next.kind === K.PlusPlusToken ? '+' : '-'
                out += `${name}.write(${name}.read() ${op} 1)`
                cursor = next.end
                i += 2
                continue
            }

            // plain read
            flush(t.start)
            out += `${name}.read()`
            cursor = t.end
            i++
            continue
        }

        i++
    }

    flush(code.length)
    return out
}

// ---------------------------------------------------------------------------
// Type-position operand marking (TODO #11 / #18 follow-up)
// ---------------------------------------------------------------------------
//
// `#18` taught the free-identifier passes NOT to misread the OPERATOR keywords `as`/`satisfies`, but
// the type OPERAND that FOLLOWS them (`x as Foo` → `x as $scope.Foo`) was still rewritten — producing
// intermediate TS that is not type-valid. It is harmless at runtime (Bun strips type annotations
// syntactically before resolution, and `emitCheck` is a separate verbatim-copy path), but it is a
// tracked shortcut. `markTypeSkips` walks each `as`/`satisfies` type operand and returns the token
// indices that live in TYPE position, so both free-identifier passes leave them alone.
//
// SAFETY INVARIANT: the scanner only ever ADDS an index it can prove is in type position, and STOPS at
// the first token it cannot classify as type-continuation. It can therefore only ever UNDER-mark
// (leaving today's harmless residue) — it can never mask a real VALUE identifier that must stay
// rewritten (e.g. `a`/`b` in `x as Foo ? a : b`, where the type is just `Foo` and the ternary arms are
// values). Bracketed/scalar atoms only advance the cursor; the recursion never crosses a `?`/`:`/`,`
// or any operator that is not a type-continuation (`|`/`&`).

// Number of `>` a closing-angle token contributes (composite `>>`/`>>>` close nested generics); 0 when
// the token is not a bare closer (e.g. `>=`, `>>=`) → the angle scan bails conservatively.
function greaterArity(kind: SyntaxKind): number {
    if (kind === K.GreaterThanToken) return 1
    if (kind === K.GreaterThanGreaterThanToken) return 2
    if (kind === K.GreaterThanGreaterThanGreaterThanToken) return 3
    return 0
}

// Keyword operators that may LEAD a type (`keyof T`, `readonly T[]`, `infer U`, `typeof x`, `unique
// symbol`, `new () => T`). `typeof`'s operand is a value name but is still type-position (stripped).
const LEADING_TYPE_OPS: Set<SyntaxKind> = new Set([
    K.KeyOfKeyword,
    K.ReadonlyKeyword,
    K.InferKeyword,
    K.TypeOfKeyword,
    K.UniqueKeyword,
    K.NewKeyword,
])

// Non-identifier tokens that stand alone as a type atom (advance-only, nothing to mark): the primitive
// keyword types that DON'T double as value identifiers, plus literal types.
const SCALAR_TYPE_ATOMS: Set<SyntaxKind> = new Set([
    K.VoidKeyword,
    K.NullKeyword,
    K.UndefinedKeyword,
    K.TrueKeyword,
    K.FalseKeyword,
    K.ThisKeyword,
    K.StringLiteral,
    K.NumericLiteral,
    K.BigIntLiteral,
    K.NoSubstitutionTemplateLiteral,
])

// Mark every identifier-like token inside a balanced `(`/`{`/`[` … region as type position. Only called
// on regions already known to be type context (inside an `as`/`satisfies` operand), where identifiers
// are type names / property keys / type params — never runtime values.
function markInner(tokens: Tok[], open: number, close: number, skip: Set<number>): void {
    for (let j = open + 1; j < close; j++) {
        if (isIdentifierLike(tokenAt(tokens, j).kind)) skip.add(j)
    }
}

// Scan a balanced generic argument list `< … >` starting at `openIdx` (a `<`). Returns the index just
// past the matching close, or -1 when it cannot match cleanly (caller then leaves the `<…` unmarked).
function scanAngle(
    tokens: Tok[],
    openIdx: number,
    matchClose: Map<number, number>,
    skip: Set<number>,
): number {
    let depth = 0
    for (let i = openIdx; i < tokens.length; i++) {
        const k = tokenAt(tokens, i).kind
        if (k === K.LessThanToken) {
            depth++
            continue
        }
        const arity = greaterArity(k)
        if (arity > 0) {
            depth -= arity
            if (depth <= 0) return i + 1
            continue
        }
        if (isIdentifierLike(k)) {
            skip.add(i)
            continue
        }
        // Balanced () / [] / {} inside a generic — jump over them (still type context).
        if (k === K.OpenParenToken || k === K.OpenBracketToken || k === K.OpenBraceToken) {
            const close = matchClose.get(i)
            if (close === undefined) return -1
            markInner(tokens, i, close, skip)
            i = close
            continue
        }
        // Structural type tokens legal inside a generic argument (unions, conditionals, function types, …).
        if (
            k === K.DotToken ||
            k === K.CommaToken ||
            k === K.BarToken ||
            k === K.AmpersandToken ||
            k === K.EqualsGreaterThanToken ||
            k === K.QuestionToken ||
            k === K.ColonToken ||
            k === K.ExtendsKeyword ||
            k === K.DotDotDotToken ||
            LEADING_TYPE_OPS.has(k) ||
            SCALAR_TYPE_ATOMS.has(k)
        ) {
            continue
        }
        return -1 // anything else — bail rather than risk running away past the type.
    }
    return -1
}

// Scan ONE type atom (name/qualified/generic/array, a bracketed/object/tuple type, or a scalar/literal)
// starting at `start`. Returns the index just past the atom, or -1 when the token at `start` is not a
// recognizable type atom (caller stops — never marking beyond what it is sure of).
function scanTypeAtom(
    tokens: Tok[],
    start: number,
    matchClose: Map<number, number>,
    skip: Set<number>,
): number {
    let i = start
    // Leading type operators (`keyof`/`readonly`/`infer`/`typeof`/`unique`/`new`). Some (`readonly`,
    // `unique`) tokenize as identifier-like contextual keywords, so mark them too or they'd be rewritten.
    while (i < tokens.length && LEADING_TYPE_OPS.has(tokenAt(tokens, i).kind)) {
        if (isIdentifierLike(tokenAt(tokens, i).kind)) skip.add(i)
        i++
    }
    const k = tokens[i]?.kind
    if (k === undefined) return -1

    if (isIdentifierLike(k)) {
        skip.add(i)
        i++
        // Qualified name `A.B.C`.
        while (
            tokens[i]?.kind === K.DotToken &&
            tokens[i + 1] &&
            isIdentifierLike(tokenAt(tokens, i + 1).kind)
        ) {
            skip.add(i + 1)
            i += 2
        }
        // Generic arguments `Foo<…>`.
        if (tokens[i]?.kind === K.LessThanToken) {
            const after = scanAngle(tokens, i, matchClose, skip)
            if (after < 0) return i // couldn't match — stop cleanly before the `<`.
            i = after
        }
        // Postfix array / indexed access `Foo[]`, `Foo['x']`, `Foo[K]`.
        while (tokens[i]?.kind === K.OpenBracketToken) {
            const close = matchClose.get(i)
            if (close === undefined) break
            markInner(tokens, i, close, skip)
            i = close + 1
        }
        return i
    }

    // Parenthesized / function / object / tuple type — mark inner type names, then continue.
    if (k === K.OpenParenToken || k === K.OpenBraceToken || k === K.OpenBracketToken) {
        const close = matchClose.get(i)
        if (close === undefined) return -1
        markInner(tokens, i, close, skip)
        i = close + 1
        // Function type `(…) => ReturnType` — recurse for the return type.
        if (tokens[i]?.kind === K.EqualsGreaterThanToken) {
            const after = scanTypeAtom(tokens, i + 1, matchClose, skip)
            if (after > 0) i = after
        }
        return i
    }

    if (SCALAR_TYPE_ATOMS.has(k)) {
        i++
        while (tokens[i]?.kind === K.OpenBracketToken) {
            const close = matchClose.get(i)
            if (close === undefined) break
            markInner(tokens, i, close, skip)
            i = close + 1
        }
        return i
    }

    return -1
}

// Mark the full type operand (a chain of atoms joined by `|`/`&`) that begins at `start`.
function scanTypeOperand(
    tokens: Tok[],
    start: number,
    matchClose: Map<number, number>,
    skip: Set<number>,
): void {
    let i = start
    for (;;) {
        const after = scanTypeAtom(tokens, i, matchClose, skip)
        if (after < 0) return
        const next = tokens[after]?.kind
        if (next === K.BarToken || next === K.AmpersandToken) {
            i = after + 1 // union / intersection stays in type position
            continue
        }
        return
    }
}

// The token indices that belong to a TYPE (the operand of an `as`/`satisfies`) — skipped by the
// free-identifier passes so a type name is never rewritten to `$scope.<name>`.
function markTypeSkips(tokens: Tok[], matchClose: Map<number, number>): Set<number> {
    const skip = new Set<number>()
    for (let i = 0; i < tokens.length; i++) {
        const k = tokenAt(tokens, i).kind
        if (k === K.AsKeyword || k === K.SatisfiesKeyword)
            scanTypeOperand(tokens, i + 1, matchClose, skip)
    }
    return skip
}

// ---------------------------------------------------------------------------
// rewriteFreeIdentifiers (Stage 1, PR3) — member-access-safe `x` → `$scope.x`
// ---------------------------------------------------------------------------

// Rewrite every FREE identifier in a template expression to `<scopeVar>.<name>` so the emitted client
// thunk / server string reads it off the merged scope object at the reference site (preserving
// getter-backed reactivity). Skips: declared script bindings, JS globals, member/property accesses,
// object-literal keys, and identifiers bound locally within the expression (arrow/function params,
// nested lets). Object-literal shorthand (`{ x }`) referencing a free identifier expands to
// `{ x: <scopeVar>.x }`. Built on the same scanner passes as `rewriteCellRefs` / `collectFreeIdentifiers`.
export function rewriteFreeIdentifiers(
    code: string,
    declared: Set<string>,
    scopeVar: string,
): string {
    const tokens = tokenize(code)
    if (tokens.length === 0) return code
    const braces = analyzeBraces(tokens)
    const { enclBraceOpen, isObjectBrace } = braces
    const { declNameIdx, shadows } = buildScopes(tokens, braces, () => true)
    const typeSkips = markTypeSkips(tokens, braces.matchClose)

    let out = ''
    let cursor = 0
    for (let i = 0; i < tokens.length; i++) {
        const t = tokenAt(tokens, i)
        if (!isIdentifierLike(t.kind)) continue
        if (typeSkips.has(i)) continue // type operand of `as`/`satisfies` — not a value reference
        const name = t.text
        if (declared.has(name)) continue
        if (GLOBALS.has(name)) continue
        const prev = i > 0 ? tokenAt(tokens, i - 1).kind : undefined
        if (prev === K.DotToken || prev === K.QuestionDotToken) continue // member access
        if (declNameIdx.has(i)) continue // local binding name
        if (isShadowed(shadows, name, i)) continue // shadowed by a local binding
        const encl = numberAt(enclBraceOpen, i)
        const inObjectPosition =
            encl !== -1 &&
            isObjectBrace.has(encl) &&
            (prev === K.OpenBraceToken || prev === K.CommaToken)
        if (inObjectPosition) {
            const next = tokens[i + 1]?.kind
            if (next === K.ColonToken || next === K.OpenParenToken) continue // property key / method name
            if (next === K.CommaToken || next === K.CloseBraceToken) {
                // shorthand `{ x }` → `{ x: $scope.x }`
                out += code.slice(cursor, t.start)
                out += `${name}: ${scopeVar}.${name}`
                cursor = t.end
                continue
            }
        }
        out += code.slice(cursor, t.start)
        out += `${scopeVar}.${name}`
        cursor = t.end
    }
    out += code.slice(cursor)
    return out
}

// ---------------------------------------------------------------------------
// collectFreeIdentifiers
// ---------------------------------------------------------------------------

export function collectFreeIdentifiers(expr: string, declared: Set<string>): Set<string> {
    const result = new Set<string>()
    const tokens = tokenize(expr)
    if (tokens.length === 0) return result
    const braces = analyzeBraces(tokens)
    const { enclBraceOpen, isObjectBrace } = braces
    // Track ALL local bindings (params, nested lets) so locals are not reported as free.
    const { declNameIdx, shadows } = buildScopes(tokens, braces, () => true)
    const typeSkips = markTypeSkips(tokens, braces.matchClose)

    for (let i = 0; i < tokens.length; i++) {
        const t = tokenAt(tokens, i)
        if (!isIdentifierLike(t.kind)) continue
        if (typeSkips.has(i)) continue // type operand of `as`/`satisfies` — not a value reference
        const prev = i > 0 ? tokenAt(tokens, i - 1).kind : undefined
        if (prev === K.DotToken || prev === K.QuestionDotToken) continue // property access
        // object key (`{ n: … }` / `{ n() {} }`) — not a value reference
        const encl = numberAt(enclBraceOpen, i)
        if (
            encl !== -1 &&
            isObjectBrace.has(encl) &&
            (prev === K.OpenBraceToken || prev === K.CommaToken)
        ) {
            const next = tokens[i + 1]?.kind
            if (next === K.ColonToken || next === K.OpenParenToken) continue
        }
        if (declNameIdx.has(i)) continue // local binding name
        if (isShadowed(shadows, t.text, i)) continue // shadowed by a local binding
        if (declared.has(t.text)) continue
        if (GLOBALS.has(t.text)) continue
        result.add(t.text)
    }
    return result
}

// ---------------------------------------------------------------------------
// analyzeScope — top-level `<script>` walk (imports, cells, bindings, setup code)
// ---------------------------------------------------------------------------

// The following small string helpers mirror `transformScript.ts`. They are duplicated here rather than
// imported because PR2 only ADDS files (it must not modify `transformScript.ts`); the behaviour is
// identical.

function splitTopLevelCommas(text: string): string[] {
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let index = 0; index < text.length; index++) {
        const char = text[index]
        if (char === '{' || char === '[' || char === '(') depth++
        else if (char === '}' || char === ']' || char === ')') depth--
        else if (char === ',' && depth === 0) {
            parts.push(text.slice(start, index))
            start = index + 1
        }
    }
    parts.push(text.slice(start))
    return parts
}

function topLevelIndexOf(text: string, target: string): number {
    let depth = 0
    for (let index = 0; index < text.length; index++) {
        const char = text[index]
        if (char === '{' || char === '[' || char === '(') depth++
        else if (char === '}' || char === ']' || char === ')') depth--
        else if (depth === 0 && char === target) return index
    }
    return -1
}

export function extractBindingNames(pattern: string): string[] {
    const trimmed = pattern.trim()
    if (trimmed === '') return []
    const isDestructure = trimmed.startsWith('{') || trimmed.startsWith('[')
    if (!isDestructure) {
        const match = trimmed.match(/^[A-Za-z_$][\w$]*/)?.[0]
        return match !== undefined ? [match] : []
    }
    const inner = trimmed.slice(1, -1)
    const names: string[] = []
    for (let part of splitTopLevelCommas(inner)) {
        part = part.trim()
        if (part === '') continue
        if (part.startsWith('...')) part = part.slice(3).trim()
        const equalsIndex = topLevelIndexOf(part, '=')
        if (equalsIndex !== -1) part = part.slice(0, equalsIndex).trim()
        const colonIndex = topLevelIndexOf(part, ':')
        if (colonIndex !== -1) part = part.slice(colonIndex + 1).trim()
        if (part.startsWith('{') || part.startsWith('[')) {
            names.push(...extractBindingNames(part))
            continue
        }
        const match = part.match(/^[A-Za-z_$][\w$]*/)?.[0]
        if (match !== undefined) names.push(match)
    }
    return names
}

function isSimpleIdentifier(pattern: string): boolean {
    return /^[A-Za-z_$][\w$]*$/.test(pattern.trim())
}

function parseImport(rawText: string): ImportBinding | null {
    const specifierMatch = rawText.match(/from\s*['"]([^'"]+)['"]/)
    if (!specifierMatch) return null
    const specifier = specifierMatch[1]
    if (specifier === undefined) return null
    const clause = rawText
        .slice(rawText.indexOf('import') + 'import'.length, specifierMatch.index)
        .trim()
    const binding: ImportBinding = {
        specifier,
        defaultLocal: null,
        namespaceLocal: null,
        named: [],
    }

    const namespaceLocal = clause.match(/\*\s*as\s+([A-Za-z_$][\w$]*)/)?.[1]
    if (namespaceLocal !== undefined) binding.namespaceLocal = namespaceLocal

    const bracedInner = clause.match(/\{([^}]*)\}/)?.[1]
    if (bracedInner !== undefined) {
        for (const entry of bracedInner.split(',')) {
            const trimmed = entry.trim()
            if (trimmed === '') continue
            const asMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
            const imported = asMatch?.[1]
            const local = asMatch?.[2]
            if (imported !== undefined && local !== undefined)
                binding.named.push({ imported, local })
            else binding.named.push({ imported: trimmed, local: trimmed })
        }
    }

    const beforeBrace = clause.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+[A-Za-z_$][\w$]*/, '')
    const defaultLocal = beforeBrace.match(/^\s*([A-Za-z_$][\w$]*)\s*,?/)?.[1]
    if (defaultLocal !== undefined && defaultLocal !== '') binding.defaultLocal = defaultLocal

    return binding
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Recognise a cell initializer (`state(...)`, `state.computed(...)`, `state.linked(...)`) where
// `stateLocal` is the local name bound to the `abide/ui/state` import.
function cellKind(init: string, stateLocal: string): 'state' | 'computed' | 'linked' | null {
    const esc = escapeRegExp(stateLocal)
    if (new RegExp(`^${esc}\\s*\\.\\s*computed\\s*\\(`).test(init)) return 'computed'
    if (new RegExp(`^${esc}\\s*\\.\\s*linked\\s*\\(`).test(init)) return 'linked'
    // `state.shared(key, initial)` is a writable cell — treated like `state(...)` for the read/write
    // reference rewrite; its cross-instance/cross-tab sharing is a pure runtime concern.
    if (new RegExp(`^${esc}\\s*\\.\\s*shared\\s*\\(`).test(init)) return 'state'
    if (new RegExp(`^${esc}\\s*\\(`).test(init)) return 'state'
    return null
}

function isPropsInit(init: string, propsLocal: string): boolean {
    return new RegExp(`^${escapeRegExp(propsLocal)}\\s*\\(`).test(init)
}

type StatementRecord =
    | {
          kind: 'import'
          binding: ImportBinding | null
          cssSpecifier: string | null
          stripStart: number
          stripEnd: number
      }
    | { kind: 'var'; rawDeclarators: string }
    | { kind: 'func'; name: string | null }

// A side-effect import (`import "spec";` — no `from`, no bindings) whose specifier ends in `.css`.
// Returns the specifier, or null if the text isn't a `.css`-side-effect import.
function cssSideEffectSpecifier(rawText: string): string | null {
    const specifier = rawText.match(/^\s*import\s*['"]([^'"]+)['"]/)?.[1]
    if (specifier === undefined) return null
    return specifier.endsWith('.css') ? specifier : null
}

// Walk the top-level statements of a script body: parse imports (recording their source ranges for
// stripping), capture `let`/`const`/`var` declarator text, and note `function`/`class` names.
function scanTopLevel(source: string): StatementRecord[] {
    const tokens = tokenize(source)
    const records: StatementRecord[] = []
    const n = tokens.length
    let depth = 0
    let atStart = true
    let i = 0

    // Scan forward from statement-keyword index `kw` to the statement end. Returns the last statement
    // token index and the index to resume at (past any `;`).
    const stmtSpan = (kw: number): { lastIdx: number; nextIdx: number } => {
        let localDepth = 0
        let lastIdx = kw
        for (let p = kw + 1; p < n; p++) {
            const t = tokenAt(tokens, p)
            const kind = t.kind
            if (localDepth === 0 && t.nl) return { lastIdx, nextIdx: p }
            if (localDepth === 0 && kind === K.SemicolonToken) return { lastIdx, nextIdx: p + 1 }
            if (isOpen(kind)) localDepth++
            else if (isClose(kind)) localDepth--
            lastIdx = p
        }
        return { lastIdx, nextIdx: n }
    }

    const blockBodyEnd = (kw: number): number => {
        let localDepth = 0
        let seenBody = false
        for (let p = kw + 1; p < n; p++) {
            const kind = tokenAt(tokens, p).kind
            if (isOpen(kind)) {
                localDepth++
                if (kind === K.OpenBraceToken && localDepth === 1) seenBody = true
            } else if (isClose(kind)) {
                localDepth--
                if (seenBody && localDepth === 0) return p + 1
            }
        }
        return n
    }

    while (i < n) {
        const t = tokenAt(tokens, i)
        const kind = t.kind
        if (depth === 0 && t.nl) atStart = true

        if (depth === 0 && atStart) {
            if (kind === K.AsyncKeyword) {
                i++
                continue
            }
            if (kind === K.ExportKeyword) {
                i++
                atStart = true
                continue
            }
            if (kind === K.ImportKeyword) {
                const { lastIdx, nextIdx } = stmtSpan(i)
                const rawText = source.slice(t.start, tokenAt(tokens, lastIdx).end)
                const terminator =
                    nextIdx > 0 &&
                    nextIdx <= n &&
                    tokens[nextIdx - 1] &&
                    tokenAt(tokens, nextIdx - 1).kind === K.SemicolonToken
                const stripEnd = terminator
                    ? tokenAt(tokens, nextIdx - 1).end
                    : tokenAt(tokens, lastIdx).end
                const binding = parseImport(rawText)
                const cssSpecifier = binding === null ? cssSideEffectSpecifier(rawText) : null
                records.push({
                    kind: 'import',
                    binding,
                    cssSpecifier,
                    stripStart: t.start,
                    stripEnd,
                })
                i = nextIdx
                atStart = true
                continue
            }
            if (kind === K.LetKeyword || kind === K.ConstKeyword || kind === K.VarKeyword) {
                const { lastIdx, nextIdx } = stmtSpan(i)
                const rawDeclarators = source.slice(t.end, tokenAt(tokens, lastIdx).end)
                records.push({ kind: 'var', rawDeclarators })
                i = nextIdx
                atStart = true
                continue
            }
            if (kind === K.FunctionKeyword || kind === K.ClassKeyword) {
                let j = i + 1
                if (tokens[j] && tokenAt(tokens, j).kind === K.AsteriskToken) j++
                const name =
                    tokens[j] && isIdentifierLike(tokenAt(tokens, j).kind)
                        ? tokenAt(tokens, j).text
                        : null
                records.push({ kind: 'func', name })
                i = blockBodyEnd(i)
                atStart = true
                continue
            }
        }

        if (isOpen(kind)) depth++
        else if (isClose(kind)) depth--
        atStart = depth === 0 && (kind === K.SemicolonToken || kind === K.CloseBraceToken)
        i++
    }

    return records
}

interface RawScript {
    imports: ImportBinding[]
    bindings: Binding[]
    cells: Set<string>
    declared: Set<string>
    cssImports: string[]
    componentImports: ComponentImport[]
    moduleImports: ImportBinding[]
    strippedCode: string
}

function localForSpecifier(
    imports: ImportBinding[],
    specifier: string,
    importedName: string,
    fallback: string,
): string {
    for (const binding of imports) {
        if (binding.specifier !== specifier) continue
        for (const entry of binding.named) {
            if (entry.imported === importedName) return entry.local
        }
        if (binding.defaultLocal !== null) return binding.defaultLocal
        if (binding.namespaceLocal !== null) return binding.namespaceLocal
    }
    return fallback
}

function analyzeScript(content: string): RawScript {
    const records = scanTopLevel(content)
    const imports: ImportBinding[] = []
    const cssImports: string[] = []
    const componentImports: ComponentImport[] = []
    const moduleImports: ImportBinding[] = []
    const stripRanges: [number, number][] = []
    for (const record of records) {
        if (record.kind === 'import') {
            stripRanges.push([record.stripStart, record.stripEnd])
            if (record.binding) {
                imports.push(record.binding)
                if (
                    record.binding.specifier.endsWith('.abide') &&
                    record.binding.defaultLocal !== null
                ) {
                    componentImports.push({
                        local: record.binding.defaultLocal,
                        specifier: record.binding.specifier,
                    })
                } else if (isPassThroughImport(record.binding.specifier)) {
                    moduleImports.push(record.binding)
                }
            } else if (record.cssSpecifier !== null) cssImports.push(record.cssSpecifier)
        }
    }

    const stateLocal = localForSpecifier(imports, 'abide/ui/state', 'state', 'state')
    const propsLocal = localForSpecifier(imports, 'abide/ui/props', 'props', 'props')

    const bindings: Binding[] = []
    const cells = new Set<string>()
    const declared = new Set<string>()

    for (const record of records) {
        if (record.kind === 'import') {
            const binding = record.binding
            if (!binding) continue
            if (binding.defaultLocal !== null) {
                bindings.push({ name: binding.defaultLocal, kind: 'import' })
                declared.add(binding.defaultLocal)
            }
            if (binding.namespaceLocal !== null) {
                bindings.push({ name: binding.namespaceLocal, kind: 'import' })
                declared.add(binding.namespaceLocal)
            }
            for (const entry of binding.named) {
                bindings.push({ name: entry.local, kind: 'import' })
                declared.add(entry.local)
            }
            continue
        }

        if (record.kind === 'func') {
            if (record.name) {
                bindings.push({ name: record.name, kind: 'function' })
                declared.add(record.name)
            }
            continue
        }

        // var / let / const
        for (const declarator of splitTopLevelCommas(record.rawDeclarators)) {
            const equalsIndex = topLevelIndexOf(declarator, '=')
            const pattern = (
                equalsIndex === -1 ? declarator : declarator.slice(0, equalsIndex)
            ).trim()
            const init = equalsIndex === -1 ? '' : declarator.slice(equalsIndex + 1).trim()
            if (pattern === '') continue
            const names = extractBindingNames(pattern)
            let kind: BindingKind = 'const'
            if (isSimpleIdentifier(pattern)) {
                const cell = cellKind(init, stateLocal)
                if (cell) {
                    kind = cell
                    cells.add(pattern)
                } else if (isPropsInit(init, propsLocal)) {
                    kind = 'prop'
                }
            } else if (isPropsInit(init, propsLocal)) {
                kind = 'prop'
            }
            for (const name of names) {
                bindings.push({ name, kind })
                declared.add(name)
            }
        }
    }

    // Strip import statements from the body (descending ranges so indices stay valid).
    let strippedCode = content
    stripRanges.sort((a, b) => b[0] - a[0])
    for (const [start, end] of stripRanges) {
        strippedCode = strippedCode.slice(0, start) + strippedCode.slice(end)
    }

    return {
        imports,
        bindings,
        cells,
        declared,
        cssImports,
        componentImports,
        moduleImports,
        strippedCode,
    }
}

export function analyzeScope(root: Root): ScopeAnalysis {
    const moduleRaw = root.moduleScript ? analyzeScript(root.moduleScript.content) : null
    const instanceRaw = root.instanceScript ? analyzeScript(root.instanceScript.content) : null

    const cellNames = new Set<string>()
    const declared = new Set<string>()
    for (const raw of [moduleRaw, instanceRaw]) {
        if (!raw) continue
        for (const name of raw.cells) cellNames.add(name)
        for (const name of raw.declared) declared.add(name)
    }

    // Module setup can only reference module cells; instance setup can reference both (module bindings
    // are in scope for the instance).
    const module: ScriptInfo | null = moduleRaw
        ? {
              setupCode: rewriteCellRefs(moduleRaw.strippedCode, moduleRaw.cells),
              imports: moduleRaw.imports,
              bindings: moduleRaw.bindings,
              cssImports: moduleRaw.cssImports,
          }
        : null
    const instance: ScriptInfo | null = instanceRaw
        ? {
              setupCode: rewriteCellRefs(instanceRaw.strippedCode, cellNames),
              imports: instanceRaw.imports,
              bindings: instanceRaw.bindings,
              cssImports: instanceRaw.cssImports,
          }
        : null

    const cssImports: string[] = []
    if (module !== null) for (const spec of module.cssImports) cssImports.push(spec)
    if (instance !== null) for (const spec of instance.cssImports) cssImports.push(spec)

    const componentImports: ComponentImport[] = []
    if (moduleRaw !== null) for (const c of moduleRaw.componentImports) componentImports.push(c)
    if (instanceRaw !== null) for (const c of instanceRaw.componentImports) componentImports.push(c)

    const moduleImports: ImportBinding[] = []
    if (moduleRaw !== null) for (const m of moduleRaw.moduleImports) moduleImports.push(m)
    if (instanceRaw !== null) for (const m of instanceRaw.moduleImports) moduleImports.push(m)

    return { module, instance, cellNames, declared, cssImports, componentImports, moduleImports }
}
