// `.abide` TYPE-CHECK LOWERING (C10.2–6, TODO #11 PR1) — the typed-lowering emitter.
//
// Produces a TYPE-ONLY TS module (never executed) that both `abide check` and `abide lsp` feed to the
// TS7 type engine. Unlike the runtime emitters (`emitClient`/`emitServer`), which resolve free
// template identifiers to `$scope.<name>` (type-erasing), this lowering preserves types: script cells
// stay `T` (via `__abideUnwrap`), and every TEMPLATE expression is emitted as real lexically-scoped TS
// so TS's own scoping + control-flow narrowing does the work.
//
// THE ONE INVARIANT (mapping depends on it): user code is copied VERBATIM into the generated module;
// only synthetic scaffolding (`__ref(` … `)`, `if (` … `)`, `__abideUnwrap(` …) is injected around it.
// So a `Segment[]` (verbatim spans, monotonic in BOTH gen and orig offsets) maps positions
// bidirectionally (gen↔orig) by binary search. `emitCheck` must NEVER rewrite INSIDE a user expression.
//
// SCOPE (PR1 = intra-file): interpolation, html, await, if/for/await/try/switch/component, element +
// component attribute expressions, and control-flow bindings — all typed in the correct lexical scope.
// Component invocations are checked for VALUE validity (each prop expression) but the component itself
// is opaque (the `.abide` ambient module types the default import as `any`); CROSS-file typed component
// signatures are PR2. A BRANCH-LOCAL
// `<script>` is emitted inside the braces its block opened, which is both the right lexical scope (TS
// then types every reference below it and none above) and the only position that keeps the segment map
// monotonic — hoisting it above earlier siblings would emit their source spans out of order.
// See `docs/spec/abide-check-lsp-plan.md`.

import { SyntaxKind } from 'typescript/unstable/ast'
import { createScanner } from 'typescript/unstable/ast/scanner'
import { escapeRegExp } from '../../shared/internal/escapeRegExp.ts'
import type { BindingAnalysis } from './analyzeBindings.ts'
import type { AttributeNode, Root, Script, TemplateNode } from './ast.ts'
import { attributeParts } from './attributeParts.ts'
import { skipQuoted, splitTopLevel, topLevelAssignmentIndex } from './scanText.ts'
import { isClose, isOpen, statementExtent, tokenAt, tokenize } from './tokens.ts'

// A verbatim span of the generated file: [genStart, genEnd) maps to original offset `origStart`.
export interface Segment {
    genStart: number
    genEnd: number
    origStart: number
}

export interface CheckModule {
    code: string
    segments: Segment[]
    // Bytes of the synthetic header prefix; a diagnostic before it is framework scaffolding, not user code.
    headerLength: number
}

// Synthetic preamble. Self-contained (no imports → resolves in any project). `__abideUnwrap` models the
// runtime `$def` accessor: in a `.abide` script a state var reads/writes as its underlying VALUE, so a
// cell must type as its value `__T` (not `State<__T>`) — that is what gives `let bar = state<T>(x)`,
// `let bar: T = state(x)`, and inferred `let bar = state(x)` the SAME `bar: T` a plain `let` would have,
// across `state`/`.linked`/`.computed`/`.shared` (all `State`-shaped). `__AbideWiden` repairs the one
// place bare inference diverges from a plain `let`: an empty/nullish initializer flows through the generic
// factory CALL and so misses TS's evolving-any special-case (`state([])` → `never[]`, `state(null)` →
// `null`), which would false-positive on the very reassignments those slots exist for — widen them back to
// a permissive type while every concrete init (`state(0)` → number) keeps real inference. `__ref` forces
// an expression to be type-checked without an unused-expression lint; `__entries` types `{#for item, i}`
// as `[index, item]`. There is deliberately no `children` intrinsic: the default-children outlet is
// `<slot/>`, a tag, and `children` is the internal scope name it resolves off — declaring it here typed
// `{children()}` as legal (and as ALWAYS a function, so `{#if children}` was always true), which is the
// only reason the interpolation form ever looked supported.
const HEADER =
    // `peek()` — this shim must match `shared/internal/reactive.ts`'s real `State`, where it is the
    // untracked read (one name, one meaning, all three primitives). A cell's `peek` returns `__T`; a
    // memo's returns `__T | undefined` and so carries no value type, which is why `__AbideMemo` below
    // pins on `state` instead.
    `interface __AbideState<__T> { (): __T; set(value: __T): void; peek(): __T; }\n` +
    // Every arm is BRACKETED so the conditional does not distribute. A naked `__T extends readonly
    // never[]` distributes over a union, which sent each constituent through the arms alone: the `null`
    // of a `number | null` matched `[null] extends [null | undefined]` and widened to `any`, and
    // `number | any` collapses to `any` — so a nullable cell/memo silently stopped being type-checked at
    // all. What this widen exists for is a WHOLE initializer that is empty/nullish, never one member of
    // a union.
    `type __AbideWiden<__T> = [__T] extends [never] ? any : [__T] extends [readonly never[]] ? any[] : [__T] extends [null | undefined] ? any : __T;\n` +
    `declare function __abideUnwrap<__T>(cell: __AbideState<__T>): __AbideWiden<__T>;\n` +
    // An auto-called MEMO binding (ADR 0024 §5) reads as its VALUE, exactly as a cell does — the rewrite
    // turns `d` into `d()` everywhere, including before a member access, so `d.length` is the value's
    // length. Unwrapping it here is what makes the check agree with the emit; a probe reached through the
    // binding (`d.live()`) is not reachable at runtime either, so it fails loudly on both sides.
    //
    // `__T` is pinned by `state`, NOT by either read, and the difference is load-bearing. They return
    // `__T | undefined`, so inference against a `SyncMemo<T | undefined>` STRIPS the `undefined` and
    // fixes `__T = T` — after which the memo's own `(): T | undefined` is not assignable to `(): __T`,
    // the overload is rejected, and the binding falls through to the identity overload below and types
    // as the memo OBJECT. Neither read can be repaired: `T | undefined` is what they return whether or not
    // `T` itself includes `undefined`, so the value type is not recoverable from it. Nor can `(): __T`
    // pin it alone — `SyncMemo<T> extends Memo<void, T>` inherits `(args: void): Promise<T>`, and
    // inference from an overloaded source takes the LAST signature, which is the inherited async one.
    // `state(): State<__T>` is exact on both counts, and it is also the member that actually MEANS memo
    // (`live`/`peek`/`invalidate` are on the shared reactive surface, so a channel/socket binding matched them
    // too; `state` is memo-only — ADR 0024 §4). The `(): __T` signature stays as the ASSIGNABILITY gate:
    // it is what keeps an async `Memo` and a keyed `SyncKeyedMemo` — neither of which the emit
    // auto-calls — falling through to identity, so the two lanes keep agreeing.
    `interface __AbideMemo<__T> { (): __T; state(...args: never[]): __AbideState<__T>; invalidate(): void; }\n` +
    `declare function __abideUnwrap<__T>(memo: __AbideMemo<__T>): __AbideWiden<__T>;\n` +
    `declare function __abideUnwrap<__T>(value: __T): __T;\n` +
    `declare function __ref(value: unknown): void;\n` +
    // The TEXT-interpolation sink. It accepts anything `__ref` does EXCEPT a definite thenable, so a bare
    // `{fn()}` on a promise-returning read is a loud error pointing at `{await fn()}`. `__T` is inferred
    // from the naked member of the intersection (a conditional type is not an inference site on its own),
    // and the conditional DISTRIBUTES — so `T | Promise<T>` stays legal on purpose: a value that is only
    // sometimes a promise is the passthrough case, where the auto-await is doing real work.
    `type __AbideNoPromise<__T> = __T extends PromiseLike<unknown> ? { __abide_error: 'this is a Promise — write {await expr} so it types as T' } : unknown;\n` +
    `declare function __text<__T>(value: __T & __AbideNoPromise<__T>): void;\n` +
    `declare function __entries<__T>(list: Iterable<__T> | ArrayLike<__T>): IterableIterator<[number, __T]>;\n` +
    // A component value — the type of a `{#component}`, an imported `.abide`, or a component-valued prop
    // (`{ Row: Component<{ entry: Item }> }`). Invoked as `<Row entry={x}/>` → checked as `Row({entry:x})`.
    `type Component<__P = Record<string, unknown>> = (props: __P, children?: () => unknown) => unknown;\n`

export const CHECK_HEADER_LENGTH = HEADER.length

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export function emitCheck(source: string, root: Root): CheckModule {
    const segments: Segment[] = []
    let code = ''

    const emitOriginal = (absStart: number, text: string): void => {
        if (text.length === 0) return
        segments.push({
            genStart: code.length,
            genEnd: code.length + text.length,
            origStart: absStart,
        })
        code += text
    }
    const emitSynthetic = (text: string): void => {
        code += text
    }
    // Absolute offset of `exprText` within `[from, to)`, or -1. Callers advance `from` past a match so
    // short/substring names in a multi-expression header (`{#for item, i …}` — `i` inside `item`) resolve
    // in source order without colliding.
    const locate = (from: number, to: number, exprText: string): number => {
        const at = source.slice(from, to).indexOf(exprText)
        return at === -1 ? -1 : from + at
    }
    // Copy `len` bytes of verbatim source at absolute offset `abs` (records a Segment for the map).
    const emitAt = (abs: number, len: number): void => {
        emitOriginal(abs, source.slice(abs, abs + len))
    }
    // Locate `exprText` within a node span and copy it verbatim; fall back to un-mapped synthetic text.
    const emitExpr = (nodeStart: number, nodeEnd: number, exprText: string): void => {
        const at = locate(nodeStart, nodeEnd, exprText)
        if (at === -1) emitSynthetic(exprText)
        else emitAt(at, exprText.length)
    }

    emitSynthetic(HEADER)

    // Module + instance scripts first (declarations in scope for the template closure).
    const scripts: Script[] = []
    if (root.moduleScript !== null) scripts.push(root.moduleScript)
    if (root.instanceScript !== null) scripts.push(root.instanceScript)
    for (const script of scripts) emitScript(source, script, emitOriginal, emitSynthetic)

    // Template render body — `async` so `{await …}` / `{#await}` / `{#for await}` are legal (the `await`
    // lives INSIDE the function, so no top-level-await requirement on the project). Called below so it is
    // not flagged unused under `noUnusedLocals`; the call is a statement (no unused-expression lint).
    emitSynthetic('async function __render() {\n')
    walk(root.children, {
        source,
        emitSynthetic,
        emitOriginal,
        emitExpr,
        emitAt,
        locate,
        rootScripts: new Set(scripts),
    })
    emitSynthetic('}\n__render();\n')

    emitSynthetic('export {};\n')
    return { code, segments, headerLength: HEADER.length }
}

// ---------------------------------------------------------------------------
// Component `.d.ts` companion (PR2 cross-file component-prop typing)
// ---------------------------------------------------------------------------

// Scan from the `<` at `ltIndex` to its matching `>` (balanced over `<>`, skipping strings and the
// arrow `=>`). Returns the matching `>` index, or -1.
function scanBalancedAngle(text: string, ltIndex: number): number {
    let depth = 0
    for (let i = ltIndex; i < text.length; i++) {
        const c = text[i]
        if (c === undefined) break
        if (c === "'" || c === '"' || c === '`') {
            i = skipQuoted(text, i)
            continue
        }
        if (c === '<') depth++
        else if (c === '>') {
            if (text[i - 1] === '=') continue // arrow `=>` inside a function type
            depth--
            if (depth === 0) return i
        }
    }
    return -1
}

// The props type for a component's default export. Explicit `props<T>()` → `T` (CLOSED — strict, per
// the graduated model: unknown props error); otherwise `Record<string, unknown>` (OPEN — accepts
// anything, zero false positives).
//
// `propsLocal` comes from the BUILD lane's analysis rather than being assumed. This used to match
// `/\bprops\s*</` with a comment conceding "`props` assumed un-aliased" — so
// `import { props as p }` fell through to the open `Record<string, unknown>` and a component's
// declared props stopped being checked at every call site, with no diagnostic. The build lane had
// resolved the local correctly the whole time (`localForSpecifier`); the two lanes now read it once.
function deriveProps(source: string, root: Root, propsLocal: string): string {
    const scripts: Script[] = []
    if (root.moduleScript !== null) scripts.push(root.moduleScript)
    if (root.instanceScript !== null) scripts.push(root.instanceScript)
    for (const script of scripts) {
        const content = source.slice(script.contentStart, script.contentEnd)
        const match = new RegExp(`\\b${escapeRegExp(propsLocal)}\\s*<`).exec(content)
        if (match !== null) {
            const lt = match.index + match[0].length - 1
            const gt = scanBalancedAngle(content, lt)
            if (gt !== -1) return content.slice(lt + 1, gt).trim()
        }
    }
    return 'Record<string, unknown>'
}

// Every name the component's own script OWNS: each import BINDING (the local name — `X as Y` owns `Y`)
// plus each locally declared type (`type`/`interface`/`enum`/`class`). Driven by the TS scanner rather
// than a regex so a name sitting inside a string or a comment cannot leak in as a binding.
//
// This does NOT use `BindingAnalysis.declared`, even though `deriveProps` next door now takes the
// analysis and the import half looks like a duplicate of `ImportBinding.named[].local`. It is not a
// duplicate: the build lane tracks the names a TEMPLATE EXPRESSION can resolve, so `declared` carries
// neither type declarations nor type-only imports. Measured on
// `import type { File } from './m.ts'; type Notification = …; const { item } = props<…>()`, `declared`
// is `["item", "props"]` — every name this function exists to shadow is absent.
//
// Consuming it would therefore un-shadow exactly the names the shadowing was written for. The
// companion carries no imports, so an owned type is MEANT to degrade to `any` — and it only degrades
// when TS cannot resolve the name, while the DOM lib declares `File`, `Event`, `Request`, `Text`,
// `Node`… so an unshadowed owned `File` types the prop as the BROWSER's `File`: not unchecked, checked
// against the wrong type, at every call site, silently. Two different questions, two walks.
function ownedNames(source: string, root: Root): Set<string> {
    const names = new Set<string>()
    const scripts: Script[] = []
    if (root.moduleScript !== null) scripts.push(root.moduleScript)
    if (root.instanceScript !== null) scripts.push(root.instanceScript)
    for (const script of scripts) {
        const scanner = createScanner(
            true,
            /* Standard */ 0,
            source.slice(script.contentStart, script.contentEnd),
        )
        let inImportClause = false
        // An import-clause identifier is held one token: `X as Y` binds `Y`, so `X` is discarded when
        // `as` turns out to follow it.
        let pending = ''
        let afterDeclarationKeyword = false
        for (;;) {
            const token = scanner.scan()
            if (token === SyntaxKind.EndOfFile) break
            if (pending !== '') {
                if (token !== SyntaxKind.AsKeyword) names.add(pending)
                pending = ''
            }
            if (afterDeclarationKeyword && token === SyntaxKind.Identifier)
                names.add(scanner.getTokenText())
            afterDeclarationKeyword =
                token === SyntaxKind.TypeKeyword ||
                token === SyntaxKind.InterfaceKeyword ||
                token === SyntaxKind.EnumKeyword ||
                token === SyntaxKind.ClassKeyword
            if (token === SyntaxKind.ImportKeyword) inImportClause = true
            // The specifier ends the clause; a side-effect `import './x.ts'` has no `from`.
            else if (token === SyntaxKind.FromKeyword || token === SyntaxKind.StringLiteral)
                inImportClause = false
            else if (inImportClause && token === SyntaxKind.Identifier)
                pending = scanner.getTokenText()
        }
        if (pending !== '') names.add(pending)
    }
    return names
}

// The identifiers `propsText` uses in TYPE-REFERENCE position. A property NAME is the one identifier
// that is not one, and it is exactly the identifier followed by `:` or `?`; a qualified name's tail
// (`Ns.Inner`) resolves through its head, which is what gets collected.
function referencedTypeNames(propsText: string): Set<string> {
    const names = new Set<string>()
    const scanner = createScanner(true, /* Standard */ 0, propsText)
    let pending = ''
    let previous = SyntaxKind.EndOfFile
    for (;;) {
        const token = scanner.scan()
        if (token === SyntaxKind.EndOfFile) break
        if (pending !== '' && token !== SyntaxKind.ColonToken && token !== SyntaxKind.QuestionToken)
            names.add(pending)
        pending =
            token === SyntaxKind.Identifier && previous !== SyntaxKind.DotToken
                ? scanner.getTokenText()
                : ''
        previous = token
    }
    if (pending !== '') names.add(pending)
    return names
}

// The typed `.d.ts` companion for a `.abide` file: its default export as a component whose props are
// `deriveProps`. Written next to the `.abide` during `abide check` so a verbatim `import X from
// "./X.abide"` resolves to this typed default instead of the ambient `declare module "*.abide"` (any).
// Errors INSIDE this file are never collected (only checked temp modules are), so a `props<T>()` that
// references a type the companion cannot resolve degrades that prop to `any` (no check, no false
// positive) — v1 omits the component's imports deliberately.
//
// That degradation only holds for a name TS CANNOT resolve. A name the script owns but the companion
// dropped still resolves whenever the DOM lib also declares it — and DOM took most of the common nouns
// (`File`, `Event`, `Request`, `Response`, `Text`, `Node`, `Range`, `Image`, `Location`, `Comment`). An
// `import type { File }` then typed the prop as the BROWSER's `File`: not unchecked, checked against
// the wrong type, at every call site, silently. So each owned name the props type references is shadowed
// with `any` here, which is what makes the documented degradation true for those names too. Only owned
// names — an unshadowed `Date`/`Promise`/`Map` is the global the author meant, and stays checked.
// `Component` is exempt: the companion declares it (shadowing would be a duplicate identifier).
export function componentDts(source: string, root: Root, analysis: BindingAnalysis): string {
    const props = deriveProps(source, root, analysis.propsLocal)
    const owned = ownedNames(source, root)
    let shadows = ''
    for (const name of referencedTypeNames(props))
        if (name !== 'Component' && owned.has(name)) shadows += `type ${name} = any;\n`
    return (
        // Self-contained `Component<P>` so a component-valued prop in `props<{ Row: Component<…> }>()`
        // resolves in this `.d.ts` companion (mirrors the check HEADER's definition).
        `type Component<__P = Record<string, unknown>> = (props: __P, children?: () => unknown) => unknown;\n` +
        shadows +
        `type __AbideProps = ${props};\n` +
        `declare const _default: (props: __AbideProps, children?: () => unknown) => unknown;\n` +
        `export default _default;\n`
    )
}

// ---------------------------------------------------------------------------
// Template walk
// ---------------------------------------------------------------------------

interface WalkEmit {
    source: string
    emitSynthetic: (text: string) => void
    emitOriginal: (absStart: number, text: string) => void
    emitExpr: (nodeStart: number, nodeEnd: number, exprText: string) => void
    emitAt: (abs: number, len: number) => void
    locate: (from: number, to: number, exprText: string) => number
    // The root `<script>` / `<script module>`, already emitted above the render body.
    rootScripts: Set<Script>
}

// Emit a `__ref(<verbatim expr>);` guard so the expression is type-checked in the current scope.
function refExpr(node: { start: number; end: number }, expr: string, e: WalkEmit): void {
    e.emitSynthetic('__ref(')
    e.emitExpr(node.start, node.end, expr)
    e.emitSynthetic(');\n')
}

// Same guard for a TEXT interpolation, through the sink that rejects a thenable.
//
// This is a CONCEPT BOUNDARY, not a typing apology (ADR 0027 D3). There are three read forms and they do
// different things: `{await fn()}` BLOCKS (the value lands in the initial HTML), `{fn.live()}` does NOT
// (reactive `T | undefined`), and `{#await fn()}` branches. A bare `{fn()}` is none of them — it is the
// AWAITABLE, and `emitServer` auto-awaits every expression slot — guarded (`isThenable(v) ? await v : v`),
// but still type-blind, so it cannot tell a promise-returning read from a plain value and a thenable is
// awaited either way — so it renders identically to `{await fn()}` while
// typing as `Promise<T>` — the author hits `Property 'x' does not exist on Promise<T>` at the first field
// access. Rejecting it keeps one spelling per behaviour.
//
// The auto-await is a passthrough BACKSTOP for the untyped path, which is why `__AbideNoPromise` below
// distributes and leaves `T | Promise<T>` legal on purpose. It is deliberately not a second way to spell
// the read: making the bare call mean "non-blocking" would need the emitter to carry types, and — the
// argument that actually decides it — a plain `.ts` has no compiler, so `fn(args)` is a `Promise<T>`
// there no matter what. One expression would mean two things by file extension, which is precisely what
// "isomorphism by default — same callable, same name, same intent on both sides" forbids.
function textExpr(node: { start: number; end: number }, expr: string, e: WalkEmit): void {
    e.emitSynthetic('__text(')
    e.emitExpr(node.start, node.end, expr)
    e.emitSynthetic(');\n')
}

function walk(nodes: TemplateNode[], e: WalkEmit): void {
    for (const node of nodes) walkNode(node, e)
}

function walkNode(node: TemplateNode, e: WalkEmit): void {
    switch (node.type) {
        case 'Text':
        case 'Comment':
        case 'Style':
            return
        case 'Script':
            // A ROOT script was already emitted above the render body. A BRANCH-LOCAL one is emitted
            // right here, inside the braces its block opened — which is both the correct lexical scope
            // (TS's own scoping then types every reference below it, and nothing above it) and the only
            // position that keeps the segment map monotonic. `analyzeBindings` has already required it
            // to be the block body's first node, so "here" and "hoisted to the top" are the same place.
            if (!e.rootScripts.has(node))
                emitScript(e.source, node, e.emitOriginal, e.emitSynthetic)
            return
        case 'Interpolation':
            // `{children()}` / `{name(args)}` component calls are ordinary interpolations — checked as-is,
            // but through the sink that rejects a bare thenable (see `textExpr`).
            textExpr(node, node.expression, e)
            return
        case 'Html':
            refExpr(node, node.expression, e)
            return
        case 'AwaitInterpolation':
            e.emitSynthetic('__ref(await (')
            e.emitExpr(node.start, node.end, node.expression)
            e.emitSynthetic('));\n')
            return
        case 'Element':
            emitAttributes(node.attributes, e)
            walk(node.children, e)
            return
        case 'Component':
            emitComponentCall(node, e)
            return
        case 'IfBlock':
            emitIf(node, e)
            return
        case 'ForBlock':
            emitFor(node, e)
            return
        case 'AwaitBlock':
            emitAwait(node, e)
            return
        case 'SwitchBlock':
            emitSwitch(node, e)
            return
        case 'TryBlock':
            emitTry(node, e)
            return
        case 'ComponentBlock':
            emitComponentDef(node, e)
            return
    }
}

function emitAttributes(attributes: AttributeNode[], e: WalkEmit): void {
    for (const attribute of attributes) {
        switch (attribute.type) {
            case 'StaticAttribute': {
                // `name="v"` / boolean carries no expression — but a quoted value INTERPOLATES
                // (`title="Count: {n}"`), and each of those is a real read at runtime. The check lane
                // used to treat the whole value as opaque text, so a typo'd identifier inside one was
                // invisible to `abide check` and to every LSP feature built on the same lowering.
                const parts = attributeParts(attribute)
                if (parts === null) break
                for (const part of parts) {
                    if ('expr' in part) refExpr({ start: part.start, end: part.end }, part.expr, e)
                }
                break
            }
            case 'ExpressionAttribute':
            case 'EventAttribute':
            case 'SpreadAttribute':
                refExpr(attribute, attribute.expression, e)
                break
            case 'BindDirective':
            case 'ClassDirective':
            case 'StyleDirective':
                if (attribute.expression !== null) refExpr(attribute, attribute.expression, e)
                break
        }
    }
}

// A component invocation `<Name a={x} b="lit" {...r}>…</Name>` → a typed call
// `Name({ "a": (x), "b": "lit", ...(r) }, () => { <children> })` against the component's `.d.ts`-declared
// props (PR2 cross-file). Prop VALUES are verbatim (mapped); keys + call scaffolding are synthetic;
// children ride an opaque `() => unknown` slot. Excess-property checks catch typo'd props on a CLOSED
// `props<T>()`; a spread or an OPEN (bare-props → `Record<string,unknown>`) component relaxes them.
function emitComponentCall(node: Extract<TemplateNode, { type: 'Component' }>, e: WalkEmit): void {
    e.emitExpr(node.start, node.end, node.name)
    e.emitSynthetic('({')
    for (const attr of node.attributes) {
        switch (attr.type) {
            case 'StaticAttribute': {
                // An INTERPOLATED prop is not a string literal, and typing it as one was a false
                // positive on legal code: `<Card count="{n}"/>` is identical to `count={n}` (the build
                // lane says so — a value that is exactly one `{expr}` plans as a bare expression), so a
                // component declaring `count: number` reported an error at every call site. A mixed
                // value (`label="a {n} b"`) is a `string`, and the concatenation is what says so.
                const parts = attributeParts(attr)
                if (parts === null) {
                    e.emitSynthetic(
                        ` ${JSON.stringify(attr.name)}: ${attr.value === null ? 'true' : JSON.stringify(attr.value)},`,
                    )
                    break
                }
                e.emitSynthetic(` ${JSON.stringify(attr.name)}: (`)
                const only = parts.length === 1 ? parts[0] : undefined
                if (only !== undefined && 'expr' in only) {
                    e.emitExpr(only.start, only.end, only.expr)
                } else {
                    e.emitSynthetic('""')
                    for (const part of parts) {
                        e.emitSynthetic(' + ')
                        if ('literal' in part) e.emitSynthetic(JSON.stringify(part.literal))
                        else {
                            e.emitSynthetic('(')
                            e.emitExpr(part.start, part.end, part.expr)
                            e.emitSynthetic(')')
                        }
                    }
                }
                e.emitSynthetic('),')
                break
            }
            // An `on<event>` on a component IS a prop (a component has no element to attach a native
            // listener to), so it types exactly like an expression attribute. Both emitters now pass it;
            // the server used to drop it, which made this the one lane that told the author the truth.
            case 'ExpressionAttribute':
            case 'EventAttribute':
                e.emitSynthetic(` ${JSON.stringify(attr.name)}: (`)
                e.emitExpr(attr.start, attr.end, attr.expression)
                e.emitSynthetic('),')
                break
            case 'BindDirective':
                if (attr.expression !== null) {
                    e.emitSynthetic(` ${JSON.stringify(attr.name)}: (`)
                    e.emitExpr(attr.start, attr.end, attr.expression)
                    e.emitSynthetic('),')
                }
                break
            // UNREACHABLE: `templatePlan` rejects `class:`/`style:` on a component, and the check lane
            // asks that gate (`validateTemplate`) BEFORE it emits — `check.ts` reports and `continue`s.
            // Kept as explicit no-op arms rather than folded in with `bind:`, because typing them as
            // props is what this lane used to do and it was wrong in a way nothing caught: the author was
            // told the directive was a valid, type-checked prop while both runtimes dropped it.
            case 'ClassDirective':
            case 'StyleDirective':
                break
            case 'SpreadAttribute':
                e.emitSynthetic(' ...(')
                e.emitExpr(attr.start, attr.end, attr.expression)
                e.emitSynthetic('),')
                break
        }
    }
    // A nested `{#component X()}` inside `<Foo>…</Foo>` is forwarded to Foo as its `X` prop (the runtime
    // lifts it). Satisfy the prop requirement here; its body is not re-checked at the call site (a v1
    // limit — precise typing would fight the verbatim source-map monotonicity invariant).
    const bodyChildren = node.children.filter((n) => n.type !== 'ComponentBlock')
    for (const child of node.children)
        if (child.type === 'ComponentBlock')
            e.emitSynthetic(` ${JSON.stringify(child.name)}: (undefined as any),`)
    e.emitSynthetic(' }')
    if (bodyChildren.length > 0) {
        // `async` so `{await}` / `{#await}` / `{#for await}` inside the component's children keep their
        // async context (the slot type `() => unknown` accepts an async thunk — it returns a Promise).
        e.emitSynthetic(', async () => {\n')
        walk(bodyChildren, e)
        e.emitSynthetic('}')
    }
    e.emitSynthetic(');\n')
}

function emitIf(node: Extract<TemplateNode, { type: 'IfBlock' }>, e: WalkEmit): void {
    node.branches.forEach((branch, index) => {
        if (branch.condition === null) {
            e.emitSynthetic(' else {\n')
        } else {
            e.emitSynthetic(index === 0 ? 'if (' : ' else if (')
            e.emitExpr(branch.start, branch.end, branch.condition)
            e.emitSynthetic(') {\n')
        }
        walk(branch.children, e)
        e.emitSynthetic('}')
    })
    e.emitSynthetic('\n')
}

function emitFor(node: Extract<TemplateNode, { type: 'ForBlock' }>, e: WalkEmit): void {
    // Locate the header expressions in SOURCE order (`item`, `index`, `iterable`, `by key`) with an
    // advancing cursor, so a short binding name that is a substring of an earlier one can't collide.
    let cursor = node.start
    const advance = (text: string): number => {
        const at = e.locate(cursor, node.end, text)
        if (at !== -1) cursor = at + text.length
        return at
    }
    const itemAt = advance(node.item)
    const indexAt = node.index !== null ? advance(node.index) : -1
    const iterAt = advance(node.iterable)
    const keyAt = node.key !== null ? advance(node.key) : -1
    // Emit a located span verbatim, or fall back to un-mapped synthetic text.
    const put = (at: number, text: string): void => {
        if (at !== -1) e.emitAt(at, text.length)
        else e.emitSynthetic(text)
    }

    if (node.await) {
        // `{#for await item of source}` — async iterable; optional `{:catch e}`.
        if (node.catch !== null) e.emitSynthetic('try {\n')
        // `await` the source to mirror the runtime (`forAwaitStream`/`toIterator` awaits it): a streaming
        // RPC read is `Promise<AsyncIterable<C>>`, and `for await` cannot iterate a Promise directly. For a
        // non-promise (bare async generator) source `await` is an identity, so this is correct for both.
        e.emitSynthetic('for await (const ')
        put(itemAt, node.item)
        e.emitSynthetic(' of (await (')
        put(iterAt, node.iterable)
        e.emitSynthetic('))) {\n')
        walk(node.children, e)
        e.emitSynthetic('}\n')
        if (node.catch !== null) {
            e.emitSynthetic('} catch (')
            if (node.catch.param !== null)
                emitClauseBinding(e, node.catch, 'catch', node.catch.param)
            else e.emitSynthetic('__e')
            e.emitSynthetic(') {\n')
            walk(node.catch.children, e)
            e.emitSynthetic('}\n')
        }
        return
    }
    if (node.index !== null) {
        e.emitSynthetic('for (const [')
        put(indexAt, node.index)
        e.emitSynthetic(', ')
        put(itemAt, node.item)
        e.emitSynthetic('] of __entries(')
        put(iterAt, node.iterable)
        e.emitSynthetic(')) {\n')
    } else {
        e.emitSynthetic('for (const ')
        put(itemAt, node.item)
        e.emitSynthetic(' of (')
        put(iterAt, node.iterable)
        e.emitSynthetic(')) {\n')
    }
    if (node.key !== null) {
        // `by key` references the item binding — check it inside the loop body.
        e.emitSynthetic('__ref(')
        put(keyAt, node.key)
        e.emitSynthetic(');\n')
    }
    walk(node.children, e)
    e.emitSynthetic('}\n')
}

// Emit a clause binding identifier — `{:then x}` / `{:catch e}`, or the inline `then x` / `catch e`
// openers — source-mapped, so hover and go-to-definition resolve on it. An unmapped synthetic binding
// (what these used to be) has no `.abide` span, so the editor shows nothing when you hover it. The
// search is scoped to after the clause keyword and before the clause body, so a short binding name
// can't collide with the keyword itself or the awaited expression.
function emitClauseBinding(
    e: WalkEmit,
    clause: { start: number; end: number; children: TemplateNode[] },
    keyword: string,
    param: string,
): void {
    const bodyStart = clause.children[0]?.start ?? clause.end
    const keywordAt = e.locate(clause.start, bodyStart, keyword)
    const from = keywordAt === -1 ? clause.start : keywordAt + keyword.length
    e.emitExpr(from, bodyStart, param)
}

function emitAwait(node: Extract<TemplateNode, { type: 'AwaitBlock' }>, e: WalkEmit): void {
    e.emitSynthetic('{\n')
    walk(node.pending, e)
    e.emitSynthetic('try {\n')
    if (node.then !== null && node.then.param !== null) {
        e.emitSynthetic('const ')
        emitClauseBinding(e, node.then, 'then', node.then.param)
        e.emitSynthetic(' = await (')
        e.emitExpr(node.start, node.end, node.expression)
        e.emitSynthetic(');\n')
    } else {
        e.emitSynthetic('await (')
        e.emitExpr(node.start, node.end, node.expression)
        e.emitSynthetic(');\n')
    }
    if (node.then !== null) walk(node.then.children, e)
    e.emitSynthetic('} catch (')
    if (node.catch !== null && node.catch.param !== null)
        emitClauseBinding(e, node.catch, 'catch', node.catch.param)
    else e.emitSynthetic('__e')
    e.emitSynthetic(') {\n')
    if (node.catch !== null) walk(node.catch.children, e)
    e.emitSynthetic('}\n')
    if (node.finally !== null) {
        e.emitSynthetic('{\n')
        walk(node.finally.children, e)
        e.emitSynthetic('}\n')
    }
    e.emitSynthetic('}\n')
}

function emitSwitch(node: Extract<TemplateNode, { type: 'SwitchBlock' }>, e: WalkEmit): void {
    walk(node.leading, e)
    e.emitSynthetic('switch (')
    e.emitExpr(node.start, node.end, node.discriminant)
    e.emitSynthetic(') {\n')
    for (const arm of node.cases) {
        if (arm.test === null) {
            e.emitSynthetic('default: {\n')
        } else {
            e.emitSynthetic('case (')
            e.emitExpr(arm.start, arm.end, arm.test)
            e.emitSynthetic('): {\n')
        }
        walk(arm.children, e)
        e.emitSynthetic('break;\n}\n')
    }
    e.emitSynthetic('}\n')
}

function emitTry(node: Extract<TemplateNode, { type: 'TryBlock' }>, e: WalkEmit): void {
    e.emitSynthetic('try {\n')
    walk(node.children, e)
    e.emitSynthetic('} catch (')
    if (node.catch !== null && node.catch.param !== null)
        emitClauseBinding(e, node.catch, 'catch', node.catch.param)
    else e.emitSynthetic('__e')
    e.emitSynthetic(') {\n')
    if (node.catch !== null) walk(node.catch.children, e)
    e.emitSynthetic('}\n')
    if (node.finally !== null) {
        e.emitSynthetic('{\n')
        walk(node.finally.children, e)
        e.emitSynthetic('}\n')
    }
}

function emitComponentDef(
    node: Extract<TemplateNode, { type: 'ComponentBlock' }>,
    e: WalkEmit,
): void {
    e.emitSynthetic('function ')
    e.emitSynthetic(node.name)
    e.emitSynthetic('(')
    if (node.params.trim().length > 0) {
        e.emitExpr(node.start, node.end, node.params)
        e.emitSynthetic(', ')
    }
    // The invocation `<Name …>children</Name>` lowers to `Name(props, () => {…})`; a component need not
    // declare a `children` param (the runtime fills `<slot/>` automatically), so absorb the trailing
    // children/scope args here to keep the call arity valid.
    e.emitSynthetic('...$rest: unknown[]) {\n')
    walk(node.children, e)
    e.emitSynthetic('}\n')
}

// ---------------------------------------------------------------------------
// Script lowering (moved from check.ts — the script-only subset)
// ---------------------------------------------------------------------------

// The check lane walks the SAME token stream the build lane does. It used to drive its own scanner
// with its own brace/template frame stack and its own `OPEN`/`CLOSE` sets — a second lexer whose
// comment said it "mirrors `analyzeBindings.tokenize()`" — and its own statement-end scan alongside.
// Mirroring is what the two lanes must not do: they keep separate LOWERINGS on purpose, but where a
// statement ENDS is not a lowering, it is a fact about the source, and both lanes reading one answer
// is the only thing that makes a case added to either test suite mean anything for the other.
function emitScript(
    source: string,
    script: Script,
    emitOriginal: (absStart: number, text: string) => void,
    emitSynthetic: (text: string) => void,
): void {
    const content = source.slice(script.contentStart, script.contentEnd)
    const base = script.contentStart
    const tokens = tokenize(content)
    let copyFrom = 0
    let depth = 0
    let atStatementStart = true

    const flush = (uptoRel: number): void => {
        if (uptoRel > copyFrom) emitOriginal(base + copyFrom, content.slice(copyFrom, uptoRel))
        copyFrom = uptoRel
    }

    for (let i = 0; i < tokens.length; i++) {
        const t = tokenAt(tokens, i)
        const kind = t.kind
        if (depth === 0 && t.nl) atStatementStart = true
        if (depth === 0 && atStatementStart) {
            if (kind === SyntaxKind.AsyncKeyword) continue
            if (
                kind === SyntaxKind.LetKeyword ||
                kind === SyntaxKind.ConstKeyword ||
                kind === SyntaxKind.VarKeyword
            ) {
                const declaratorsStart = t.end
                const { lastIdx, nextIdx, end } = statementExtent(tokens, i)
                flush(t.start)
                emitDeclarators(
                    t.text,
                    content.slice(declaratorsStart, tokenAt(tokens, lastIdx).end),
                    base + declaratorsStart,
                    emitOriginal,
                    emitSynthetic,
                )
                copyFrom = end
                i = nextIdx - 1
                atStatementStart = true
                continue
            }
        }
        if (isOpen(kind)) depth++
        else if (isClose(kind)) depth--
        atStatementStart =
            depth === 0 &&
            (kind === SyntaxKind.SemicolonToken || kind === SyntaxKind.CloseBraceToken)
    }

    flush(content.length)
    emitSynthetic('\n')
}

function emitDeclarators(
    keyword: string,
    rawDeclarators: string,
    absBase: number,
    emitOriginal: (absStart: number, text: string) => void,
    emitSynthetic: (text: string) => void,
): void {
    for (const part of splitTopLevel(rawDeclarators)) {
        const text = part.text
        const partAbs = absBase + part.start
        const equalsIndex = topLevelAssignmentIndex(text)
        const pattern = (equalsIndex === -1 ? text : text.slice(0, equalsIndex)).trim()
        if (pattern === '') continue
        // A bare identifier binding, with an OPTIONAL type annotation (`bar` or `bar: T`). Either way the
        // init is unwrapped, so `let bar: Item[] = state([])` type-checks against its annotation and an
        // inferred `let bar = state(0)` reads as `number`. Destructuring patterns (`{…}`/`[…]`) and
        // un-initialized declarators are copied verbatim — a cell is never destructured.
        const isSimpleBinding = /^[A-Za-z_$][\w$]*\s*(:[\s\S]+)?$/.test(pattern)
        if (!isSimpleBinding || equalsIndex === -1) {
            emitSynthetic(`${keyword} `)
            emitOriginal(partAbs, text)
            emitSynthetic(';\n')
            continue
        }
        const patternText = text.slice(0, equalsIndex)
        const initText = text.slice(equalsIndex + 1)
        emitSynthetic(`${keyword} `)
        emitOriginal(partAbs, patternText)
        emitSynthetic(`= __abideUnwrap(`)
        emitOriginal(partAbs + equalsIndex + 1, initText)
        emitSynthetic(`);\n`)
    }
}

// ---------------------------------------------------------------------------
// String utilities (depth + quote aware)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bidirectional offset mapping
// ---------------------------------------------------------------------------

// Generated offset → original `.abide` offset. Positions inside synthetic scaffolding snap to the
// nearest following (else preceding) verbatim segment (best-effort; see §1.11 of the plan).
export function mapGenToOrig(segments: Segment[], genPos: number): number {
    for (const segment of segments) {
        if (genPos >= segment.genStart && genPos < segment.genEnd)
            return segment.origStart + (genPos - segment.genStart)
    }
    let best: Segment | undefined
    for (const segment of segments) {
        if (segment.genStart >= genPos) {
            best = segment
            break
        }
    }
    if (best !== undefined) return best.origStart
    const last = segments[segments.length - 1]
    return last !== undefined ? last.origStart : 0
}

// Original `.abide` offset → generated offset. Used by the LSP to translate an editor position into the
// generated module before querying the checker. Segments are monotonic in `origStart`, so the same
// array answers both directions. A position not inside any verbatim segment (synthetic-only) returns -1.
export function mapOrigToGen(segments: Segment[], origPos: number): number {
    for (const segment of segments) {
        const origEnd = segment.origStart + (segment.genEnd - segment.genStart)
        if (origPos >= segment.origStart && origPos < origEnd)
            return segment.genStart + (origPos - segment.origStart)
    }
    return -1
}
