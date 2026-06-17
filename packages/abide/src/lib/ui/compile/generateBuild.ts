import { OUTLET_TAG } from '../runtime/OUTLET_TAG.ts'
import { branchElements } from './branchElements.ts'
import { escapeHtml } from './escapeHtml.ts'
import { groupBindParts } from './groupBindParts.ts'
import { lowerDocAccess } from './lowerDocAccess.ts'
import { partitionSlots } from './partitionSlots.ts'
import { nestedBindingNames } from './prepareNestedScript.ts'
import { renameSignalRefs } from './renameSignalRefs.ts'
import { staticAttrValue } from './staticAttrValue.ts'
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

    /* Branch-scoped signal bindings (from nested `<script>`s) — they deref to
       `.value` like a `derived`. Pushed while a branch's script + markup compile,
       popped after, so they shadow only within that subtree. */
    const localDerived = new Set<string>()
    const derefScope = (): ReadonlySet<string> =>
        localDerived.size === 0 ? derivedNames : new Set([...derivedNames, ...localDerived])

    /* Rewrites signal refs, then lowers a single expression (no trailing `;`). */
    function lowerExpression(code: string): string {
        const renamed = renameSignalRefs(code, stateNames, derefScope())
        return lowerDocAccess(renamed, 'model').trim().replace(/;$/, '')
    }

    /* As above but keeps the trailing `;` for a handler body. */
    function lowerStatement(code: string): string {
        const renamed = renameSignalRefs(code, stateNames, derefScope())
        return lowerDocAccess(renamed, 'model').trim()
    }

    /* Builds an element and its children; returns the build code and its var.
       `varExpr` is how the element is obtained — `openChild(parent, tag)` for a
       child (create-or-claim), or `document.createElement(tag)` for a returned
       root (rows/branches, which are create-only). */
    function generateElement(
        node: Extract<TemplateNode, { kind: 'element' }>,
        varExpr: string,
    ): { code: string; varName: string } {
        const varName = nextVar('el')
        let code = `const ${varName} = ${varExpr};\n`
        /* Stamp the scope attribute of every `<style>` active at this element (its own
           sibling list plus every ancestor's), so the bundled CSS matches it. */
        for (const scope of node.scopes ?? []) {
            code += `${varName}.setAttribute(${JSON.stringify(scope)}, "");\n`
        }
        for (const attr of node.attrs) {
            if (attr.kind === 'static') {
                code += `${varName}.setAttribute(${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});\n`
            } else if (attr.kind === 'expression') {
                code += `attr(${varName}, ${JSON.stringify(attr.name)}, () => (${lowerExpression(attr.code)}));\n`
            } else if (attr.kind === 'event') {
                code += `on(${varName}, ${JSON.stringify(attr.event)}, (${lowerExpression(attr.code)}));\n`
            } else if (attr.kind === 'attach') {
                code += `attach(${varName}, (${lowerExpression(attr.code)}));\n`
            } else if (attr.kind === 'bind' && attr.property === 'group') {
                /* Grouped two-way: radio binds the path to the single checked
                   `value`; checkbox treats the path as an array, adding/removing
                   `value` on toggle. Membership reads the array via the lowered
                   path and calls native `.includes`/`.indexOf` (the doc API has no
                   array search); mutations go through `push`/`delete`, which lower
                   to `add`/`remove` patches that the doc reindexes. */
                const { valueCode, isRadio } = groupBindParts(node)
                const value = lowerExpression(valueCode)
                if (isRadio) {
                    code += `effect(() => { ${varName}.checked = (${lowerExpression(attr.code)}) === (${value}); });\n`
                    code += `on(${varName}, "change", () => { if (${varName}.checked) { ${lowerStatement(`${attr.code} = ${valueCode}`)} } });\n`
                } else {
                    code += `effect(() => { ${varName}.checked = (${lowerExpression(attr.code)}).includes(${value}); });\n`
                    code += `on(${varName}, "change", () => { const $groupValue = ${value}; if (${varName}.checked) { if (!(${lowerExpression(attr.code)}).includes($groupValue)) { ${lowerStatement(`${attr.code}.push($groupValue)`)} } } else { const $groupIndex = (${lowerExpression(attr.code)}).indexOf($groupValue); if ($groupIndex !== -1) { ${lowerStatement(`delete ${attr.code}[$groupIndex]`)} } } });\n`
                }
            } else {
                /* Two-way: drive the property from the path, and write the path
                   back on input. The path is an lvalue, so the write is lowered
                   as an assignment statement. */
                code += `effect(() => { ${varName}.${attr.property} = ${lowerExpression(attr.code)}; });\n`
                code += `on(${varName}, "input", () => { ${lowerStatement(`${attr.code} = ${varName}.${attr.property}`)} });\n`
            }
        }
        /* A `<script>` among the children scopes its bindings to this element's
           subtree (its later siblings auto-deref them); pop after. */
        const added = scopeNestedScripts(node.children)
        code += generateChildren(node.children, varName)
        for (const name of added) {
            localDerived.delete(name)
        }
        return { code, varName }
    }

    /* Adds the binding names of any `<script>` children to the deref scope, returning
       the names it added (for the caller to pop). */
    function scopeNestedScripts(children: TemplateNode[]): string[] {
        const added: string[] = []
        for (const child of children) {
            if (child.kind === 'script') {
                for (const name of nestedBindingNames(child.code)) {
                    if (!localDerived.has(name)) {
                        localDerived.add(name)
                        added.push(name)
                    }
                }
            }
        }
        return added
    }

    /* Emits code appending `node` to `parentVar`. */
    function generateChild(node: TemplateNode, parentVar: string): string {
        if (node.kind === 'script') {
            return `${lowerStatement(node.code)}\n`
        }
        /* A `<style>` emits no DOM — its CSS is bundled and its scope attribute is
           already stamped onto the elements it covers (see `generateElement`). */
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
            /* In a layout, the unnamed `<slot/>` is the router's page outlet: a bare
               structural element the router mounts the next chain layer into. Created
               empty (no scope attr, no children) so it matches the SSR placeholder. */
            if (isLayout && staticAttrValue(node, 'name') === undefined) {
                return `openChild(${parentVar}, ${JSON.stringify(OUTLET_TAG)});\n`
            }
            return generateSlot(node, parentVar)
        }
        if (node.kind === 'element') {
            /* openChild appends (create) or claims (hydrate) — no separate append. */
            return generateElement(node, `openChild(${parentVar}, ${JSON.stringify(node.tag)})`)
                .code
        }
        if (node.kind === 'if') {
            return generateIf(node, parentVar)
        }
        if (node.kind === 'await') {
            return generateAwait(node, parentVar)
        }
        if (node.kind === 'try') {
            return generateTry(node, parentVar)
        }
        if (node.kind === 'branch') {
            return '' // branches are consumed by their await block, never standalone
        }
        if (node.kind === 'component') {
            return generateComponent(node, parentVar)
        }
        if (node.kind === 'switch') {
            return generateSwitch(node, parentVar)
        }
        if (node.kind === 'case') {
            return '' // cases are consumed by their switch/if, never standalone
        }
        if (node.kind === 'snippet') {
            return generateSnippet(node)
        }
        return generateEach(node, parentVar)
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
    ): string {
        const cases = node.children
            .filter(
                (child): child is Extract<TemplateNode, { kind: 'case' }> => child.kind === 'case',
            )
            .map((branch) => {
                const param = nextVar('p')
                const roots = elementRoots(branch.children, '<template case>', param)
                const match =
                    branch.match === undefined
                        ? 'undefined'
                        : `() => (${lowerExpression(branch.match)})`
                return `{ match: ${match}, render: (${param}) => {\n${roots.code}return ${roots.expr};\n} }`
            })
            .join(', ')
        return `switchBlock(${parentVar}, () => (${lowerExpression(node.subject)}), [${cases}]);\n`
    }

    /* A `<slot>` outlet: render the parent-provided content for this slot (default
       via `$children`, named via `$slots[name]`), falling back to the slot's own
       children when the parent supplied none. */
    function generateSlot(
        node: Extract<TemplateNode, { kind: 'element' }>,
        parentVar: string,
    ): string {
        const name = staticAttrValue(node, 'name')
        const guard =
            name === undefined
                ? '$props && $props.$children'
                : `$props && $props.$slots && $props.$slots[${JSON.stringify(name)}]`
        const invoke =
            name === undefined
                ? `$props.$children(${parentVar})`
                : `$props.$slots[${JSON.stringify(name)}](${parentVar})`
        const fallback = node.children.map((child) => generateChild(child, parentVar)).join('')
        if (fallback.trim() === '') {
            return `if (${guard}) { ${invoke}; }\n`
        }
        return `if (${guard}) { ${invoke}; } else {\n${fallback}}\n`
    }

    /* Mounts a child component into a wrapper element, passing each prop as a
       reactive thunk so the child re-reads when the parent expression changes. */
    function generateComponent(
        node: Extract<TemplateNode, { kind: 'component' }>,
        parentVar: string,
    ): string {
        const wrapper = nextVar('cmp')
        const parts = node.props.map(
            (prop) => `${JSON.stringify(prop.name)}: () => (${lowerExpression(prop.code)})`,
        )
        /* Slot content compiles to builders the child mounts into the host it passes
           from each <slot> position: the default markup as `$children`, and each
           `slot="name"` group as `$slots[name]`. */
        const groups = partitionSlots(node.children)
        const slotCode = groups.default.map((child) => generateChild(child, '$slot')).join('')
        if (slotCode.trim() !== '') {
            parts.push(`"$children": ($slot) => {\n${slotCode}}`)
        }
        if (groups.named.length > 0) {
            const entries = groups.named
                .map((group) => {
                    const code = group.nodes.map((child) => generateChild(child, '$slot')).join('')
                    return `${JSON.stringify(group.name)}: ($slot) => {\n${code}}`
                })
                .join(', ')
            parts.push(`"$slots": { ${entries} }`)
        }
        /* openChild appends (create) or claims the SSR wrapper (hydrate); since
           hydration is still active, the child's own build then adopts its server
           markup inside the wrapper. */
        return (
            `const ${wrapper} = openChild(${parentVar}, ${JSON.stringify(node.name.toLowerCase())});\n` +
            `mountChild(${wrapper}, ${node.name}, { ${parts.join(', ')} });\n`
        )
    }

    /* An await block: pending → resolved(value) / error branches. Each branch is a
       single-element root; a render thunk returns its node. */
    function generateAwait(
        node: Extract<TemplateNode, { kind: 'await' }>,
        parentVar: string,
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
        const thenThunk = node.blocking
            ? renderRangeThunk(
                  node.children.filter((child) => child.kind !== 'branch'),
                  node.as ?? '_value',
                  '<template await then>',
                  finallyChildren,
              )
            : renderSettledThunk(
                  node.children.find(isBranch('then')),
                  '_value',
                  '<template then>',
                  finallyChildren,
              )
        /* Neither catch nor finally → pass `undefined` so awaitBlock re-throws the
           rejection (surfacing it) instead of rendering an empty branch. A finally-only
           block keeps a catch thunk that renders just finally. */
        const catchThunk =
            catchBranch === undefined && finallyChildren.length === 0
                ? 'undefined'
                : renderSettledThunk(catchBranch, '_error', '<template catch>', finallyChildren)
        return (
            `awaitBlock(${parentVar}, nextBlockId(), () => (${lowerExpression(node.promise)}), ` +
            `${renderThunk(pending, undefined, '<template await> pending')}, ` +
            `${thenThunk}, ` +
            `${catchThunk});\n`
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

    /* Builds the element roots of a branch into `parentVar` (each via openRoot, so
       detached on create / claimed on hydrate), returning the code plus an array
       expression of the root nodes the block tracks as a range. */
    function elementRoots(
        children: TemplateNode[],
        context: string,
        parentVar: string,
        allowEmpty = false,
    ): { code: string; expr: string } {
        /* Nested `<script>`s: add their bindings to the deref scope (so the script
           body + this branch's markup auto-deref them), emit the lowered script
           bodies first, then build the element roots — all within the scope, which
           we pop afterward. The scripts run when the branch mounts, owned by its
           scope. */
        const added: string[] = []
        for (const child of children) {
            if (child.kind === 'script') {
                for (const name of nestedBindingNames(child.code)) {
                    if (!localDerived.has(name)) {
                        localDerived.add(name)
                        added.push(name)
                    }
                }
            }
        }
        const scriptCode = children
            .filter(
                (child): child is Extract<TemplateNode, { kind: 'script' }> =>
                    child.kind === 'script',
            )
            .map((child) => `${lowerStatement(child.code)}\n`)
            .join('')
        const built = branchElements(children, context, allowEmpty).map((element) =>
            generateElement(element, `openRoot(${parentVar}, ${JSON.stringify(element.tag)})`),
        )
        for (const name of added) {
            localDerived.delete(name)
        }
        return {
            code: scriptCode + built.map((part) => part.code).join(''),
            expr: `[${built.map((part) => part.varName).join(', ')}]`,
        }
    }

    /* A `(parent[, value]) => Node[]` thunk over a branch's element roots, or
       `undefined` when empty (a `<template await>` with no pending branch).
       `paramName`/`fallback` name the resolved/error value the branch binds. */
    function renderThunk(
        children: TemplateNode[],
        paramName: string | undefined,
        context: string,
        fallback?: string,
    ): string {
        const hasElement = children.some((child) => child.kind === 'element')
        const parentParam = nextVar('p')
        if (!hasElement) {
            const value = fallback === undefined ? '' : `, ${paramName ?? fallback}`
            return fallback === undefined ? 'undefined' : `(${parentParam}${value}) => []`
        }
        const roots = elementRoots(children, context, parentParam)
        const value = fallback === undefined ? '' : `, ${paramName ?? fallback}`
        return `(${parentParam}${value}) => {\n${roots.code}return ${roots.expr};\n}`
    }

    /* A thunk over a node range: `children`'s roots concatenated with the `finally`
       roots, both possibly empty. `param` names a bound value (the resolved/error
       value, or the caught error); undefined for a value-less branch (try/pending). */
    function renderRangeThunk(
        children: TemplateNode[],
        param: string | undefined,
        context: string,
        finallyChildren: TemplateNode[],
    ): string {
        const parentParam = nextVar('p')
        const head = param === undefined ? `(${parentParam})` : `(${parentParam}, ${param})`
        const roots = elementRoots(children, context, parentParam, true)
        const finallyRoots = elementRoots(finallyChildren, '<template finally>', parentParam, true)
        return `${head} => {\n${roots.code}${finallyRoots.code}return [...${roots.expr}, ...${finallyRoots.expr}];\n}`
    }

    /* A settled (then/catch) thunk: the outcome branch's roots ++ `finally`. */
    function renderSettledThunk(
        branch: TemplateNode | undefined,
        fallback: string,
        context: string,
        finallyChildren: TemplateNode[],
    ): string {
        return renderRangeThunk(
            branchChildren(branch),
            branchVar(branch) ?? fallback,
            context,
            finallyChildren,
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
    function generateTry(node: Extract<TemplateNode, { kind: 'try' }>, parentVar: string): string {
        const catchBranch = findBranch(node.children, 'catch')
        const finallyChildren = branchChildren(findBranch(node.children, 'finally'))
        const guarded = node.children.filter((child) => child.kind !== 'branch')
        const tryThunk = renderRangeThunk(guarded, undefined, '<template try>', finallyChildren)
        const catchThunk =
            catchBranch === undefined
                ? 'undefined'
                : renderRangeThunk(
                      branchChildren(catchBranch),
                      branchVar(catchBranch) ?? '_error',
                      '<template catch>',
                      finallyChildren,
                  )
        return `tryBlock(${parentVar}, nextBlockId(), ${tryThunk}, ${catchThunk});\n`
    }

    /* A conditional with an optional nested `<template else>` (a `case` child).
       Both branches are single-element roots. */
    function generateIf(node: Extract<TemplateNode, { kind: 'if' }>, parentVar: string): string {
        const elseBranch = node.children.find(
            (child): child is Extract<TemplateNode, { kind: 'case' }> => child.kind === 'case',
        )
        const thenChildren = node.children.filter((child) => child.kind !== 'case')
        const thenParam = nextVar('p')
        const thenRoots = elementRoots(thenChildren, '<template if>', thenParam)
        const thenThunk = `(${thenParam}) => {\n${thenRoots.code}return ${thenRoots.expr};\n}`
        if (elseBranch === undefined) {
            return `when(${parentVar}, () => (${lowerExpression(node.condition)}), ${thenThunk});\n`
        }
        const elseParam = nextVar('p')
        const elseRoots = elementRoots(elseBranch.children, '<template else>', elseParam)
        const elseThunk = `(${elseParam}) => {\n${elseRoots.code}return ${elseRoots.expr};\n}`
        return `when(${parentVar}, () => (${lowerExpression(node.condition)}), ${thenThunk}, ${elseThunk});\n`
    }

    /* A keyed each. The row must have a single element root (it returns one node). */
    function generateEach(
        node: Extract<TemplateNode, { kind: 'each' }>,
        parentVar: string,
    ): string {
        const rowParam = nextVar('p')
        /* A `<script>` in the row body declares per-row local signals (seeded from
           the row item), scoped to this row's render thunk. */
        const added = scopeNestedScripts(node.children)
        const scriptCode = node.children
            .filter(
                (child): child is Extract<TemplateNode, { kind: 'script' }> =>
                    child.kind === 'script',
            )
            .map((child) => `${lowerStatement(child.code)}\n`)
            .join('')
        const row = singleElementRoot(
            node.children,
            '<template each> must contain a single element row',
            rowParam,
        )
        for (const name of added) {
            localDerived.delete(name)
        }
        const keyExpression = node.key === undefined ? node.as : lowerExpression(node.key)
        /* `await` → the AsyncIterable runtime, drained row-by-row on the client, with an
           optional `<template catch>` branch rendered (after the streamed rows) when the
           iterator rejects. Absent → `undefined`, so the rejection surfaces instead. */
        const fn = node.async ? 'eachAsync' : 'each'
        const catchBranch = node.children.find(
            (child) => child.kind === 'branch' && child.branch === 'catch',
        )
        const catchArg = node.async
            ? `, ${catchBranch === undefined ? 'undefined' : renderSettledThunk(catchBranch, '_error', '<template catch>', [])}`
            : ''
        return (
            `${fn}(${parentVar}, () => (${lowerExpression(node.items)}), ` +
            `(${node.as}) => (${keyExpression}), (${rowParam}, ${node.as}) => {\n${scriptCode}${row.code}return ${row.varName};\n}${catchArg});\n`
        )
    }

    /* Builds the lone element child of a control-flow block (each/if return one
       node), erroring if the block isn't a single element. The root is opened
       with `openRoot(parentVar, tag)` so it's detached on create and claimed on
       hydrate — `parentVar` is the render thunk's parent parameter. */
    function singleElementRoot(
        children: TemplateNode[],
        message: string,
        parentVar: string,
    ): { code: string; varName: string } {
        const root = children.find((child) => child.kind === 'element')
        if (root === undefined || root.kind !== 'element') {
            throw new Error(`[abide] ${message}`)
        }
        return generateElement(root, `openRoot(${parentVar}, ${JSON.stringify(root.tag)})`)
    }

    return generateChildren(nodes, hostVar)
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
            .map((part) =>
                part.kind === 'static' && part.value.trim() !== '' ? escapeHtml(part.value) : '',
            )
            .join('')
    }
    if (node.kind !== 'element') {
        return '' // <style> and any non-element emit no markup
    }
    let html = `<${node.tag}`
    for (const scope of node.scopes ?? []) {
        html += ` ${scope}=""`
    }
    for (const attr of node.attrs) {
        if (attr.kind === 'static') {
            html += ` ${attr.name}="${escapeHtml(attr.value)}"`
        }
    }
    html += '>'
    if (VOID_TAGS.has(node.tag)) {
        return html
    }
    return `${html}${node.children.map(staticHtml).join('')}</${node.tag}>`
}
