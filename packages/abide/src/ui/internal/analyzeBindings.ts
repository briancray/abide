// `.abide` `<script>` BINDING ANALYSIS + CELL-REFERENCE REWRITE (Stage 1, PR2) — BUILD/SERVER-SIDE ONLY.
//
// NAMED FOR BINDINGS, NOT SCOPES (ADR 0026, TODO #32). What this module produces is a COMPILE-TIME
// name→meaning map — which identifiers are cells, which are memos, which are shadowed over which token
// range. It is not a region of execution you enter and leave, and it holds no values, so calling it a
// "scope" made it read as a sibling of the runtime `ReactiveScope`/`EffectScope`/`currentScope` family
// it has nothing to do with. The file's own atoms were already `Binding`/`BindingKind`/`ImportBinding`;
// the collection now matches them.
//
// The emitted `$scope` is a DIFFERENT thing and keeps its name: it is a real runtime object holding
// real values that emitted code reads bindings off, which is the ordinary JS meaning.
//
// This module extends the role of `transformScript.ts`. Where the legacy transform relied on
// `with ($s)` + get/set accessors so a bare `count` proxied an atom, the AOT emitter needs LEXICAL
// identifiers: `let count = state(0)` stays a real binding and EVERY reference is rewritten — read
// `count` → `count()`, write `count = x` → `count.set(x)`. That reference rewrite
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
//   • TS TYPE POSITIONS are excluded from the rewrite by `markTypeSkips` — a cell name in a type is a
//     type name, not a read. See that function for the entry points it covers and the one it does not.
//   NOT supported (best-effort, documented): destructuring binding patterns (`const {n} = …`,
//   `({n}) =>`), `catch (n)` bindings, and regex literals (the raw scanner does not re-scan `/…/` —
//   division is fine, regex bodies are not specially protected). Multi-line
//   statement/RHS boundaries follow the same line-break (ASI) heuristic as `transformScript.ts`.

import type { SyntaxKind } from 'typescript/unstable/ast'
import { escapeRegExp } from '../../shared/internal/escapeRegExp.ts'
import type { Root, Script, TemplateNode } from './ast.ts'
import { SCOPE_PROVIDED_SPECIFIERS } from './SCOPE_PROVIDED.ts'
import {
    matchingBracket,
    splitParams,
    topLevelAssignmentIndex,
    topLevelIndexOf,
} from './scanText.ts'
import { childListsOf } from './templateChildren.ts'
import {
    analyzeBraces,
    type BraceInfo,
    isClose,
    isIdentifierLike,
    isOpen,
    isStatementBreak,
    K,
    numberAt,
    rhsExtent,
    statementExtent,
    type Tok,
    tokenAt,
    tokenize,
} from './tokens.ts'
import { markTypeSkips } from './typePositions.ts'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// One import declaration's parsed shape (default, namespace, and named locals). Produced here by the
// binding analysis and consumed by the emitters (`emitSetup`/`emitServer`/`emitClient`).
export interface ImportBinding {
    specifier: string
    defaultLocal: string | null
    namespaceLocal: string | null
    named: { imported: string; local: string }[]
}

export type BindingKind = 'state' | 'memo' | 'const' | 'function' | 'prop' | 'import'

export interface Binding {
    name: string
    kind: BindingKind
    // `let`/`var` (not `const`, not a function/class declaration). Only a REASSIGNABLE plain binding
    // needs a live getter when a nested `<script>` publishes it onto `$scope` — everything else can be
    // copied once, because a cell/memo binding is never rebound (a write lowers to `.set()`).
    reassignable?: boolean
}

// Everything `rewriteCellRefs` needs to decide what a bare identifier MEANS (ADR 0024 §5).
//
// `cells` are writable state cells: a read becomes `n()`, a write becomes `n.set(x)`.
// `memos` are auto-called memos: only the BARE reference becomes `m()`. A memo is read-only and carries a
// surface, so `m.live()` / `m.refresh()` / `m.state()` and an explicit `m()` are left alone — reach into
// the VALUE with `{m}` or `{m().field}`.
// There is no dependency-position exception (ADR 0025): a `memo`/`watch` source is ALWAYS a thunk, so
// every identifier inside it is an ordinary read and needs no special casing here.
export interface CellBindings {
    cells: Set<string>
    memos: Set<string>
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

// A `<script>` inside a BLOCK BODY — the branch/iteration-local setup of spec C9.4.
//
// Unlike the root instance script, its bindings cannot stay lexical. Every template level below it is a
// SEPARATE emitted mount function on the client (they are siblings inside `mount`, not nested blocks),
// so a lexical `let` would be invisible one level down. The setup therefore PUBLISHES each binding onto
// the level's own `$scope` child, and every reference in that subtree resolves through it — which costs
// no new rewrite rule: `templatePlan` keeps these names OUT of `declared`, and that alone is what makes
// `rewriteFreeIdentifiers` qualify them as `$scope.x` (while `cells` still adds the `()` read).
export interface NestedScript {
    // The whole preamble, emitter-agnostic: `$scope` alias lines for its non-module imports, the
    // rewritten body, then the lines publishing its bindings onto `$scope`. Both emitters embed this
    // verbatim, having first pointed `$scope` at a fresh child object.
    setupCode: string
    cells: Set<string>
    memos: Set<string>
    // Every name it binds that resolves through `$scope` in its subtree (import locals that became REAL
    // module imports are excluded — those stay lexical and are added to the analysis-wide `declared`).
    names: Set<string>
}

export interface BindingAnalysis {
    module: ScriptInfo | null
    instance: ScriptInfo | null
    // Branch-local `<script>`s, keyed by their AST node so `templatePlan` can pick each up at the level
    // that owns it. Empty for the overwhelmingly common single-root-script component.
    nested: Map<Script, NestedScript>
    // Everything a template-expression rewrite needs: cells, auto-called memos, dependency-position
    // callees. `cells` is the WRITABLE half — what `bind:` and the seeded-state plumbing key on. It was
    // also published as a top-level `cellNames` field "kept as its own field because WRITABILITY is not
    // auto-call", but the two were the SAME `Set` object, so the distinction was in the comment only and
    // no production caller read the alias.
    cellBindings: CellBindings
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
    // The local name `props` was imported under, resolved from the import bindings rather than assumed.
    // The INSTANCE script's wins where both declare one — that is where a component's props are read.
    //
    // Published because the CHECK lane needs the same answer and was guessing at it: `componentDts`
    // matched `/\bprops\s*</` against raw source with a comment conceding "`props` assumed
    // un-aliased", so `import { props as p }` silently degraded a component's props type from its
    // declared shape to the open `Record<string, unknown>` — cross-file prop checking went dark with no
    // diagnostic. The build lane had resolved the local correctly the whole time.
    propsLocal: string
}

// An ordinary import is the DEFAULT: its local stays lexical (`declared`) and both emitters re-emit the
// statement verbatim, with the specifier rewritten to an absolute path (`resolvePassThroughImport`).
// Import a local module, a workspace package, an npm package — no ceremony, no allowlist to be on.
//
// Only two families are held back, and each because the name must resolve to something the importer
// cannot see from where it sits:
//   • SCOPE-PROVIDED primitives — `state`, `props`, `route`, the `abide/server/*` ambients. A component
//     must get the instance bound to THIS render (same scheduler, same request), not a fresh module
//     instance, so the runtime injects them through `$scope`.
//   • SERVER modules — `$server/rpc/*`, `$server/sockets/*`. SSR binds the real callable; the browser
//     gets the generated proxy under the same local (the module swap, rpc-core §6). Bundling the
//     handler into the client is exactly what must not happen.
// Anything else is just a module, and is treated as one. An unresolvable specifier is a BUILD ERROR
// rather than a silent `$scope` read that arrives `undefined` at mount.
const SERVER_MODULE_SPECIFIER = /(^|\/)\$?server\//
function isPassThroughImport(specifier: string): boolean {
    if (specifier.endsWith('.abide') || specifier.endsWith('.css')) return false
    if (SCOPE_PROVIDED_SPECIFIERS.has(specifier)) return false
    if (specifier.startsWith('abide/server/')) return false
    return !SERVER_MODULE_SPECIFIER.test(specifier)
}

// Reconstruct an `import … from "spec";` statement from a parsed binding, faithfully re-expressing
// default / namespace / named (with `as` aliasing) clauses. Used to re-emit pass-through module
// imports as real ES imports in both emitters.
// REWRITE one import's specifier in emitted code. The counterpart to `reconstructImport`, and it lives
// beside it because the two are one rule read in two directions: this must find whatever that wrote.
//
// Three call sites (`emit.ts` twice, `clientBundle.ts` once) each spelled `from "spec"` by hand, which
// cannot match the CLAUSE-LESS form `reconstructImport` emits for a side-effect import — so the moment
// that form became reachable, a bare import would have been written out unrewritten and resolved
// against the wrong base. Matching both spellings is the whole of what this adds over `.replaceAll`.
export function rewriteImportSpecifier(source: string, from: string, to: string): string {
    const quotedFrom = JSON.stringify(from)
    const quotedTo = JSON.stringify(to)
    return source
        .replaceAll(`from ${quotedFrom}`, `from ${quotedTo}`)
        .replaceAll(`import ${quotedFrom}`, `import ${quotedTo}`)
}

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

// A small allowlist of JS globals that `rewriteFreeIdentifiers` must NOT rewrite as scope references
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

// ---------------------------------------------------------------------------
// Binding + shadow analysis (pure array pass)
// ---------------------------------------------------------------------------

interface ShadowedBinding {
    name: string
    start: number // inclusive token index
    end: number // inclusive token index
}

interface Scopes {
    declNameIdx: Set<number> // token indices that are binding/declaration NAMES (never rewritten)
    shadows: ShadowedBinding[]
}

// Collect the simple identifiers bound by parameters within a `(` … `)` group (open/close token
// indices). Records the first identifier after `(` or a top-level `,`; skips defaults/types/
// destructuring (best-effort). `filter` decides which names matter.
// Collect the identifiers BOUND by a destructuring parameter pattern (`{ a, b }`, `[a]`, nested, with
// defaults and rest). A property KEY is not a binding — in `{ a: renamed }` the binding is `renamed` —
// and everything after a `=` is a DEFAULT VALUE, i.e. an ordinary reference that must still be rewritten.
// A computed key (`{ [k]: v }`) is skipped whole, since `k` is a reference too.
function collectPatternBindings(
    tokens: Tok[],
    open: number,
    close: number,
    filter: (name: string) => boolean,
    matchClose: Map<number, number>,
): number[] {
    const names: number[] = []
    let depth = 0
    let defaultDepth = -1 // depth at which the current default-value expression began; -1 = none
    for (let j = open + 1; j < close; j++) {
        const t = tokenAt(tokens, j)
        const kind = t.kind
        if (isOpen(kind)) {
            // A computed key is `[expr]` followed by `:` — its contents are references, not bindings.
            const patternClose = matchClose.get(j)
            if (
                kind === K.OpenBracketToken &&
                patternClose !== undefined &&
                tokens[patternClose + 1]?.kind === K.ColonToken
            ) {
                j = patternClose
                continue
            }
            depth++
            continue
        }
        if (isClose(kind)) {
            depth--
            if (defaultDepth !== -1 && depth < defaultDepth) defaultDepth = -1
            continue
        }
        if (kind === K.CommaToken) {
            if (defaultDepth === depth) defaultDepth = -1
            continue
        }
        if (kind === K.EqualsToken) {
            if (defaultDepth === -1) defaultDepth = depth
            continue
        }
        if (defaultDepth !== -1) continue // inside a default value — a reference, leave it alone
        if (!isIdentifierLike(kind)) continue
        if (tokens[j + 1]?.kind === K.ColonToken) continue // property key; the binding is its value
        if (filter(t.text)) names.push(j)
    }
    return names
}

function collectParamBindings(
    tokens: Tok[],
    open: number,
    close: number,
    filter: (name: string) => boolean,
    matchClose: Map<number, number>,
): number[] {
    const params: number[] = []
    let depth = 0
    let expectName = true
    for (let j = open + 1; j < close; j++) {
        const t = tokenAt(tokens, j)
        const kind = t.kind
        if (isOpen(kind)) {
            // A DESTRUCTURING parameter binds every name inside its pattern. Without this the names stay
            // unregistered, so a pattern that happens to reuse a cell's name both loses its shadow AND
            // gets rewritten as if it were an object literal — emitting invalid JS (`({ a: a() }) =>`).
            const patternClose = matchClose.get(j)
            if (depth === 0 && expectName && patternClose !== undefined && patternClose < close) {
                for (const idx of collectPatternBindings(
                    tokens,
                    j,
                    patternClose,
                    filter,
                    matchClose,
                )) {
                    params.push(idx)
                }
                j = patternClose
                expectName = false
                continue
            }
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
    let inType = false
    for (let j = kw + 1; j < tokens.length; j++) {
        const t = tokenAt(tokens, j)
        const kind = t.kind
        if (depth === 0) {
            if (kind === K.SemicolonToken) break
            // THE ASI RULE, not a bare "any line break ends it". Breaking on every depth-0 newline meant
            // that in
            //
            //     let a = 1,
            //         count = state(0)
            //
            // every declarator after the first was neither registered as a declaration name nor
            // shadowed — and was then rewritten as a REFERENCE at its own declaration site, emitting
            // `count.set( state(0))`, which fails the build on generated source. `emitCheck` splits the
            // same input correctly, so `abide check` stayed green over it: the documented lane
            // asymmetry, and the reason this asks the shared `isStatementBreak` rather than re-spelling
            // the test. `inType` tracks a declarator's annotation for the same reason `statementExtent`
            // does — `let onReset: () => void` is complete at `void`.
            if (j > kw + 1 && isStatementBreak(tokens, j, inType)) break
            if (kind === K.ColonToken) inType = true
            else if (kind === K.EqualsToken || kind === K.CommaToken) inType = false
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

function buildShadowedBindings(
    tokens: Tok[],
    braces: BraceInfo,
    filter: (name: string) => boolean,
): Scopes {
    const { matchClose, matchOpen, enclBraceOpen, bracketDepth } = braces
    const declNameIdx = new Set<number>()
    const shadows: ShadowedBinding[] = []
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
                    const params = collectParamBindings(tokens, p, close, filter, matchClose)
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
                        params = collectParamBindings(tokens, open, i - 1, filter, matchClose)
                } else if (isIdentifierLike(prev.kind) && filter(prev.text)) {
                    params = [i - 1]
                }
            }
            const bodyStart = i + 1
            let bodyEnd: number
            if (tokens[bodyStart] && tokenAt(tokens, bodyStart).kind === K.OpenBraceToken) {
                bodyEnd = matchClose.get(bodyStart) ?? n - 1
            } else {
                bodyEnd = rhsExtent(tokens, bodyStart)
            }
            for (const pidx of params) {
                declNameIdx.add(pidx)
                shadows.push({ name: tokenAt(tokens, pidx).text, start: bodyStart, end: bodyEnd })
            }
        }
    }

    return { declNameIdx, shadows }
}

// Is token `idx` (an identifier `name`) inside a region that shadows the same-named outer binding?
function isShadowed(shadows: ShadowedBinding[], name: string, idx: number): boolean {
    for (const shadow of shadows) {
        if (shadow.name === name && idx >= shadow.start && idx <= shadow.end) return true
    }
    return false
}

// ---------------------------------------------------------------------------
// rewriteCellRefs — the crux
// ---------------------------------------------------------------------------

export function rewriteCellRefs(code: string, bindings: CellBindings): string {
    const { cells: cellNames, memos: memoNames } = bindings
    if (cellNames.size === 0 && memoNames.size === 0) return code
    const tokens = tokenize(code)
    if (tokens.length === 0) return code
    const braces = analyzeBraces(tokens)
    const { enclBraceOpen, isObjectBrace } = braces
    const named = (name: string): boolean => cellNames.has(name) || memoNames.has(name)
    const { declNameIdx, shadows } = buildShadowedBindings(tokens, braces, named)
    const typeSkips = markTypeSkips(tokens, braces)

    // Is `tokens[i]` (a cell-named Identifier) a genuine reference we should rewrite?
    const isCellRef = (i: number): boolean => {
        const prev = i > 0 ? tokenAt(tokens, i - 1).kind : undefined
        if (prev === K.DotToken || prev === K.QuestionDotToken) return false // member/property access
        if (declNameIdx.has(i)) return false // declaration / parameter name
        if (typeSkips.has(i)) return false // type position — a type name is never a value read
        if (isShadowed(shadows, tokenAt(tokens, i).text, i)) return false
        return true
    }

    // A property KEY or a shorthand method name (`{ n: … }`, `{ n() {} }`) — not a reference.
    const isObjectKey = (i: number): boolean => {
        const prev = i > 0 ? tokenAt(tokens, i - 1).kind : undefined
        if (prev !== K.OpenBraceToken && prev !== K.CommaToken) return false // property position only
        const next = tokens[i + 1]?.kind
        // `name:` at property position is a KEY however the brace is classified — an object literal, a
        // destructuring PATTERN, or a statement label. None of the three is a value read, so this must
        // not ask `isObjectBrace`: requiring it is what made a RENAMING pattern emit
        // `const { open(): initialOpen } = props()` — a build error on generated code, hit whenever a
        // destructured prop happens to share a name with a cell, which for `props()` is the common case.
        if (next === K.ColonToken) return true
        // `name(` is a shorthand METHOD only inside an object literal; inside a block it is a CALL, and
        // a call on a cell-named binding is a read the rewrite owes.
        const encl = numberAt(enclBraceOpen, i)
        if (encl === -1 || !isObjectBrace.has(encl)) return false
        return next === K.OpenParenToken
    }

    // Object-literal shorthand (`{ n }`, `{ a, n }`) — a READ, rewritten to `n: n()`.
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
                isIdentifierLike(next.kind) &&
                cellNames.has(next.text) &&
                isCellRef(i + 1)
            ) {
                flush(t.start)
                const name = next.text
                const op = kind === K.PlusPlusToken ? '+' : '-'
                out += `${name}.set(${name}() ${op} 1)`
                cursor = next.end
                i += 2
                continue
            }
            i++
            continue
        }

        if (isIdentifierLike(kind) && named(t.text) && isCellRef(i)) {
            const name = t.text
            const next = tokens[i + 1]
            const nextKind = next?.kind

            if (isObjectKey(i)) {
                i++
                continue
            }

            // A MEMO reads exactly like a cell — `{d}` is the value, `{d.length}` is the VALUE's property
            // (`d().length`). The memo's own surface is therefore not reachable through the binding; that is
            // the price of auto-call and the same price a cell already pays, and it costs nothing in
            // practice because probes belong to RPC/socket callables, which are IMPORTS, not memo-bound
            // locals. Only writes differ: a memo is read-only, so a write form is left verbatim and the
            // `const` binding makes the assignment a loud TypeError on its own.
            if (memoNames.has(name)) {
                if (
                    nextKind === K.EqualsToken ||
                    nextKind === K.PlusPlusToken ||
                    nextKind === K.MinusMinusToken ||
                    (nextKind !== undefined && COMPOUND_OP.has(nextKind))
                ) {
                    i++
                    continue
                }
                if (isObjectShorthand(i)) {
                    flush(t.start)
                    out += `${name}: ${name}()`
                    cursor = t.end
                    i++
                    continue
                }
                flush(t.start)
                out += `${name}()`
                cursor = t.end
                i++
                continue
            }

            if (isObjectShorthand(i)) {
                flush(t.start)
                out += `${name}: ${name}()`
                cursor = t.end
                i++
                continue
            }

            if (next !== undefined && next.kind === K.EqualsToken) {
                // `n = rhs` → `n.set(rhs)`
                flush(t.start)
                out += `${name}.set(`
                const end = rhsExtent(tokens, i + 2)
                pending.push({ pos: tokenAt(tokens, end).end, text: ')', seq: seq++ })
                cursor = next.end // skip `n` and `=`
                i += 2
                continue
            }

            if (next !== undefined && COMPOUND_OP.has(next.kind)) {
                // `n op= rhs` → `n.set(n() op (rhs))`
                flush(t.start)
                const op = COMPOUND_OP.get(next.kind)
                if (op === undefined) throw new Error('analyzeBindings: missing compound operator')
                out += `${name}.set(${name}() ${op} (`
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
                    out += `${name}.set(${name}() ${op} (`
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
                out += `${name}.set(${name}() ${op} 1)`
                cursor = next.end
                i += 2
                continue
            }

            // plain read
            flush(t.start)
            out += `${name}()`
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
// rewriteFreeIdentifiers (Stage 1, PR3) — member-access-safe `x` → `$scope.x`
// ---------------------------------------------------------------------------

// Rewrite every FREE identifier in a template expression to `<scopeVar>.<name>` so the emitted client
// thunk / server string reads it off the merged scope object at the reference site (preserving
// getter-backed reactivity). Skips: declared script bindings, JS globals, member/property accesses,
// object-literal keys, and identifiers bound locally within the expression (arrow/function params,
// nested lets). Object-literal shorthand (`{ x }`) referencing a free identifier expands to
// `{ x: <scopeVar>.x }`. Built on the same scanner passes as `rewriteCellRefs`.
export function rewriteFreeIdentifiers(
    code: string,
    declared: Set<string>,
    scopeVar: string,
): string {
    const sites = freeIdentifierSites(code, declared)
    if (sites.length === 0) return code
    let out = ''
    let cursor = 0
    for (const site of sites) {
        out += code.slice(cursor, site.start)
        // shorthand `{ x }` → `{ x: $scope.x }`; everything else is a plain qualification
        out += site.shorthand
            ? `${site.name}: ${scopeVar}.${site.name}`
            : `${scopeVar}.${site.name}`
        cursor = site.end
    }
    out += code.slice(cursor)
    return out
}

// One free identifier that WOULD be qualified onto the scope object, in source order.
export interface FreeIdentifierSite {
    name: string
    start: number
    end: number
    // Object-literal shorthand (`{ x }`), which expands to `x: <scopeVar>.x` rather than replacing the
    // token outright. The two output shapes are why this is a field rather than something the consumer
    // can re-derive from `name`/`start` alone.
    shorthand: boolean
}

// Which identifiers in a template expression are FREE — the twelve-branch decision `rewriteFreeIdentifiers`
// used to inline. It is extracted because a second consumer needs the same ANSWER without the rewrite:
// `templatePlan.rewriteExpr` reserves `children` (the outlet's internal scope name) and must reject a
// template that reaches it, in EVERY expression position rather than only in an interpolation.
//
// Asking this rather than matching `/\bchildren\b/` is the whole point: the word appears in string
// literals, in member accesses (`node.children`), in object keys and in type positions, none of which is
// a scope reference — and a regex over an expression is precisely the shape of scan this compiler has
// had to un-write three times (see `scanText.ts`).
export function freeIdentifierSites(code: string, declared: Set<string>): FreeIdentifierSite[] {
    const sites: FreeIdentifierSite[] = []
    const tokens = tokenize(code)
    if (tokens.length === 0) return sites
    const braces = analyzeBraces(tokens)
    const { enclBraceOpen, isObjectBrace } = braces
    const { declNameIdx, shadows } = buildShadowedBindings(tokens, braces, () => true)
    const typeSkips = markTypeSkips(tokens, braces)

    for (let i = 0; i < tokens.length; i++) {
        const t = tokenAt(tokens, i)
        if (!isIdentifierLike(t.kind)) continue
        if (typeSkips.has(i)) continue // type position — not a value reference
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
        let shorthand = false
        if (inObjectPosition) {
            const next = tokens[i + 1]?.kind
            if (next === K.ColonToken || next === K.OpenParenToken) continue // property key / method name
            if (next === K.CommaToken || next === K.CloseBraceToken) shorthand = true
        }
        sites.push({ name, start: t.start, end: t.end, shorthand })
    }
    return sites
}

// ---------------------------------------------------------------------------
// analyzeBindings — top-level `<script>` walk (imports, cells, bindings, setup code)
// ---------------------------------------------------------------------------

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
    for (let part of splitParams(inner)) {
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

export function isSimpleIdentifier(pattern: string): boolean {
    return /^[A-Za-z_$][\w$]*$/.test(pattern.trim())
}

function parseImport(rawText: string): ImportBinding | null {
    const specifierMatch = rawText.match(/from\s*['"]([^'"]+)['"]/)
    if (!specifierMatch) {
        // A SIDE-EFFECT import (`import "./polyfill.ts"`) has no `from`, so the match above misses it.
        // The scanner still records the statement and the classifier strips its range unconditionally,
        // so a non-CSS one used to be DELETED from both emitted substrates with no diagnostic, sitting
        // next to imports that survived. That it was meant to work was already written down two
        // functions below: `reconstructImport` re-emits the clause-less form, and nothing could reach
        // that branch.
        const bareSpecifier = rawText.match(/^\s*import\s*['"]([^'"]+)['"]/)?.[1]
        if (bareSpecifier === undefined) return null
        // A side-effect `.css` import is ALREADY owned, by `cssSideEffectSpecifier` — and the classifier
        // reads `record.cssSpecifier` only when `record.binding` is null, so claiming one here takes
        // every stylesheet out of `cssImports` and the page renders with no `<link>`. The two
        // clause-less forms are different facts about the module; this branch owns the one that had no
        // owner.
        if (bareSpecifier.endsWith('.css')) return null
        return { specifier: bareSpecifier, defaultLocal: null, namespaceLocal: null, named: [] }
    }
    const specifier = specifierMatch[1]
    if (specifier === undefined) return null
    const clause = rawText
        .slice(rawText.indexOf('import') + 'import'.length, specifierMatch.index)
        .trim()

    // A WHOLE-CLAUSE type-only import (`import type { X }`, `import type Foo`, `import type * as NS`) is
    // erased at runtime — drop it so it is never aliased to `$scope` (the runtime emitters would emit
    // `const type X = $scope["type X"]`). The type-check path (`emitCheck`) copies the raw import
    // verbatim, so the type stays resolvable there. `import type from "x"` (a default binding literally
    // named `type`) has no trailing token → not matched.
    if (/^type\s+[{*A-Za-z_$]/.test(clause)) return null

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
            // A PER-SPECIFIER type modifier (`{ type X }`, `{ type X as Y }`) is erased at runtime —
            // skip it. `type` followed by `as` (`{ type as foo }`) is the value binding named `type`
            // aliased, NOT a modifier, so the negative lookahead keeps it.
            if (/^type\s+(?!as\b)/.test(trimmed)) continue
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

    // A braced import whose specifiers were ALL type-stripped, with no default/namespace, is fully
    // erased at runtime — drop it so a passthrough (`abide/*`) type import doesn't degrade to a bare
    // side-effect `import "spec"`. (A real side-effect import `import "x"` has no braces → kept.)
    if (
        bracedInner !== undefined &&
        binding.named.length === 0 &&
        binding.defaultLocal === null &&
        binding.namespaceLocal === null
    ) {
        return null
    }

    return binding
}

// After a callee name, does an (optional) generic argument list lead into a call `(`? See
// `callOpenIndex` — this is its boolean face.
function callFollows(rest: string): boolean {
    return callOpenIndex(rest) !== -1
}

// Recognise a cell initializer (`state(...)`, `state.shared(...)`) — including the generic call form
// (`state<T>(...)`) — where `stateLocal` is the local bound to `abide/shared/state`. Derivation is not
// here: `state.computed`/`state.linked` are retired in favour of `memo` (ADR 0024), see `memoKind`.
function cellKind(init: string, stateLocal: string): 'state' | null {
    const esc = escapeRegExp(stateLocal)
    // `state.shared(key, initial)` is a writable cell — treated like `state(...)` for the read/write
    // reference rewrite; its cross-instance/cross-tab sharing is a pure runtime concern.
    const method = init.match(new RegExp(`^${esc}\\s*\\.\\s*shared\\b`))
    if (method !== null) return callFollows(init.slice(method[0].length)) ? 'state' : null
    const bare = init.match(new RegExp(`^${esc}`))
    if (bare !== null && callFollows(init.slice(bare[0].length))) return 'state'
    return null
}

// Index of the call `(` that follows a callee at the start of `rest`, or -1 when no call follows.
// Skips a balanced `<...>` (nested generics allowed — `state<Map<K, V>>(…)`; `=>` inside a
// function-type arg is not a close) so the generic call form `state<Foo[]>(…)` / `props<Bar>()` is
// recognised, not just the bare `state(…)`. `rest` is the substring immediately after the callee.
// Returns -1 on an unbalanced `<` (e.g. a `state < 5` comparison), so a non-call is never misread as
// a cell.
function callOpenIndex(rest: string): number {
    let index = 0
    while (index < rest.length && /\s/.test(rest.charAt(index))) index++
    if (rest.charAt(index) === '<') {
        let depth = 0
        for (; index < rest.length; index++) {
            const char = rest.charAt(index)
            if (char === '<') depth++
            else if (char === '>') {
                if (rest.charAt(index - 1) === '=') continue // `=>` arrow in a function-type arg
                depth--
                if (depth === 0) {
                    index++
                    break
                }
            }
        }
        if (depth !== 0) return -1
        while (index < rest.length && /\s/.test(rest.charAt(index))) index++
    }
    return rest.charAt(index) === '(' ? index : -1
}

// Does `source` open an ARGLESS arrow thunk — `() => …` or `(): T => …`?
//
// This used to be `/^\(\s*\)\s*=>/`, which matched only the un-annotated form. An annotated memo then
// fell through to `memoKind`'s `null` = "opaque" branch and bound as a plain const, so a bare `{d}`
// read the memo OBJECT instead of its value — with `abide check` green, since the check lane types the
// binding through `__abideUnwrap` and never consults this classifier.
//
// The annotation is not PARSED, only stepped over to an arrow, and the distinction matters: a return
// type may be a function type carrying its own `=>` (`(): (x: number) => string => body`), so telling
// the type's arrow from the body's would need TypeScript's own greedy-parse-then-reparameterise rule
// (`((x: number) => string) => String` is a parenthesised type, `(x: number) => string` a parameter
// list — the same `)` precedes both). None of that is needed for a yes/no answer: an expression
// opening `()` followed by `:` can only be an argless arrow with a return type, so ANY depth-zero
// arrow after it confirms one. Requiring the arrow at all is the cheap guard against garbage.
function isArglessArrowThunk(source: string): boolean {
    if (source.charAt(0) !== '(') return false
    const close = matchingBracket(source, 0)
    if (close === -1) return false
    if (source.slice(1, close).trim() !== '') return false // takes args — not a thunk

    let index = close + 1
    while (index < source.length && /\s/.test(source.charAt(index))) index++
    if (source.startsWith('=>', index)) return true
    if (source.charAt(index) !== ':') return false

    let depth = 0
    for (index++; index < source.length; index++) {
        const char = source.charAt(index)
        if (char === "'" || char === '"' || char === '`') {
            index++
            while (index < source.length && source.charAt(index) !== char) {
                if (source.charAt(index) === '\\') index++
                index++
            }
            continue
        }
        if (char === '(' || char === '[' || char === '{') depth++
        else if (char === ')' || char === ']' || char === '}') {
            depth--
            if (depth < 0) return false // ran past the initializer — never a thunk
        } else if (depth === 0 && char === '=' && source.charAt(index + 1) === '>') return true
    }
    return false
}

// Recognise a `memo(...)` initializer and classify it (ADR 0024 §5), where `memoLocal` is the local bound
// to `abide/shared/memo`.
//   'cell' — `memo(…).state()`: the WRITABLE projection, indistinguishable from `state(…)` at the
//            reference-rewrite level (read `n()`, write `n.set(x)`).
//   'memo' — auto-called: the compiler can SEE an argless, non-async fn literal in the source position,
//            with or without a transform, so a bare reference reads as the value.
//   null   — anything opaque (`memo(someFnRef)`, an async body, an arged handler): a plain const binding.
//            Guessing wrong would emit a call with undefined args, or a promise-returning read that blanks
//            the server-rendered text and refills it a microtask later (ADR 0024 §3).
function memoKind(init: string, memoLocal: string): 'memo' | 'cell' | null {
    const bare = init.match(new RegExp(`^${escapeRegExp(memoLocal)}\\b`))
    if (bare === null) return null
    const rest = init.slice(bare[0].length)
    const open = callOpenIndex(rest)
    if (open === -1) return null
    const close = matchingBracket(rest, open)
    if (close === -1) return null

    const after = rest.slice(close + 1).trim()
    const projection = after.match(/^\.\s*state\b/)
    if (projection !== null && callFollows(after.slice(projection[0].length))) return 'cell'

    const args = splitParams(rest.slice(open + 1, close)).map((part) => part.trim())
    const source = args[0] ?? ''
    const transform = args[1]
    if (transform !== undefined && /^async\b/.test(transform)) return null
    // The source is always an ARGLESS THUNK (ADR 0025) — that is the whole rule, with or without a
    // transform. A node reference or an object literal here is not a source and never classifies.
    // Either spelling may carry a return type annotation; the `function` form tolerates one for free
    // (nothing after the `()` is matched), the arrow form has to skip it.
    if (isArglessArrowThunk(source)) return 'memo'
    if (/^function\s*\*?\s*\(\s*\)/.test(source)) return 'memo'
    return null
}

function isPropsInit(init: string, propsLocal: string): boolean {
    const bare = init.match(new RegExp(`^${escapeRegExp(propsLocal)}`))
    return bare !== null && callFollows(init.slice(bare[0].length))
}

type StatementRecord =
    | {
          kind: 'import'
          binding: ImportBinding | null
          cssSpecifier: string | null
          stripStart: number
          stripEnd: number
      }
    | { kind: 'var'; rawDeclarators: string; reassignable: boolean }
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
            // A `<script>` runs once per module or once per instance, but it is never an ES module
            // BOUNDARY: `emitSetup` inlines its body into `$ensureModule($scope)` / `render` / `mount`,
            // where an `export` is a syntax error in EMITTED code — so the author got a parse failure
            // over generated source instead of a diagnostic on the line they wrote. It used to be
            // skipped here, which made `export const x = 1` analyze as `const x = 1` and bind
            // correctly, so everything downstream agreed the script was fine.
            if (kind === K.ExportKeyword)
                throw scriptGateError(
                    'a <script> is not an ES module boundary — its body is inlined into the ' +
                        'component setup, so an `export` there is a syntax error in the emitted ' +
                        'module. Drop it: a top-level binding is already visible to the template and ' +
                        'to every nested <script>, a prop is `const { x } = props()`, and a value ' +
                        'shared across FILES belongs in a `.ts` module you import.',
                )
            if (kind === K.ImportKeyword) {
                const { lastIdx, nextIdx } = statementExtent(tokens, i)
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
                const { lastIdx, nextIdx } = statementExtent(tokens, i)
                const rawDeclarators = source.slice(t.end, tokenAt(tokens, lastIdx).end)
                records.push({
                    kind: 'var',
                    rawDeclarators,
                    reassignable: kind !== K.ConstKeyword,
                })
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
    // The local name `props` was imported UNDER. `import { props as p }` binds `p`, and the whole
    // props-detection story keys on it — `isPropsInit` below, and the check lane's `componentDts`.
    propsLocal: string
    bindings: Binding[]
    cells: Set<string>
    memos: Set<string>
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

    const stateLocal = localForSpecifier(imports, 'abide/shared/state', 'state', 'state')
    const propsLocal = localForSpecifier(imports, 'abide/ui/props', 'props', 'props')
    const memoLocal = localForSpecifier(imports, 'abide/shared/memo', 'memo', 'memo')

    const bindings: Binding[] = []
    const cells = new Set<string>()
    const memos = new Set<string>()
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
        for (const declarator of splitParams(record.rawDeclarators)) {
            // `topLevelAssignmentIndex`, not the first top-level `=`: a function-type ANNOTATION
            // (`let f: () => void = fn`) puts an `=` inside its `=>` ahead of the real assignment.
            // emitCheck's declarator scan has always asked it this way; this one asked the naive
            // question, which is the same lane split `statementExtent`'s header records.
            const equalsIndex = topLevelAssignmentIndex(declarator)
            const pattern = (
                equalsIndex === -1 ? declarator : declarator.slice(0, equalsIndex)
            ).trim()
            const init = equalsIndex === -1 ? '' : declarator.slice(equalsIndex + 1).trim()
            if (pattern === '') continue
            const names = extractBindingNames(pattern)
            let kind: BindingKind = 'const'
            // A cell/memo declarator may carry a type annotation — emitCheck accepts `bar: T` and
            // type-checks the unwrapped init against it, so the build lane has to see the same
            // declaration. Testing the annotated text made `let n: number = state(0)` a plain const:
            // `{n}` emitted the callable instead of `n()` and `n = 1` was never rewritten to `.set()`,
            // with `abide check` green over it because only THIS lane misread it.
            const annotation = pattern.startsWith('{') ? -1 : topLevelIndexOf(pattern, ':')
            const bare = annotation === -1 ? pattern : pattern.slice(0, annotation).trim()
            if (isSimpleIdentifier(bare)) {
                const cell = cellKind(init, stateLocal)
                const derived = cell === null ? memoKind(init, memoLocal) : null
                if (cell) {
                    kind = cell
                    cells.add(bare)
                } else if (derived === 'cell') {
                    // `memo(…).state()` — the writable projection reads and writes exactly like a cell.
                    kind = 'state'
                    cells.add(bare)
                } else if (derived === 'memo') {
                    kind = 'memo'
                    memos.add(bare)
                } else if (isPropsInit(init, propsLocal)) {
                    kind = 'prop'
                }
            } else if (isPropsInit(init, propsLocal)) {
                kind = 'prop'
            }
            for (const name of names) {
                bindings.push({ name, kind, reassignable: record.reassignable })
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
        memos,
        declared,
        cssImports,
        componentImports,
        moduleImports,
        propsLocal,
        strippedCode,
    }
}

// ---------------------------------------------------------------------------
// Branch-local `<script>` collection (C9.4)
// ---------------------------------------------------------------------------

// Where a `<script>` sits. A BLOCK BODY is a template level that gets its own emitted frame and its own
// `$scope` child — which is precisely what a per-branch/per-iteration setup needs to own and to dispose.
// Element children and component children are INLINED into their parent level and have neither, so a
// script there would have no lifetime of its own; it is rejected rather than silently hoisted.
type ScriptSite = 'root' | 'block' | 'element'

// The nodes that decide "first" for a block body — whitespace and comments don't count.
function isIgnorableBefore(node: TemplateNode): boolean {
    if (node.type === 'Comment') return true
    return node.type === 'Text' && node.value.trim() === ''
}

function scriptGateError(message: string): Error {
    return new Error(`<script>: ${message}`)
}

interface NestedCollect {
    nested: Map<Script, NestedScript>
    rootScripts: Set<Script>
}

// Analyze one branch-local script against the cells and lexical names visible around it.
function analyzeNestedScript(
    script: Script,
    inherited: CellBindings,
    lexical: Set<string>,
): NestedScript {
    const raw = analyzeScript(script.content)

    // An import is MODULE-level wherever it is written — a branch cannot import conditionally, and the
    // bundle carries it either way — so allowing one here would only look like it meant something. It
    // is also not legal TS in the position the check lowering emits this body into. The component's
    // imports are already lexically in scope here, so the fix is always the same one.
    if (raw.imports.length > 0)
        throw scriptGateError(
            'a branch-local <script> reuses the imports of the component it sits in — move the ' +
                'import to the root <script>.',
        )

    // Its own cells read/write as cells, and so do the ones it inherits — an outer cell is either
    // lexical (the root script, visible because every mount fn nests inside `mount`) or itself
    // `$scope`-published, and the free-identifier pass below tells those two apart.
    const cells = new Set(inherited.cells)
    const memos = new Set(inherited.memos)
    for (const name of raw.cells) cells.add(name)
    for (const name of raw.memos) memos.add(name)

    // LEXICALLY available to this body: what the root script declared, its own declarations, and its own
    // real module imports. Everything else — an OUTER nested script's binding, or an ambient the scope
    // provides — is qualified onto `$scope`, which is where both of those actually live.
    const visible = new Set(lexical)
    for (const name of raw.declared) visible.add(name)
    const body = rewriteFreeIdentifiers(
        rewriteCellRefs(raw.strippedCode, { cells, memos }),
        visible,
        '$scope',
    )

    // Publish the bindings. A cell/memo/const/function binding is copied once (a cell is never rebound —
    // a write to it lowered to `.set()`); a reassignable plain `let` gets an accessor PAIR, so that it
    // reads live rather than frozen at setup time AND a template write still lands on the variable
    // (emitted modules are strict, where assigning through a getter-only property throws).
    let publish = ''
    const names = new Set<string>()
    for (const binding of raw.bindings) {
        if (binding.kind === 'import') continue
        if (names.has(binding.name)) continue
        names.add(binding.name)
        const key = JSON.stringify(binding.name)
        if (binding.reassignable === true && binding.kind !== 'state' && binding.kind !== 'memo')
            publish +=
                `Object.defineProperty($scope, ${key}, { get: () => ${binding.name}, ` +
                `set: ($v) => { ${binding.name} = $v; }, configurable: true });\n`
        else publish += `$scope[${key}] = ${binding.name};\n`
    }

    return { setupCode: `${body}\n${publish}`, cells: raw.cells, memos: raw.memos, names }
}

// Walk the template for branch-local `<script>`s, enforcing where one may appear and threading the
// cells each level can see down to the levels below it.
function walkNestedScripts(
    nodes: TemplateNode[],
    site: ScriptSite,
    inherited: CellBindings,
    lexical: Set<string>,
    collect: NestedCollect,
): void {
    let own: NestedScript | null = null
    for (const [index, node] of nodes.entries()) {
        if (node.type !== 'Script') continue
        if (site === 'root') {
            // The first root-level `<script>` / `<script module>` are the component's own (lifted by the
            // parser); a further one used to be dropped in silence.
            if (collect.rootScripts.has(node)) continue
            throw scriptGateError(
                'a component has one <script> and one <script module>. A second root-level script is ' +
                    'not merged — move its code into the first, or into the block body it belongs to.',
            )
        }
        if (site === 'element')
            throw scriptGateError(
                'a <script> inside an element or a component body has no lifetime of its own. Move it ' +
                    'to the first line of the enclosing {#if}/{#for}/{#component} body, or to the ' +
                    "component's root <script>.",
            )
        if (node.module)
            throw scriptGateError(
                '<script module> runs once per module, so it cannot live in a block body. Move it to ' +
                    'the top level of the component.',
            )
        if (own !== null)
            throw scriptGateError(
                'one <script> per block body — merge it with the one above it in this branch.',
            )
        if (!nodes.slice(0, index).every(isIgnorableBefore))
            throw scriptGateError(
                'a branch-local <script> must be the FIRST node of its block body (whitespace and ' +
                    'comments aside), so that it is set up before anything reads it.',
            )
        own = analyzeNestedScript(node, inherited, lexical)
        collect.nested.set(node, own)
    }

    // Levels below this one see this script's bindings as cells too — but NOT as lexical names.
    let childCells = inherited
    if (own !== null) {
        const cells = new Set(inherited.cells)
        const memos = new Set(inherited.memos)
        for (const name of own.cells) cells.add(name)
        for (const name of own.memos) memos.add(name)
        childCells = { cells, memos }
    }

    // WHERE the children are is `templateChildren.ts`'s table; what this walk does with each list is its
    // own. `site` is the one thing it needs from there: an element's or component's children (and the
    // whitespace gap before the first `{:case}`) are folded into the PARENT level, so they cannot host a
    // branch-local `<script>`, while every block body becomes its own level and can.
    for (const node of nodes) {
        for (const list of childListsOf(node)) {
            walkNestedScripts(
                list.nodes,
                list.site === 'inline' ? 'element' : 'block',
                childCells,
                lexical,
                collect,
            )
        }
    }
}

export function analyzeBindings(root: Root): BindingAnalysis {
    const moduleRaw = root.moduleScript ? analyzeScript(root.moduleScript.content) : null
    const instanceRaw = root.instanceScript ? analyzeScript(root.instanceScript.content) : null

    const cellNames = new Set<string>()
    const memoNames = new Set<string>()
    const declared = new Set<string>()
    for (const raw of [moduleRaw, instanceRaw]) {
        if (!raw) continue
        for (const name of raw.cells) cellNames.add(name)
        for (const name of raw.memos) memoNames.add(name)
        for (const name of raw.declared) declared.add(name)
    }
    const cellBindings: CellBindings = { cells: cellNames, memos: memoNames }

    // Module setup can only reference module cells; instance setup can reference both (module bindings
    // are in scope for the instance).
    const module: ScriptInfo | null = moduleRaw
        ? {
              setupCode: rewriteCellRefs(moduleRaw.strippedCode, {
                  cells: moduleRaw.cells,
                  memos: moduleRaw.memos,
              }),
              imports: moduleRaw.imports,
              bindings: moduleRaw.bindings,
              cssImports: moduleRaw.cssImports,
          }
        : null
    const instance: ScriptInfo | null = instanceRaw
        ? {
              setupCode: rewriteCellRefs(instanceRaw.strippedCode, cellBindings),
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

    // Branch-local `<script>`s LAST: each is analyzed against the root's cells and lexical names, since
    // those are exactly what is in scope around it. Nothing it binds joins `declared` — a
    // `$scope`-published name must resolve there, which is what keeping it out of `declared` achieves.
    const rootScripts = new Set<Script>()
    if (root.moduleScript !== null) rootScripts.add(root.moduleScript)
    if (root.instanceScript !== null) rootScripts.add(root.instanceScript)
    const nested = new Map<Script, NestedScript>()
    walkNestedScripts(root.children, 'root', cellBindings, declared, { nested, rootScripts })

    return {
        module,
        instance,
        nested,
        cellBindings,
        declared,
        cssImports,
        componentImports,
        moduleImports,
        propsLocal: instanceRaw?.propsLocal ?? moduleRaw?.propsLocal ?? 'props',
    }
}
