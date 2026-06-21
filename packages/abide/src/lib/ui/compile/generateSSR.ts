import { OUTLET_CLOSE, OUTLET_OPEN } from '../runtime/OUTLET_MARKER.ts'
import { OUTLET_TAG } from '../runtime/OUTLET_TAG.ts'
import { asOutlet } from './asOutlet.ts'
import { groupBindParts } from './groupBindParts.ts'
import { isAnchorPositioned } from './isAnchorPositioned.ts'
import { lowerContext } from './lowerContext.ts'
import { scopeAttr } from './scopeAttr.ts'
import { skeletonContext } from './skeletonContext.ts'
import { staticAttr } from './staticAttr.ts'
import { staticTextPart } from './staticTextPart.ts'
import { stripEffects } from './stripEffects.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import { VOID_TAGS } from './VOID_TAGS.ts'

/* The range boundary comments a control-flow block emits around its content. They
   serialize exactly as the client's `document.createComment('[' | ']')` markers, so
   the client claims the same `[ … ]` boundary it builds — the comment-marked range
   that lets a branch hold any content. */
const RANGE_OPEN = '<!--[-->'
const RANGE_CLOSE = '<!--]-->'

/* The `then`/`catch`/`finally` branch child of an await/try block, or undefined. */
function branchNamed(
    children: TemplateNode[],
    which: 'then' | 'catch' | 'finally',
): Extract<TemplateNode, { kind: 'branch' }> | undefined {
    return children.find(
        (child): child is Extract<TemplateNode, { kind: 'branch' }> =>
            child.kind === 'branch' && child.branch === which,
    )
}

/*
Server code generator: turns the parsed template into statements that push HTML
fragments onto an output array, reading the document synchronously (no DOM, no
listeners). Same expression lowering as the client back-end, so server and client
render the same markup. Dynamic values go through `$esc`; `if` is a plain `if`,
`each` a `for…of`.

An `await` block emits boundary comments (`<!--abide:await:N-->…<!--/abide:await:N-->`)
and registers the promise plus its resolved/error string-renderers on `$awaits`. A
streaming block (no `then` on the tag) puts its pending branch between the markers;
`renderToStream` flushes each resolved fragment out of order — the await-block-streams
half of the cache rule. A blocking block (`then` on the tag) emits an empty boundary
and flags the entry, so `renderToStream` settles it before the first flush.
*/
export function generateSSR(
    nodes: TemplateNode[],
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    computedNames: ReadonlySet<string>,
    isLayout = false,
): string {
    /* Compile-time counter for unique temp var names (runtime block ids, child render
       results) — block ids themselves are allocated at runtime via nextBlockId(). */
    let varCounter = 0
    const nextVar = (prefix: string): string => `${prefix}${varCounter++}`

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
        inSkeleton.get(node) ? push(target, '<!--a-->') : ''

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
                    const value = `$text(${lowerExpression(part.code)})`
                    return markText.get(node)
                        ? `${target}.push('<!--a-->' + ${value});\n`
                        : `${target}.push(${value});\n`
                })
                .join('')
        }
        if (node.kind === 'if') {
            const elseBranch = node.children.find((child) => child.kind === 'case')
            const thenChildren = node.children.filter((child) => child.kind !== 'case')
            let code = `if (${lowerExpression(node.condition)}) {\n${branchContent(thenChildren, target)}}`
            if (elseBranch !== undefined && elseBranch.kind === 'case') {
                code += ` else {\n${branchContent(elseBranch.children, target)}}`
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
            return `function ${node.name}(${node.params ?? ''}) {\nconst $o = [];\n${body}return $snip($o.join(''));\n}\n`
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
            return `${anchor}for (const ${node.as} of (${lowerExpression(node.items)})) {\n${openRange(target)}${branchContent(node.children, target)}${closeRange(target)}}\n`
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
            const parts = node.props.map(
                (prop) => `${JSON.stringify(prop.name)}: () => (${lowerExpression(prop.code)})`,
            )
            /* Slot content is a fresh build context — the child's `<slot>` mounts it via
               `mountSlot`, not the parent skeleton clone, and the client builds it through
               `componentParts`/`generateChildren` (never the skeleton path). `skeletonContext`
               records it reset, so its children emit no enclosing-skeleton anchors the client
               slot builder would lack. */
            const slotCode = generateInto(node.children, '$slot')
            if (slotCode.trim() !== '') {
                parts.push(
                    `"$children": () => { const $slot = []; ${slotCode}return $slot.join(''); }`,
                )
            }
            /* Render the child and MERGE its await blocks into this page's `$awaits`
               so they join the page's SSR stream — their markers carry render-pass
               block ids (nextBlockId), unique across page + children, so the streamed
               fragments resolve into the right boundaries. ($awaits is captured from
               the enclosing render body, including from branch closures.) */
            const result = nextVar('$child')
            return (
                anchor +
                push(target, RANGE_OPEN) +
                `const ${result} = ${node.name}.render({ ${parts.join(', ')} });\n` +
                `${target}.push(${result}.html);\n` +
                `for (const $a of ${result}.awaits) { $awaits.push($a); }\n` +
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
        let code = push(target, `<${node.tag}`)
        /* Every `<style>` active at this element (own siblings + ancestors) — same set
           the client stamps, so server and client markup carry identical attributes. */
        for (const scope of node.scopes ?? []) {
            code += push(target, scopeAttr(scope))
        }
        for (const attr of node.attrs) {
            if (attr.kind === 'static') {
                code += push(target, staticAttr(attr.name, attr.value))
            } else if (attr.kind === 'expression') {
                /* present/absent semantics matching the client `attr` binding:
                   false/null/undefined drops it, true emits the bare attribute. */
                code += `${target}.push($attr(${JSON.stringify(attr.name)}, ${lowerExpression(attr.code)}));\n`
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
        const body =
            fallback.trim() === ''
                ? `if ($props && $props.$children) { ${target}.push($props.$children()); }\n`
                : `if ($props && $props.$children) { ${target}.push($props.$children()); } else {\n${fallback}}\n`
        if (!wrap) {
            return body
        }
        return `${anchor}${openRange(target)}${body}${closeRange(target)}`
    }

    /* Boundary markers + a `$awaits` registration carrying the promise and
       string-renderers for the resolved/error branches. Streaming emits the pending
       branch between the markers (flushed now, value streamed later); blocking emits
       an empty boundary — its resolved branch is the children bound to `node.as` — and
       flags the entry so `renderToStream` settles it before the first flush. */
    function generateAwait(node: Extract<TemplateNode, { kind: 'await' }>, target: string): string {
        const catchBranch = branchNamed(node.children, 'catch')
        const finallyChildren = branchNamed(node.children, 'finally')?.children ?? []
        /* Resolved branch + its bound value: the children directly when blocking, the
           `then` child when streaming. Pending (streaming only) is the non-branch
           children. */
        const thenBranch = branchNamed(node.children, 'then')
        const resolvedChildren = node.blocking
            ? node.children.filter((child) => child.kind !== 'branch')
            : (thenBranch?.children ?? [])
        const resolvedAs = node.blocking ? node.as : thenBranch?.as
        const pending = node.blocking
            ? []
            : node.children.filter((child) => child.kind !== 'branch')
        /* Runtime block id (shared with the client + child components in this pass). */
        const id = nextVar('$aid')
        let code = `const ${id} = nextBlockId();\n`
        code += `${target}.push("<!--abide:await:" + ${id} + "-->");\n`
        code += branchContent(pending, target)
        code += `${target}.push("<!--/abide:await:" + ${id} + "-->");\n`
        /* The settled closures append `finally` after the outcome markup, matching the
           client's concatenated node range so hydration aligns. */
        const settled = (binding: string, children: TemplateNode[]) =>
            `(${binding}) => { const $o = []; ${branchContent(children, '$o')}${branchContent(finallyChildren, '$o')}return $o.join(''); }`
        /* Neither catch nor finally → omit `catch` so a rejection surfaces to the
           stream/error path (renderToStream re-throws) instead of rendering an empty
           branch. A finally-only block keeps a catch closure that renders just finally. */
        const catchProp =
            catchBranch === undefined && finallyChildren.length === 0
                ? ''
                : `catch: ${settled(catchBranch?.as ?? '_error', catchBranch?.children ?? [])} `
        code +=
            `$awaits.push({ id: ${id}, ` +
            (node.blocking ? 'blocking: true, ' : '') +
            `promise: () => (${lowerExpression(node.promise)}), ` +
            `then: ${settled(resolvedAs ?? '_value', resolvedChildren)}, ` +
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
        const catchBranch = branchNamed(node.children, 'catch')
        const finallyChildren = branchNamed(node.children, 'finally')?.children ?? []
        const guarded = node.children.filter((child) => child.kind !== 'branch')
        const errName = catchBranch?.as ?? '_error'
        const id = nextVar('$tid')
        const mark = nextVar('$trim')
        let code = `const ${id} = nextBlockId();\n`
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
