import { assertExhaustive } from '../../shared/assertExhaustive.ts'
import { escapeRegex } from '../../shared/escapeRegex.ts'
import { OUTLET_CLOSE, OUTLET_OPEN } from '../runtime/OUTLET_MARKER.ts'
import { OUTLET_TAG } from '../runtime/OUTLET_TAG.ts'
import {
    ANCHOR,
    RANGE_CLOSE as RANGE_CLOSE_DATA,
    RANGE_OPEN as RANGE_OPEN_DATA,
} from '../runtime/RANGE_MARKER.ts'
import { asOutlet } from './asOutlet.ts'
import { awaitPlan } from './awaitPlan.ts'
import { composeProps } from './composeProps.ts'
import { eachPlan } from './eachPlan.ts'
import { elementPlan } from './elementPlan.ts'
import { groupBindParts } from './groupBindParts.ts'
import { hoistableAwaits } from './hoistableAwaits.ts'
import { hoistableChildRenders } from './hoistableChildRenders.ts'
import { ifPlan } from './ifPlan.ts'
import { interpolatedTemplateLiteral } from './interpolatedTemplateLiteral.ts'
import { isAnchorPositioned } from './isAnchorPositioned.ts'
import { lowerContext } from './lowerContext.ts'
import { makeVarNamer } from './makeVarNamer.ts'
import { scopeAttr } from './scopeAttr.ts'
import { skeletonContext } from './skeletonContext.ts'
import { snippetPlan } from './snippetPlan.ts'
import { spreadExcludedNames } from './spreadExcludedNames.ts'
import { staticAttr } from './staticAttr.ts'
import { staticAttrValue } from './staticAttrValue.ts'
import { staticTextPart } from './staticTextPart.ts'
import { stripEffects } from './stripEffects.ts'
import { switchPlan } from './switchPlan.ts'
import { tryPlan } from './tryPlan.ts'
import type { Binding } from './types/Binding.ts'
import type { ShadowKind } from './types/ShadowKind.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import { withBindings } from './withBindings.ts'

/* The range boundary comments a control-flow block emits around its content. Sourced
   from the SAME wire-alphabet constants the client's `document.createComment` markers
   use (`RANGE_MARKER`), wrapped in comment syntax — so a server-emitted boundary and the
   client `[ … ]` boundary it claims can never drift on a literal. */
const RANGE_OPEN = `<!--${RANGE_OPEN_DATA}-->`
const RANGE_CLOSE = `<!--${RANGE_CLOSE_DATA}-->`

/* The skeleton positioning anchor a control-flow block / slot / outlet emits, sourced
   from the same `ANCHOR` constant the client's anchor scan matches. */
const ANCHOR_COMMENT = `<!--${ANCHOR}-->`

/*
Server code generator: turns the parsed template into statements that push HTML
fragments onto an output array, reading the document synchronously (no DOM, no
listeners). Same expression lowering as the client back-end, so server and client
render the same markup. Dynamic values go through `$esc`; `if` is a plain `if`,
`each` a `for…of`.

An `await` block emits boundary comments (`<!--abide:await:N-->…<!--/abide:await:N-->`).
A streaming block (no `then` on the tag) puts its pending branch between the markers and
registers the promise + async resolved/error renderers on `$awaits`; `renderToStream`
flushes each resolved fragment out of order — the await-block-streams half of the cache
rule. A blocking block (`then` on the tag) is `await`ed INLINE at its structural position
and its resolved branch rendered between the markers, so the render body is async and its
id (`$ctx.next++`) allocates depth-first like the client; the resolved value lands in
`$resume`. Block ids draw from the request-local `$ctx`, shared with inlined child renders.
*/
export function generateSSR(
    nodes: TemplateNode[],
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    computedNames: ReadonlySet<string>,
    isLayout = false,
    /* `linked` / async `computed` names, lowered to `$$readCell(name)` in template exprs. */
    cellReadNames: ReadonlySet<string> = new Set(),
): { body: string; flightDecls: string } {
    /* Unique temp var names (child render results); runtime block ids are
       allocated separately at runtime via `$ctx.next++`. */
    const nextVar = makeVarNamer()
    /* A per-body source-order ordinal for each `<Child/>` render site — the render-path segment the
       child roots under, matching the client `mountChild`'s `childOrdinal` (`generateBuild`) drawn
       in the identical document-order walk, so both compose the same cell scope ids. */
    let childOrdinal = 0

    /* The enclosing `<select bind:value>`s, innermost last: each carries the JS var holding
       its bound value and whether it's a `multiple` (array) select, so an `<option>` rendered
       within can emit `selected` by comparing its own value against the bound one. Pushed when
       a bound select opens, popped after its children. */
    const selectBinds: { variable: string; multiple: boolean }[] = []

    /* The shared signal→`model` lowering + branch-scoped nested-script deref scope. */
    const {
        expression: lowerExpression,
        statement,
        withNestedScripts,
        withShadow,
        bindRead,
        bindWrite,
    } = lowerContext(stateNames, derivedNames, computedNames, cellReadNames)

    /* SSR has no cells, so every plan `Binding` — `reactive` or `plain` — renders as a `plain`
       shadow (a real JS local / loop var / arrow param, read as the bare identifier). The one
       mapping `withBindings` registers every binding through on this back-end. */
    const ssrBindingKind = (_binding: Binding): ShadowKind => 'plain'

    /* A scoped-script body for SSR: the shared lowering, then strip effects
       (client-only lifecycle that emits no HTML) — the one SSR-side asymmetry. */
    const lowerScript = (code: string): string => stripEffects(statement(code))

    function push(target: string, literal: string): string {
        return `${target}.push(${JSON.stringify(literal)});\n`
    }

    /* The JS expression for an `<option>`'s value, to compare against an enclosing bound
       `<select>`: the `value` attribute (static/expression/interpolated), else the option's
       static text content (the browser's own fallback, whitespace-trimmed). Returns undefined
       when the value can't be known at compile time (a dynamic-text option with no `value`
       attr) — the client selects it on hydrate. */
    function optionValueForSSR(
        node: Extract<TemplateNode, { kind: 'element' }>,
    ): string | undefined {
        const valueAttr = node.attrs.find(
            (attr) =>
                (attr.kind === 'static' ||
                    attr.kind === 'expression' ||
                    attr.kind === 'interpolated') &&
                attr.name === 'value',
        )
        if (valueAttr !== undefined) {
            if (valueAttr.kind === 'static') {
                return JSON.stringify(valueAttr.value)
            }
            if (valueAttr.kind === 'expression') {
                return lowerExpression(valueAttr.code)
            }
            if (valueAttr.kind === 'interpolated') {
                return lowerExpression(interpolatedTemplateLiteral(valueAttr.parts))
            }
        }
        let staticText = ''
        for (const child of node.children) {
            if (child.kind !== 'text') {
                return undefined
            }
            for (const part of child.parts) {
                if (part.kind !== 'static') {
                    return undefined
                }
                staticText += part.value
            }
        }
        return JSON.stringify(staticText.trim())
    }

    function generateInto(children: TemplateNode[], target: string): string {
        return children.map((child) => generate(child, target)).join('')
    }

    /* In a layout, rewrite `<slot/>` outlets to `OUTLET_TAG` elements up front (the same shared
       `asOutlet` the client back-end runs), then drive both the skeleton context and the
       traversal from this tree — one decision site for the outlet, and the outlet emitted bare
       through the generic element path exactly as the client clones it. */
    const rootNodes = isLayout ? nodes.map(asOutlet) : nodes

    /* ADR-0034: the await blocks whose promise-start hoists to the synchronous render prefix so
       independent flights overlap instead of serializing. Server-only — this rewires only the SSR
       promise SOURCE (a blocking `await $flightN`, a streaming `promise: () => $flightN`); the
       block's markers, `$ctx.next++` id, RESUME wire, and the whole client build stay byte-identical.
       The `flightDecls` are emitted by compileSSR after the lowered script and BEFORE the barrier, so
       a hoisted flight is already in-flight while the barrier awaits any unrelated blocking cell. */
    const flightNameByNode = new Map<Extract<TemplateNode, { kind: 'await' }>, string>()
    for (const flight of hoistableAwaits(rootNodes, cellReadNames)) {
        flightNameByNode.set(flight.node, flight.name)
    }

    /* ADR-0037 Phase 2: the top-level-spine `<Child/>` renders whose start hoists to the prefix so
       sibling renders overlap instead of serializing behind each other's `await`. The component walk
       below emits each hoisted child's flight decl into `childFlightDecls` (with its childOrdinal and
       lowered props computed at the SAME site as the body's `await`, so the two can't drift) and
       awaits the flight const at the structural position. Each hoisted render starts under
       `$$isolateCellBarrier` so its async cells drain in their own list, not a concurrent sibling's
       (the request-scoped barrier is `splice(0)`-drained). */
    const hoistableChildSet = hoistableChildRenders(rootNodes, cellReadNames)
    const childFlightDecls: string[] = []
    let childFlightCounter = 0

    /* A snippet name (any identifier, `$` included) interpolated into a RegExp must have its
       regex metacharacters escaped, or e.g. a trailing `$` would read as an end-anchor and the
       call site would never match — leaving an un-awaited Promise stringified as `[object
       Promise]`. */
    /* A leading boundary that, unlike `\b`, also fires before a `$`-leading name: `\b$row`
       never matches (`$` is a non-word char, so there is no word boundary before it), which
       would silently miss every `$row(...)` call. A negative lookbehind for word-or-`$`
       matches the same call sites as `\b` for word-leading names while also catching them. */
    /* Memoised per name: the pattern is a pure function of the name but tested across the
       fixpoint loop below (per snippet × per text part × per iteration), so recompiling the
       RegExp each test — far costlier than the test itself — dominated the snippet scan. */
    const callPatternCache = new Map<string, RegExp>()
    const callPattern = (name: string): RegExp => {
        let pattern = callPatternCache.get(name)
        if (pattern === undefined) {
            pattern = new RegExp(`(?<![$\\w])${escapeRegex(name)}\\s*\\(`)
            callPatternCache.set(name, pattern)
        }
        return pattern
    }
    /* A subtree call to any of `names` from a TEXT interpolation (`name()` / `name(args)`). */
    const subtreeCalls = (children: TemplateNode[], names: ReadonlySet<string>): boolean =>
        children.some((child) => {
            if (child.kind === 'text') {
                return child.parts.some(
                    (part) =>
                        part.kind !== 'static' &&
                        [...names].some((name) => callPattern(name).test(part.code)),
                )
            }
            return 'children' in child && subtreeCalls(child.children, names)
        })

    /* Snippet names whose body produces an `await`, so the snippet must be an `async function`
       and its `{name(...)}` call sites awaited: it inlines a child component, holds an await
       block, or emits a `{children()}` slot fill (all `await $props.$children()` in SSR) — a
       structural scan — OR it text-calls another async snippet. The latter is a dependency
       between snippets, so resolve it to a fixpoint — seed with the structural set, then keep
       adding any snippet that calls an already-async one until nothing changes. */
    const subtreeAwaits = (children: TemplateNode[]): boolean =>
        children.some(
            (child) =>
                child.kind === 'component' ||
                child.kind === 'await' ||
                (child.kind === 'element' && child.tag === 'slot') ||
                ('children' in child && subtreeAwaits(child.children)),
        )
    const snippetDefs = new Map<string, TemplateNode[]>()
    const collectSnippetDefs = (children: TemplateNode[]): void => {
        for (const child of children) {
            if (child.kind === 'snippet') {
                snippetDefs.set(child.name, child.children)
            }
            if ('children' in child) {
                collectSnippetDefs(child.children)
            }
        }
    }
    collectSnippetDefs(rootNodes)
    const asyncSnippets = new Set<string>()
    for (const [name, children] of snippetDefs) {
        if (subtreeAwaits(children)) {
            asyncSnippets.add(name)
        }
    }
    let grew = true
    while (grew) {
        grew = false
        for (const [name, children] of snippetDefs) {
            if (!asyncSnippets.has(name) && subtreeCalls(children, asyncSnippets)) {
                asyncSnippets.add(name)
                grew = true
            }
        }
    }
    /* A text-part expression whose value may be a Promise, so `$text` must `await` it:
       either it calls an async snippet declared HERE, or it CALLS a computed-backed
       binding. The latter covers a snippet handed down as a prop and called by its prop
       name (`{item(label)}`) — that prop lowers to a computed, so it never appears in this
       component's own `asyncSnippets`, yet the parent's snippet body may be async and the
       call returns a Promise (the `[object Promise]` bug). A computed READ (`{full}`) is not
       a call, so plain interpolation stays sync; only `name(...)` on a computed is awaited. */
    const awaitableCallNames = new Set<string>([...asyncSnippets, ...computedNames])
    const callsAwaitable = (code: string): boolean => {
        // The common component with no async snippet and no computed pays zero regex work.
        if (awaitableCallNames.size === 0) {
            return false
        }
        for (const name of awaitableCallNames) {
            if (callPattern(name).test(code)) {
                return true
            }
        }
        return false
    }

    /* Per-node skeleton position, computed once. Both back-ends read this single source of
       truth so their `<!--a-->` anchor placement cannot drift — the fresh-context boundaries
       (control-flow branches, component/slot/snippet content) are enumerated there, not
       re-tracked here as mutable state that a forgotten reset could leak past. */
    const { inSkeleton, markText } = skeletonContext(rootNodes)

    /* A control-flow branch's content, generated exactly like a normal child list so
       a branch holds ANY content (components, text, nested blocks). `generate` emits
       nested `<script>`s in document order; `withNestedScripts` puts their bindings in
       scope — matching the client build, so hydration stays aligned. The caller wraps
       it in the `[ … ]` range markers the runtime tracks (unconditionally per block,
       so an empty/false branch still emits the boundary the client claims). The branch's
       fresh build context is already recorded by `skeletonContext`, so its children read
       their own (reset) position — no flag juggling here. */
    function branchContent(children: TemplateNode[], target: string): string {
        return withNestedScripts(children, () => generateInto(children, target))
    }
    const openRange = (target: string): string => push(target, RANGE_OPEN)
    const closeRange = (target: string): string => push(target, RANGE_CLOSE)

    /* Wrap a control-flow branch/row body in the render-path segment the CLIENT pushes for it (the
       `withPathFrom`/`withPath` call the `each`/`when`/`switchBlock` dom runtimes make), so a scope
       created inside — a nested `<Child/>`, always an inline `await` in SSR — composes the SAME
       serialization-stable id on both sides (the warm-seed key). Emitted ONLY when the subtree can
       create such a scope: a component render is the sole scope-creating construct in a branch/row
       and always lowers to an inline `await`, so `subtreeAwaits` is the gate. A purely-synchronous
       branch creates no scope, so its segment is inert — skipping the wrap keeps the static render
       synchronous (no per-row closure/await, matching today's output byte-for-byte). `segment` is a
       JS expression (a literal branch key, or the each row's key/index); `$$withPath` escapes it,
       exactly like the client. The row/branch RANGE markers stay OUTSIDE this call (they create no
       scope), so only the content composes the path — mirroring the client, where the markers are
       built outside `withPathFrom`. */
    const withPathBranch = (segment: string, children: TemplateNode[], target: string): string => {
        const content = branchContent(children, target)
        if (!subtreeAwaits(children)) {
            return content
        }
        return `await $$withPath(${segment}, async () => {\n${content}});\n`
    }

    /* In a skeleton, a control-flow block or slot is positioned by an `<!--a-->` anchor
       (cloned into the located parent), so it can sit anywhere among static siblings.
       Emitted both sides in document order — the client's anchor scan lines up with it.
       Outside a skeleton (top-level / inside a branch) blocks mount on the host directly,
       so no anchor. */
    const anchorMark = (node: TemplateNode, target: string): string =>
        inSkeleton.get(node) ? push(target, ANCHOR_COMMENT) : ''

    function generate(node: TemplateNode, target: string): string {
        /* Every kind that mounts as a marker range is positioned by an `<!--a-->` anchor when
           in a skeleton context: control-flow blocks, child components, and a layout's outlet /
           a component's `<slot>` (both elements). `isAnchorPositioned` is the ONE decision site
           (mirrored by the client's `skeletonMarkup`); `anchorMark` no-ops outside a skeleton,
           so non-anchored nodes ignore the precomputed `anchor`. */
        const anchor = isAnchorPositioned(node) ? anchorMark(node, target) : ''
        if (node.kind === 'text') {
            return node.parts
                .map((part) => {
                    if (part.kind === 'static') {
                        const markup = staticTextPart(part.value)
                        return markup === '' ? '' : push(target, markup)
                    }
                    /* A call to an async snippet returns a Promise — `await` it before `$text`.
                       (The enclosing context is async: the render body and async-snippet bodies.)
                       Plain expressions stay sync, so a component with only interpolation keeps a
                       sync render. */
                    const lowered = lowerExpression(part.code)
                    const value = callsAwaitable(part.code)
                        ? `$text(await (${lowered}))`
                        : `$text(${lowered})`
                    return markText.get(node)
                        ? `${target}.push('${ANCHOR_COMMENT}' + ${value});\n`
                        : `${target}.push(${value});\n`
                })
                .join('')
        }
        if (node.kind === 'if') {
            /* `case` children are the `elseif`/`else` branches in source order; the rest are the
               `then` content. The whole `if`/`elseif`/`else` chain desugars to a run of `if` /
               `else if` clauses. A branch whose condition is a bare async subject contributes TWO
               clauses in order — an empty `$$cellPending` guard (renders nothing, and stops the
               chain: a still-loading branch holds, so nothing later renders on its unknown value)
               then the `$$readCell` truthy test — so sync and async branches interleave and each
               resolves at render time, mirroring the client `switchBlock` cond-chain. */
            const plan = ifPlan(node)
            /* The client build lowers a simple `if`/`else` through `when` (branch keys `'then'` /
               `'else'`) and an `if` with any `elseif` through `switchBlock` over `[then, ...branches]`
               (branch key = the case's array index). Mirror whichever the client picks so a nested
               `<Child/>`'s scope id composes identically. */
            const clauses: string[] = []
            const conditional = (
                condition: string,
                asyncSubject: boolean | undefined,
                children: TemplateNode[],
                segment: string,
            ): void => {
                if (asyncSubject === true) {
                    const cell = condition.trim()
                    clauses.push(`($$cellPending(${cell})) {\n}`)
                    clauses.push(
                        `($$readCell(${cell})) {\n${withPathBranch(segment, children, target)}}`,
                    )
                } else {
                    clauses.push(
                        `(${lowerExpression(condition)}) {\n${withPathBranch(segment, children, target)}}`,
                    )
                }
            }
            /* `then` is the `when` `'then'` branch, or the `switchBlock` case at index 0. */
            conditional(
                node.condition,
                node.asyncSubject,
                plan.thenChildren,
                JSON.stringify(plan.hasElseif ? '0' : 'then'),
            )
            for (let index = 0; index < plan.branches.length; index += 1) {
                const branch = plan.branches[index] as Extract<TemplateNode, { kind: 'case' }>
                if (branch.condition !== undefined) {
                    /* An `elseif` is the `switchBlock` case at `[then, ...branches]` index `index + 1`
                       (a chain with any condition always lowers to `switchBlock`). */
                    conditional(
                        branch.condition,
                        branch.asyncSubject,
                        branch.children,
                        JSON.stringify(String(index + 1)),
                    )
                }
            }
            let code = clauses
                .map((clause, index) => `${index === 0 ? 'if' : ' else if'} ${clause}`)
                .join('')
            if (plan.elseBranch !== undefined) {
                /* `else` is the `when` `'else'` branch, or (for a cond-chain) the `switchBlock`
                   default at its own `[then, ...branches]` index. */
                const elseSegment = plan.hasElseif
                    ? String(plan.branches.indexOf(plan.elseBranch) + 1)
                    : 'else'
                code += ` else {\n${withPathBranch(JSON.stringify(elseSegment), plan.elseBranch.children, target)}}`
            }
            return `${anchor}${openRange(target)}${code}\n${closeRange(target)}`
        }
        if (node.kind === 'switch') {
            const plan = switchPlan(node)
            /* A bare async subject: read the peek, but only match once the cell has settled —
               a pending subject renders no case (matching the client's `switchBlock`). */
            const subjectExpr =
                node.asyncSubject === true
                    ? `$$readCell(${node.subject.trim()})`
                    : `(${lowerExpression(node.subject)})`
            let code = `{ const $s = ${subjectExpr};\n`
            if (node.asyncSubject === true) {
                code += `if (!$$cellPending(${node.subject.trim()})) {\n`
            }
            let started = false
            /* The client `switchBlock` keys each branch by its index in `plan.cases` (source order,
               the default at its own position); mirror that index so a nested `<Child/>` matches. */
            for (let index = 0; index < plan.cases.length; index += 1) {
                const branch = plan.cases[index] as Extract<TemplateNode, { kind: 'case' }>
                if (branch.match !== undefined) {
                    code += `${started ? 'else ' : ''}if ($s === (${lowerExpression(branch.match)})) {\n${withPathBranch(JSON.stringify(String(index)), branch.children, target)}}\n`
                    started = true
                }
            }
            if (plan.fallback !== undefined) {
                const fallbackSegment = String(plan.cases.indexOf(plan.fallback))
                code += `${started ? 'else ' : ''}{\n${withPathBranch(JSON.stringify(fallbackSegment), plan.fallback.children, target)}}\n`
            }
            if (node.asyncSubject === true) {
                code += `}\n`
            }
            return `${anchor}${openRange(target)}${code}}\n${closeRange(target)}`
        }
        if (node.kind === 'case') {
            return ''
        }
        if (node.kind === 'snippet') {
            const plan = snippetPlan(node)
            /* A hoisted function returning the snippet's `$snip`-branded HTML string;
               `{name(args)}` pushes it via `$text`, which wraps it in markers. `args` are plain
               call parameters — `withBindings` registers the plan's `plain` bindings so the body
               reads the bare local, shadowing a same-named component signal rather than reading it. */
            const body = withBindings(withShadow, plan.bindings, ssrBindingKind, () =>
                generateInto(plan.children, '$o'),
            )
            /* `async` only when the body produces an `await` (it inlines a child component) — then
               call sites `await` it (`$text(await frag())`). A sync snippet stays a plain function
               called inline, preserving the sync render contract. */
            const keyword = asyncSnippets.has(plan.name) ? 'async function' : 'function'
            return `${keyword} ${plan.name}(${plan.params ?? ''}) {\nconst $o = [];\n${body}return $snip($o.join(''));\n}\n`
        }
        if (node.kind === 'script') {
            /* A scoped reactive block: re-seed its local signals (lowered, in scope)
               so SSR renders the same values the client build will. */
            return `${lowerScript(node.code)}\n`
        }
        /* A `<style>` emits no markup — its scope attribute is already on the elements
           it covers (above) and its CSS is bundled, not inlined. */
        if (node.kind === 'style') {
            return ''
        }
        if (node.kind === 'each') {
            const plan = eachPlan(node)
            /* Async each (`await`) is drained on the client — render no rows on the
               server (an infinite stream would hang SSR); the client inserts its anchor
               before the next sibling during hydration, like an empty sync each. In a
               skeleton the `<!--a-->` anchor still marks its position (the client mounts
               there); no range markers, since there are no server rows to claim. */
            if (plan.async) {
                return anchor
            }
            /* The client `each` pushes a render-path segment per row (keyed → the `by` key evaluated
               on the raw item, exactly like its `keyOf`; keyless → the row position), so a nested
               `<Child/>`'s scope id composes identically. Mirror it only when the row can create a
               scope (`subtreeAwaits` — it holds a component); a static row needs no segment and stays
               synchronous. A keyless row that needs its position reuses a bound `index`, else a
               synthesized loop index — the same 0-based `entries()` position the client's row cell
               carries, so the segments agree. */
            const rowSegments = subtreeAwaits(plan.children)
            const keylessIndex =
                plan.key === undefined && plan.index === undefined && rowSegments
                    ? nextVar('$i')
                    : undefined
            const indexBinding = plan.index ?? keylessIndex
            /* The row item (and index) are real `for`-loop locals, so the body must lower
               references to them as the bare identifier — `withBindings` registers the plan's
               row bindings (under `plain`, SSR's only kind) so a row binding that shadows a
               same-named component signal reads the loop value, not the (whole-list) signal it
               shadows. The names come straight from `plan.bindings` (the single source the
               client also reads); the items expression stays outside the shadow. */
            const rowBody = withBindings(withShadow, plan.bindings, ssrBindingKind, () => {
                /* The row's render-path segment, lowered inside the row's plain shadow so a keyed
                   `by` reads the raw loop item exactly like the client `keyOf` (a keyless row uses
                   its position). Unused when `rowSegments` is false — `withPathBranch` then skips it. */
                const segment =
                    plan.key === undefined
                        ? (indexBinding ?? '0')
                        : `(${lowerExpression(plan.key)})`
                return `${openRange(target)}${withPathBranch(segment, plan.children, target)}${closeRange(target)}`
            })
            /* `index="i"` binds the row position. SSR reads it as a plain number from
               `entries()` over a materialized array; the client reads the same number from a
               cell, so first paint is congruent. No index → a plain `for…of` over the items. */
            /* An undefined source renders no rows, not a throw — a `{#for x in promise}`
               whose lifted source peeks undefined while pending (ADR-0032 D3). Mirrors the
               client `each`'s undefined-as-empty guard. */
            const header =
                indexBinding === undefined
                    ? `for (const ${plan.as} of ((${lowerExpression(plan.items)}) ?? []))`
                    : `for (const [${indexBinding}, ${plan.as}] of [...((${lowerExpression(plan.items)}) ?? [])].entries())`
            return `${anchor}${header} {\n${rowBody}}\n`
        }
        if (node.kind === 'await') {
            return `${anchor}${generateAwait(node, target)}`
        }
        if (node.kind === 'try') {
            return `${anchor}${generateTry(node, target)}`
        }
        if (node.kind === 'branch') {
            return ''
        }
        if (node.kind === 'component') {
            /* Server-render the child via its `render` and inline the HTML inside the same
               `[ … ]` marker range the client mounts into (`mountRange`) — no wrapper element,
               so SSR and client agree and the child's root lays out as a direct child. Props
               pass as thunks; slot content passes as a string-returning `children` the child
               invokes from its <slot>. */
            /* Slot content is a fresh build context — the child's `<slot>` mounts it via
               `mountSlot`, not the parent skeleton clone, and the client builds it through
               `propsArg`/`generateChildren` (never the skeleton path). `skeletonContext`
               records it reset, so its children emit no enclosing-skeleton anchors the client
               slot builder would lack. */
            const slotCode = generateInto(node.children, '$slot')
            /* Slot content rides the `children` prop key as a `Snippet`: a zero-arg callable
               returning an ASYNC builder the child `await`s at its `{children()}` position
               (`generateSlot`), whose resolved value is a `$snip`-branded string — so it renders
               through the same `$text` snippet-marker path as any `{snippet(args)}` and unifies
               with a passed `children={snippet}`. It is NOT pre-resolved: pre-resolving here would
               run the slot's `$ctx.next++` block ids BEFORE the child render's own, but the client
               builds slot content lazily at the `{children()}` site — so a child with an await/try
               before its slot would allocate ids in the opposite order and desync hydration.
               Keeping the slot lazy draws its ids at the `{children()}` site on both sides. The
               builder shares the enclosing render's `$ctx`/`$awaits`/`$resume` (a closure), so
               nested awaits register and number correctly during the child render. A child with a
               slot fill is therefore always an async render. */
            const slotPart =
                slotCode.trim() === ''
                    ? undefined
                    : `"children": () => (async () => { const $slot = []; ${slotCode}return $snip($slot.join('')); })`
            /* The same last-wins layering the client build emits (`composeProps`), so SSR
               and hydration read the same prop bag. */
            const propsExpr = composeProps(
                node.props,
                lowerExpression,
                slotPart,
                bindRead,
                bindWrite,
            )
            /* Render the child (awaited — render is async) sharing this render's `$ctx`,
               so its `await`/`try` block ids draw from the same depth-first counter,
               unique across page + children, and the streamed fragments resolve into the
               right boundaries. MERGE its streaming awaits into `$awaits` and its inline
               blocking values into `$resume`. ($awaits/$resume are captured from the
               enclosing render body, including from branch closures.) */
            const result = nextVar('$child')
            /* The tag lowers like any reference (see generateBuild): a static import is left bare, a
               reactive/loop/await binding derefs — SSR registers such a binding as `plain`, so it
               reads the bare local holding the resolved component, keeping SSR and client congruent.
               Root the child's render-path at this mount site's source-order ordinal — the same
               segment the client's `mountChild` pushes — so the child's cells (and now its block ids,
               ADR-0037) get an id matching the client's. `$$withPath` sets the path across the child's
               awaits (ALS on the server). */
            const ordinal = childOrdinal++
            const renderExpr = `$$withPath(${ordinal}, () => ${lowerExpression(node.name)}.render(${propsExpr}, $ctx))`
            /* Hoistable (ADR-0037 Phase 2): start the render in the prefix as an isolated flight and
               await the const here, so this child overlaps its siblings. Otherwise await the render
               inline at its structural position (sequential, as before). Either way the html splices
               and the awaits/resume merge at THIS position, so document order is preserved. */
            let renderSource: string
            if (hoistableChildSet.has(node)) {
                const flightName = `$cf${childFlightCounter++}`
                childFlightDecls.push(
                    `const ${flightName} = $$flight(() => $$isolateCellBarrier(() => ${renderExpr}));`,
                )
                renderSource = flightName
            } else {
                renderSource = renderExpr
            }
            return (
                anchor +
                push(target, RANGE_OPEN) +
                `const ${result} = await ${renderSource};\n` +
                `${target}.push(${result}.html);\n` +
                `for (const $a of ${result}.awaits) { $awaits.push($a); }\n` +
                `Object.assign($resume, ${result}.resume);\n` +
                push(target, RANGE_CLOSE)
            )
        }
        if (node.kind === 'element' && node.tag === OUTLET_TAG) {
            /* A layout's router fill point (`asOutlet` rewrote its `<slot/>`): an `<!--a-->`
               anchor (in a skeleton) + an empty `<!--abide:outlet-->`…`<!--/abide:outlet-->`
               boundary the chain composer folds the child layer into (`renderChain`) and the
               client router fills/hydrates (`outlet`/`fillBoundary`) — no wrapper element. */
            return anchor + push(target, `<!--${OUTLET_OPEN}--><!--${OUTLET_CLOSE}-->`)
        }
        if (node.kind === 'element' && node.tag === 'slot') {
            /* `asOutlet` already rewrote a layout's top-level/element-nested `<slot/>` to an
               `OUTLET_TAG` element (handled above), so a `slot` node reaching here in a layout
               is control-flow-nested — emit the same empty outlet boundary the client's
               control-flow-nested path builds, which the chain composer folds the child into. */
            if (isLayout) {
                return push(target, `<!--${OUTLET_OPEN}--><!--${OUTLET_CLOSE}-->`)
            }
            return generateSlot(node, target, anchor)
        }
        /* Every non-element kind returned above; a kind reaching the element builder
           that isn't an element is a compiler gap — fail loud rather than emit it as a
           bogus `<undefined>` tag. (`node` narrows to `never` in this branch.) */
        if (node.kind !== 'element') {
            return assertExhaustive(node, 'template node kind')
        }
        let code = push(target, `<${node.tag}`)
        /* Every `<style>` active at this element (own siblings + ancestors) — same set
           the client stamps, so server and client markup carry identical attributes. */
        for (const scope of node.scopes ?? []) {
            code += push(target, scopeAttr(scope))
        }
        /* The shared per-element emission DECISION (one site, consulted by the build back-end
           too): each attribute classified + tagged with its merge status, the class/style/
           directive merge folded in, and void-tag status. `class:`/`style:` directives collapse
           with any static/interpolated `class`/`style` base into a SINGLE merged attribute (a
           duplicate attribute would be invalid and ignored). SSR must always emit one attribute
           string, so it merges whenever a directive exists (`mergeClass`/`mergeStyle`); those
           attrs are tagged `mergedSSR` and skipped below. The client's classList.toggle /
           style.setProperty effects re-apply the same values on hydrate, so the merged SSR value
           already matches the post-mount DOM — no flash, no desync. SSR RENDERS each kind below
           as an escaped string. */
        const plan = elementPlan(node, lowerExpression)
        const merge = plan.merge
        for (const { attr, mergedSSR } of plan.attrs) {
            /* Skip attrs folded into the merged class/style string below. */
            if (mergedSSR) {
                continue
            }
            if (attr.kind === 'static') {
                code += push(target, staticAttr(attr.name, attr.value))
            } else if (attr.kind === 'expression') {
                /* present/absent semantics matching the client `attr` binding:
                   false/null/undefined drops it, true emits the bare attribute. */
                code += `${target}.push($attr(${JSON.stringify(attr.name)}, ${lowerExpression(attr.code)}));\n`
            } else if (attr.kind === 'interpolated') {
                /* A string-valued attribute, always present (a merged class/style was skipped
                   above). */
                code += `${target}.push($attr(${JSON.stringify(attr.name)}, ${lowerExpression(interpolatedTemplateLiteral(attr.parts))}));\n`
            } else if (attr.kind === 'spread') {
                /* `{...expr}` element spread: each key as an attribute, functions (event
                   handlers) skipped — the client `spreadAttrs` wires those on hydrate. Keys
                   explicitly named on the element are skipped (the explicit attr wins), so
                   no duplicate attribute is emitted and the client DOM agrees. */
                code += `${target}.push($spread(${lowerExpression(attr.code)}, ${JSON.stringify(spreadExcludedNames(node.attrs))}));\n`
            } else if (attr.kind === 'bind' && attr.property === 'group') {
                /* Render the checked state as a boolean attribute: present when the
                   path holds (radio) or contains (checkbox) this control's value. */
                const { valueCode, isRadio } = groupBindParts(node)
                const present = isRadio
                    ? `(${lowerExpression(attr.code)}) === (${lowerExpression(valueCode)})`
                    : `(${lowerExpression(attr.code)}).includes(${lowerExpression(valueCode)})`
                code += `${target}.push((${present}) ? ' checked' : '');\n`
            } else if (attr.kind === 'bind' && attr.property === 'checked') {
                /* A boolean property — its mere presence means checked, so emit the
                   attribute only when truthy (a string `checked="false"` still checks). */
                code += `${target}.push((${bindRead(attr.code)}) ? ' checked' : '');\n`
            } else if (attr.kind === 'bind' && attr.property === 'open') {
                /* `<details open>` — `open` is a boolean attribute, so `open="false"` would
                   still render open. Emit the bare attribute only when truthy, like checked. */
                code += `${target}.push((${bindRead(attr.code)}) ? ' open' : '');\n`
            } else if (attr.kind === 'bind' && attr.property === 'value' && node.tag === 'select') {
                /* `<select bind:value>` selects via `selected` on the matching option (a
                   `value="…"` on the select is ignored by browsers), wired below. Emit nothing
                   here. */
            } else if (attr.kind === 'bind') {
                code += `${target}.push(${JSON.stringify(` ${attr.property}="`)} + $esc(${bindRead(attr.code)}) + '"');\n`
            }
        }
        /* Merged class/style: the same composed parts the build effect uses (from the plan),
           joined and escaped into one attribute string. */
        if (merge.mergeClass) {
            code += `${target}.push(' class="' + $esc([${merge.classParts.join(', ')}].filter(Boolean).join(' ')) + '"');\n`
        }
        if (merge.mergeStyle) {
            code += `${target}.push(' style="' + $esc([${merge.styleParts.join(', ')}].filter(Boolean).join(';')) + '"');\n`
        }
        /* An `<option>` inside a bound `<select>`: emit `selected` when its value equals the
           bound value (single) or is a member of it (multiple). */
        if (node.tag === 'option' && selectBinds.length > 0) {
            const optionValue = optionValueForSSR(node)
            const bind = selectBinds[selectBinds.length - 1]
            if (optionValue !== undefined && bind !== undefined) {
                const present = bind.multiple
                    ? `Array.isArray(${bind.variable}) && ${bind.variable}.includes(${optionValue})`
                    : `(${optionValue}) === (${bind.variable})`
                code += `${target}.push((${present}) ? ' selected' : '');\n`
            }
        }
        code += push(target, '>')
        /* A bound `<select>` publishes its current value to a local so the options rendered
           as its children can compare against it; popped once past those children. */
        const selectValueBind =
            node.tag === 'select'
                ? node.attrs.find((attr) => attr.kind === 'bind' && attr.property === 'value')
                : undefined
        if (selectValueBind !== undefined && selectValueBind.kind === 'bind') {
            const variable = nextVar('$sel')
            code += `const ${variable} = ${bindRead(selectValueBind.code)};\n`
            selectBinds.push({
                variable,
                multiple: staticAttrValue(node, 'multiple') !== undefined,
            })
        }
        if (!plan.isVoid) {
            /* Each child's skeleton position (whether its reactive text interleaves into an
               anchor, whether a nested block anchors) is already recorded by `skeletonContext`
               — read per node, not tracked here. A `<script>` child scopes its bindings to
               this element's subtree. */
            code += withNestedScripts(node.children, () => generateInto(node.children, target))
            code += push(target, `</${node.tag}>`)
        }
        if (selectValueBind !== undefined) {
            selectBinds.pop()
        }
        return code
    }

    /* A component `{children()}` fill point: render the `children` prop (a `Snippet`) as a
       snippet text part. `children()()` reads the destructured `children` computed and calls
       it → a Promise of a `$snip`-branded string; `await` it and push through `$text`, which
       wraps the branded string in `<!--abide:snippet-->` markers — the same range the client's
       appendText→appendSnippet emits and claims, so hydration stays congruent. Inside a skeleton
       the slot is positioned by an `<!--a-->` anchor and bounded by a `[ … ]` range (matching the
       client's `mountSlot`); outside one it emits just the snippet markers (matching the client's
       direct `appendText`). The `await` makes a component with a slot an async render (its caller
       already `await`s `render()`). A fallback is now an authored `{#if children}…{:else}…{/if}`,
       so the slot node carries no children. */
    function generateSlot(
        node: Extract<TemplateNode, { kind: 'element' }>,
        target: string,
        anchor: string,
    ): string {
        const wrap = inSkeleton.get(node)
        const body = `${target}.push($text(await (${lowerExpression('children()')})));\n`
        if (!wrap) {
            return body
        }
        return `${anchor}${openRange(target)}${body}${closeRange(target)}`
    }

    /* A blocking await (`then` on the tag) renders INLINE during the async render pass;
       a streaming await defers its resolved branch to `renderToStream`. */
    function generateAwait(node: Extract<TemplateNode, { kind: 'await' }>, target: string): string {
        return node.blocking
            ? generateBlockingAwait(node, target)
            : generateStreamingAwait(node, target)
    }

    /*
    A blocking await — `await`ed at its structural position in the async render pass and
    its resolved branch rendered INLINE into `target`, between the boundary markers. This
    matches the client (which runs `then` inline during adopt): one render pass, so the
    block id (`$ctx.next++`) and any nested await's id are allocated depth-first in the
    same order the client hydrates them, and the resolved value is captured into `$resume`
    for the manifest. The resolved children bind `node.as`; `finally` appends after, matching
    the client's concatenated node range. With no catch/finally branch a rejection propagates
    (renderToStream / the 500 surfaces it); otherwise the catch branch renders and seeds an
    error resume. The value `const` is block-scoped to its `try`, so sibling blocking awaits
    that bind the same name don't collide.
    */
    function generateBlockingAwait(
        node: Extract<TemplateNode, { kind: 'await' }>,
        target: string,
    ): string {
        const plan = awaitPlan(node)
        const id = nextVar('$aid')
        /* The resolved value lands in a synthetic var FIRST, then the author binding is
           declared from it inside a nested block. Two reasons: the promise expression is
           lowered in the outer scope where the binding name is not yet declared, so
           `{#await foo then foo}` reads the outer `foo` (no temporal-dead-zone crash on a
           same-named binding); and the nested block is the lexical scope the branch's
           `withBindings` shadow models, so a reference to the binding reads the plain
           local rather than the (unresolved) component signal it shadows. */
        const resolved = nextVar('$av')
        /* ADR-0034: a hoisted block awaits the prefix flight const (already in-flight); a
           non-hoisted block evaluates + awaits its promise inline as before. */
        const hoistedPromise = flightNameByNode.get(node)
        let code = `const ${id} = $$blockId($ctx);\n`
        code += `${target}.push("<!--abide:await:" + ${id} + "-->");\n`
        code += `try {\n`
        code += `const ${resolved} = await (${hoistedPromise ?? lowerExpression(node.promise)});\n`
        code += `{\n`
        code += `const ${plan.resolvedAs} = ${resolved};\n`
        code += withBindings(withShadow, plan.resolvedBindings, ssrBindingKind, () =>
            branchContent(plan.resolvedChildren, target),
        )
        /* `finally` does not bind the resolved value, so it is lowered OUTSIDE the `then`
           shadow — matching the catch branch below, so a finally expression naming the
           same identifier as the `then` binding reads the component signal, not the local. */
        code += branchContent(plan.finallyChildren, target)
        /* Seed the resolved value into the resume manifest so hydration adopts the server
           branch warm (no round-trip) and wires it live on the first frame. Seed the
           resolved temp, NOT `plan.resolvedAs` — the latter is the author's binding
           PATTERN (e.g. `{name}` or `{name = 'anon'}`), which as an expression rebuilds a
           partial object or is a CoverInitializedName syntax error. */
        code += `$resume[${id}] = { ok: true, value: ${resolved} };\n`
        code += `}\n`
        if (plan.surfaceRejection) {
            /* No catch/finally → let the rejection surface instead of an empty branch. */
            code += `} catch (_error) { throw _error; }\n`
        } else {
            code += `} catch (${plan.catchAs}) {\n`
            code += withBindings(withShadow, plan.catchBindings, ssrBindingKind, () =>
                branchContent(plan.catchChildren, target),
            )
            code += branchContent(plan.finallyChildren, target)
            code += `$resume[${id}] = { ok: false, error: String(${plan.catchAs}) };\n`
            code += `}\n`
        }
        code += `${target}.push("<!--/abide:await:" + ${id} + "-->");\n`
        return code
    }

    /* A streaming await — emits the pending branch between the markers (flushed now) and
       registers the promise + async string-renderers on `$awaits`; `renderToStream`
       flushes the resolved fragment out of order. The renderers are async so a nested
       `await` block inside the branch composes. `finally` appends after the outcome,
       matching the client's concatenated node range. Neither catch nor finally → omit
       `catch` so a rejection surfaces (renderToStream re-throws); a finally-only block
       keeps a catch renderer that renders just finally. */
    function generateStreamingAwait(
        node: Extract<TemplateNode, { kind: 'await' }>,
        target: string,
    ): string {
        const plan = awaitPlan(node)
        const id = nextVar('$aid')
        let code = `const ${id} = $$blockId($ctx);\n`
        code += `${target}.push("<!--abide:await:" + ${id} + "-->");\n`
        code += branchContent(plan.pending, target)
        code += `${target}.push("<!--/abide:await:" + ${id} + "-->");\n`
        /* The settled renderer takes the resolved/error value as a real arrow parameter
           (`async (foo) => …`), so its body must lower references to that name as the plain
           local — `withBindings` registers the plan's bindings (under `plain`, SSR's only kind)
           so a binding that shadows a same-named component signal reads the value, not the
           signal. The arrow param is the binding's author name; the names enter scope from the
           same `plan.*Bindings` the client reads. */
        const settled = (param: string, bindings: Binding[], children: TemplateNode[]) =>
            `async (${param}) => { const $o = []; ${withBindings(
                withShadow,
                bindings,
                ssrBindingKind,
                () => branchContent(children, '$o'),
            )}${branchContent(plan.finallyChildren, '$o')}return $o.join(''); }`
        const catchProp = plan.surfaceRejection
            ? ''
            : `catch: ${settled(plan.catchAs, plan.catchBindings, plan.catchChildren)} `
        /* ADR-0034: a hoisted streaming block's thunk returns the prefix flight const (started
           in the prefix, so it overlaps a preceding blocking await); non-hoisted evaluates lazily
           at drain time as before. */
        const hoistedPromise = flightNameByNode.get(node)
        code +=
            `$awaits.push({ id: ${id}, ` +
            `promise: () => (${hoistedPromise ?? lowerExpression(node.promise)}), ` +
            `then: ${settled(plan.resolvedAs, plan.resolvedBindings, plan.resolvedChildren)}, ` +
            `${catchProp}});\n`
        return code
    }

    /* A reactive error boundary: push the guarded markup (++ finally) inside a real
       try/catch; on a throw, truncate the output back to the range start and push the
       catch markup (++ finally) instead — so even mid-stream a render throw becomes catch
       markup, not a broken response. No catch re-throws (propagates to an enclosing boundary
       / the 500 / the stream). The `abide:try:N` boundary comments let hydration discard the
       server content if the client adoption fails; the inner `[ … ]` range markers are the
       live range the render-many client (`tryBlock`) tracks — emitted here so a FRESH client
       mount (which brackets its branch) and the SSR markup stay congruent. */
    function generateTry(node: Extract<TemplateNode, { kind: 'try' }>, target: string): string {
        const plan = tryPlan(node)
        const id = nextVar('$tid')
        const mark = nextVar('$trim')
        let code = `const ${id} = $$blockId($ctx);\n`
        code += `${target}.push("<!--abide:try:" + ${id} + "-->");\n`
        code += openRange(target)
        /* Truncate back to just after the range-open marker on a catch, so `[` survives. */
        code += `const ${mark} = ${target}.length;\n`
        code += `try {\n`
        code += branchContent(plan.guarded, target)
        code += branchContent(plan.finallyChildren, target)
        code += `} catch (${plan.catchAs}) {\n${target}.length = ${mark};\n`
        if (plan.hasCatch) {
            code += withBindings(withShadow, plan.catchBindings, ssrBindingKind, () =>
                branchContent(plan.catchChildren, target),
            )
            code += branchContent(plan.finallyChildren, target)
        } else {
            code += `throw ${plan.catchAs};\n`
        }
        code += `}\n`
        code += closeRange(target)
        code += `${target}.push("<!--/abide:try:" + ${id} + "-->");\n`
        return code
    }

    /* The body walk emits `await $flightN` / `promise: () => $flightN` for hoisted nodes; the
       matching prefix declarations (lowered at component scope — hoisted promises reference only
       component-scope names, never a branch shadow, so this lowering matches the body's) are
       returned for compileSSR to place after the lowered script and before the barrier. */
    const body = generateInto(rootNodes, '$out')
    let flightDecls = ''
    for (const [node, name] of flightNameByNode) {
        flightDecls += `const ${name} = $$flight(() => (${lowerExpression(node.promise)}));\n`
    }
    /* Child-render flights emitted during the body walk above (ADR-0037 Phase 2) — appended after
       the await flights; both are independent prefix promise-starts, so order between them is free. */
    for (const decl of childFlightDecls) {
        flightDecls += `${decl}\n`
    }
    return { body, flightDecls }
}
