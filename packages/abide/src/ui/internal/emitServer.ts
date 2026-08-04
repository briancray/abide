// `.abide` SERVER MODULE EMITTER (Stage 1, PR3) — BUILD/SSR-SIDE ONLY.
//
// Turns a `TemplatePlan` + `BindingAnalysis` into an ES-module string exporting `async function
// render($scope)` that builds the SSR HTML string. Reads from the SAME plan the client emitter uses,
// so comment anchors match. Uses `serverRuntime` ($rt) for escaping / attribute serialization and
// lexical `<script>` bindings from `emitSetup`.
//
// Event attributes on an ELEMENT are omitted — SSR emits markup and a listener is not markup. On a
// COMPONENT they are not: `onclick={fn}` there is a PROP named `onclick` (a component has no element to
// attach a listener to), and dropping it made SSR and hydrate disagree about the props a component
// received. See `componentAttrLanes.test.ts`, which enumerates the per-kind lowering across all three
// lanes; the element/component split is the whole distinction it guards.

import type { BindingAnalysis, ScriptInfo } from './analyzeBindings.ts'
import { reconstructImport } from './analyzeBindings.ts'
import { BLOCK_ANCHOR } from './BLOCK_ANCHOR.ts'
import { bindPattern } from './bindPattern.ts'
import { emitInstanceSetup, emitModuleEnsure } from './emitSetup.ts'
import { indent } from './indent.ts'
import { runtimeImportStatement } from './RUNTIME_IMPORT.ts'
import { splitParams } from './scanText.ts'
import { applyStatic, attrBuilder } from './serverRuntime.ts'
import type { AttrPlan, ServerChunk, TemplatePlan } from './templatePlan.ts'

// RPC route imports follow the `src/server/rpc/<name>.ts` file convention, so their specifier carries a
// `server/rpc/` segment. A `{#for await}` head that resolves to one is ATTACHABLE (replayable-streams.md
// §5) — its transcript can be handed off to the client instead of re-run. Any other head (a local async
// generator, a `fetch().body`, a state binding) is not. The segment may open the specifier, follow a
// path separator, or follow the `$` of the `$server/rpc/<name>` tsconfig alias — the alias is the
// scaffolded form, so missing it silently made every aliased stream re-run on hydrate.
const RPC_SPECIFIER = /(^|\/)\$?server\/rpc\//

// The local names bound by RPC route imports across the module + instance scripts (default and named).
// By framework convention the import LOCAL equals the route/wire name (`$scope[local]` on both sides),
// so the local doubles as the `rpcName` recorded on the handoff.
// The RPC-import local names for an analysis. Memoized per-analysis: `genChunkRaw` recurses over the
// template and asks for this on every `{#for await}` block, but the set is fixed for the whole module.
const RPC_LOCALS_CACHE = new WeakMap<BindingAnalysis, Set<string>>()
function rpcImportLocals(analysis: BindingAnalysis): Set<string> {
    const cached = RPC_LOCALS_CACHE.get(analysis)
    if (cached !== undefined) return cached
    const locals = new Set<string>()
    const collect = (script: ScriptInfo | null): void => {
        if (script === null) return
        for (const binding of script.imports) {
            if (!RPC_SPECIFIER.test(binding.specifier)) continue
            if (binding.defaultLocal !== null) locals.add(binding.defaultLocal)
            for (const entry of binding.named) locals.add(entry.local)
        }
    }
    collect(analysis.module)
    collect(analysis.instance)
    RPC_LOCALS_CACHE.set(analysis, locals)
    return locals
}

// Slice out the balanced argument list of a `head(...)` call starting at the `(` at `openIndex`. String
// and template-literal bodies are treated as opaque so a `)` inside them never miscounts depth. Returns
// the inner text (may be empty), or null when the parens are unbalanced.
function extractCallArgs(src: string, openIndex: number): string | null {
    let depth = 0
    let inString: string | null = null
    for (let i = openIndex; i < src.length; i++) {
        const ch = src[i]
        if (inString !== null) {
            if (ch === '\\') i++
            else if (ch === inString) inString = null
            continue
        }
        if (ch === '"' || ch === "'" || ch === '`') inString = ch
        else if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') {
            depth--
            if (depth === 0) return src.slice(openIndex + 1, i)
        }
    }
    return null
}

// If a `{#for await}` iterable is a call `rpcName(<args>)` whose head is an RPC import, return the wire
// name + the argument expression (empty string for a zero-arg call) so the emitter can tag the source
// attachable (§5). Any non-RPC head, non-call form, or unbalanced parens → null (client re-iterates).
function parseAttachSource(
    iterable: string,
    rpcLocals: Set<string>,
): { rpcName: string; args: string } | null {
    const match = /^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(iterable)
    if (match === null) return null
    const head = match[1]
    if (head === undefined) return null
    if (!rpcLocals.has(head)) return null
    const args = extractCallArgs(iterable, match.index + match[0].length - 1)
    if (args === null) return null
    return { rpcName: head, args }
}

// A child scope expression carrying an optional single binding (block param / for item).
function childScopeCode(target: string, param: string | null, valueExpr: string): string {
    let out = `const ${target} = Object.create($scope);\n`
    if (param !== null && param.trim() !== '') out += `${bindPattern(target, param, valueExpr)}\n`
    return out
}

// One interpolation leaf, appended to `$out` through `render`.
//
// The `await` is GUARDED rather than unconditional. Every expression slot auto-awaits (a `T | Promise<T>`
// union is deliberately legal), but `await` on a non-thenable is not free — it still costs a promise wrap
// and a microtask tick, and an interpolation in a list pays it PER ROW. `isThenable` is a couple of type
// checks, so the common already-settled value takes the sync arm and only a real promise suspends.
// Semantics are unchanged: a thenable is still awaited, in the same order, before the leaf is written.
//
// `$v` is block-scoped, so nested leaves shadow rather than collide.
function leafStatement(render: string, expr: string, suffix: string): string {
    return `  { const $v = (${expr}); $out += ${render}($rt.isThenable($v) ? await $v : $v)${suffix}; }\n`
}

// A statement whose expression must be SETTLED before use, with the same guarded await `leafStatement`
// applies to text leaves — an attribute value, a directive operand, a component prop.
//
// Every one of these slots auto-awaits by design (a `T | Promise<T>` union is legal), but an
// unconditional `await` costs a promise wrap and a microtask tick even for a plain string, and these
// slots are per ATTRIBUTE per element — inside a list, per row. `$v` is block-scoped, so nested and
// repeated uses shadow rather than collide.
function settledStatement(expr: string, use: (value: string) => string): string {
    return `    { const $v = (${expr}); ${use('($rt.isThenable($v) ? await $v : $v)')} }\n`
}

// A branch body assigned to `target`. A stream-free body writes straight into a shadowed accumulator
// instead of an awaited IIFE — inside a `{#for}` that frame is per ROW, and a branch is the commonest
// thing a row contains.
//
// `scopeExpr` names the scope the body renders against; a branch that binds a parameter (`{:catch e}`)
// passes the child scope it just built. The inline arm rebinds `$scope` in a NESTED block rather than
// at this level, because the `const $cc = Object.create($scope)` that produced it is a sibling
// statement — shadowing in the same block would put that reference in the temporal dead zone.
function branchBody(
    analysis: BindingAnalysis,
    children: ServerChunk[],
    target: string,
    pad: string,
    scopeExpr = '$scope',
): string {
    if (!inlinableChildren(children))
        return `${target} = await ${bodyExpr(analysis, children)}(${scopeExpr});`
    const body = `let $out = "";\n${genChunks(analysis, children)}${pad}${target} = $out;`
    if (scopeExpr === '$scope') return body
    return `{ const $scope = ${scopeExpr};\n${body} }`
}

// One level of an `{#if}` / `{:else if}` / `{:else}` chain, nested so later conditions stay unevaluated.
function genIfChain(
    analysis: BindingAnalysis,
    branches: { expr: string | null; children: ServerChunk[] }[],
    index: number,
    pad: string,
): string {
    const branch = branches[index]
    if (branch === undefined) return ''
    const body = branchBody(analysis, branch.children, '$r', `${pad}  `)
    if (branch.expr === null) return `${pad}{ ${body} }\n`
    const rest =
        index + 1 < branches.length
            ? ` else {\n${genIfChain(analysis, branches, index + 1, `${pad}  `)}${pad}}`
            : ''
    return (
        `${pad}{ const $v = (${branch.expr});\n` +
        `${pad}  if ($rt.isThenable($v) ? await $v : $v) { ${body} }${rest}\n` +
        `${pad}}\n`
    )
}

// One level of a `{#switch}` case chain, nested for the same reason `genIfChain` nests: a later case's
// expression must stay unevaluated once an earlier one matched. `{:default}` is skipped in place and
// emitted as the innermost fallback, which is where the old `return`-based form put it too — a
// `{:default}` written between two cases still runs last.
function genSwitchChain(
    analysis: BindingAnalysis,
    cases: { expr: string | null; children: ServerChunk[] }[],
    index: number,
    fallback: { children: ServerChunk[] } | undefined,
    pad: string,
): string {
    let at = index
    while (at < cases.length && cases[at]?.expr === null) at++
    const branch = cases[at]
    if (branch === undefined || branch.expr === null) {
        if (fallback === undefined) return ''
        return `${pad}{ ${branchBody(analysis, fallback.children, '$r', `${pad}  `)} }\n`
    }
    const body = branchBody(analysis, branch.children, '$r', `${pad}  `)
    const inner = genSwitchChain(analysis, cases, at + 1, fallback, `${pad}  `)
    const rest = inner === '' ? '' : ` else {\n${inner}${pad}}`
    return (
        `${pad}{ const $v = (${branch.expr});\n` +
        `${pad}  if (($rt.isThenable($v) ? await $v : $v) === $subject) { ${body} }${rest}\n` +
        `${pad}}\n`
    )
}

// An async arrow that renders a chunk list against a `$scope` param and returns a string.
function bodyExpr(analysis: BindingAnalysis, chunks: ServerChunk[]): string {
    return `(async ($scope) => {\n  let $out = "";\n${genChunks(analysis, chunks)}  return $out;\n})`
}

// Can this child list be emitted straight into the PARENT's `$out` accumulator instead of its own
// awaited `bodyExpr` IIFE? Only when the subtree owns nothing that participates in streaming SSR.
//
// The IIFE-per-level is not free: it costs a promise + a microtask tick per element per render, which
// on a list is per ROW (the `for-list-1000` render was ~4x this alone). But a blanket inline was tried
// and reverted — it broke streaming SSR, because a `{#for await}`/`{#await}` reached through a
// collapsed frame stopped seeing the per-render stream scope and silently fell back to a fully
// buffered drain. So the predicate is deliberately CONSERVATIVE: any streaming participant anywhere in
// the subtree — an `{#await}` block, a `{#for await}`, a hoisted `componentDef`, a branch-local
// `<script>` — keeps the whole level's IIFE. Everything that owns its own frame, or is transparent to
// the one it runs in (`if`/`switch`/`try`/sync `for`/`element`/`component`), is recursed THROUGH
// rather than bailed on: inlining the level above them does not change the frame they run in.
//
// EXPORTED for its own test. It is the guard against a SILENT regression — collapsing a frame around a
// streaming block produces byte-identical HTML and merely stops streaming it — and `emitServer` exports
// only `emitServerModule`, so until now the rule was reachable only by compiling a template, rendering
// it, and watching for the absence of progressive output.
export function inlinableChildren(chunks: ServerChunk[]): boolean {
    for (const chunk of chunks) {
        switch (chunk.kind) {
            case 'static':
            case 'interp':
            case 'html':
            case 'await':
            case 'style':
                break
            case 'element':
                if (!inlinableChildren(chunk.children)) return false
                break
            case 'component':
                // A component INVOCATION is transparent to streaming: whatever the component renders
                // — including a streaming block — runs inside the builder's own async frame, not the
                // caller's, so collapsing the caller's frame cannot take a stream scope away from it.
                // Its SLOT children do render in the caller's frame, so those still have to qualify.
                if (!inlinableChildren(chunk.children)) return false
                break
            case 'if':
                for (const branch of chunk.branches)
                    if (!inlinableChildren(branch.children)) return false
                break
            case 'switch':
                for (const c of chunk.cases) if (!inlinableChildren(c.children)) return false
                break
            case 'try':
                if (!inlinableChildren(chunk.children)) return false
                if (chunk.catch && !inlinableChildren(chunk.catch.children)) return false
                if (chunk.finally && !inlinableChildren(chunk.finally)) return false
                break
            case 'script':
                // A branch-local `<script>` opens an effect scope and rebinds `$scope` for the level;
                // keeping the frame keeps that setup's extent exactly the level that declared it.
                return false
            case 'for':
                // A `{#for await}` IS the streaming participant — never collapse a level around one.
                if (chunk.await) return false
                if (!inlinableChildren(chunk.children)) return false
                if (chunk.catch && !inlinableChildren(chunk.catch.children)) return false
                break
            // What is left keeps the frame: `awaitBlock` (streams), and `componentDef` (a hoisted
            // registration the parent frame must own). `component` is NOT among them — it is handled
            // above, transparently. This comment used to say it was, contradicting the case ten lines
            // up; the case is right and the comment was left behind when it was added.
            default:
                return false
        }
    }
    return true
}

// An element whose every attribute is a compile-time constant (or a client-only `event`, which emits
// nothing server-side) needs no runtime `AttributeBuilder` — its open tag is a constant string.
function isStaticOnly(attrs: AttrPlan[]): boolean {
    for (const attr of attrs) {
        if (attr.kind !== 'static' && attr.kind !== 'event') return false
    }
    return true
}

// The open-tag attribute string for an all-static element, computed at emit time by running the SAME
// `AttributeBuilder` the runtime would — so the baked literal is byte-identical to the builder path
// (class/style trim + merge, boolean/bare attrs, escaping, and the trailing scope attributes all match).
function staticAttrLiteral(attrs: AttrPlan[], scopeAttrs: string[]): string {
    const builder = attrBuilder()
    for (const attr of attrs) {
        if (attr.kind === 'static') applyStatic(builder, attr.name, attr.value)
        // `event` contributes no server attribute (mirrors the builder path's `case 'event': break`).
    }
    for (const scopeAttr of scopeAttrs) applyStatic(builder, scopeAttr, null)
    return builder.serialize()
}

function genElement(
    analysis: BindingAnalysis,
    name: string,
    isVoid: boolean,
    attrs: AttrPlan[],
    children: ServerChunk[],
    scopeAttrs: string[],
): string {
    let out = ''
    if (isStaticOnly(attrs)) {
        // Fast path: no `attrBuilder()` allocation — the whole open tag is a compile-time constant.
        out += `  $out += ${JSON.stringify(`<${name}${staticAttrLiteral(attrs, scopeAttrs)}>`)};\n`
    } else {
        out += '  {\n    const $a = $rt.attrBuilder();\n'
        for (const attr of attrs) {
            switch (attr.kind) {
                case 'static':
                    out += `    $rt.applyStatic($a, ${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});\n`
                    break
                case 'expr':
                    out += settledStatement(
                        attr.expr,
                        (value) => `$rt.applyExpr($a, ${JSON.stringify(attr.name)}, ${value});`,
                    )
                    break
                case 'event':
                    break
                case 'class':
                    out += settledStatement(
                        attr.expr,
                        (value) => `$rt.applyClassDir($a, ${JSON.stringify(attr.name)}, ${value});`,
                    )
                    break
                case 'style':
                    out += settledStatement(
                        attr.expr,
                        (value) => `$rt.applyStyleDir($a, ${JSON.stringify(attr.name)}, ${value});`,
                    )
                    break
                case 'bind':
                    out += settledStatement(
                        attr.expr,
                        (value) => `$rt.applyBind($a, ${JSON.stringify(attr.name)}, ${value});`,
                    )
                    break
                case 'spread':
                    out += settledStatement(attr.expr, (value) => `$rt.applySpread($a, ${value});`)
                    break
            }
        }
        for (const scopeAttr of scopeAttrs)
            out += `    $rt.applyStatic($a, ${JSON.stringify(scopeAttr)}, null);\n`
        out += `    $out += "<${name}" + $a.serialize() + ">";\n`
        out += '  }\n'
    }
    if (!isVoid) {
        // A stream-free child list is emitted straight into this accumulator — the child IIFE is a
        // promise + microtask tick per element per render with nothing to show for it. Anything that
        // participates in streaming SSR keeps its own frame; see `inlinableChildren` for why a blanket
        // inline was tried, reverted, and is now gated. (The unit oracle can't catch that regression,
        // docs e2e `bench.spec` can.) The child IIFE took the SAME `$scope`, so this is a pure
        // substitution — every `let`/`const` `genChunks` emits is already block- or IIFE-scoped.
        if (inlinableChildren(children)) {
            out += genChunks(analysis, children)
        } else {
            out += `  $out += await ${bodyExpr(analysis, children)}($scope);\n`
        }
        out += `  $out += ${JSON.stringify(`</${name}>`)};\n`
    }
    return out
}

function genComponent(
    analysis: BindingAnalysis,
    name: string,
    ref: string,
    attrs: AttrPlan[],
    children: ServerChunk[],
    hasChildren: boolean,
    siteId: number,
): string {
    let out = '  {\n    const $props = {};\n'
    for (const attr of attrs) {
        switch (attr.kind) {
            case 'static':
                out += `    $props[${JSON.stringify(attr.name)}] = ${attr.value === null ? 'true' : JSON.stringify(attr.value)};\n`
                break
            case 'expr':
            case 'bind':
                out += settledStatement(
                    attr.expr,
                    (value) => `$props[${JSON.stringify(attr.name)}] = ${value};`,
                )
                break
            case 'spread':
                out += settledStatement(
                    attr.expr,
                    (value) =>
                        `const $s = ${value}; if ($s !== null && typeof $s === "object") Object.assign($props, $s);`,
                )
                break
            // `onclick={fn}` on a COMPONENT is a prop named `onclick`, not a native listener — a
            // component has no element to attach one to, so passing it is the only thing it can mean
            // (the component places it on an element of its own, or spreads it).
            //
            // The server used to DROP it while the client passed it, which is an isomorphism break, not
            // a missing optimisation: a component that branches on the prop (`{onclick ? … : …}`, or
            // spreading props onto a tag) rendered one thing in SSR and another on hydrate. Proven:
            // server `<b>none</b>`, client `<b>has</b>`, for `<Btn onclick={go}/>`. Handlers do not
            // *fire* during SSR, which is why this looked free — but whether the prop EXISTS is
            // observable in the output.
            case 'event':
                out += settledStatement(
                    attr.expr,
                    (value) => `$props[${JSON.stringify(attr.name)}] = ${value};`,
                )
                break
            // `class:`/`style:` on a component are rejected by `templatePlan` (they target one element),
            // so the planner never produces them here.
            case 'class':
            case 'style':
                break
        }
    }
    // `ref` was resolved by `templatePlan`, which is the only place that knows which bindings are in
    // force at this tag's LEVEL (a branch-local `<script>`'s are published on `$scope`, not lexical). A
    // cell-/memo-named tag is reactive; SSR is a snapshot, so `ref` already reads its value once.
    out += `    const $c = ${ref};\n`
    out += `    if (typeof $c !== "function") throw new Error(${JSON.stringify(`<${name}> is not a component in scope (expected a render function)`)});\n`
    if (hasChildren)
        out += `    const $children = async () => new $rt.Raw(await ${bodyExpr(analysis, children)}($scope));\n`
    // A childless `<Name/>` allocated a fresh closure AND a fresh empty `Raw` on every invocation —
    // per row inside a list. Nothing about either is per-call: `Raw` is immutable, so one shared
    // instance serves every childless site in the process.
    else out += `    const $children = $rt.emptyChildren;\n`
    // 4th arg = the STABLE site id (templatePlan): the adapter opens its seed bucket by SITE, not by
    // mount order, so a component's bucket can't shift when an earlier sibling mounts asynchronously.
    out += `    const $r = await $c($props, $children, $scope, ${siteId});\n`
    out += `    $out += $r instanceof $rt.Raw ? $r.value : String($r ?? "");\n`
    out += '  }\n'
    return out
}

// Block/component kinds are wrapped in the paired `<!--[-->…<!--]-->` anchors emitted by the client
// skeleton (templatePlan: `<!--[--><!--]-->` per block/component). Leaves carry a trailing `<!---->`
// inside their own case. Anchors match the client by construction — both sides read the SAME plan, and
// both spell the markers from `BLOCK_ANCHOR` (asserted end-to-end by `planParity.test.ts`).
// WHICH SERVER CHUNK KINDS ARE BRACKETED — a total `Record`, not a `switch` with a `default`, for the
// reason `SLOT_FOOTPRINT` gives for the client's slot kinds: a new kind that brackets its region and is
// not listed here silently takes the `default` arm, and unbracketed output paints correctly while the
// hydrate walk falls back to a fresh mount — right-looking HTML, no error. A missing key is now a
// compile error at the one place the kinds are enumerated. (`ServerChunk['kind']` is its OWN taxonomy,
// not `SlotKind` — `interp` vs `interpolation`, and a server `style` chunk is a `<style>` element where
// a `style` SLOT is a directive — so this is the sibling table, not a second reader of that one.)
const BRACKETED_CHUNK: Record<ServerChunk['kind'], boolean> = {
    component: true,
    if: true,
    for: true,
    awaitBlock: true,
    switch: true,
    try: true,

    static: false,
    interp: false,
    html: false,
    await: false,
    element: false,
    componentDef: false,
    style: false,
    script: false,
}

function genChunk(analysis: BindingAnalysis, chunk: ServerChunk): string {
    const code = genChunkRaw(analysis, chunk)
    if (!BRACKETED_CHUNK[chunk.kind]) return code
    return `  $out += "<!--${BLOCK_ANCHOR.open}-->";\n${code}  $out += "<!--${BLOCK_ANCHOR.close}-->";\n`
}

function genChunkRaw(analysis: BindingAnalysis, chunk: ServerChunk): string {
    switch (chunk.kind) {
        case 'static':
            return `  $out += ${JSON.stringify(chunk.text)};\n`
        case 'interp':
            // One shape: the scalar plus its trailing `<!---->` leaf anchor (mirrors templatePlan.pushLeaf).
            // `renderLeaf` throws on a component — those arrive through a component slot (`<Name/>`), which
            // carries its own paired anchors — so this position is never anything but a single text leaf.
            return leafStatement('$rt.renderLeaf', chunk.expr, '')
        case 'html':
            return leafStatement('$rt.renderHtml', chunk.expr, '')
        case 'await':
            return leafStatement('$rt.renderValue', chunk.expr, ' + "<!---->"')
        case 'style':
            return `  $out += ${JSON.stringify(`<style>${chunk.css}</style>`)};\n`
        case 'element':
            return genElement(
                analysis,
                chunk.name,
                chunk.void,
                chunk.attrs,
                chunk.children,
                chunk.scopeAttrs,
            )
        case 'component':
            return genComponent(
                analysis,
                chunk.name,
                chunk.ref,
                chunk.attrs,
                chunk.children,
                chunk.hasChildren,
                chunk.siteId,
            )
        case 'if': {
            // An `else if` chain has to stay LAZY — a later condition must not run when an earlier one
            // matched — so the guarded awaits nest rather than hoisting into temps up front. Each level
            // opens its own block, and the inner `const $v` shadows the outer one, which is why the same
            // name is safe all the way down.
            return `  {\n    let $r = "";\n${genIfChain(analysis, chunk.branches, 0, '    ')}    $out += $r;\n  }\n`
        }
        case 'for': {
            let body = `    const $c = Object.create($scope);\n`
            // Anything in the loop body that OWNS state must get a DISTINCT seed bucket per iteration —
            // a `<Component/>` (whose bucket branches by site) and a branch-local `<script>` (whose
            // `state()` calls are per iteration). Only emitted when the body has one: this allocates per
            // item per render.
            if (chunk.hasComponent || chunk.hasScript)
                body += `    if ($scope.state && $scope.state.forItem) $c.state = $scope.state.forItem($i);\n`
            body += `    ${bindPattern('$c', chunk.item, '$value')}\n`
            if (chunk.index !== null) body += `    ${bindPattern('$c', chunk.index, '$i')}\n`
            // A stream-free item body renders straight into the loop's accumulator. This is the same
            // trade as `genElement`'s (see `inlinableChildren`), but it pays PER ROW rather than per
            // element, so it is the single biggest lever on list-render cost. The item body took `$c`
            // as its `$scope`, so the inline form rebinds that name in a block and is otherwise a
            // verbatim substitution.
            if (inlinableChildren(chunk.children)) {
                body += `    {\n      const $scope = $c;\n${genChunks(analysis, chunk.children)}    }\n    $i++;\n`
            } else {
                body += `    $out += await ${bodyExpr(analysis, chunk.children)}($c);\n    $i++;\n`
            }
            if (chunk.await) {
                // STREAMING `{#for await}` (streaming-ssr-plan.md PR6): `$rt.forAwaitStream` drains the source up
                // to the deadline INLINE (a fast/synchronous stream stays byte-identical to the buffered drain),
                // then appends each subsequent item into an `<abide-list>` as a patch, marking it complete iff
                // the source ends within the budget. No stream scope (direct `render()`) → it drains fully inline.
                // Same per-item state factory as the sync path above — and load-bearing HERE especially:
                // this is the block whose client counterpart re-creates asynchronously, so its components
                // must be named by site+item rather than by mount order.
                const itemState =
                    chunk.hasComponent || chunk.hasScript
                        ? `      if ($scope.state && $scope.state.forItem) $c.state = $scope.state.forItem($i);\n`
                        : ''
                const itemBind =
                    `const $c = Object.create($scope);\n${itemState}      ${bindPattern('$c', chunk.item, '$value')}\n` +
                    (chunk.index !== null ? `      ${bindPattern('$c', chunk.index, '$i')}\n` : '')
                const renderItem = `async ($value, $i) => {\n      ${itemBind}      return await ${bodyExpr(analysis, chunk.children)}($c);\n    }`
                const caught = chunk.catch
                    ? `async ($e) => {\n      ${childScopeCode('$cc', chunk.catch.param, '$e').replace(/\n/g, '\n      ')}      return await ${bodyExpr(analysis, chunk.catch.children)}($cc);\n    }`
                    : 'null'
                // §5 attach tag: when the source head is a known RPC import, carry `{ attachable, rpcName, args }`
                // so `forAwaitStream` seeds a `StreamHandle` and the client adopts/resumes instead of re-running.
                // A non-RPC source adds NOTHING here → the emitted call is byte-identical to the pre-§5 output.
                const attach = parseAttachSource(chunk.iterable, rpcImportLocals(analysis))
                let attachTag = ''
                if (attach !== null) {
                    const argsExpr = attach.args.trim() === '' ? 'undefined' : attach.args
                    attachTag = `, attachable: true, rpcName: ${JSON.stringify(attach.rpcName)}, args: async () => (${argsExpr})`
                }
                return `  $out += await $rt.forAwaitStream({ source: () => (${chunk.iterable}), renderItem: ${renderItem}, caught: ${caught}${attachTag} });\n`
            }
            // The loop KEEPS its async IIFE, unlike `{#if}`/`{#try}`/`{#switch}`, which all render into
            // an accumulator in the enclosing frame. Collapsing it the same way was tried TWICE and
            // reverted both times — the frame is worth one microtask tick per BLOCK, and a list amortises
            // that over every row it contains, so there is very little to win and it measurably loses.
            //
            // Attempt 1 — rows appended straight to the enclosing `$out`. `bench:delta` vs base:
            // `for-list-1000 · render` +16.4%, `nested-for-if-50` +18.2%, `for-list-100` +7.1%,
            // `for-list-10000` +6.5%; every list row slower, clear of the vanilla noise controls, ≈8 ns
            // per row at n=1000.
            //
            // Attempt 2 tested the obvious explanation for attempt 1 — that appending per row to an
            // already-long enclosing accumulator is what cost, rather than the frame — by collapsing the
            // frame while keeping a fresh shadowed `$out` and assigning it out at the end, which is
            // exactly the shape `{#if}` uses. It came back +12.8% / +12.1% / +7.8%. So that explanation
            // is WRONG and worth writing down: the accumulator is not the variable. A small
            // self-contained async arrow optimises better here than the same loop nested inside the much
            // larger enclosing `render`, and the tick it costs is cheaper than whatever that buys.
            // The trade is therefore inverted from `{#try}`, where the frame was per ROW.
            //
            // The source await is the ONE expression slot in this file that is deliberately NOT guarded
            // by `$rt.isThenable`, and that is a measured decision, not an oversight. A `{#for}` source
            // is usually an already-materialised array, so the guard looks free: in a standalone
            // reconstruction of this shape it saved 31.5 ns per block by skipping the promise wrap and
            // the microtask tick. In the ACTUAL emitted arrow it loses. `bench:delta` vs base, three
            // runs, consistent sign: `for-list-1000 · render` +16.4% / +12.8% / +8.3%, `for-list-10000`
            // +6.5% / +7.9%, and removing the guard again returned every row to parity-or-faster with
            // quiet vanilla controls (+1.7%, +0.1%).
            //
            // The mechanism is the difference between `const $src = await (…)` as the arrow's leading
            // statement and `let $src` + a conditional `await` in its body: the second is a mutable
            // binding whose suspension point is inside a branch, and it compiles worse than the
            // unconditional form regardless of the tick it avoids. The lesson generalises — the
            // micro-ablation that motivated this was not the emitted shape, and it disagreed with it.
            //
            // The tick is per BLOCK, which a list amortises over every row, so there was little to win
            // even if it had worked. The per-ROW slots (`leafStatement`, `settledStatement`) are where
            // the guard pays, and they keep it.
            let out = '  $out += await (async ($scope) => {\n    let $out = "";\n    let $i = 0;\n'
            out += `    const $src = await (${chunk.iterable});\n`
            out += `    for (const $value of ($src ?? [])) {\n${body}    }\n`
            out += '    return $out;\n  })($scope);\n'
            return out
        }
        case 'awaitBlock': {
            // STREAMING form — the full `{#await}{:then}` block (streaming-ssr-plan.md decision 4). Defer to
            // `$rt.awaitStream`: it races the read against the per-render deadline, renders inline when the
            // read settles in time (byte-identical to the blocking path for warm/fast reads), or emits an
            // `<abide-slot>` placeholder + streams the resolved subtree as an out-of-order patch when slow.
            // No stream scope (direct `render()` in tests) → it awaits fully inline, so those stay identical.
            if (!chunk.inline) {
                const resolved = chunk.then
                    ? `async ($value) => {\n${childScopeCode('$ct', chunk.then.param, '$value')}      return await ${bodyExpr(analysis, chunk.then.children)}($ct);\n    }`
                    : `async ($value) => await ${bodyExpr(analysis, chunk.pending)}($scope)`
                const pending = `async () => await ${bodyExpr(analysis, chunk.pending)}($scope)`
                const caught = chunk.catch
                    ? `async ($e) => {\n${childScopeCode('$cc', chunk.catch.param, '$e')}      return await ${bodyExpr(analysis, chunk.catch.children)}($cc);\n    }`
                    : 'null'
                const finalize = chunk.finally
                    ? `async () => await ${bodyExpr(analysis, chunk.finally)}($scope)`
                    : 'null'
                return `  $out += await $rt.awaitStream({ read: async () => (${chunk.expr}), resolved: ${resolved}, pending: ${pending}, caught: ${caught}, finalize: ${finalize} });\n`
            }
            // BLOCKING inline shorthand `{#await p then v}` / `{#await p catch e}` — await fully, render inline.
            let out = '  $out += await (async ($scope) => {\n    let $out = "";\n    try {\n'
            out += `      const $value = await (${chunk.expr});\n`
            if (chunk.then) {
                out +=
                    '      ' +
                    childScopeCode('$ct', chunk.then.param, '$value').replace(/\n/g, '\n      ')
                out += `      $out += await ${bodyExpr(analysis, chunk.then.children)}($ct);\n`
            } else {
                out += `      $out += await ${bodyExpr(analysis, chunk.pending)}($scope);\n`
            }
            out += '    } catch ($e) {\n'
            if (chunk.catch) {
                out +=
                    '      ' +
                    childScopeCode('$cc', chunk.catch.param, '$e').replace(/\n/g, '\n      ')
                out += `      $out += await ${bodyExpr(analysis, chunk.catch.children)}($cc);\n`
            } else {
                out += '      throw $e;\n'
            }
            out += '    }\n'
            if (chunk.finally)
                out += `    $out += await ${bodyExpr(analysis, chunk.finally)}($scope);\n`
            out += '    return $out;\n  })($scope);\n'
            return out
        }
        case 'switch': {
            // Now exactly the `{#if}` shape: an accumulator in the ENCLOSING frame plus a nested chain.
            // The IIFE was here only because the cases `return`ed — the one thing that needs a function
            // — and that cost a microtask tick per `{#switch}`, per ROW inside a `{#for}` (measured at
            // ~26 ns/row). Assigning `$r` down a nested chain buys the same first-match-wins laziness
            // structurally: a later case's expression sits inside the previous case's `else`, so it is
            // no more evaluated than it was before.
            const fallback = chunk.cases.find((c) => c.expr === null)
            return (
                `  {\n    let $r = "";\n` +
                `    const $d = (${chunk.discriminant});\n` +
                `    const $subject = $rt.isThenable($d) ? await $d : $d;\n` +
                genSwitchChain(analysis, chunk.cases, 0, fallback, '    ') +
                `    $out += $r;\n  }\n`
            )
        }
        case 'try': {
            // Same two treatments as `{#if}`, and for the same reason. The outer async IIFE is gone: a
            // block-scoped accumulator in the ENCLOSING frame is enough, since every `await` this block
            // emits is already legal there. And each body goes through `branchBody`, so a stream-free
            // one renders straight into that accumulator instead of a second awaited IIFE.
            //
            // It used to be both frames unconditionally — 2 microtask ticks per `{#try}`, where `{#if}`
            // costs 0, and inside a `{#for}` that is per ROW (measured: +86 ns/row over the same markup
            // in an `{#if}`, ~48% of a 1000-row render whose body is a `{#try}`). Anything that
            // participates in streaming SSR still keeps its own frame — `inlinableChildren` is the gate,
            // and it is the gate because a blanket inline was tried and reverted (see that function).
            let out = '  {\n    let $r = "";\n    try {\n'
            out += `      ${branchBody(analysis, chunk.children, '$r', '      ')}\n`
            out += '    } catch ($e) {\n'
            if (chunk.catch) {
                out +=
                    '      ' +
                    childScopeCode('$cc', chunk.catch.param, '$e').replace(/\n/g, '\n      ')
                out += `      ${branchBody(analysis, chunk.catch.children, '$r', '      ', '$cc')}\n`
            } else {
                out += '      throw $e;\n'
            }
            out += '    }\n'
            // `{:finally}` APPENDS to whatever the try/catch produced, so it accumulates separately and
            // is concatenated — it must not overwrite `$r`.
            if (chunk.finally) {
                out += `    { let $f = "";\n      ${branchBody(analysis, chunk.finally, '$f', '      ')}\n      $r += $f;\n    }\n`
            }
            out += '    $out += $r;\n  }\n'
            return out
        }
        case 'componentDef':
        case 'script':
            return '' // both are emitted up front by genChunks
    }
}

// The branch-local `<script>` preamble (C9.4). Runs inside its own effect scope, so every `watch` the
// script creates is owned by this branch/iteration and disposed when the request's scope goes — the
// server half of "a `watch` teardown IS the lifecycle hook", where a render is the whole life.
function genNestedScript(setup: string): string {
    return (
        `  const $setup = $rt.openRenderScope();\n` +
        `  try {\n${indent(setup, 4)}  } finally {\n` +
        `    $rt.closeEffectScope($setup);\n` +
        `  }\n`
    )
}

// Register component builders (hoisted) then emit the non-component chunks in order.
//
// A level that owns a branch-local `<script>` first gets a `$scope` of its OWN — the script publishes
// its bindings there, and every level nested inside inherits them through the prototype chain while a
// sibling branch never sees them. `$scope` is rebound in a nested block rather than reassigned because
// the inlined level paths (`{#for}` items, component-def bodies) bind it with `const`.
function genChunks(analysis: BindingAnalysis, chunks: ServerChunk[]): string {
    const script = chunks.find((chunk) => chunk.kind === 'script')
    if (script !== undefined && script.kind === 'script') {
        const rest = chunks.filter((chunk) => chunk.kind !== 'script')
        return (
            `  {\n    const $branch = Object.create($scope);\n` +
            `    {\n      const $scope = $branch;\n` +
            indent(genNestedScript(script.setup), 4) +
            indent(genChunks(analysis, rest), 4) +
            `    }\n  }\n`
        )
    }
    let out = ''
    for (const chunk of chunks) {
        if (chunk.kind !== 'componentDef') continue
        const patterns = chunk.params.trim() === '' ? [] : splitParams(chunk.params)
        // A snapshot here, unlike the client (`bindLazyPattern`): a server render reads each param once
        // by construction, so accessors would buy nothing and cost a `defineProperty` per param per row.
        let binds = ''
        for (const [i, pattern] of patterns.entries())
            binds += `    ${bindPattern('$s', pattern, `$args[${i}]`)}\n`
        // The component-invocation convention passes the caller's children factory as the 2nd arg, so
        // `<slot/>` (which resolves `$scope.children`) is filled automatically — no `children` param
        // needed. An explicit param of the same name overrides it via `binds`.
        // The builder's body, like an element's children, does not need a frame of its own when it
        // holds nothing that participates in streaming — and this one is entered once per INVOCATION,
        // so inside a list it is another promise and microtask tick per row. Same gate as everywhere
        // else (`inlinableChildren`); the body read `$s` as its `$scope`, so the inline form rebinds
        // that name in a block and is otherwise verbatim.
        const body = inlinableChildren(chunk.children)
            ? `    let $out = "";\n    {\n      const $scope = $s;\n${genChunks(analysis, chunk.children)}    }\n    return new $rt.Raw($out);\n`
            : `    return new $rt.Raw(await ${bodyExpr(analysis, chunk.children)}($s));\n`
        out += `  $scope[${JSON.stringify(chunk.name)}] = async (...$args) => {\n    const $s = Object.create($scope);\n    if (typeof $args[1] === "function") $s.children = $args[1];\n${binds}${body}  };\n`
    }
    for (const chunk of chunks) {
        if (chunk.kind === 'componentDef') continue
        out += genChunk(analysis, chunk)
    }
    return out
}

export function emitServerModule(plan: TemplatePlan, analysis: BindingAnalysis): string {
    // `.abide` component imports stay REAL ES imports (specifier rewritten by the loader to the compiled
    // component server module). The local is lexical (`declared`) so `<Card>` resolves to this binding.
    let componentImports = ''
    for (const entry of analysis.componentImports) {
        componentImports += `import ${entry.local} from ${JSON.stringify(entry.specifier)};\n`
    }
    // Pass-through framework imports (`abide/shared/online`, …) stay REAL ES imports too — resolved by
    // the temp-module dynamic import against abide's package exports (M3b).
    let moduleImports = ''
    for (const binding of analysis.moduleImports) {
        moduleImports += `${reconstructImport(binding)}\n`
    }
    return (
        runtimeImportStatement('server') +
        componentImports +
        moduleImports +
        `\n` +
        emitModuleEnsure(analysis) +
        // Mirror of the client `mount`: the setup preamble runs inside an open effect scope, so the
        // `watch`es a `<script>` creates are OWNED — here by the request, which disposes them when its
        // work is finished (a render is a component's whole life on the server). The scope closes before
        // the chunk phase so only setup effects are in it, and the `finally` closes it on a throw too.
        `\nexport async function render($scope) {\n` +
        `  const $setup = $rt.openRenderScope();\n` +
        `  try {\n` +
        indent(emitInstanceSetup(analysis), 2) +
        `    $rt.closeEffectScope($setup);\n` +
        `    let $out = "";\n` +
        indent(genChunks(analysis, plan.serverChunks), 2) +
        `    return $out;\n` +
        `  } finally {\n` +
        `    $rt.closeEffectScope($setup);\n` +
        `  }\n}\n` +
        // Default component adapter — emitted for EVERY module (pages import `{render}` and ignore it). A
        // consumer `<Card>` invokes this: build a child scope inheriting the caller's `$parent` scope,
        // install the caller's props as `props()` and children as `children`, then reuse this module's own
        // `render`; the result is wrapped in `$rt.Raw` so the caller splices it verbatim.
        `\nexport default async (props, childrenFn, $parent, $site) => {\n` +
        `  const $s = Object.create($parent ?? null);\n` +
        // Per-component-localized seed (mirror of the client adapter): open this component instance's own
        // recording bucket so its `state()` initials group separately from the page/siblings.
        `  if ($parent && $parent.state && $parent.state.forSite) $s.state = $parent.state.forSite($site);\n` +
        `  $s.props = () => props;\n` +
        `  $s.children = childrenFn;\n` +
        `  return new $rt.Raw(await render($s));\n` +
        `};\n`
    )
}
