import { HOLE_ATTRIBUTE } from '../runtime/HOLE_ATTRIBUTE.ts'
import { OUTLET_TAG } from '../runtime/OUTLET_TAG.ts'
import { asOutlet } from './asOutlet.ts'
import { bindListenEvent } from './bindListenEvent.ts'
import { composeProps } from './composeProps.ts'
import { groupBindParts } from './groupBindParts.ts'
import { isControlFlow } from './isControlFlow.ts'
import { isWhitespaceText } from './isWhitespaceText.ts'
import { lowerContext } from './lowerContext.ts'
import { resolveBranches } from './resolveBranches.ts'
import { scopeAttr } from './scopeAttr.ts'
import { skeletonContext } from './skeletonContext.ts'
import { spreadExcludedNames } from './spreadExcludedNames.ts'
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

/* A JS-identifier-safe frame name from an authored construct label (an attribute name
   like `aria-label`, a bound property). Non-identifier chars → `_`; a leading digit gets
   an `_` prefix; empty falls back to `thunk`. Callers prefix the label (`attr_`/`bind_`),
   so the result is never a bare reserved word. */
function thunkName(label: string): string {
    const safe = label.replace(/[^A-Za-z0-9_$]/g, '_').replace(/^(?=\d)/, '_')
    return safe === '' ? 'thunk' : safe
}

/* Names a reactive thunk so a stack frame reads `name@File.abide:line` instead of
   `(anonymous)` — disambiguating which binding a frame is when several share a line. Emits
   a named function expression (the only form whose name a debugger displays); the named
   bodies never reference `this`/`arguments`, so the arrow→function swap is behaviour-safe,
   and minify strips the name, so it costs nothing in production. */
function namedThunk(name: string, body: string): string {
    return `function ${thunkName(name)}() { ${body} }`
}

export function generateBuild(
    nodes: TemplateNode[],
    hostVar: string,
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    computedNames: ReadonlySet<string>,
    isLayout = false,
): string {
    let counter = 0
    const nextVar = (prefix: string): string => `${prefix}${counter++}`

    /* In a layout, `<slot/>` outlets are rewritten to `OUTLET_TAG` elements up front
       (`asOutlet`) so the static-clone path carries them as ordinary structure. `asOutlet`
       CLONES every element it descends through and drops the slot's anchor hole, so the
       shared skeleton context must walk THIS rewritten tree — the one the build traversal
       below reads — or its node-keyed hole indices key the originals and never match. */
    const rootNodes = isLayout ? nodes.map(asOutlet) : nodes

    /* Per-node skeleton position from the SAME pass the SSR back-end reads — so the client's
       anchor/text-leaf decisions consult one source of truth instead of re-deriving the
       position structurally (the drift the shared context exists to prevent). */
    const { markText, elIndex, anIndex } = skeletonContext(rootNodes)

    /* The hole's index, assigned by the shared skeletonContext walk — the sole numberer. A
       missing entry means this back-end reached a hole the shared walk didn't number: a
       structural divergence between the two, surfaced loudly at compile time rather than as a
       runtime hydration desync. */
    function holeIndex(map: WeakMap<object, number>, key: object): number {
        const index = map.get(key)
        if (index === undefined) {
            throw new Error('[abide] skeleton hole not numbered by the shared positional walk')
        }
        return index
    }

    /* The shared signal→`model` lowering + branch-scoped nested-script deref scope. */
    const {
        expression: lowerExpression,
        statement: lowerStatement,
        withNestedScripts,
        bindRead,
        bindWrite,
    } = lowerContext(stateNames, derivedNames, computedNames)

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
            return `attr(${varName}, ${JSON.stringify(attr.name)}, ${namedThunk(`attr_${attr.name}`, `return (${lowerExpression(attr.code)})`)});\n`
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
                    `effect(${namedThunk('bind_group', `${varName}.checked = (${lowerExpression(attr.code)}) === (${value});`)});\n` +
                    `on(${varName}, "change", () => { if (${varName}.checked) { ${lowerStatement(`${attr.code} = ${valueCode}`)} } });\n`
                )
            }
            return (
                `effect(${namedThunk('bind_group', `${varName}.checked = (${lowerExpression(attr.code)}).includes(${value});`)});\n` +
                `on(${varName}, "change", () => { const $groupValue = ${value}; if (${varName}.checked) { if (!(${lowerExpression(attr.code)}).includes($groupValue)) { ${lowerStatement(`${attr.code}.push($groupValue)`)} } } else { const $groupIndex = (${lowerExpression(attr.code)}).indexOf($groupValue); if ($groupIndex !== -1) { ${lowerStatement(`delete ${attr.code}[$groupIndex]`)} } } });\n`
            )
        }
        /* Two-way: drive the property from the bind target, and write it back on the
           property's native event (`input` for most fields, but `toggle` for
           `<details open>`, `change` for checked/select). An lvalue target reads as
           itself and writes by assignment; an accessor object (`{ get, set }`) reads via
           `.get()` and writes via `.set(v)` — see `bindRead`/`bindWrite`. */
        const event = bindListenEvent(attr.property, node.tag)
        return (
            `effect(${namedThunk(`bind_${attr.property}`, `${varName}.${attr.property} = ${bindRead(attr.code)};`)});\n` +
            `on(${varName}, ${JSON.stringify(event)}, () => { ${bindWrite(attr.code, `${varName}.${attr.property}`)} });\n`
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
    /* The skeleton anchor var for an anchor-positioned node: declares `an<n> = sk.an[i]` as
       a bind and returns the var name. The three anchored kinds (control-flow/component,
       outlet, slot) all mount at this `<!--a-->` anchor, so they number through this ONE
       site (`anIndex`) — no per-branch copy of the lookup to drift from the runtime scan. */
    function anchorVarAt(node: TemplateNode, skVar: string, binds: string[]): string {
        const anchorVar = nextVar('an')
        binds.push(`const ${anchorVar} = ${skVar}.an[${holeIndex(anIndex, node)}];\n`)
        return anchorVar
    }

    function skeletonMarkup(node: TemplateNode, skVar: string, binds: string[]): string {
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
                        `appendTextAt(${skVar}.an[${holeIndex(anIndex, part)}], ${namedThunk('text', `return (${lowerExpression(part.code)})`)});\n`,
                    )
                    return '<!--a-->'
                })
                .join('')
        }
        if (isControlFlow(node) || node.kind === 'component') {
            /* A control-flow block OR a child component at its position: an `<!--a-->` anchor
               in the clone, its content mounted as a marker-bounded range at it. `anchorCursor`
               parks the hydrate cursor past the anchor and returns the create insertion
               reference; the parent is the located element the anchor was cloned into
               (`anchor.parentNode`). A component takes an anchor like a block — no wrapper
               element — so its root lays out as a true direct child of `anchor.parentNode`. */
            const anchorVar = anchorVarAt(node, skVar, binds)
            binds.push(generateChild(node, `${anchorVar}.parentNode`, `anchorCursor(${anchorVar})`))
            return '<!--a-->'
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
        if (node.tag === OUTLET_TAG) {
            /* A layout's router fill point at its position: an `<!--a-->` anchor, an empty
               `outlet` boundary the router fills with the next chain layer (`fillBoundary`).
               No wrapper element — the filled child lays out as a direct child of the parent. */
            const anchorVar = anchorVarAt(node, skVar, binds)
            binds.push(`outlet(${anchorVar}.parentNode, anchorCursor(${anchorVar}));\n`)
            return '<!--a-->'
        }
        if (node.tag === 'slot') {
            /* A `<slot>` outlet at its position: an `<!--a-->` anchor, the slot's content
               mounted as a marker-bounded range (`mountSlot`) so it positions like a block. */
            const anchorVar = anchorVarAt(node, skVar, binds)
            const hostVar = nextVar('host')
            binds.push(
                `mountSlot(${anchorVar}.parentNode, (${hostVar}) => {\n${generateSlot(node, hostVar)}}, anchorCursor(${anchorVar}));\n`,
            )
            return '<!--a-->'
        }
        const hasReactiveAttr = node.attrs.some((attr) => attr.kind !== 'static')
        const reactiveTextChild = node.children.find(
            (child) => child.kind === 'text' && child.parts.some((part) => part.kind !== 'static'),
        )
        /* A text-leaf (only text/style children) with reactive text binds marker-free via
           `generateChildren` on the located element; otherwise reactive text is interleaved
           and uses `<!--a-->` anchors during the child recursion below. The shared context
           records the leaf's text as NOT interleaved (`markText` false) — read that flag the
           SSR back-end also reads, rather than re-deriving leaf-ness via `isTextLeaf` here. */
        const textLeafBind =
            reactiveTextChild !== undefined && markText.get(reactiveTextChild) === false
        let openTag = `<${node.tag}`
        let elVar = ''
        if (hasReactiveAttr || textLeafBind) {
            /* The element is a located hole (for attr binds or text-leaf text). Take its
               index BEFORE recursing, so holes number in pre-order — the order the runtime's
               path walk produces them. */
            elVar = nextVar('el')
            binds.push(`const ${elVar} = ${skVar}.el[${holeIndex(elIndex, node)}];\n`)
            openTag += ` ${HOLE_ATTRIBUTE}`
            for (const attr of node.attrs) {
                if (attr.kind === 'spread') {
                    /* `{...expr}` onto the element: each key binds as a reactive attribute
                       (or an `on<event>` function as a listener) via `spreadAttrs`, skipping
                       any key explicitly named on the element (the explicit attr wins). */
                    binds.push(
                        `spreadAttrs(${elVar}, ${namedThunk('spread', `return (${lowerExpression(attr.code)})`)}, ${JSON.stringify(spreadExcludedNames(node.attrs))});\n`,
                    )
                } else if (attr.kind !== 'static') {
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
            node.children.map((child) => skeletonMarkup(child, skVar, binds)).join(''),
        )
        return `${openTag}${inner}</${node.tag}>`
    }

    /* Emits a skeletonable subtree via the skeleton path: a marker-stamped static
       skeleton string (parsed once, cloned per mount) plus each hole's wiring against
       its located node. */
    function generateSkeleton(
        node: Extract<TemplateNode, { kind: 'element' }>,
        parentVar: string,
    ): string {
        const skVar = nextVar('sk')
        const binds: string[] = []
        const html = skeletonMarkup(node, skVar, binds)
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
                        : `appendText(${parentVar}, ${namedThunk('text', `return (${lowerExpression(part.code)})`)}${splitAlways});\n`
                })
                .join('')
        }
        if (node.kind === 'element' && node.tag === OUTLET_TAG) {
            /* A standalone layout outlet (a top-level/element-nested `<slot/>` rewritten by
               `asOutlet`, reached outside any skeleton): an empty `outlet` boundary at
               `before`, no anchor — the router fills it with the next chain layer. */
            return `outlet(${parentVar}, ${before});\n`
        }
        if (node.kind === 'element' && node.tag === 'slot') {
            /* In a layout, `<slot/>` is the router's page outlet (`outlet` boundary the
               router fills with the next chain layer). Top-level/element-nested layout slots
               are rewritten to `OUTLET_TAG` up front by `asOutlet` and handled above; this
               covers a layout slot reached inside a control-flow branch. */
            if (isLayout) {
                return `outlet(${parentVar}, ${before});\n`
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
            /* A standalone component (top-level, or a bare child of a branch/row/slot) mounts
               directly as a marker range on `parentVar` at `before` — no anchor, no wrapper,
               same as a standalone control-flow block routes through `generateIf`/etc. */
            return generateChildComponent(node, parentVar, before)
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

    /* The child's slot content as a host-taking builder (`$children`), or undefined when
       the component has no slotted children. */
    function slotPart(node: Extract<TemplateNode, { kind: 'component' }>): string | undefined {
        const slotCode = generateChildren(node.children, '$slot')
        return slotCode.trim() === '' ? undefined : `"$children": ($slot) => {\n${slotCode}}`
    }

    /* The props bag a child mount receives — composed by the shared `composeProps` so the
       build and SSR back-ends emit the same last-wins layering. */
    function propsArg(node: Extract<TemplateNode, { kind: 'component' }>): string {
        return composeProps(node.props, lowerExpression, slotPart(node))
    }

    /* Mounts a child component as a marker-bounded range on `parentVar`, positioned at
       `before` (a skeleton anchor's `anchorCursor`, or `null` for a standalone child).
       `mountRange` opens the `[`/`]` markers and builds the child between them — no
       wrapper element — so the child's root is a true direct child of `parentVar`.
       Hydration stays ambient, so the child claims its server range in place. The
       component name passes as the scope label (the inspector's `<Counter>` name). */
    function generateChildComponent(
        node: Extract<TemplateNode, { kind: 'component' }>,
        parentVar: string,
        before: string,
    ): string {
        return `mountChild(${parentVar}, ${node.name}, ${propsArg(node)}, ${before}, ${JSON.stringify(node.name)});\n`
    }

    /* An await block: pending → resolved(value) / error branches. Each branch is a
       single-element root; a render thunk returns its node. */
    function generateAwait(
        node: Extract<TemplateNode, { kind: 'await' }>,
        parentVar: string,
        before: string,
    ): string {
        const [thenBranch, catchBranch, finallyBranch] = resolveBranches(
            node,
            'then',
            'catch',
            'finally',
        )
        const finallyChildren = finallyBranch?.children ?? []
        /* Blocking: no pending, the children are the resolved branch bound to `node.as`.
           Streaming: pending is the non-branch children, resolved is the `then` child. */
        const pending = node.blocking
            ? []
            : node.children.filter((child) => child.kind !== 'branch')
        const thenThunk = node.blocking
            ? branchThunk(
                  node.children.filter((child) => child.kind !== 'branch'),
                  node.as ?? '_value',
                  finallyChildren,
              )
            : branchThunk(thenBranch?.children ?? [], thenBranch?.as ?? '_value', finallyChildren)
        /* Neither catch nor finally → pass `undefined` so awaitBlock re-throws the
           rejection (surfacing it) instead of rendering an empty branch. A finally-only
           block keeps a catch thunk that renders just finally. */
        const catchThunk =
            catchBranch === undefined && finallyChildren.length === 0
                ? 'undefined'
                : branchThunk(
                      catchBranch?.children ?? [],
                      catchBranch?.as ?? '_error',
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
                isControlFlow(child) ||
                child.kind === 'snippet' ||
                (child.kind === 'text' && !isWhitespaceText(child)),
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
        const [catchBranch, finallyBranch] = resolveBranches(node, 'catch', 'finally')
        const finallyChildren = finallyBranch?.children ?? []
        const guarded = node.children.filter((child) => child.kind !== 'branch')
        const tryThunk = branchThunk(guarded, undefined, finallyChildren)
        const catchThunk =
            catchBranch === undefined
                ? 'undefined'
                : branchThunk(catchBranch.children, catchBranch.as ?? '_error', finallyChildren)
        return `tryBlock(${parentVar}, nextBlockId(), ${tryThunk}, ${catchThunk}, ${before});\n`
    }

    /* A conditional with an optional nested `<template else>` (a `case` child). Each
       branch is a content range the runtime tracks between markers. */
    function generateIf(
        node: Extract<TemplateNode, { kind: 'if' }>,
        parentVar: string,
        before: string,
    ): string {
        /* The `case` children are the chain's `elseif`/`else` branches in source order;
           the rest are the `then` content. */
        const branches = node.children.filter(
            (child): child is Extract<TemplateNode, { kind: 'case' }> => child.kind === 'case',
        )
        const thenChildren = node.children.filter((child) => child.kind !== 'case')
        const hasElseif = branches.some((branch) => branch.condition !== undefined)
        /* Fast path: a plain `if` (with optional `else`) is the binary `when` runtime. */
        if (!hasElseif) {
            const elseBranch = branches.find((branch) => branch.condition === undefined)
            const thenThunk = branchThunk(thenChildren)
            const elseThunk =
                elseBranch === undefined ? 'undefined' : branchThunk(elseBranch.children)
            return `when(${parentVar}, () => (${lowerExpression(node.condition)}), ${thenThunk}, ${elseThunk}, ${before});\n`
        }
        /* if/elseif/else is a cond-chain — reuse `switchBlock` over a constant `true`
           subject with `Boolean`-coerced match thunks, so the first truthy branch wins
           (`else` is the match-less default). */
        const entries = [
            `{ match: () => Boolean(${lowerExpression(node.condition)}), render: ${branchThunk(thenChildren)} }`,
            ...branches.map((branch) =>
                branch.condition !== undefined
                    ? `{ match: () => Boolean(${lowerExpression(branch.condition)}), render: ${branchThunk(branch.children)} }`
                    : `{ match: undefined, render: ${branchThunk(branch.children)} }`,
            ),
        ]
        return `switchBlock(${parentVar}, () => true, [${entries.join(', ')}], ${before});\n`
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
        const [catchBranch] = resolveBranches(node, 'catch')
        const catchArg = node.async
            ? `, ${catchBranch === undefined ? 'undefined' : branchThunk(catchBranch.children, catchBranch.as ?? '_error')}`
            : ''
        return (
            `${fn}(${parentVar}, () => (${lowerExpression(node.items)}), ` +
            `(${node.as}) => (${keyExpression}), (${rowParam}, ${node.as}) => {\n${rowBody}}${catchArg}, ${before});\n`
        )
    }

    return generateChildren(rootNodes, hostVar)
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
    if (node.kind !== 'element' || node.tag === 'slot' || node.tag === OUTLET_TAG) {
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
