// `.abide` TEMPLATE PLAN (Stage 1, PR3) — BUILD/SERVER-SIDE ONLY.
//
// The single shared walk over a parsed `Root` that decides comment anchors ONCE, so the emitted
// client and server modules can never drift. It records, per template boundary (the root and each
// block/component/component body):
//   • `skeletonClient` — static HTML with comment anchors (`<!---->` for interp/await/html leaves,
//     paired `<!--[-->…<!--]-->` for blocks/components). Cloned + cursor-walked by emitted client code.
//   • `slots` — the dynamic wiring points, each with a `path: number[]` of child-index steps from the
//     cloned fragment root (firstChild + nextSibling walk) and an already-rewritten `expr`.
//   • `serverChunks` — an ordered static-text ⨉ dynamic-slot tree the server emitter concatenates.
//   • `scopeAttr` / `scopedCss` — #13 root scoped styles.
//
// Every embedded expression is rewritten via `rewriteCellRefs` (cells → `()/.set()`) then
// `rewriteFreeIdentifiers` (free/block-bound names → `$scope.x`), so both emitters consume ready-to-
// embed source. This module uses the TS7 scanner (through analyzeBindings) and NEVER ships to the browser.

import type { BindingAnalysis, NestedScript } from './analyzeBindings.ts'
import { type CellBindings, rewriteCellRefs, rewriteFreeIdentifiers } from './analyzeBindings.ts'
import type { AttributeNode, Root, Script, TemplateNode } from './ast.ts'
import { BLOCK_ANCHOR } from './BLOCK_ANCHOR.ts'
import { HTML_ANCHOR } from './HTML_ANCHOR.ts'
import { escapeHtml } from './serverRuntime.ts'

// The clone skeleton's placeholder for one block/component: the paired anchors with an EMPTY body. The
// server paints content between them; the claim walk reconciles the two by depth-counting the pair.
const BLOCK_SKELETON = `<!--${BLOCK_ANCHOR.open}--><!--${BLOCK_ANCHOR.close}-->`

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SlotKind =
    | 'interpolation'
    | 'html'
    | 'await'
    | 'attr'
    | 'event'
    | 'class'
    | 'style'
    | 'bind'
    | 'spread'
    | 'if'
    | 'for'
    | 'awaitBlock'
    | 'switch'
    | 'try'
    | 'component'
    | 'componentDef'
    | 'script'

// The tag name of a DYNAMIC element (one with its own dynamic attrs or dynamic descendants), keyed by
// its child-index `path` within the template level. Threaded to the client emitter so the hydrate walk
// can emit a cheap `claimElement($node, tag)` assertion at each such element (PR6, decision 5).
export interface ElementTag {
    path: number[]
    tag: string
}

// A client sub-plan: its own cloned template + slots (used for a block/component/component body).
export interface ClientPlan {
    skeleton: string
    slots: DynamicSlot[]
    elementTags?: ElementTag[]
}

export interface DynamicSlot {
    kind: SlotKind
    path: number[] // child-index path to the target (element for attrs; anchor for leaves/blocks)
    expr: string | null // primary rewritten expression
    // Leaf slots only (interp/html/await): the UTF-16 length of the immediately-preceding static text
    // node (0 when the previous sibling is a comment/element/block/none). Threaded to `claimText` so
    // hydration can split the server's merged `static+value` text node at the right offset (plan §1).
    prefixLen?: number
    meta: SlotMeta
}

// Kind-specific slot payloads (loosely a bag; documented per kind).
export interface SlotMeta {
    name?: string // attr / class / style / bind / component name
    event?: string // event name (without `on`)
    attrs?: AttrPlan[] // component props
    branches?: BranchPlan[] // if / switch
    discriminant?: string // switch
    leading?: ClientPlan // switch leading nodes
    pending?: ClientPlan // await block
    then?: ClausePlan | null
    catch?: ClausePlan | null
    finally?: ClientPlan | null
    body?: ClientPlan // component children / try / component-def
    hasChildren?: boolean // component
    await?: boolean // for
    item?: string // for item pattern
    index?: string | null // for index name
    iterable?: string // for iterable (rewritten)
    key?: string | null // for key (rewritten)
    params?: string // component params
    siteId?: number // component: its stable per-module site id (see `WalkState.nextSiteId`)
    // for: does the body invoke a component, or own a branch-local `<script>`? Either one needs a
    // per-item `state` factory, so that each iteration's cells get their own hydration-seed bucket.
    hasComponent?: boolean
    hasScript?: boolean
    // component: the rewritten expression that RESOLVES the tag (`Card`, `$scope.Row`, `$scope.C()`),
    // decided here where the level's bindings are known rather than re-derived per emitter.
    ref?: string
    reactive?: boolean // component: a cell-/memo-named tag, which re-mounts on identity change
    setup?: string // script: the branch-local `<script>` preamble (analyzeBindings.NestedScript)
}

export interface BranchPlan {
    expr: string | null // condition / case test (rewritten); null = else/default
    plan: ClientPlan
}

export interface ClausePlan {
    param: string | null
    plan: ClientPlan
}

// An element/component attribute, classified with rewritten expressions.
export type AttrPlan =
    | { kind: 'static'; name: string; value: string | null }
    | { kind: 'expr'; name: string; expr: string }
    | { kind: 'event'; name: string; event: string; expr: string }
    | { kind: 'class'; name: string; expr: string }
    | { kind: 'style'; name: string; expr: string }
    | { kind: 'bind'; name: string; expr: string }
    | { kind: 'spread'; expr: string }

// A server chunk tree node.
export type ServerChunk =
    | { kind: 'static'; text: string }
    | { kind: 'interp'; expr: string }
    | { kind: 'html'; expr: string }
    | { kind: 'await'; expr: string }
    | {
          kind: 'element'
          name: string
          void: boolean
          attrs: AttrPlan[]
          children: ServerChunk[]
          // Every scope attribute in force here: the component's own (a root `<style>`) plus one per
          // enclosing nested `<style>`. All of them are stamped, so an outer rule still reaches into an
          // inner-scoped subtree while the inner rule cannot reach out.
          scopeAttrs: string[]
      }
    | {
          kind: 'component'
          name: string
          ref: string
          attrs: AttrPlan[]
          children: ServerChunk[]
          hasChildren: boolean
          siteId: number
      }
    | { kind: 'if'; branches: { expr: string | null; children: ServerChunk[] }[] }
    | {
          kind: 'for'
          await: boolean
          item: string
          index: string | null
          iterable: string
          children: ServerChunk[]
          catch: { param: string | null; children: ServerChunk[] } | null
          hasComponent: boolean
          hasScript: boolean
      }
    | {
          kind: 'awaitBlock'
          expr: string
          pending: ServerChunk[]
          then: { param: string | null; children: ServerChunk[] } | null
          catch: { param: string | null; children: ServerChunk[] } | null
          finally: ServerChunk[] | null
          // Inline shorthand `{#await p then v}` blocks; the full `{#await}{:then}` block streams (SSR).
          inline: boolean
      }
    | {
          kind: 'switch'
          discriminant: string
          cases: { expr: string | null; children: ServerChunk[] }[]
      }
    | {
          kind: 'try'
          children: ServerChunk[]
          catch: { param: string | null; children: ServerChunk[] } | null
          finally: ServerChunk[] | null
      }
    | { kind: 'componentDef'; name: string; params: string; children: ServerChunk[] }
    | { kind: 'style'; css: string }
    | { kind: 'script'; setup: string }

export interface TemplatePlan {
    skeletonClient: string
    slots: DynamicSlot[]
    serverChunks: ServerChunk[]
    elementTags: ElementTag[]
}

// ---------------------------------------------------------------------------
// #13 scoped styles
// ---------------------------------------------------------------------------

// Small deterministic FNV-1a hash → hex, for the scope attribute suffix.
function hashSource(source: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < source.length; i++) {
        hash ^= source.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16)
}

// Append the scope attribute selector to each top-level selector of a CSS block. Best-effort (Stage 1
// root scope): rewrites the selector list before each `{`, skipping at-rules and keyframe stops.
export function scopeStyles(css: string, scopeAttr: string): string {
    const selector = `[${scopeAttr}]`
    let out = ''
    let index = 0
    while (index < css.length) {
        const braceAt = css.indexOf('{', index)
        if (braceAt === -1) {
            out += css.slice(index)
            break
        }
        const prelude = css.slice(index, braceAt)
        const trimmed = prelude.trim()
        if (trimmed.startsWith('@')) {
            // At-rule (media/keyframes/etc.) — leave the prelude untouched.
            out += `${prelude}{`
        } else {
            const scoped = prelude
                .split(',')
                .map((part) => {
                    const t = part.trim()
                    return t === '' ? part : part.replace(t, t + selector)
                })
                .join(',')
            out += `${scoped}{`
        }
        index = braceAt + 1
    }
    return out
}

// ---------------------------------------------------------------------------
// The shared walk
// ---------------------------------------------------------------------------

interface WalkState {
    cellBindings: CellBindings
    declared: Set<string>
    // Branch-local `<script>` preambles, keyed by node (analyzeBindings validated where each may sit).
    nested: Map<Script, NestedScript>
    // The scope attributes in force, outermost first: the component's own (root `<style>`) plus one per
    // enclosing nested `<style>`. Pushed/popped around a level's walk.
    scopeAttrs: string[]
    // Every component name reachable in this template — inline `{#component}` defs at any depth plus the
    // locals of imported `.abide` components. Used to reject the call form `{Name(…)}` (see `rejectComponentCall`).
    componentNames: Set<string>
    // Monotonic per-MODULE counter handing each `<Component/>` invocation a STABLE site id. Mutated
    // through the shared ctx object so the whole recursive walk draws from one sequence. Both emitters
    // read the id off the same plan, so server and client name a component instance identically —
    // which is the point: seed buckets keyed by site are immune to mount-ORDER divergence.
    nextSiteId: number
}

interface LevelResult {
    skeleton: string
    slots: DynamicSlot[]
    server: ServerChunk[]
    elementTags: ElementTag[]
    // Does this level (at ANY depth) invoke a component? A `{#for}` body that does needs its per-item
    // scope to carry an item-scoped state factory, so components inside the loop get distinct seed
    // buckets per iteration. Loops that don't are the common case and skip the per-item allocation.
    hasComponent: boolean
    // Same question for a branch-local `<script>`, which needs the same per-item factory for the same
    // reason: its `state()` calls are per ITERATION, so they must not share one ordinal sequence.
    hasScript: boolean
}

function rewriteExpr(ctx: WalkState, expr: string): string {
    const cellRewritten = rewriteCellRefs(expr, ctx.cellBindings)
    return rewriteFreeIdentifiers(cellRewritten, ctx.declared, '$scope')
}

// The expression that REACHES a bare binding without reading it — lexical when a script declared it in
// the emitted frame, `$scope`-qualified when it is published there instead (a branch-local `<script>`'s
// binding). `rewriteExpr` can't serve this: on a cell it produces the READ, `name()`.
function bindingRef(ctx: WalkState, name: string): string {
    return ctx.declared.has(name) ? name : `$scope.${name}`
}

// The scope attribute a level's own `<style>` nodes establish, or null when it has none. Content-hashed,
// so two branches carrying identical CSS share one attribute — their rules are identical, and sharing
// keeps the emitted markup smaller.
function levelScopeAttr(nodes: TemplateNode[]): string | null {
    let css = ''
    for (const node of nodes) if (node.type === 'Style') css += node.content
    return css === '' ? null : `data-ab-${hashSource(css)}`
}

// The branch-local `<script>` this level owns, if any. `analyzeBindings` has already enforced that one
// can only appear as the first node of a block body, so finding it is a lookup, not a search.
function levelScript(ctx: WalkState, nodes: TemplateNode[]): NestedScript | null {
    for (const node of nodes) {
        if (node.type !== 'Script') continue
        const info = ctx.nested.get(node)
        if (info !== undefined) return info
    }
    return null
}

// Collect every component name declared or imported in this template, at any nesting depth. A nested
// `{#component}` inside `<Foo>…</Foo>` is a render-prop for Foo but is still defined at the caller's level,
// so a flat set over the whole tree is the right granularity.
function collectComponentNames(nodes: TemplateNode[], into: Set<string>): void {
    for (const node of nodes) {
        switch (node.type) {
            case 'ComponentBlock':
                into.add(node.name)
                collectComponentNames(node.children, into)
                break
            case 'Element':
            case 'Component':
                collectComponentNames(node.children, into)
                break
            case 'IfBlock':
                for (const branch of node.branches) collectComponentNames(branch.children, into)
                break
            case 'ForBlock':
                collectComponentNames(node.children, into)
                if (node.catch !== null) collectComponentNames(node.catch.children, into)
                break
            case 'AwaitBlock':
                collectComponentNames(node.pending, into)
                if (node.then !== null) collectComponentNames(node.then.children, into)
                if (node.catch !== null) collectComponentNames(node.catch.children, into)
                if (node.finally !== null) collectComponentNames(node.finally.children, into)
                break
            case 'SwitchBlock':
                collectComponentNames(node.leading, into)
                for (const arm of node.cases) collectComponentNames(arm.children, into)
                break
            case 'TryBlock':
                collectComponentNames(node.children, into)
                if (node.catch !== null) collectComponentNames(node.catch.children, into)
                if (node.finally !== null) collectComponentNames(node.finally.children, into)
                break
        }
    }
}

// A component is invoked as a TAG (`<Name/>`) — a component slot with its own paired `<!--[-->…<!--]-->`
// anchors on both emitters. The call form `{Name(…)}` used to render the same subtree at a scalar LEAF
// position, which forced the server to pick its anchor shape at render time and the hydrate walk to peek
// for it. That form is gone; reject it here, where the component name is known, so the author gets the
// fix rather than a stray `[object Object]` (the runtime guards in `serverRuntime.renderLeaf` /
// `runtime.interpolate` catch only the case this cannot see — a component arriving through props).
function rejectComponentCall(ctx: WalkState, expression: string): void {
    for (const name of ctx.componentNames) {
        if (!expression.includes(name)) continue
        // Not preceded by `.`/word char, so `obj.Name(` and `MyName(` don't false-positive. A component
        // name inside a STRING literal in the expression still would — accepted: it is vanishingly rare
        // next to the desync the call form causes, and the message names the fix either way.
        if (!new RegExp(`(^|[^.\\w$])${name}\\s*\\(`).test(expression)) continue
        throw new Error(
            `{${name}(…)} is not a valid interpolation — an interpolation renders text. ` +
                `Invoke the component as a tag instead: <${name} …/>.`,
        )
    }
}

// One piece of a quoted attribute value: a literal run or a `{expr}` interpolation.
type AttrPart = { literal: string } | { expr: string }

// Skip a JS string / template literal at `s[i]` (its opening quote), returning the index just past
// the closing quote. Honours backslash escapes; template-literal `${…}` recurses through the balanced
// brace scan so a `}` inside an embedded expression doesn't end the string early.
function skipAttrString(s: string, i: number): number {
    const quote = s[i]
    if (quote === undefined) return i
    i++
    while (i < s.length) {
        const c = s[i]
        if (c === undefined) break
        if (c === '\\') {
            i += 2
            continue
        }
        if (quote === '`' && c === '$' && s[i + 1] === '{') {
            i = scanBalancedBrace(s, i + 2) + 1
            continue
        }
        if (c === quote) return i + 1
        i++
    }
    return i
}

// From `start` (just inside a `{`), scan to the matching top-level `}` and return its index. Balanced
// over (), [], {} and skips strings/template literals — mirrors the parser's scanBalancedUntilBrace.
function scanBalancedBrace(s: string, start: number): number {
    let depth = 0
    let i = start
    while (i < s.length) {
        const c = s[i]
        if (c === undefined) break
        if (c === "'" || c === '"' || c === '`') {
            i = skipAttrString(s, i)
            continue
        }
        if (c === '(' || c === '[' || c === '{') {
            depth++
            i++
            continue
        }
        if (c === ')' || c === ']') {
            depth--
            i++
            continue
        }
        if (c === '}') {
            if (depth === 0) return i
            depth--
            i++
            continue
        }
        i++
    }
    return i
}

// Split a quoted attribute value into literal + `{expr}` interpolation parts, or null when it has no
// interpolation (pure static). Mirrors element-content interpolation: `{` starts an expression; a
// literal brace is written `{'{'}` (or, in `html()` text, an HTML entity).
function splitAttrValue(value: string): AttrPart[] | null {
    if (!value.includes('{')) return null
    const parts: AttrPart[] = []
    let i = 0
    let literalStart = 0
    while (i < value.length) {
        if (value[i] === '{') {
            if (i > literalStart) parts.push({ literal: value.slice(literalStart, i) })
            const exprStart = i + 1
            const close = scanBalancedBrace(value, exprStart)
            parts.push({ expr: value.slice(exprStart, close).trim() })
            i = close + 1
            literalStart = i
        } else {
            i++
        }
    }
    if (literalStart < value.length) parts.push({ literal: value.slice(literalStart) })
    return parts
}

function planAttribute(ctx: WalkState, attr: AttributeNode): AttrPlan {
    switch (attr.type) {
        case 'StaticAttribute': {
            // A quoted attribute value may carry `{expr}` interpolations (`title="Count: {n}"`), including
            // on a component prop. Compile it to a reactive `expr` attribute that concatenates the parts;
            // a value that is exactly `{expr}` is identical to `name={expr}`. No interpolation → static.
            const parts = attr.value === null ? null : splitAttrValue(attr.value)
            if (parts?.some((part) => 'expr' in part)) {
                const only = parts.length === 1 ? parts[0] : undefined
                if (only && 'expr' in only) {
                    return { kind: 'expr', name: attr.name, expr: rewriteExpr(ctx, only.expr) }
                }
                const pieces = parts.map((part) =>
                    'literal' in part
                        ? JSON.stringify(part.literal)
                        : `(${rewriteExpr(ctx, part.expr)})`,
                )
                return { kind: 'expr', name: attr.name, expr: `"" + ${pieces.join(' + ')}` }
            }
            return { kind: 'static', name: attr.name, value: attr.value }
        }
        case 'ExpressionAttribute':
            return { kind: 'expr', name: attr.name, expr: rewriteExpr(ctx, attr.expression) }
        case 'EventAttribute':
            return {
                kind: 'event',
                name: attr.name,
                event: attr.event,
                expr: rewriteExpr(ctx, attr.expression),
            }
        case 'ClassDirective':
            return {
                kind: 'class',
                name: attr.name,
                expr: rewriteExpr(ctx, attr.expression ?? attr.name),
            }
        case 'StyleDirective':
            return {
                kind: 'style',
                name: attr.name,
                expr: rewriteExpr(ctx, attr.expression ?? attr.name),
            }
        case 'BindDirective': {
            const boundRaw = (attr.expression ?? attr.name).trim()
            // A bare state var — `bind:value={count}` over `let count = state(...)` — used to be a
            // documented known-limit (TODO #14): `rewriteExpr` collapses `count` to a READ (`count()`),
            // so the two-way bind received the VALUE, not a writable accessor, and silently no-op'd. Wrap a
            // bare cell in the same `{ get, set }` accessor the manual workaround uses, so value/checked/group
            // binds sync both ways. `count` is a declared lexical cell in the emitted mount/render, so it needs
            // no `$scope`/cell-ref rewrite. `bind:element` over a bare cell (`let node = state(null)`) needs the
            // SAME wrap (TODO #22): otherwise the cell collapses to `node()` and the node ref is never
            // assigned — `bindElement` writes the element through the `set`. An attach FN (`bind:element={fn}`)
            // is not a cell name, so it falls through to `rewriteExpr` and stays a callable.
            if (ctx.cellBindings.cells.has(boundRaw)) {
                const cell = bindingRef(ctx, boundRaw)
                return {
                    kind: 'bind',
                    name: attr.name,
                    expr: `{ get: () => ${cell}(), set: ($v) => ${cell}.set($v) }`,
                }
            }
            return {
                kind: 'bind',
                name: attr.name,
                expr: rewriteExpr(ctx, attr.expression ?? attr.name),
            }
        }
        case 'SpreadAttribute':
            return { kind: 'spread', expr: rewriteExpr(ctx, attr.expression) }
    }
}

// Static attribute string (client skeleton) for an element's static attrs + the scope attrs in force.
function staticAttrString(attrs: AttrPlan[], scopeAttrs: string[]): string {
    let out = ''
    for (const attr of attrs) {
        if (attr.kind !== 'static') continue
        if (attr.value === null) out += ` ${attr.name}`
        // `escapeHtml`, not an attribute-specific variant: it is a strict superset (it also escapes
        // `'`, inert inside a double-quoted value) and carries the probe-first fast path. Two escapers
        // is how the skeleton and the server render come to disagree about one character.
        else out += ` ${attr.name}="${escapeHtml(attr.value)}"`
    }
    for (const scopeAttr of scopeAttrs) out += ` ${scopeAttr}`
    return out
}

function toClientPlan(result: LevelResult): ClientPlan {
    return { skeleton: result.skeleton, slots: result.slots, elementTags: result.elementTags }
}

// One template level: its own `<style>` scope, its own branch-local `<script>`, then the node walk.
//
// Both are pushed for the WHOLE level (including every level nested inside it) and popped after. The
// script overlay SWAPS the binding sets rather than mutating them — the sets are read by reference all
// through the walk, and a swap keeps the enclosing level's meaning of a shadowed name intact. Neither
// push is unwound on a throw: a throw here fails the compile outright, so there is no later walk to
// corrupt.
function walkLevel(ctx: WalkState, nodes: TemplateNode[]): LevelResult {
    const scopeAttr = levelScopeAttr(nodes)
    if (scopeAttr !== null) ctx.scopeAttrs.push(scopeAttr)

    const script = levelScript(ctx, nodes)
    const outerCells = ctx.cellBindings
    const outerDeclared = ctx.declared
    if (script !== null) {
        const cells = new Set(outerCells.cells)
        const memos = new Set(outerCells.memos)
        for (const name of script.cells) cells.add(name)
        for (const name of script.memos) memos.add(name)
        // Its names leave `declared` — that subtraction IS the qualification: a name the level publishes
        // on `$scope` must resolve there, including when it shadows a same-named root binding.
        const declared = new Set(outerDeclared)
        for (const name of script.names) declared.delete(name)
        ctx.cellBindings = { cells, memos }
        ctx.declared = declared
    }

    const result = walkLevelNodes(ctx, nodes, scopeAttr, script)

    ctx.cellBindings = outerCells
    ctx.declared = outerDeclared
    if (scopeAttr !== null) ctx.scopeAttrs.pop()
    return result
}

function walkLevelNodes(
    ctx: WalkState,
    nodes: TemplateNode[],
    scopeAttr: string | null,
    script: NestedScript | null,
): LevelResult {
    let skeleton = ''
    const slots: DynamicSlot[] = []
    const server: ServerChunk[] = []
    const elementTags: ElementTag[] = []
    let childIndex = 0
    // Set when this level, or any level nested inside it, invokes a component (see `LevelResult`).
    let hasComponent = false
    let hasScript = script !== null
    // Every nested walk goes through here so `hasComponent`/`hasScript` propagate UP from any depth — a
    // component (or a branch-local `<script>`) inside an `{#if}` inside a `{#for}` body still marks the loop.
    const subLevel = (children: TemplateNode[]): LevelResult => {
        const result = walkLevel(ctx, children)
        if (result.hasComponent) hasComponent = true
        if (result.hasScript) hasScript = true
        return result
    }

    // The branch-local `<script>` is hoisted to the head of the level, exactly like a `{#component}`
    // definition: both are zero-DOM registrations the rest of the level reads from. It is already the
    // first node in source (analyzeBindings enforces it), so hoisting changes no ordering — it only
    // keeps the emitters from having to find it among the chunks.
    if (script !== null) {
        slots.push({ kind: 'script', path: [], expr: null, meta: { setup: script.setupCode } })
        server.push({ kind: 'script', setup: script.setupCode })
    }
    // Whether the position at `childIndex - 1` is a still-"open" static Text node that a subsequent
    // Text emission would MERGE into. The HTML parser coalesces adjacent character data, so two static
    // text runs separated only by a zero-DOM node (a `{#component}` definition, a `<script>`, or an empty
    // Text) become ONE DOM text node — the model must count them as one child too, or every later
    // sibling index desyncs from the parsed server DOM (and the cloned skeleton). `textRun` accumulates
    // that merged run's UTF-16 length so a following leaf's `prefixLen` splits the server's
    // `static+value` node at the right offset.
    let openText = false
    let textRun = 0

    const pushLeaf = (kind: SlotKind, expr: string): void => {
        const prefixLen = openText ? textRun : 0
        skeleton += '<!---->'
        slots.push({ kind, path: [childIndex], expr, prefixLen, meta: {} })
        childIndex++
    }

    // `{html(...)}` injects arbitrary markup, so the claim cannot re-derive its extent — it reads it from
    // the anchors the server brackets the region with (`serverRuntime.renderHtml`). Two child positions,
    // open + close, exactly like a block: the skeleton and the server DOM must stay structurally identical
    // or the cursor walk's index accounting drifts from the real parse. No `prefixLen` — raw markup has no
    // single text-split point (`runtime.htmlBlock` never had one).
    const pushHtmlSlot = (expr: string): void => {
        skeleton += `<!--${HTML_ANCHOR.open}--><!--${HTML_ANCHOR.close}-->`
        slots.push({ kind: 'html', path: [childIndex + 1], expr, meta: {} })
        childIndex += 2
    }

    // The component's single default-children slot — emitted by both `{children()}` and `<slot>`. A
    // zero-prop, no-body COMPONENT invocation of a `children` component (resolved off `$scope.children`),
    // reusing the component emit + `$rt.component` runtime path (paired anchors + claimBlock hydration).
    const pushChildrenSlot = (): void => {
        skeleton += BLOCK_SKELETON
        const emptyBody = subLevel([])
        slots.push({
            kind: 'component',
            path: [childIndex + 1],
            expr: null,
            meta: {
                name: 'children',
                ref: '$scope.children',
                reactive: false,
                attrs: [],
                body: toClientPlan(emptyBody),
                hasChildren: false,
            },
        })
        server.push({
            kind: 'component',
            name: 'children',
            ref: '$scope.children',
            attrs: [],
            children: [],
            hasChildren: false,
            // No site id: `children` is the layout-composition outlet, not a `.abide` adapter — every
            // composed level records into the ROOT bucket (see compose.childComponent / pages.renderLevel).
            siteId: -1,
        })
        childIndex += 2
    }

    for (const node of nodes) {
        switch (node.type) {
            case 'Script':
                break // handled by scope analysis, emits nothing
            case 'Text': {
                if (node.value === '') break
                skeleton += node.value
                server.push({ kind: 'static', text: node.value })
                // A fresh run claims a new child slot; a run contiguous with the previous text (openText)
                // merges into the same parsed DOM node, so it does NOT advance `childIndex`.
                if (!openText) {
                    childIndex++
                    openText = true
                    textRun = 0
                }
                textRun += node.value.length
                break
            }
            case 'Comment': {
                const text = `<!--${node.value}-->`
                skeleton += text
                server.push({ kind: 'static', text })
                childIndex++
                break
            }
            case 'Interpolation': {
                // TODO #7: `{children()}` is the layout/component single slot. Emit it as a zero-prop, no-body
                // COMPONENT invocation of a `children` component (resolved off `$scope.children`) rather than a
                // text leaf — so it reuses the existing component emit + `$rt.component` runtime path (paired
                // block anchors + claimBlock hydration). The composer injects `children` into scope as an
                // isomorphic component wrapping the next level (server: renders it → Raw; client: mounts it).
                if (node.expression.trim() === 'children()') {
                    pushChildrenSlot()
                    break
                }
                rejectComponentCall(ctx, node.expression)
                const expr = rewriteExpr(ctx, node.expression)
                pushLeaf('interpolation', expr)
                server.push({ kind: 'interp', expr })
                break
            }
            case 'Html': {
                const expr = rewriteExpr(ctx, node.expression)
                pushHtmlSlot(expr)
                server.push({ kind: 'html', expr })
                break
            }
            case 'AwaitInterpolation': {
                const expr = rewriteExpr(ctx, node.expression)
                pushLeaf('await', expr)
                server.push({ kind: 'await', expr })
                break
            }
            case 'Element': {
                // `<slot/>` is the component's default-children outlet — same emission as `{children()}`.
                // (Fallback content inside `<slot>…</slot>` is not yet supported and is ignored.)
                if (node.name === 'slot') {
                    pushChildrenSlot()
                    break
                }
                const attrPlans = node.attributes.map((attr) => planAttribute(ctx, attr))
                skeleton += `<${node.name}${staticAttrString(attrPlans, ctx.scopeAttrs)}>`
                const elemPath = [childIndex]
                for (const ap of attrPlans) {
                    if (ap.kind === 'static') continue
                    if (ap.kind === 'spread')
                        slots.push({ kind: 'spread', path: elemPath, expr: ap.expr, meta: {} })
                    else if (ap.kind === 'event')
                        slots.push({
                            kind: 'event',
                            path: elemPath,
                            expr: ap.expr,
                            meta: { event: ap.event, name: ap.name },
                        })
                    else
                        slots.push({
                            kind: attrKindToSlot(ap.kind),
                            path: elemPath,
                            expr: ap.expr,
                            meta: { name: ap.name },
                        })
                }
                let childServer: ServerChunk[] = []
                // Dynamic iff it has a non-static attr/directive of its own or any dynamic descendant slot.
                let isDynamic = attrPlans.some((ap) => ap.kind !== 'static')
                if (!node.void) {
                    const sub = subLevel(node.children)
                    skeleton += sub.skeleton
                    for (const s of sub.slots) slots.push({ ...s, path: [childIndex, ...s.path] })
                    for (const et of sub.elementTags)
                        elementTags.push({ path: [childIndex, ...et.path], tag: et.tag })
                    if (sub.slots.length > 0) isDynamic = true
                    childServer = sub.server
                    skeleton += `</${node.name}>`
                }
                if (isDynamic) elementTags.push({ path: [childIndex], tag: node.name })
                // #20: carry the #13 scope attribute so the SERVER emitter stamps it on the element too (the
                // client skeleton bakes it via staticAttrString). Without this the server render omits it, so a
                // scoped selector `.a[data-ab-<hash>]` matches nothing during SSR/no-JS and after hydration.
                server.push({
                    kind: 'element',
                    name: node.name,
                    void: node.void,
                    attrs: attrPlans,
                    children: childServer,
                    scopeAttrs: ctx.scopeAttrs.slice(),
                })
                childIndex++
                break
            }
            case 'Component': {
                skeleton += BLOCK_SKELETON
                const attrPlans = node.attributes.map((attr) => planAttribute(ctx, attr))
                // A top-level `{#component Name()}` inside `<Foo>…</Foo>` is forwarded to Foo as its `Name`
                // prop. Emit each as a caller-level component def (so it closes over the CALLER's scope) and
                // add a synthetic `Name={Name}` prop; the remaining children are the body/`<slot/>`.
                const nestedDefs = node.children.filter((n) => n.type === 'ComponentBlock')
                const bodyChildren = node.children.filter((n) => n.type !== 'ComponentBlock')
                for (const def of nestedDefs) {
                    const defSub = subLevel(def.children)
                    slots.push({
                        kind: 'componentDef',
                        path: [],
                        expr: null,
                        meta: { name: def.name, params: def.params, body: toClientPlan(defSub) },
                    })
                    server.push({
                        kind: 'componentDef',
                        name: def.name,
                        params: def.params,
                        children: defSub.server,
                    })
                    attrPlans.push({
                        kind: 'expr',
                        name: def.name,
                        expr: rewriteExpr(ctx, def.name),
                    })
                }
                const sub = subLevel(bodyChildren)
                const hasChildren = bodyChildren.some((n) => n.type !== 'Script')
                const siteId = ctx.nextSiteId++
                hasComponent = true
                // Resolve the tag HERE, where the level's bindings are known. A cell-/memo-named tag is
                // reactive (re-mounts on identity change) and reads as a value; anything else resolves
                // once, lexically or off `$scope`.
                const reactive =
                    ctx.cellBindings.cells.has(node.name) || ctx.cellBindings.memos.has(node.name)
                const ref = rewriteExpr(ctx, node.name)
                slots.push({
                    kind: 'component',
                    path: [childIndex + 1],
                    expr: null,
                    meta: {
                        name: node.name,
                        ref,
                        reactive,
                        attrs: attrPlans,
                        body: toClientPlan(sub),
                        hasChildren,
                        siteId,
                    },
                })
                server.push({
                    kind: 'component',
                    name: node.name,
                    ref,
                    attrs: attrPlans,
                    children: sub.server,
                    hasChildren,
                    siteId,
                })
                childIndex += 2
                break
            }
            case 'IfBlock': {
                skeleton += BLOCK_SKELETON
                const branches = node.branches.map((b) => {
                    const sub = subLevel(b.children)
                    return {
                        expr: b.condition === null ? null : rewriteExpr(ctx, b.condition),
                        sub,
                    }
                })
                slots.push({
                    kind: 'if',
                    path: [childIndex + 1],
                    expr: null,
                    meta: {
                        branches: branches.map((b) => ({
                            expr: b.expr,
                            plan: toClientPlan(b.sub),
                        })),
                    },
                })
                server.push({
                    kind: 'if',
                    branches: branches.map((b) => ({ expr: b.expr, children: b.sub.server })),
                })
                childIndex += 2
                break
            }
            case 'ForBlock': {
                skeleton += BLOCK_SKELETON
                const bodySub = subLevel(node.children)
                const catchNode = node.catch
                const catchSub = catchNode ? subLevel(catchNode.children) : null
                const iterable = rewriteExpr(ctx, node.iterable)
                const key = node.key === null ? null : rewriteExpr(ctx, node.key)
                slots.push({
                    kind: 'for',
                    path: [childIndex + 1],
                    expr: iterable,
                    meta: {
                        await: node.await,
                        item: node.item,
                        index: node.index,
                        iterable,
                        key,
                        body: toClientPlan(bodySub),
                        catch:
                            catchNode && catchSub
                                ? { param: catchNode.param, plan: toClientPlan(catchSub) }
                                : null,
                        hasComponent: bodySub.hasComponent,
                        hasScript: bodySub.hasScript,
                    },
                })
                server.push({
                    kind: 'for',
                    await: node.await,
                    item: node.item,
                    index: node.index,
                    iterable,
                    children: bodySub.server,
                    catch:
                        catchNode && catchSub
                            ? { param: catchNode.param, children: catchSub.server }
                            : null,
                    hasComponent: bodySub.hasComponent,
                    hasScript: bodySub.hasScript,
                })
                childIndex += 2
                break
            }
            case 'AwaitBlock': {
                skeleton += BLOCK_SKELETON
                const expr = rewriteExpr(ctx, node.expression)
                const pendingSub = subLevel(node.pending)
                const thenNode = node.then
                const thenSub = thenNode ? subLevel(thenNode.children) : null
                const catchNode = node.catch
                const catchSub = catchNode ? subLevel(catchNode.children) : null
                const finallySub = node.finally ? subLevel(node.finally.children) : null
                slots.push({
                    kind: 'awaitBlock',
                    path: [childIndex + 1],
                    expr,
                    meta: {
                        pending: toClientPlan(pendingSub),
                        // biome-ignore lint/suspicious/noThenProperty: await-block branch name, not a thenable
                        then:
                            thenNode && thenSub
                                ? { param: thenNode.param, plan: toClientPlan(thenSub) }
                                : null,
                        catch:
                            catchNode && catchSub
                                ? { param: catchNode.param, plan: toClientPlan(catchSub) }
                                : null,
                        finally: finallySub ? toClientPlan(finallySub) : null,
                    },
                })
                server.push({
                    kind: 'awaitBlock',
                    expr,
                    pending: pendingSub.server,
                    // biome-ignore lint/suspicious/noThenProperty: await-block branch name, not a thenable
                    then:
                        thenNode && thenSub
                            ? { param: thenNode.param, children: thenSub.server }
                            : null,
                    catch:
                        catchNode && catchSub
                            ? { param: catchNode.param, children: catchSub.server }
                            : null,
                    finally: finallySub ? finallySub.server : null,
                    inline: node.inline,
                })
                childIndex += 2
                break
            }
            case 'SwitchBlock': {
                skeleton += BLOCK_SKELETON
                const discriminant = rewriteExpr(ctx, node.discriminant)
                const leadingSub = subLevel(node.leading)
                const cases = node.cases.map((c) => {
                    const sub = subLevel(c.children)
                    return { expr: c.test === null ? null : rewriteExpr(ctx, c.test), sub }
                })
                slots.push({
                    kind: 'switch',
                    path: [childIndex + 1],
                    expr: discriminant,
                    meta: {
                        discriminant,
                        leading: toClientPlan(leadingSub),
                        branches: cases.map((c) => ({ expr: c.expr, plan: toClientPlan(c.sub) })),
                    },
                })
                server.push({
                    kind: 'switch',
                    discriminant,
                    cases: cases.map((c) => ({ expr: c.expr, children: c.sub.server })),
                })
                childIndex += 2
                break
            }
            case 'TryBlock': {
                skeleton += BLOCK_SKELETON
                const bodySub = subLevel(node.children)
                const catchNode = node.catch
                const catchSub = catchNode ? subLevel(catchNode.children) : null
                const finallySub = node.finally ? subLevel(node.finally.children) : null
                slots.push({
                    kind: 'try',
                    path: [childIndex + 1],
                    expr: null,
                    meta: {
                        body: toClientPlan(bodySub),
                        catch:
                            catchNode && catchSub
                                ? { param: catchNode.param, plan: toClientPlan(catchSub) }
                                : null,
                        finally: finallySub ? toClientPlan(finallySub) : null,
                    },
                })
                server.push({
                    kind: 'try',
                    children: bodySub.server,
                    catch:
                        catchNode && catchSub
                            ? { param: catchNode.param, children: catchSub.server }
                            : null,
                    finally: finallySub ? finallySub.server : null,
                })
                childIndex += 2
                break
            }
            case 'ComponentBlock': {
                // Component definitions emit no DOM at their site; they register a builder callable on the scope.
                const sub = subLevel(node.children)
                slots.push({
                    kind: 'componentDef',
                    path: [],
                    expr: null,
                    meta: { name: node.name, params: node.params, body: toClientPlan(sub) },
                })
                server.push({
                    kind: 'componentDef',
                    name: node.name,
                    params: node.params,
                    children: sub.server,
                })
                break
            }
            case 'Style': {
                // Scoped to THIS level's attribute — the innermost one in force, which is what makes a
                // nested `<style>` reach its own subtree and nothing else.
                const css = scopeAttr !== null ? scopeStyles(node.content, scopeAttr) : node.content
                skeleton += `<style>${css}</style>`
                server.push({ kind: 'style', css })
                childIndex++
                break
            }
        }
        // Any node that emitted a DOM boundary (element, comment, leaf/block anchor, style) terminates the
        // open text run. `Text` manages `openText` itself; `Script`/`ComponentBlock` emit no DOM and must
        // leave it intact so the text runs on either side of them merge (matching the parser).
        if (node.type !== 'Text' && node.type !== 'Script' && node.type !== 'ComponentBlock') {
            openText = false
            textRun = 0
        }
    }

    return { skeleton, slots, server, elementTags, hasComponent, hasScript }
}

function attrKindToSlot(kind: 'expr' | 'class' | 'style' | 'bind'): SlotKind {
    if (kind === 'expr') return 'attr'
    return kind
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function buildPlan(root: Root, analysis: BindingAnalysis): TemplatePlan {
    const componentNames = new Set<string>()
    for (const entry of analysis.componentImports) componentNames.add(entry.local)
    collectComponentNames(root.children, componentNames)
    // The root `<style>` needs no special case: it is simply the outermost level's own scope, which
    // `walkLevel` establishes like any other. (Before, only a ROOT style produced a scope attribute at
    // all, so a component whose only `<style>` was nested shipped that CSS unscoped and global.)
    const ctx: WalkState = {
        cellBindings: analysis.cellBindings,
        declared: analysis.declared,
        nested: analysis.nested,
        scopeAttrs: [],
        componentNames,
        nextSiteId: 0,
    }
    const level = walkLevel(ctx, root.children)
    return {
        skeletonClient: level.skeleton,
        slots: level.slots,
        serverChunks: level.server,
        elementTags: level.elementTags,
    }
}
