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
import { composeProps } from './composeProps.ts'
import { groupBindParts } from './groupBindParts.ts'
import { isAnchorPositioned } from './isAnchorPositioned.ts'
import { lowerContext } from './lowerContext.ts'
import { makeVarNamer } from './makeVarNamer.ts'
import { resolveBranches } from './resolveBranches.ts'
import { scopeAttr } from './scopeAttr.ts'
import { skeletonContext } from './skeletonContext.ts'
import { spreadExcludedNames } from './spreadExcludedNames.ts'
import { staticAttr } from './staticAttr.ts'
import { staticTextPart } from './staticTextPart.ts'
import { stripEffects } from './stripEffects.ts'
import type { TemplateAttr } from './types/TemplateAttr.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import { VOID_TAGS } from './VOID_TAGS.ts'

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
): string {
    /* Unique temp var names (child render results); runtime block ids are
       allocated separately at runtime via `$ctx.next++`. */
    const nextVar = makeVarNamer()

    /* The shared signal→`model` lowering + branch-scoped nested-script deref scope. */
    const {
        expression: lowerExpression,
        statement,
        withNestedScripts,
        bindRead,
    } = lowerContext(stateNames, derivedNames, computedNames)

    /* A scoped-script body for SSR: the shared lowering, then strip effects
       (client-only lifecycle that emits no HTML) — the one SSR-side asymmetry. */
    const lowerScript = (code: string): string => stripEffects(statement(code))

    function push(target: string, literal: string): string {
        return `${target}.push(${JSON.stringify(literal)});\n`
    }

    function generateInto(children: TemplateNode[], target: string): string {
        return children.map((child) => generate(child, target)).join('')
    }

    /* In a layout, rewrite `<slot/>` outlets to `OUTLET_TAG` elements up front (the same shared
       `asOutlet` the client back-end runs), then drive both the skeleton context and the
       traversal from this tree — one decision site for the outlet, and the outlet emitted bare
       through the generic element path exactly as the client clones it. */
    const rootNodes = isLayout ? nodes.map(asOutlet) : nodes

    /* A snippet name (any identifier, `$` included) interpolated into a RegExp must have its
       regex metacharacters escaped, or e.g. a trailing `$` would read as an end-anchor and the
       call site would never match — leaving an un-awaited Promise stringified as `[object
       Promise]`. */
    /* A leading boundary that, unlike `\b`, also fires before a `$`-leading name: `\b$row`
       never matches (`$` is a non-word char, so there is no word boundary before it), which
       would silently miss every `$row(...)` call. A negative lookbehind for word-or-`$`
       matches the same call sites as `\b` for word-leading names while also catching them. */
    const callPattern = (name: string): RegExp =>
        new RegExp(`(?<![$\\w])${escapeRegex(name)}\\s*\\(`)
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
       and its `{name(...)}` call sites awaited: it inlines a child component / holds an await
       block (a structural scan), OR it text-calls another async snippet. The latter is a
       dependency between snippets, so resolve it to a fixpoint — seed with the structural set,
       then keep adding any snippet that calls an already-async one until nothing changes. */
    const subtreeAwaits = (children: TemplateNode[]): boolean =>
        children.some(
            (child) =>
                child.kind === 'component' ||
                child.kind === 'await' ||
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
    /* A text-part expression that calls an async snippet, so its value is `await`ed before
       `$text`. */
    const callsAsyncSnippet = (code: string): boolean =>
        [...asyncSnippets].some((name) => callPattern(name).test(code))

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
                    const value = callsAsyncSnippet(part.code)
                        ? `$text(await (${lowered}))`
                        : `$text(${lowered})`
                    return markText.get(node)
                        ? `${target}.push('${ANCHOR_COMMENT}' + ${value});\n`
                        : `${target}.push(${value});\n`
                })
                .join('')
        }
        if (node.kind === 'if') {
            /* `case` children are the `elseif`/`else` branches in source order; the rest are
               the `then` content. Each `elseif` becomes an `else if`, the match-less `else`
               the trailing `else`. */
            const branches = node.children.filter(
                (child): child is Extract<TemplateNode, { kind: 'case' }> => child.kind === 'case',
            )
            const thenChildren = node.children.filter((child) => child.kind !== 'case')
            let code = `if (${lowerExpression(node.condition)}) {\n${branchContent(thenChildren, target)}}`
            for (const branch of branches) {
                code +=
                    branch.condition !== undefined
                        ? ` else if (${lowerExpression(branch.condition)}) {\n${branchContent(branch.children, target)}}`
                        : ` else {\n${branchContent(branch.children, target)}}`
            }
            return `${anchor}${openRange(target)}${code}\n${closeRange(target)}`
        }
        if (node.kind === 'switch') {
            const cases = node.children.filter(
                (child): child is Extract<TemplateNode, { kind: 'case' }> => child.kind === 'case',
            )
            let code = `{ const $s = (${lowerExpression(node.subject)});\n`
            let started = false
            for (const branch of cases) {
                if (branch.match !== undefined) {
                    code += `${started ? 'else ' : ''}if ($s === (${lowerExpression(branch.match)})) {\n${branchContent(branch.children, target)}}\n`
                    started = true
                }
            }
            const fallback = cases.find((branch) => branch.match === undefined)
            if (fallback !== undefined) {
                code += `${started ? 'else ' : ''}{\n${branchContent(fallback.children, target)}}\n`
            }
            return `${anchor}${openRange(target)}${code}}\n${closeRange(target)}`
        }
        if (node.kind === 'case') {
            return ''
        }
        if (node.kind === 'snippet') {
            /* A hoisted function returning the snippet's `$snip`-branded HTML string;
               `{name(args)}` pushes it via `$text`, which wraps it in markers. */
            const body = generateInto(node.children, '$o')
            /* `async` only when the body produces an `await` (it inlines a child component) — then
               call sites `await` it (`$text(await frag())`). A sync snippet stays a plain function
               called inline, preserving the sync render contract. */
            const keyword = asyncSnippets.has(node.name) ? 'async function' : 'function'
            return `${keyword} ${node.name}(${node.params ?? ''}) {\nconst $o = [];\n${body}return $snip($o.join(''));\n}\n`
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
            /* Async each (`await`) is drained on the client — render no rows on the
               server (an infinite stream would hang SSR); the client inserts its anchor
               before the next sibling during hydration, like an empty sync each. In a
               skeleton the `<!--a-->` anchor still marks its position (the client mounts
               there); no range markers, since there are no server rows to claim. */
            if (node.async) {
                return anchor
            }
            const rowBody = `${openRange(target)}${branchContent(node.children, target)}${closeRange(target)}`
            /* `index="i"` binds the row position. SSR reads it as a plain number from
               `entries()` over a materialized array; the client reads the same number from a
               cell, so first paint is congruent. No index → a plain `for…of` over the items. */
            const header =
                node.index === undefined
                    ? `for (const ${node.as} of (${lowerExpression(node.items)}))`
                    : `for (const [${node.index}, ${node.as}] of [...(${lowerExpression(node.items)})].entries())`
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
               pass as thunks; slot content passes as a string-returning `$children` the child
               invokes from its <slot>. */
            /* Slot content is a fresh build context — the child's `<slot>` mounts it via
               `mountSlot`, not the parent skeleton clone, and the client builds it through
               `propsArg`/`generateChildren` (never the skeleton path). `skeletonContext`
               records it reset, so its children emit no enclosing-skeleton anchors the client
               slot builder would lack. */
            const slotCode = generateInto(node.children, '$slot')
            /* `$children` is an ASYNC builder the child `await`s at its `<slot>` position
               (`generateSlot`), NOT a pre-resolved string. Pre-resolving here would run the
               slot's `$ctx.next++` block ids BEFORE the child render's own, but the client
               builds slot content lazily at the `<slot>` site — so a child with an await/try
               before its `<slot>` would allocate ids in the opposite order and desync hydration.
               Keeping the slot lazy makes the slot's ids draw at the `<slot>` site on both
               sides. The builder shares the enclosing render's `$ctx`/`$awaits`/`$resume` (a
               closure), so nested awaits register and number correctly during the child render.
               A child with a `<slot>` is therefore always an async render. */
            const slotPart =
                slotCode.trim() === ''
                    ? undefined
                    : `"$children": async () => { const $slot = []; ${slotCode}return $slot.join(''); }`
            /* The same last-wins layering the client build emits (`composeProps`), so SSR
               and hydration read the same prop bag. */
            const propsExpr = composeProps(node.props, lowerExpression, slotPart)
            /* Render the child (awaited — render is async) sharing this render's `$ctx`,
               so its `await`/`try` block ids draw from the same depth-first counter,
               unique across page + children, and the streamed fragments resolve into the
               right boundaries. MERGE its streaming awaits into `$awaits` and its inline
               blocking values into `$resume`. ($awaits/$resume are captured from the
               enclosing render body, including from branch closures.) */
            const result = nextVar('$child')
            return (
                anchor +
                push(target, RANGE_OPEN) +
                `const ${result} = await ${node.name}.render(${propsExpr}, $ctx);\n` +
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
        /* `class:`/`style:` directives collapse with any static `class`/`style` into a SINGLE
           merged attribute (a duplicate attribute would be invalid and ignored). The client's
           classList.toggle / style.setProperty effects re-apply the same values on hydrate, so
           the merged SSR value already matches the post-mount DOM — no flash, no desync. */
        const classDirectives = node.attrs.filter(
            (attr): attr is Extract<TemplateAttr, { kind: 'class' }> => attr.kind === 'class',
        )
        const styleDirectives = node.attrs.filter(
            (attr): attr is Extract<TemplateAttr, { kind: 'style' }> => attr.kind === 'style',
        )
        for (const attr of node.attrs) {
            if (attr.kind === 'static') {
                /* A static class/style is folded into the merge below when directives exist. */
                if (
                    (attr.name === 'class' && classDirectives.length > 0) ||
                    (attr.name === 'style' && styleDirectives.length > 0)
                ) {
                    continue
                }
                code += push(target, staticAttr(attr.name, attr.value))
            } else if (attr.kind === 'expression') {
                /* present/absent semantics matching the client `attr` binding:
                   false/null/undefined drops it, true emits the bare attribute. */
                code += `${target}.push($attr(${JSON.stringify(attr.name)}, ${lowerExpression(attr.code)}));\n`
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
            } else if (attr.kind === 'bind') {
                code += `${target}.push(${JSON.stringify(` ${attr.property}="`)} + $esc(${bindRead(attr.code)}) + '"');\n`
            }
        }
        /* Merged class: static value + each directive's name when its expression is truthy. */
        if (classDirectives.length > 0) {
            const staticClass = node.attrs.find(
                (attr): attr is Extract<TemplateAttr, { kind: 'static' }> =>
                    attr.kind === 'static' && attr.name === 'class',
            )
            const parts = [
                ...(staticClass ? [JSON.stringify(staticClass.value)] : []),
                ...classDirectives.map(
                    (dir) => `((${lowerExpression(dir.code)}) ? ${JSON.stringify(dir.name)} : "")`,
                ),
            ]
            code += `${target}.push(' class="' + $esc([${parts.join(', ')}].filter(Boolean).join(' ')) + '"');\n`
        }
        /* Merged style: static value + each directive's `prop:value` (String()-coerced, matching
           the client's style.setProperty). */
        if (styleDirectives.length > 0) {
            const staticStyle = node.attrs.find(
                (attr): attr is Extract<TemplateAttr, { kind: 'static' }> =>
                    attr.kind === 'static' && attr.name === 'style',
            )
            const parts = [
                ...(staticStyle ? [JSON.stringify(staticStyle.value)] : []),
                ...styleDirectives.map(
                    (dir) =>
                        `(${JSON.stringify(`${dir.property}:`)} + String(${lowerExpression(dir.code)}))`,
                ),
            ]
            code += `${target}.push(' style="' + $esc([${parts.join(', ')}].filter(Boolean).join(';')) + '"');\n`
        }
        code += push(target, '>')
        if (!VOID_TAGS.has(node.tag)) {
            /* Each child's skeleton position (whether its reactive text interleaves into an
               anchor, whether a nested block anchors) is already recorded by `skeletonContext`
               — read per node, not tracked here. A `<script>` child scopes its bindings to
               this element's subtree. */
            code += withNestedScripts(node.children, () => generateInto(node.children, target))
            code += push(target, `</${node.tag}>`)
        }
        return code
    }

    /* A `<slot>` outlet: emit the parent-provided content (`$children`), falling back to the
       slot's own children when none was supplied. Inside a skeleton the slot is positioned
       by an `<!--a-->` anchor and its content bounded by a `[ … ]` range (matching the
       client's `mountSlot`), so it can sit among static siblings. The fallback is a fresh,
       non-skeleton build context — the client builds it via `mountSlot`/`fillBefore`, not the
       skeleton clone — so its reactive text takes no anchor (`skeletonContext` records the
       fallback children reset). */
    function generateSlot(
        node: Extract<TemplateNode, { kind: 'element' }>,
        target: string,
        anchor: string,
    ): string {
        const wrap = inSkeleton.get(node)
        const fallback = generateInto(node.children, target)
        /* `$children` is an async builder the parent passes lazily; `await` it here so the
           slot content's block ids allocate AT the `<slot>` position — the same order the
           client builds slot content — keeping hydration congruent. The `await` makes a
           component with a `<slot>` an async render (its caller already `await`s `render()`). */
        const body =
            fallback.trim() === ''
                ? `if ($props && $props.$children) { ${target}.push(await $props.$children()); }\n`
                : `if ($props && $props.$children) { ${target}.push(await $props.$children()); } else {\n${fallback}}\n`
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
        const [catchBranch, finallyBranch] = resolveBranches(node, 'catch', 'finally')
        const finallyChildren = finallyBranch?.children ?? []
        const resolvedChildren = node.children.filter((child) => child.kind !== 'branch')
        const resolvedAs = node.as ?? '_value'
        const errorAs = catchBranch?.as ?? '_error'
        const id = nextVar('$aid')
        let code = `const ${id} = $ctx.next++;\n`
        code += `${target}.push("<!--abide:await:" + ${id} + "-->");\n`
        code += `try {\n`
        code += `const ${resolvedAs} = await (${lowerExpression(node.promise)});\n`
        code += branchContent(resolvedChildren, target)
        code += branchContent(finallyChildren, target)
        code += `$resume[${id}] = { ok: true, value: ${resolvedAs} };\n`
        if (catchBranch === undefined && finallyChildren.length === 0) {
            /* No catch/finally → let the rejection surface instead of an empty branch. */
            code += `} catch (_error) { throw _error; }\n`
        } else {
            code += `} catch (${errorAs}) {\n`
            code += branchContent(catchBranch?.children ?? [], target)
            code += branchContent(finallyChildren, target)
            code += `$resume[${id}] = { ok: false, error: String(${errorAs}) };\n`
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
        const [thenBranch, catchBranch, finallyBranch] = resolveBranches(
            node,
            'then',
            'catch',
            'finally',
        )
        const finallyChildren = finallyBranch?.children ?? []
        const pending = node.children.filter((child) => child.kind !== 'branch')
        const id = nextVar('$aid')
        let code = `const ${id} = $ctx.next++;\n`
        code += `${target}.push("<!--abide:await:" + ${id} + "-->");\n`
        code += branchContent(pending, target)
        code += `${target}.push("<!--/abide:await:" + ${id} + "-->");\n`
        const settled = (binding: string, children: TemplateNode[]) =>
            `async (${binding}) => { const $o = []; ${branchContent(children, '$o')}${branchContent(finallyChildren, '$o')}return $o.join(''); }`
        const catchProp =
            catchBranch === undefined && finallyChildren.length === 0
                ? ''
                : `catch: ${settled(catchBranch?.as ?? '_error', catchBranch?.children ?? [])} `
        code +=
            `$awaits.push({ id: ${id}, ` +
            `promise: () => (${lowerExpression(node.promise)}), ` +
            `then: ${settled(thenBranch?.as ?? '_value', thenBranch?.children ?? [])}, ` +
            `${catchProp}});\n`
        return code
    }

    /* A sync error boundary: push the guarded markup (++ finally) inside a real
       try/catch; on a throw, truncate the output back to the boundary start and push
       the catch markup (++ finally) instead — so even mid-stream a render throw
       becomes catch markup, not a broken response. No catch re-throws (propagates to
       an enclosing boundary / the 500 / the stream). Boundary comments let hydration
       discard the server content if the client adoption fails. */
    function generateTry(node: Extract<TemplateNode, { kind: 'try' }>, target: string): string {
        const [catchBranch, finallyBranch] = resolveBranches(node, 'catch', 'finally')
        const finallyChildren = finallyBranch?.children ?? []
        const guarded = node.children.filter((child) => child.kind !== 'branch')
        const errName = catchBranch?.as ?? '_error'
        const id = nextVar('$tid')
        const mark = nextVar('$trim')
        let code = `const ${id} = $ctx.next++;\n`
        code += `${target}.push("<!--abide:try:" + ${id} + "-->");\n`
        code += `const ${mark} = ${target}.length;\n`
        code += `try {\n`
        code += branchContent(guarded, target)
        code += branchContent(finallyChildren, target)
        code += `} catch (${errName}) {\n${target}.length = ${mark};\n`
        if (catchBranch !== undefined) {
            code += branchContent(catchBranch.children, target)
            code += branchContent(finallyChildren, target)
        } else {
            code += `throw ${errName};\n`
        }
        code += `}\n`
        code += `${target}.push("<!--/abide:try:" + ${id} + "-->");\n`
        return code
    }

    return generateInto(rootNodes, '$out')
}
