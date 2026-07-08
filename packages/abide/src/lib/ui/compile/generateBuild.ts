import { assertExhaustive } from '../../shared/assertExhaustive.ts'
import { HOLE_ATTRIBUTE } from '../runtime/HOLE_ATTRIBUTE.ts'
import { OUTLET_TAG } from '../runtime/OUTLET_TAG.ts'
import { ANCHOR } from '../runtime/RANGE_MARKER.ts'
import { asOutlet } from './asOutlet.ts'
import { awaitPlan } from './awaitPlan.ts'
import { bindListenEvent } from './bindListenEvent.ts'
import { composeProps } from './composeProps.ts'
import { eachPlan } from './eachPlan.ts'
import { elementPlan } from './elementPlan.ts'
import { groupBindParts } from './groupBindParts.ts'
import { ifPlan } from './ifPlan.ts'
import { interpolatedTemplateLiteral } from './interpolatedTemplateLiteral.ts'
import { isControlFlow } from './isControlFlow.ts'
import { isPlainIdentifier } from './isPlainIdentifier.ts'
import { isWhitespaceText } from './isWhitespaceText.ts'
import { lowerContext } from './lowerContext.ts'
import { makeVarNamer } from './makeVarNamer.ts'
import { reactiveBinding } from './reactiveBinding.ts'
import { scopeAttr } from './scopeAttr.ts'
import { skeletonContext } from './skeletonContext.ts'
import { snippetPlan } from './snippetPlan.ts'
import { spreadExcludedNames } from './spreadExcludedNames.ts'
import { staticAttr } from './staticAttr.ts'
import { staticAttrValue } from './staticAttrValue.ts'
import { staticTextPart } from './staticTextPart.ts'
import { switchPlan } from './switchPlan.ts'
import { tryPlan } from './tryPlan.ts'
import type { Binding } from './types/Binding.ts'
import type { ShadowKind } from './types/ShadowKind.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import { VOID_TAGS } from './VOID_TAGS.ts'
import { withBindings } from './withBindings.ts'

/* The skeleton positioning anchor a control-flow block / component / slot / outlet
   stamps into its skeleton markup, sourced from the same `ANCHOR` wire-alphabet constant
   the client's anchor scan (`skeleton`) matches — so the markup the build clones and the
   markup the scan reads can never drift on a literal. */
const ANCHOR_COMMENT = `<!--${ANCHOR}-->`

/*
Generates the build statements for a parsed template: element creation, static
attributes, reactive `attr`/`text` bindings, `on` listeners, keyed `each`, and
conditional `when`. Every embedded expression is first rewritten from the signal
surface (`count` → `model.count`) and then lowered to the doc patch/read API
(cell-hoisting runs over the whole result afterwards). The output operates on
`hostVar` and expects the `$$`-aliased dom bindings (`$$watch`, `$$each`, …)
and the component's `$$model` (emitted by `desugarSignals`) in scope — the body
the component compiler wraps and hoists cells into.
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
    /* `linked` / async `computed` names, lowered to `$$readCell(name)` in template exprs. */
    cellReadNames: ReadonlySet<string> = new Set(),
): string {
    const nextVar = makeVarNamer()

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
        withShadow,
        bindRead,
        bindWrite,
    } = lowerContext(stateNames, derivedNames, computedNames, cellReadNames)

    /* Maps a plan `Binding`'s classification to the client `ShadowKind`: a `reactive` value
       derefs as a `.value` cell (`derived`), a `plain` value as the bare local (`plain`). The
       injected mapping `withBindings` registers every binding through — the one place a name's
       kind is chosen on this back-end. */
    const buildBindingKind = (binding: Binding): ShadowKind =>
        binding.classification === 'reactive' ? 'derived' : 'plain'

    /* Emits the wiring for one non-static attribute against an already-obtained skeleton
       element var — reactive `attr`, `on` listener, `attach`, or a two-way `bind`. */
    function dynamicAttr(
        node: Extract<TemplateNode, { kind: 'element' }>,
        attr: Extract<
            (typeof node.attrs)[number],
            {
                kind:
                    | 'expression'
                    | 'interpolated'
                    | 'event'
                    | 'attach'
                    | 'bind'
                    | 'class'
                    | 'style'
            }
        >,
        varName: string,
    ): string {
        if (attr.kind === 'expression') {
            return `$$attr(${varName}, ${JSON.stringify(attr.name)}, ${namedThunk(`attr_${attr.name}`, `return (${lowerExpression(attr.code)})`)});\n`
        }
        /* `name="literal {expr}"` — the template-literal concatenation bound as a reactive
           string attribute (always present). A class/style with directives is merged
           upstream of this dispatch, so it never reaches here. */
        if (attr.kind === 'interpolated') {
            return `$$attr(${varName}, ${JSON.stringify(attr.name)}, ${namedThunk(`attr_${attr.name}`, `return (${lowerExpression(interpolatedTemplateLiteral(attr.parts))})`)});\n`
        }
        if (attr.kind === 'event') {
            return `$$on(${varName}, ${JSON.stringify(attr.event)}, (${lowerExpression(attr.code)}));\n`
        }
        if (attr.kind === 'attach') {
            return `$$attach(${varName}, (${lowerExpression(attr.code)}));\n`
        }
        /* `class:<name>` — toggle the class by truthiness; surgical, no element re-render.
           Layers on top of any static `class="…"` in the skeleton (classList is additive). */
        if (attr.kind === 'class') {
            return `$$watch(${namedThunk(`class_${attr.name}`, `${varName}.classList.toggle(${JSON.stringify(attr.name)}, !!(${lowerExpression(attr.code)}));`)});\n`
        }
        /* `style:<property>` — write one inline style / custom property reactively. */
        if (attr.kind === 'style') {
            return `$$watch(${namedThunk(`style_${attr.property}`, `${varName}.style.setProperty(${JSON.stringify(attr.property)}, String(${lowerExpression(attr.code)}));`)});\n`
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
                    `$$watch(${namedThunk('bind_group', `${varName}.checked = (${lowerExpression(attr.code)}) === (${value});`)});\n` +
                    `$$on(${varName}, "change", () => { if (${varName}.checked) { ${lowerStatement(`${attr.code} = ${valueCode}`)} } });\n`
                )
            }
            return (
                `$$watch(${namedThunk('bind_group', `${varName}.checked = (${lowerExpression(attr.code)}).includes(${value});`)});\n` +
                `$$on(${varName}, "change", () => { const $groupValue = ${value}; if (${varName}.checked) { if (!(${lowerExpression(attr.code)}).includes($groupValue)) { ${lowerStatement(`${attr.code}.push($groupValue)`)} } } else { const $groupIndex = (${lowerExpression(attr.code)}).indexOf($groupValue); if ($groupIndex !== -1) { ${lowerStatement(`delete ${attr.code}[$groupIndex]`)} } } });\n`
            )
        }
        /* `<select bind:value>` — options frequently mount after this binding runs (a
           `{#for}` child, an async list) and the browser drops a `value` set naming a
           not-yet-present option, so route to `bindSelectValue`: it re-applies on option
           changes via a MutationObserver and switches single/array semantics on `multiple`
           (`<select multiple>` binds an array of the selected option values). The read/write
           are the same lvalue/accessor forms every bind uses; the helper decides how to
           apply and collect them. */
        if (attr.property === 'value' && node.tag === 'select') {
            const multiple = staticAttrValue(node, 'multiple') !== undefined
            return `$$bindSelectValue(${varName}, () => (${bindRead(attr.code)}), ($selectValue) => { ${bindWrite(attr.code, '$selectValue')} }, ${multiple});\n`
        }
        /* Two-way: drive the property from the bind target, and write it back on the
           property's native event (`input` for most fields, but `toggle` for
           `<details open>`, `change` for checked/select). An lvalue target reads as
           itself and writes by assignment; an accessor object (`{ get, set }`) reads via
           `.get()` and writes via `.set(v)` — see `bindRead`/`bindWrite`. A numeric input
           (`type="number"`/`"range"`) reports its edit as a string on `el.value`, which
           would corrupt number-typed state; source the write-back from `valueAsNumber`
           instead (empty field → `undefined`), gated on a statically-known type. */
        const event = bindListenEvent(attr.property)
        const staticType = staticAttrValue(node, 'type')
        const isNumericInput =
            attr.property === 'value' &&
            node.tag === 'input' &&
            (staticType === 'number' || staticType === 'range')
        const writeSource = isNumericInput
            ? `(${varName}.value === '' ? undefined : ${varName}.valueAsNumber)`
            : `${varName}.${attr.property}`
        return (
            `$$watch(${namedThunk(`bind_${attr.property}`, `${varName}.${attr.property} = ${bindRead(attr.code)};`)});\n` +
            `$$on(${varName}, ${JSON.stringify(event)}, () => { ${bindWrite(attr.code, writeSource)} });\n`
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
                        `$$appendTextAt(${skVar}.an[${holeIndex(anIndex, part)}], ${namedThunk('text', `return (${lowerExpression(part.code)})`)});\n`,
                    )
                    return ANCHOR_COMMENT
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
            binds.push(
                generateChild(node, `${anchorVar}.parentNode`, `$$anchorCursor(${anchorVar})`),
            )
            return ANCHOR_COMMENT
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
            binds.push(`$$outlet(${anchorVar}.parentNode, $$anchorCursor(${anchorVar}));\n`)
            return ANCHOR_COMMENT
        }
        if (node.tag === 'slot') {
            /* A `<slot>` outlet at its position: an `<!--a-->` anchor, the slot's content
               mounted as a marker-bounded range (`mountSlot`) so it positions like a block. */
            const anchorVar = anchorVarAt(node, skVar, binds)
            const hostVar = nextVar('host')
            binds.push(
                `$$mountSlot(${anchorVar}.parentNode, (${hostVar}) => {\n${generateSlot(node, hostVar)}}, $$anchorCursor(${anchorVar}));\n`,
            )
            return ANCHOR_COMMENT
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
        /* The shared per-element emission DECISION (one site both back-ends consult): each
           attribute classified + tagged with its merge status, the class/style/directive merge
           folded in, and void-tag status. The composed `classParts`/`styleParts` and the
           merge triggers come from the same plan SSR renders, so neither the attribute set nor
           the merged value can drift. Build still RENDERS each kind below as live wiring. */
        const plan = elementPlan(node, lowerExpression)
        let openTag = `<${node.tag}`
        let elVar = ''
        if (hasReactiveAttr || textLeafBind) {
            /* The element is a located hole (for attr binds or text-leaf text). Take its
               index BEFORE recursing, so holes number in pre-order — the order the runtime's
               path walk produces them. */
            elVar = nextVar('el')
            binds.push(`const ${elVar} = ${skVar}.el[${holeIndex(elIndex, node)}];\n`)
            openTag += ` ${HOLE_ATTRIBUTE}`
            /* An interpolated (reactive) class/style base can't layer additive directive toggles
               on top — re-setting the base would wipe them — so base + its directives collapse
               into ONE effect computing the whole value (`mergeClassBuild`/`mergeStyleBuild`,
               the build trigger); their attrs are then skipped (`mergedBuild`) in the dispatch
               below. A STATIC base keeps the surgical-toggle model (the base sits in the cloned
               skeleton). */
            if (plan.merge.mergeClassBuild) {
                binds.push(
                    `$$watch(${namedThunk('class_merge', `${elVar}.setAttribute("class", [${plan.merge.classParts.join(', ')}].filter(Boolean).join(' '));`)});\n`,
                )
            }
            if (plan.merge.mergeStyleBuild) {
                binds.push(
                    `$$watch(${namedThunk('style_merge', `${elVar}.setAttribute("style", [${plan.merge.styleParts.join(', ')}].filter(Boolean).join(';'));`)});\n`,
                )
            }
            for (const { attr, mergedBuild } of plan.attrs) {
                /* Skip the attrs already folded into a merged class/style effect. */
                if (mergedBuild) {
                    continue
                }
                if (attr.kind === 'spread') {
                    /* `{...expr}` onto the element: each key binds as a reactive attribute
                       (or an `on<event>` function as a listener) via `spreadAttrs`, skipping
                       any key explicitly named on the element (the explicit attr wins). */
                    binds.push(
                        `$$spreadAttrs(${elVar}, ${namedThunk('spread', `return (${lowerExpression(attr.code)})`)}, ${JSON.stringify(spreadExcludedNames(node.attrs))});\n`,
                    )
                } else if (attr.kind !== 'static') {
                    binds.push(dynamicAttr(node, attr, elVar))
                }
            }
        }
        for (const scope of node.scopes ?? []) {
            openTag += scopeAttr(scope)
        }
        /* Static attrs sit in the cloned skeleton markup — emitted here regardless of whether
           the element is a hole. A static class/style folded into a merged attribute (build
           trigger) is skipped, since the merge effect re-sets the whole value. */
        for (const { attr, mergedBuild } of plan.attrs) {
            if (attr.kind === 'static' && !mergedBuild) {
                openTag += staticAttr(attr.name, attr.value)
            }
        }
        openTag += '>'
        if (plan.isVoid) {
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
        return `const ${skVar} = $$skeleton(${parentVar}, ${JSON.stringify(html)});\n${binds.join('')}`
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
                        ? `$$appendStatic(${parentVar}, ${JSON.stringify(part.value)}${splitAlways});\n`
                        : `$$appendText(${parentVar}, ${namedThunk('text', `return (${lowerExpression(part.code)})`)}${splitAlways});\n`
                })
                .join('')
        }
        if (node.kind === 'element' && node.tag === OUTLET_TAG) {
            /* A standalone layout outlet (a top-level/element-nested `<slot/>` rewritten by
               `asOutlet`, reached outside any skeleton): an empty `outlet` boundary at
               `before`, no anchor — the router fills it with the next chain layer. */
            return `$$outlet(${parentVar}, ${before});\n`
        }
        if (node.kind === 'element' && node.tag === 'slot') {
            /* In a layout, `<slot/>` is the router's page outlet (`outlet` boundary the
               router fills with the next chain layer). Top-level/element-nested layout slots
               are rewritten to `OUTLET_TAG` up front by `asOutlet` and handled above; this
               covers a layout slot reached inside a control-flow branch. */
            if (isLayout) {
                return `$$outlet(${parentVar}, ${before});\n`
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
        if (node.kind === 'each') {
            return generateEach(node, parentVar, before)
        }
        /* Every TemplateNode kind is handled above; `node` is `never` here. A new kind
           reaching this point is a compiler gap — fail loud instead of silently routing
           it to the wrong branch. */
        return assertExhaustive(node, 'template node kind')
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
                code += `$$cloneStatic(${parentVar}, ${JSON.stringify(runHtml)});\n`
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
        const plan = snippetPlan(node)
        /* `args` are plain call parameters, not component cells — `withBindings` registers the
           plan's `plain` bindings so the body reads the bare local, shadowing a same-named
           component signal rather than reading it. */
        const body = withBindings(withShadow, plan.bindings, buildBindingKind, () =>
            plan.children.map((child) => generateChild(child, '$host')).join(''),
        )
        return `function ${plan.name}(${plan.params ?? ''}) {\nreturn $$snippet(($host) => {\n${body}});\n}\n`
    }

    /* A switch: each `case` is `{ match: () => value, render }`, the default is
       `{ match: undefined, render }`. */
    function generateSwitch(
        node: Extract<TemplateNode, { kind: 'switch' }>,
        parentVar: string,
        before: string,
    ): string {
        const cases = switchPlan(node)
            .cases.map((branch) => {
                const match =
                    branch.match === undefined
                        ? 'undefined'
                        : `() => (${lowerExpression(branch.match)})`
                return `{ match: ${match}, render: ${branchThunk(branch.children)} }`
            })
            .join(', ')
        return `$$switchBlock(${parentVar}, () => (${lowerExpression(node.subject)}), [${cases}], ${before});\n`
    }

    /* A component `{children()}` fill point: mount the `children` prop (a `Snippet`) by
       calling it and mounting the resulting value through the snippet interpolation path,
       exactly as any `{snippet(args)}`. `lowerExpression('children()')` reads the destructured
       `children` computed and calls it → a `SnippetValue`, which `appendText` routes to
       `appendSnippet`. A fallback is now an authored `{#if children}…{:else}…{/if}`, so the slot
       node carries no children. Layouts never reach here — their slots are rewritten to `outlet`
       elements by `asOutlet`. */
    function generateSlot(
        _node: Extract<TemplateNode, { kind: 'element' }>,
        parentVar: string,
    ): string {
        return `$$appendText(${parentVar}, () => (${lowerExpression('children()')}));\n`
    }

    /* Slot content as a zero-arg `Snippet` under the `children` key — a callable returning a
       `$$snippet`-branded builder, so it unifies with a passed `children={snippet}` and mounts
       through the standard snippet interpolation path. `composeProps` wraps it in the prop-bag
       thunk, so the final bag value is `() => (Snippet callable)`. */
    function slotPart(node: Extract<TemplateNode, { kind: 'component' }>): string | undefined {
        const slotCode = generateChildren(node.children, '$slot')
        return slotCode.trim() === ''
            ? undefined
            : `"children": () => (() => $$snippet(($slot) => {\n${slotCode}}))`
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
        /* The tag lowers through `lowerExpression` like any other reference: a static
           module import (`Button`) is left bare, but a reactive binding — a `{#for}`
           item, an `await` `then` value, a component signal — derefs to its `.value`
           cell, so `<Icon>` from `{#for {icon: Icon} of …}` mounts the component the cell
           holds, not the cell object (whose `.build` is undefined → `build is not a
           function`). SSR emits the same lowering for congruence. */
        return `$$mountChild(${parentVar}, ${lowerExpression(node.name)}, ${propsArg(node)}, ${before}, ${JSON.stringify(node.name)});\n`
    }

    /* An await block: pending → resolved(value) / error branches. Each branch is a
       void render thunk `(parent[, value]) => void` that builds its content into `parent`. */
    function generateAwait(
        node: Extract<TemplateNode, { kind: 'await' }>,
        parentVar: string,
        before: string,
    ): string {
        const plan = awaitPlan(node)
        /* The resolved value is reactive: a re-settle updates it in place rather than
           rebuilding the branch (see awaitBlock). The branch reads it as a `.value` cell.
           Build settles blocking and streaming uniformly through `awaitBlock`, so the plan's
           resolved content/binding feeds one thunk regardless of mode. */
        const thenThunk = branchThunk(
            plan.resolvedChildren,
            plan.resolvedBindings,
            plan.finallyChildren,
        )
        /* Neither catch nor finally → pass `undefined` so awaitBlock re-throws the
           rejection (surfacing it) instead of rendering an empty branch. A finally-only
           block keeps a catch thunk that renders just finally. */
        const catchThunk = plan.surfaceRejection
            ? 'undefined'
            : branchThunk(plan.catchChildren, plan.catchBindings, plan.finallyChildren)
        const pendingThunk = hasRenderableContent(plan.pending)
            ? branchThunk(plan.pending)
            : 'undefined'
        return (
            `$$awaitBlock(${parentVar}, $$nextBlockId(), () => (${lowerExpression(node.promise)}), ` +
            `${pendingThunk}, ` +
            `${thenThunk}, ` +
            `${catchThunk}, ${before});\n`
        )
    }

    /* A branch's content as a void render thunk `(parent[, value]) => void` that
       builds its children — and an optional trailing `finally` branch — into
       `parent`. The full-range model tracks the built content between markers, so a
       branch holds ANY content (components, text, nested control-flow, snippets) and
       is generated exactly like a normal child list. `bindings` are the value param(s)
       the plan declared (an `await` `then` value → `reactive`; a `catch` error → `plain`)
       — at most one. Names flow to the deref scope ONLY through `withBindings` over the
       plan's bindings; the cell wiring of a `reactive` binding is arranged by
       `reactiveBinding`. Nested `<script>`s are emitted in document order by
       `generateChildren`; `withNestedScripts` puts their bindings in deref scope. */
    function branchThunk(
        children: TemplateNode[],
        bindings: Binding[] = [],
        finallyChildren: TemplateNode[] = [],
    ): string {
        const parentParam = nextVar('p')
        /* A `reactive` binding arrives as a `.value` cell the runtime can set in place (the
           branch re-runs in place on a re-settle); `reactiveBinding` renders its cell param +
           per-leaf reader prefix. A `plain` binding is the author param verbatim — a real arrow
           parameter `withBindings` registers under `plain`, read as the bare local. */
        const reactive = bindings.find((binding) => binding.classification === 'reactive')
        const wiring =
            reactive === undefined ? undefined : reactiveBinding(reactive, nextVar, lowerStatement)
        const plainBinding = bindings.find((binding) => binding.classification === 'plain')
        const param = wiring?.param ?? plainBinding?.name
        const prefix = wiring?.prefix ?? ''
        const head = param === undefined ? `(${parentParam})` : `(${parentParam}, ${param})`
        const body = withNestedScripts(children, () =>
            withBindings(withShadow, bindings, buildBindingKind, () =>
                generateChildren(children, parentParam),
            ),
        )
        const finallyBody =
            finallyChildren.length > 0
                ? withNestedScripts(finallyChildren, () =>
                      generateChildren(finallyChildren, parentParam),
                  )
                : ''
        return `${head} => {\n${prefix}${body}${finallyBody}}`
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
        const plan = tryPlan(node)
        const tryThunk = branchThunk(plan.guarded, [], plan.finallyChildren)
        const catchThunk = plan.hasCatch
            ? branchThunk(plan.catchChildren, plan.catchBindings, plan.finallyChildren)
            : 'undefined'
        return `$$tryBlock(${parentVar}, $$nextBlockId(), ${tryThunk}, ${catchThunk}, ${before});\n`
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
        const plan = ifPlan(node)
        /* Fast path: a plain `if` (with optional `else`) is the binary `when` runtime. */
        if (!plan.hasElseif) {
            const thenThunk = branchThunk(plan.thenChildren)
            const elseThunk =
                plan.elseBranch === undefined ? 'undefined' : branchThunk(plan.elseBranch.children)
            return `$$when(${parentVar}, () => (${lowerExpression(node.condition)}), ${thenThunk}, ${elseThunk}, ${before});\n`
        }
        /* if/elseif/else is a cond-chain — reuse `switchBlock` over a constant `true`
           subject with `Boolean`-coerced match thunks, so the first truthy branch wins
           (`else` is the match-less default). */
        const entries = [
            `{ match: () => Boolean(${lowerExpression(node.condition)}), render: ${branchThunk(plan.thenChildren)} }`,
            ...plan.branches.map((branch) =>
                branch.condition !== undefined
                    ? `{ match: () => Boolean(${lowerExpression(branch.condition)}), render: ${branchThunk(branch.children)} }`
                    : `{ match: undefined, render: ${branchThunk(branch.children)} }`,
            ),
        ]
        return `$$switchBlock(${parentVar}, () => true, [${entries.join(', ')}], ${before});\n`
    }

    /* A keyed each. Each row is a content RANGE (any content, tracked between the
       row's markers), built by a `(rowParent, item) => void` thunk. */
    function generateEach(
        node: Extract<TemplateNode, { kind: 'each' }>,
        parentVar: string,
        before: string,
    ): string {
        const plan = eachPlan(node)
        const rowParam = nextVar('p')
        /* The item is a reactive `.value` cell so a re-key with a changed value updates the row
           in place (no rebuild). `keyOf` receives the RAW item; the key expression is lowered
           with the author name plain — derive it BEFORE the row body puts that name in the
           deref scope. With no explicit `key`, default the key to the item's own identity: a
           plain `as` returns its name; a destructuring `as` binds a fresh param and returns
           THAT, not the pattern re-wrapped (`[i,crumb]` → `[i,crumb]` would allocate a fresh
           array per reconcile, so keys never match and every row rebuilds). An explicit `key`
           destructures the item via `plan.as` to read its leaves. */
        const rawItemParam = isPlainIdentifier(plan.as) ? plan.as : nextVar('k')
        const keyParam = plan.key === undefined ? rawItemParam : plan.as
        /* The key callback binds the RAW item via `plan.as`, so lower the key expression with
           the item's names shadowed as PLAIN locals — otherwise a `by item.id` whose `item`
           collides with a component signal rewrites to `$$model.read("item/id")` (every row
           keys off the same signal → keyed reconciliation degenerates). The plain kind (not
           the row body's reactive `.value` kind) keeps it the bare param the callback binds. */
        const keyExpression =
            plan.key === undefined
                ? rawItemParam
                : withBindings(
                      withShadow,
                      [plan.bindings[0] as Binding],
                      () => 'plain',
                      () => lowerExpression(plan.key as string),
                  )
        /* The item is the row's `reactive` binding (its `.value` cell + per-leaf reader prefix
           rendered by `reactiveBinding`); `index="i"` is a second reactive cell param, a plain
           identifier read as `i.value` (no prefix). The names of BOTH enter the deref scope via
           `withBindings` over `plan.bindings`, not a hand-built list. */
        const itemWiring = reactiveBinding(plan.bindings[0] as Binding, nextVar, lowerStatement)
        const indexParam = plan.index === undefined ? '' : `, ${plan.index}`
        /* The row body builds its children (a `<script>` declares per-row local signals,
           emitted in document order) into the row parent. A `<template catch>` child is
           consumed by the async-each, not the row — `generateChildren` skips it. */
        const rowBody = withNestedScripts(plan.children, () =>
            withBindings(withShadow, plan.bindings, buildBindingKind, () =>
                generateChildren(plan.children, rowParam),
            ),
        )
        /* `await` → the AsyncIterable runtime, drained row-by-row on the client, with an
           optional `<template catch>` branch rendered (after the streamed rows) when the
           iterator rejects. Absent → `undefined`, so the rejection surfaces instead. */
        const fn = plan.async ? '$$eachAsync' : '$$each'
        const catchArg = plan.async
            ? `, ${plan.hasCatch ? branchThunk(plan.catchChildren, plan.catchBindings) : 'undefined'}`
            : ''
        return (
            `${fn}(${parentVar}, () => (${lowerExpression(plan.items)}), ` +
            `(${keyParam}) => (${keyExpression}), (${rowParam}, ${itemWiring.param}${indexParam}) => {\n${itemWiring.prefix}${rowBody}}${catchArg}, ${before});\n`
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
