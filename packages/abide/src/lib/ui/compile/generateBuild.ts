import { HOLE_ATTRIBUTE } from '../runtime/HOLE_ATTRIBUTE.ts'
import { OUTLET_TAG } from '../runtime/OUTLET_TAG.ts'
import { bindListenEvent } from './bindListenEvent.ts'
import { componentWrapperTag } from './componentWrapperTag.ts'
import { groupBindParts } from './groupBindParts.ts'
import { lowerContext } from './lowerContext.ts'
import { scopeAttr } from './scopeAttr.ts'
import { staticAttr } from './staticAttr.ts'
import { staticTextPart } from './staticTextPart.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import { VOID_TAGS } from './VOID_TAGS.ts'

/*
Generates the build statements for a parsed template: element creation, static
attributes, reactive `attr`/`text` bindings, `on` listeners, keyed `each`, and
conditional `when`. Every embedded expression is first rewritten from the signal
surface (`count` → `model.count`) and then lowered to the doc patch/read API
(cell-hoisting runs over the whole result afterwards). The output operates on
`hostVar` and expects the dom bindings, `doc`, `effect`, and the component's
`model` in scope — the body the component compiler wraps and hoists cells into.
*/
export function generateBuild(
    nodes: TemplateNode[],
    hostVar: string,
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    isLayout = false,
): string {
    let counter = 0
    const nextVar = (prefix: string): string => `${prefix}${counter++}`

    /* The shared signal→`model` lowering + branch-scoped nested-script deref scope. */
    const {
        expression: lowerExpression,
        statement: lowerStatement,
        withNestedScripts,
    } = lowerContext(stateNames, derivedNames)

    /* Emits the wiring for one non-static attribute against an already-obtained skeleton
       element var — reactive `attr`, `on` listener, `attach`, or a two-way `bind`. */
    function dynamicAttr(
        node: Extract<TemplateNode, { kind: 'element' }>,
        attr: Extract<
            (typeof node.attrs)[number],
            { kind: 'expression' | 'event' | 'attach' | 'bind' }
        >,
        varName: string,
    ): string {
        if (attr.kind === 'expression') {
            return `attr(${varName}, ${JSON.stringify(attr.name)}, () => (${lowerExpression(attr.code)}));\n`
        }
        if (attr.kind === 'event') {
            return `on(${varName}, ${JSON.stringify(attr.event)}, (${lowerExpression(attr.code)}));\n`
        }
        if (attr.kind === 'attach') {
            return `attach(${varName}, (${lowerExpression(attr.code)}));\n`
        }
        if (attr.property === 'group') {
            /* Grouped two-way: radio binds the path to the single checked `value`;
               checkbox treats the path as an array, adding/removing `value` on toggle.
               Membership reads the array via the lowered path and calls native
               `.includes`/`.indexOf` (the doc API has no array search); mutations go
               through `push`/`delete`, which lower to `add`/`remove` patches that the
               doc reindexes. */
            const { valueCode, isRadio } = groupBindParts(node)
            const value = lowerExpression(valueCode)
            if (isRadio) {
                return (
                    `effect(() => { ${varName}.checked = (${lowerExpression(attr.code)}) === (${value}); });\n` +
                    `on(${varName}, "change", () => { if (${varName}.checked) { ${lowerStatement(`${attr.code} = ${valueCode}`)} } });\n`
                )
            }
            return (
                `effect(() => { ${varName}.checked = (${lowerExpression(attr.code)}).includes(${value}); });\n` +
                `on(${varName}, "change", () => { const $groupValue = ${value}; if (${varName}.checked) { if (!(${lowerExpression(attr.code)}).includes($groupValue)) { ${lowerStatement(`${attr.code}.push($groupValue)`)} } } else { const $groupIndex = (${lowerExpression(attr.code)}).indexOf($groupValue); if ($groupIndex !== -1) { ${lowerStatement(`delete ${attr.code}[$groupIndex]`)} } } });\n`
            )
        }
        /* Two-way: drive the property from the path, and write the path back on the
           property's native event (`input` for most fields, but `toggle` for
           `<details open>`, `change` for checked/select). The path is an lvalue, so
           the write lowers to an assignment. */
        const event = bindListenEvent(attr.property, node.tag)
        return (
            `effect(() => { ${varName}.${attr.property} = ${lowerExpression(attr.code)}; });\n` +
            `on(${varName}, ${JSON.stringify(event)}, () => { ${lowerStatement(`${attr.code} = ${varName}.${attr.property}`)} });\n`
        )
    }

    /* Renders a skeletonable node to its marker-stamped skeleton markup, appending each
       hole's wiring to `binds`. Children are walked in document order, so the holes number
       in the order the runtime produces them: element holes (reactive attr / text-leaf
       text) by element-only path (`sk.el`, pre-order); anchor holes (interleaved reactive
       text, control-flow blocks, slots) by document-order scan (`sk.an`). A control-flow
       block or slot drops an `<!--a-->` anchor at its position and mounts there (see
       `anchorCursor`), so it can sit ANYWHERE among static siblings. Static descendants are
       plain markup. */
    function skeletonMarkup(
        node: TemplateNode,
        skVar: string,
        counter: { el: number; an: number },
        binds: string[],
    ): string {
        if (node.kind === 'text') {
            /* Reactive text reached here is INTERLEAVED with element siblings (a text-leaf
               is bound via `generateChildren` instead). It can't be element-positioned, so
               it gets an `<!--a-->` anchor — kept in both SSR and client (like a control-flow
               range marker), located by document-order scan (`sk.an`). */
            return node.parts
                .map((part) => {
                    if (part.kind === 'static') {
                        return staticTextPart(part.value)
                    }
                    binds.push(
                        `appendTextAt(${skVar}.an[${counter.an++}], () => (${lowerExpression(part.code)}));\n`,
                    )
                    return '<!--a-->'
                })
                .join('')
        }
        if (isControlFlowNode(node)) {
            /* A control-flow block at its position: an `<!--a-->` anchor in the clone, the
               block mounted at it. `anchorCursor` parks the hydrate cursor past the anchor
               and returns the create insertion reference; the block's parent is the located
               element the anchor was cloned into (`anchor.parentNode`). */
            const anchorVar = nextVar('an')
            binds.push(`const ${anchorVar} = ${skVar}.an[${counter.an++}];\n`)
            binds.push(generateChild(node, `${anchorVar}.parentNode`, `anchorCursor(${anchorVar})`))
            return '<!--a-->'
        }
        if (node.kind === 'component') {
            /* The wrapper element is a positioned hole in the skeleton; the child mounts
               into the located node (idempotent display:contents for a transparent wrap,
               static so it lives in the markup). */
            const { tag, transparent } = componentWrapperTag(node.name)
            const { code } = mountComponent(node, `${skVar}.el[${counter.el++}]`)
            binds.push(code)
            const style = transparent ? ' style="display:contents"' : ''
            return `<${tag} ${HOLE_ATTRIBUTE}${style}></${tag}>`
        }
        if (node.kind === 'script') {
            /* A nested `<script>` (scoped reactive block) emits no markup — its lowered body
               runs as a bind, in document order, so its signals are declared before the later
               siblings that deref them (the enclosing `withNestedScripts` puts those names in
               scope). */
            binds.push(`${lowerStatement(node.code)}\n`)
            return ''
        }
        if (node.kind === 'snippet') {
            /* A `<template name>` snippet declares a hoisted builder, appending nothing here —
               `{name(args)}` mounts it. Emit the declaration as a bind. */
            binds.push(generateSnippet(node))
            return ''
        }
        if (node.kind !== 'element') {
            return '' // <style> emits no markup
        }
        if (node.tag === 'slot') {
            /* A `<slot>` outlet at its position: an `<!--a-->` anchor, the slot's content
               mounted as a marker-bounded range (`mountSlot`) so it positions like a block. */
            const anchorVar = nextVar('an')
            binds.push(`const ${anchorVar} = ${skVar}.an[${counter.an++}];\n`)
            const hostVar = nextVar('host')
            binds.push(
                `mountSlot(${anchorVar}.parentNode, (${hostVar}) => {\n${generateSlot(node, hostVar)}}, anchorCursor(${anchorVar}));\n`,
            )
            return '<!--a-->'
        }
        const hasReactiveAttr = node.attrs.some((attr) => attr.kind !== 'static')
        const hasReactiveText = node.children.some(
            (child) => child.kind === 'text' && child.parts.some((part) => part.kind !== 'static'),
        )
        /* A text-leaf (only text/style children) with reactive text binds marker-free via
           `generateChildren` on the located element; otherwise reactive text is interleaved
           and uses `<!--a-->` anchors during the child recursion below. */
        const isTextLeaf = node.children.every(
            (child) => child.kind === 'text' || child.kind === 'style',
        )
        const textLeafBind = hasReactiveText && isTextLeaf
        let openTag = `<${node.tag}`
        let elVar = ''
        if (hasReactiveAttr || textLeafBind) {
            /* The element is a located hole (for attr binds or text-leaf text). Take its
               index BEFORE recursing, so holes number in pre-order — the order the runtime's
               path walk produces them. */
            elVar = nextVar('el')
            binds.push(`const ${elVar} = ${skVar}.el[${counter.el++}];\n`)
            openTag += ` ${HOLE_ATTRIBUTE}`
            for (const attr of node.attrs) {
                if (attr.kind !== 'static') {
                    binds.push(dynamicAttr(node, attr, elVar))
                }
            }
        }
        for (const scope of node.scopes ?? []) {
            openTag += scopeAttr(scope)
        }
        for (const attr of node.attrs) {
            if (attr.kind === 'static') {
                openTag += staticAttr(attr.name, attr.value)
            }
        }
        openTag += '>'
        if (VOID_TAGS.has(node.tag)) {
            return openTag
        }
        if (textLeafBind) {
            /* Clone the element empty, build its text on the located node with the
               imperative path — handles static/reactive/snippet/raw-html text. */
            binds.push(generateChildren(node.children, elVar))
            return `${openTag}</${node.tag}>`
        }
        /* A nested `<script>` among the children scopes its bindings to this subtree (its
           later siblings auto-deref them); pop after. */
        const inner = withNestedScripts(node.children, () =>
            node.children.map((child) => skeletonMarkup(child, skVar, counter, binds)).join(''),
        )
        return `${openTag}${inner}</${node.tag}>`
    }

    /* Emits a skeletonable subtree via the skeleton path: a marker-stamped static
       skeleton string (parsed once, cloned per mount) plus each hole's wiring against
       its located node. */
    function generateSkeleton(
        node: Extract<TemplateNode, { kind: 'element' | 'component' }>,
        parentVar: string,
    ): string {
        const skVar = nextVar('sk')
        const binds: string[] = []
        const html = skeletonMarkup(node, skVar, { el: 0, an: 0 }, binds)
        return `const ${skVar} = skeleton(${parentVar}, ${JSON.stringify(html)});\n${binds.join('')}`
    }

    /* Emits code appending `node` to `parentVar`. */
    function generateChild(node: TemplateNode, parentVar: string, before = 'null'): string {
        if (node.kind === 'script') {
            return `${lowerStatement(node.code)}\n`
        }
        /* A `<style>` emits no DOM — its CSS is bundled and its scope attribute is
           already stamped onto the elements it covers (see `staticHtml`/`skeletonMarkup`). */
        if (node.kind === 'style') {
            return ''
        }
        if (node.kind === 'text') {
            /* The non-whitespace parts share one merged SSR text node, so on hydrate
               each must split off its own portion. Every consumer but the last passes
               `splitAlways` so it leaves a node behind even on an exact-length consume
               (e.g. an interpolation that renders empty) — the last keeps the cheaper
               split-only-when-shorter path. */
            const consumers = node.parts.filter(
                (part) => part.kind !== 'static' || part.value.trim() !== '',
            )
            return consumers
                .map((part, index) => {
                    const splitAlways = index < consumers.length - 1 ? ', true' : ''
                    return part.kind === 'static'
                        ? `appendStatic(${parentVar}, ${JSON.stringify(part.value)}${splitAlways});\n`
                        : `appendText(${parentVar}, () => (${lowerExpression(part.code)})${splitAlways});\n`
                })
                .join('')
        }
        if (node.kind === 'element' && node.tag === 'slot') {
            /* In a layout, `<slot/>` is the router's page outlet: a bare empty `OUTLET_TAG`
               element the router mounts the next chain layer into, cloned (create) / claimed
               (hydrate) so it matches the SSR placeholder. (Top-level/nested-in-element layout
               slots are rewritten to `OUTLET_TAG` up front by `asOutlet`; this covers a slot
               reached inside a control-flow branch.) */
            if (isLayout) {
                return `cloneStatic(${parentVar}, ${JSON.stringify(`<${OUTLET_TAG}></${OUTLET_TAG}>`)});\n`
            }
            return generateSlot(node, parentVar)
        }
        if (node.kind === 'element') {
            /* Every bound element builds through the parser-backed skeleton (one clone +
               located holes / anchors, correct foreign namespaces). A fully-static element
               never reaches here — `generateChildren` coalesces it into a `cloneStatic` run —
               so a non-slot element here always carries a hole and is skeletonable. */
            return generateSkeleton(node, parentVar)
        }
        if (node.kind === 'if') {
            return generateIf(node, parentVar, before)
        }
        if (node.kind === 'await') {
            return generateAwait(node, parentVar, before)
        }
        if (node.kind === 'try') {
            return generateTry(node, parentVar, before)
        }
        if (node.kind === 'branch') {
            return '' // branches are consumed by their await block, never standalone
        }
        if (node.kind === 'component') {
            /* A standalone component builds through the skeleton too — its wrapper element
               is a located hole, the child mounts into it (same as a component nested in a
               skeletonable element). */
            return generateSkeleton(node, parentVar)
        }
        if (node.kind === 'switch') {
            return generateSwitch(node, parentVar, before)
        }
        if (node.kind === 'case') {
            return '' // cases are consumed by their switch/if, never standalone
        }
        if (node.kind === 'snippet') {
            return generateSnippet(node)
        }
        return generateEach(node, parentVar, before)
    }

    /* Builds a sibling list, coalescing maximal runs of fully-static element subtrees
       into one `cloneStatic` clone (a single cloneNode in place of the N create/append
       calls the imperative path would emit). Whitespace-only text is transparent — it
       neither breaks a run nor adds markup, matching both back-ends dropping it. Every
       other child flushes the pending run and builds imperatively, preserving order. */
    function generateChildren(children: TemplateNode[], parentVar: string): string {
        let code = ''
        let runHtml = ''
        const flush = (): void => {
            if (runHtml !== '') {
                code += `cloneStatic(${parentVar}, ${JSON.stringify(runHtml)});\n`
                runHtml = ''
            }
        }
        for (const child of children) {
            if (isStaticCloneableElement(child)) {
                runHtml += staticHtml(child)
            } else if (!isWhitespaceText(child)) {
                flush()
                code += generateChild(child, parentVar)
            }
        }
        flush()
        return code
    }

    /* A snippet declaration: a hoisted function returning a `snippet`-branded builder
       that appends its body into the host it is mounted on. The function closes over
       the component scope (its `model`/cells); `args` are plain parameters bound by
       the call. Appends nothing at the declaration site — `{name(args)}` mounts it. */
    function generateSnippet(node: Extract<TemplateNode, { kind: 'snippet' }>): string {
        const body = node.children.map((child) => generateChild(child, '$host')).join('')
        return `function ${node.name}(${node.params ?? ''}) {\nreturn snippet(($host) => {\n${body}});\n}\n`
    }

    /* A switch: each `case` is `{ match: () => value, render }`, the default is
       `{ match: undefined, render }`. */
    function generateSwitch(
        node: Extract<TemplateNode, { kind: 'switch' }>,
        parentVar: string,
        before: string,
    ): string {
        const cases = node.children
            .filter(
                (child): child is Extract<TemplateNode, { kind: 'case' }> => child.kind === 'case',
            )
            .map((branch) => {
                const match =
                    branch.match === undefined
                        ? 'undefined'
                        : `() => (${lowerExpression(branch.match)})`
                return `{ match: ${match}, render: ${branchThunk(branch.children)} }`
            })
            .join(', ')
        return `switchBlock(${parentVar}, () => (${lowerExpression(node.subject)}), [${cases}], ${before});\n`
    }

    /* A `<slot>` outlet: render the parent-provided content (`$children`), falling
       back to the slot's own children when the parent supplied none. */
    function generateSlot(
        node: Extract<TemplateNode, { kind: 'element' }>,
        parentVar: string,
    ): string {
        const fallback = generateChildren(node.children, parentVar)
        const invoke = `$props.$children(${parentVar})`
        if (fallback.trim() === '') {
            return `if ($props && $props.$children) { ${invoke}; }\n`
        }
        return `if ($props && $props.$children) { ${invoke}; } else {\n${fallback}}\n`
    }

    /* Mounts a child component into a wrapper element, passing each prop as a
       reactive thunk so the child re-reads when the parent expression changes. */
    /* The prop + slot thunks a child mount receives — its props as value thunks and
       its slot content as a host-taking builder (`$children`). */
    function componentParts(node: Extract<TemplateNode, { kind: 'component' }>): string[] {
        const parts = node.props.map(
            (prop) => `${JSON.stringify(prop.name)}: () => (${lowerExpression(prop.code)})`,
        )
        const slotCode = generateChildren(node.children, '$slot')
        if (slotCode.trim() !== '') {
            parts.push(`"$children": ($slot) => {\n${slotCode}}`)
        }
        return parts
    }

    /* Mounts a child into a wrapper obtained via `varExpr` (a skeleton-located node).
       Hydration stays active, so the child adopts its server markup inside the wrapper.
       Returns the wrapper var. */
    function mountComponent(
        node: Extract<TemplateNode, { kind: 'component' }>,
        varExpr: string,
    ): { code: string; varName: string } {
        const wrapper = nextVar('cmp')
        const code =
            `const ${wrapper} = ${varExpr};\n` +
            `mountChild(${wrapper}, ${node.name}, { ${componentParts(node).join(', ')} });\n`
        return { code, varName: wrapper }
    }

    /* An await block: pending → resolved(value) / error branches. Each branch is a
       single-element root; a render thunk returns its node. */
    function generateAwait(
        node: Extract<TemplateNode, { kind: 'await' }>,
        parentVar: string,
        before: string,
    ): string {
        const isBranch = (which: 'then' | 'catch' | 'finally') => (child: TemplateNode) =>
            child.kind === 'branch' && child.branch === which
        const catchBranch = node.children.find(isBranch('catch'))
        const finallyChildren = branchChildren(node.children.find(isBranch('finally')))
        /* Blocking: no pending, the children are the resolved branch bound to `node.as`.
           Streaming: pending is the non-branch children, resolved is the `then` child. */
        const pending = node.blocking
            ? []
            : node.children.filter((child) => child.kind !== 'branch')
        const thenBranch = node.children.find(isBranch('then'))
        const thenThunk = node.blocking
            ? branchThunk(
                  node.children.filter((child) => child.kind !== 'branch'),
                  node.as ?? '_value',
                  finallyChildren,
              )
            : branchThunk(
                  branchChildren(thenBranch),
                  branchVar(thenBranch) ?? '_value',
                  finallyChildren,
              )
        /* Neither catch nor finally → pass `undefined` so awaitBlock re-throws the
           rejection (surfacing it) instead of rendering an empty branch. A finally-only
           block keeps a catch thunk that renders just finally. */
        const catchThunk =
            catchBranch === undefined && finallyChildren.length === 0
                ? 'undefined'
                : branchThunk(
                      branchChildren(catchBranch),
                      branchVar(catchBranch) ?? '_error',
                      finallyChildren,
                  )
        const pendingThunk = hasRenderableContent(pending) ? branchThunk(pending) : 'undefined'
        return (
            `awaitBlock(${parentVar}, nextBlockId(), () => (${lowerExpression(node.promise)}), ` +
            `${pendingThunk}, ` +
            `${thenThunk}, ` +
            `${catchThunk}, ${before});\n`
        )
    }

    /* Children of a branch node (then/catch), or [] when the branch is absent. */
    function branchChildren(branch: TemplateNode | undefined): TemplateNode[] {
        return branch !== undefined && branch.kind === 'branch' ? branch.children : []
    }

    /* The value/error variable name a branch binds, if any. */
    function branchVar(branch: TemplateNode | undefined): string | undefined {
        return branch !== undefined && branch.kind === 'branch' ? branch.as : undefined
    }

    /* A branch's content as a void render thunk `(parent[, value]) => void` that
       builds its children — and an optional trailing `finally` branch — into
       `parent`. The full-range model tracks the built content between markers, so a
       branch holds ANY content (components, text, nested control-flow, snippets) and
       is generated exactly like a normal child list. `valueParam` binds a resolved /
       error / item value into scope. Nested `<script>`s are emitted in document order
       by `generateChildren`; `withNestedScripts` puts their bindings in deref scope. */
    function branchThunk(
        children: TemplateNode[],
        valueParam?: string,
        finallyChildren: TemplateNode[] = [],
    ): string {
        const parentParam = nextVar('p')
        const head =
            valueParam === undefined ? `(${parentParam})` : `(${parentParam}, ${valueParam})`
        const body = withNestedScripts(children, () => generateChildren(children, parentParam))
        const finallyBody =
            finallyChildren.length > 0
                ? withNestedScripts(finallyChildren, () =>
                      generateChildren(finallyChildren, parentParam),
                  )
                : ''
        return `${head} => {\n${body}${finallyBody}}`
    }

    /* True when a branch has content worth a render thunk — vs an absent/empty branch
       a block represents with `undefined` (an `await` with no pending markup). */
    function hasRenderableContent(children: TemplateNode[]): boolean {
        return children.some(
            (child) =>
                child.kind === 'element' ||
                child.kind === 'component' ||
                child.kind === 'if' ||
                child.kind === 'each' ||
                child.kind === 'await' ||
                child.kind === 'try' ||
                child.kind === 'switch' ||
                child.kind === 'snippet' ||
                (child.kind === 'text' && !isWhitespaceText(child)),
        )
    }

    /* The branch child of a control block matching `which` (then/catch/finally). */
    function findBranch(
        children: TemplateNode[],
        which: 'then' | 'catch' | 'finally',
    ): Extract<TemplateNode, { kind: 'branch' }> | undefined {
        return children.find(
            (child): child is Extract<TemplateNode, { kind: 'branch' }> =>
                child.kind === 'branch' && child.branch === which,
        )
    }

    /* A sync error boundary: build the guarded subtree (++ finally); a throw while
       building swaps to the catch branch (++ finally). No catch → `undefined`, which
       makes the runtime re-throw to the nearest enclosing boundary. */
    function generateTry(
        node: Extract<TemplateNode, { kind: 'try' }>,
        parentVar: string,
        before: string,
    ): string {
        const catchBranch = findBranch(node.children, 'catch')
        const finallyChildren = branchChildren(findBranch(node.children, 'finally'))
        const guarded = node.children.filter((child) => child.kind !== 'branch')
        const tryThunk = branchThunk(guarded, undefined, finallyChildren)
        const catchThunk =
            catchBranch === undefined
                ? 'undefined'
                : branchThunk(
                      branchChildren(catchBranch),
                      branchVar(catchBranch) ?? '_error',
                      finallyChildren,
                  )
        return `tryBlock(${parentVar}, nextBlockId(), ${tryThunk}, ${catchThunk}, ${before});\n`
    }

    /* A conditional with an optional nested `<template else>` (a `case` child). Each
       branch is a content range the runtime tracks between markers. */
    function generateIf(
        node: Extract<TemplateNode, { kind: 'if' }>,
        parentVar: string,
        before: string,
    ): string {
        const elseBranch = node.children.find(
            (child): child is Extract<TemplateNode, { kind: 'case' }> => child.kind === 'case',
        )
        const thenChildren = node.children.filter((child) => child.kind !== 'case')
        const thenThunk = branchThunk(thenChildren)
        const elseThunk = elseBranch === undefined ? 'undefined' : branchThunk(elseBranch.children)
        return `when(${parentVar}, () => (${lowerExpression(node.condition)}), ${thenThunk}, ${elseThunk}, ${before});\n`
    }

    /* A keyed each. Each row is a content RANGE (any content, tracked between the
       row's markers), built by a `(rowParent, item) => void` thunk. */
    function generateEach(
        node: Extract<TemplateNode, { kind: 'each' }>,
        parentVar: string,
        before: string,
    ): string {
        const rowParam = nextVar('p')
        /* The row body builds its children (a `<script>` declares per-row local signals,
           emitted in document order) into the row parent. A `<template catch>` child is
           consumed by the async-each, not the row — `generateChildren` skips it. */
        const rowBody = withNestedScripts(node.children, () =>
            generateChildren(node.children, rowParam),
        )
        const keyExpression = node.key === undefined ? node.as : lowerExpression(node.key)
        /* `await` → the AsyncIterable runtime, drained row-by-row on the client, with an
           optional `<template catch>` branch rendered (after the streamed rows) when the
           iterator rejects. Absent → `undefined`, so the rejection surfaces instead. */
        const fn = node.async ? 'eachAsync' : 'each'
        const catchBranch = node.children.find(
            (child) => child.kind === 'branch' && child.branch === 'catch',
        )
        const catchArg = node.async
            ? `, ${catchBranch === undefined ? 'undefined' : branchThunk(branchChildren(catchBranch), branchVar(catchBranch) ?? '_error')}`
            : ''
        return (
            `${fn}(${parentVar}, () => (${lowerExpression(node.items)}), ` +
            `(${node.as}) => (${keyExpression}), (${rowParam}, ${node.as}) => {\n${rowBody}}${catchArg}, ${before});\n`
        )
    }

    /* In a layout the `<slot/>` page outlet is a bare empty `OUTLET_TAG` element (the
       router fills it later) — exactly the SSR placeholder. Rewriting it to an element
       node up front lets the static-clone path carry it as ordinary structure. */
    function asOutlet(node: TemplateNode): TemplateNode {
        if (node.kind !== 'element') {
            return node
        }
        if (node.tag === 'slot') {
            return { ...node, tag: OUTLET_TAG, attrs: [], children: [] }
        }
        return { ...node, children: node.children.map(asOutlet) }
    }

    return generateChildren(isLayout ? nodes.map(asOutlet) : nodes, hostVar)
}

/* A control-flow block — `if`/`each`/`await`/`switch`/`try`. In a skeleton each mounts at
   an `<!--a-->` anchor cloned into its located parent at the block's position. */
function isControlFlowNode(node: TemplateNode): boolean {
    return (
        node.kind === 'if' ||
        node.kind === 'each' ||
        node.kind === 'await' ||
        node.kind === 'switch' ||
        node.kind === 'try'
    )
}

/* A text node that is purely whitespace (no interpolation, only blank static
   parts). Both back-ends drop it, so it neither contributes markup nor breaks a
   static clone run — it stays transparent so `<a/>\n<b/>` still coalesces. */
function isWhitespaceText(node: TemplateNode): boolean {
    return (
        node.kind === 'text' &&
        node.parts.every((part) => part.kind === 'static' && part.value.trim() === '')
    )
}

/*
Whether an element subtree is fully static — no reactive/event/bind attributes,
no nested `<script>`, and every descendant likewise static (static text, static
child elements, or scope-only `<style>`). Such a subtree builds to fixed DOM with
no per-instance wiring, so it can be cloned from a template instead of built call
by call. Only ELEMENTS qualify as run members: a static element never merges with
an adjacent dynamic text node, whereas a bare static text sibling shares one
merged SSR text node with its neighbour (the `splitAlways` hazard) — those stay
imperative. Static text and elements nested INSIDE a qualifying element are fine,
enclosed by its tags.
*/
function isStaticCloneableElement(node: TemplateNode): boolean {
    if (node.kind !== 'element' || node.tag === 'slot') {
        return false
    }
    if (node.attrs.some((attr) => attr.kind !== 'static')) {
        return false
    }
    return node.children.every(
        (child) =>
            child.kind === 'style' ||
            (child.kind === 'text' && child.parts.every((part) => part.kind === 'static')) ||
            isStaticCloneableElement(child),
    )
}

/*
Renders a fully-static node to its constant HTML, byte-identical to the SSR
back-end's output for the same node (same scope-attr order, same escaping, same
void-tag handling, same whitespace-only-text dropping) — so the client clone
template and the server markup parse to the same DOM. Only handles the shapes
`isStaticCloneableElement` admits.
*/
function staticHtml(node: TemplateNode): string {
    if (node.kind === 'text') {
        return node.parts
            .map((part) => (part.kind === 'static' ? staticTextPart(part.value) : ''))
            .join('')
    }
    if (node.kind !== 'element') {
        return '' // <style> and any non-element emit no markup
    }
    let html = `<${node.tag}`
    for (const scope of node.scopes ?? []) {
        html += scopeAttr(scope)
    }
    for (const attr of node.attrs) {
        if (attr.kind === 'static') {
            html += staticAttr(attr.name, attr.value)
        }
    }
    html += '>'
    if (VOID_TAGS.has(node.tag)) {
        return html
    }
    return `${html}${node.children.map(staticHtml).join('')}</${node.tag}>`
}
