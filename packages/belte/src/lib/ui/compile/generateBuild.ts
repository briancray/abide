import { lowerDocAccess } from './lowerDocAccess.ts'
import { partitionSlots } from './partitionSlots.ts'
import { renameSignalRefs } from './renameSignalRefs.ts'
import { staticAttrValue } from './staticAttrValue.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

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
    scopeAttribute: string | undefined,
): string {
    let counter = 0
    /* Await ids count in document order, matching the SSR back-end's counter, so a
       client `await` block and its SSR boundary/resume value share one id. */
    let awaitId = 0
    const nextVar = (prefix: string): string => `${prefix}${counter++}`

    /* Rewrites signal refs, then lowers a single expression (no trailing `;`). */
    function lowerExpression(code: string): string {
        const renamed = renameSignalRefs(code, stateNames, derivedNames)
        return lowerDocAccess(renamed, 'model').trim().replace(/;$/, '')
    }

    /* As above but keeps the trailing `;` for a handler body. */
    function lowerStatement(code: string): string {
        const renamed = renameSignalRefs(code, stateNames, derivedNames)
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
        if (scopeAttribute !== undefined) {
            code += `${varName}.setAttribute(${JSON.stringify(scopeAttribute)}, "");\n`
        }
        for (const attr of node.attrs) {
            if (attr.kind === 'static') {
                code += `${varName}.setAttribute(${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});\n`
            } else if (attr.kind === 'expression') {
                code += `attr(${varName}, ${JSON.stringify(attr.name)}, () => (${lowerExpression(attr.code)}));\n`
            } else if (attr.kind === 'event') {
                code += `on(${varName}, ${JSON.stringify(attr.event)}, (${lowerExpression(attr.code)}));\n`
            } else {
                /* Two-way: drive the property from the path, and write the path
                   back on input. The path is an lvalue, so the write is lowered
                   as an assignment statement. */
                code += `effect(() => { ${varName}.${attr.property} = ${lowerExpression(attr.code)}; });\n`
                code += `on(${varName}, "input", () => { ${lowerStatement(`${attr.code} = ${varName}.${attr.property}`)} });\n`
            }
        }
        for (const child of node.children) {
            code += generateChild(child, varName)
        }
        return { code, varName }
    }

    /* Emits code appending `node` to `parentVar`. */
    function generateChild(node: TemplateNode, parentVar: string): string {
        if (node.kind === 'text') {
            let code = ''
            for (const part of node.parts) {
                if (part.kind === 'static') {
                    if (part.value.trim() === '') {
                        continue // drop insignificant whitespace between elements
                    }
                    code += `appendStatic(${parentVar}, ${JSON.stringify(part.value)});\n`
                } else {
                    code += `appendText(${parentVar}, () => (${lowerExpression(part.code)}));\n`
                }
            }
            return code
        }
        if (node.kind === 'element' && node.tag === 'slot') {
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
        return generateEach(node, parentVar)
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
                const root = singleElementRoot(
                    branch.children,
                    '<template case> must contain a single element',
                    param,
                )
                const match =
                    branch.match === undefined
                        ? 'undefined'
                        : `() => (${lowerExpression(branch.match)})`
                return `{ match: ${match}, render: (${param}) => {\n${root.code}return ${root.varName};\n} }`
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
            `${node.name}(${wrapper}, { ${parts.join(', ')} });\n`
        )
    }

    /* An await block: pending → resolved(value) / error branches. Each branch is a
       single-element root; a render thunk returns its node. */
    function generateAwait(
        node: Extract<TemplateNode, { kind: 'await' }>,
        parentVar: string,
    ): string {
        const isBranch = (which: 'then' | 'catch') => (child: TemplateNode) =>
            child.kind === 'branch' && child.branch === which
        const pending = node.children.filter((child) => child.kind !== 'branch')
        const thenBranch = node.children.find(isBranch('then'))
        const catchBranch = node.children.find(isBranch('catch'))
        const id = awaitId++
        return (
            `awaitBlock(${parentVar}, ${id}, () => (${lowerExpression(node.promise)}), ` +
            `${renderThunk(pending, undefined)}, ` +
            `${renderThunk(branchChildren(thenBranch), branchVar(thenBranch), '_value')}, ` +
            `${renderThunk(branchChildren(catchBranch), branchVar(catchBranch), '_error')});\n`
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

    /* A `() => Node` thunk over a single-element block, or `undefined` when empty
       (no pending branch). `paramName`/`fallback` name the resolved/error value. */
    function renderThunk(
        children: TemplateNode[],
        paramName: string | undefined,
        fallback?: string,
    ): string {
        const parentParam = nextVar('p')
        const root = children.find((child) => child.kind === 'element')
        if (root === undefined || root.kind !== 'element') {
            return fallback === undefined ? 'undefined' : `() => document.createTextNode("")`
        }
        const built = generateElement(root, `openRoot(${parentParam}, ${JSON.stringify(root.tag)})`)
        const value = fallback === undefined ? '' : `, ${paramName ?? fallback}`
        return `(${parentParam}${value}) => {\n${built.code}return ${built.varName};\n}`
    }

    /* A conditional with an optional nested `<template else>` (a `case` child).
       Both branches are single-element roots. */
    function generateIf(node: Extract<TemplateNode, { kind: 'if' }>, parentVar: string): string {
        const elseBranch = node.children.find(
            (child): child is Extract<TemplateNode, { kind: 'case' }> => child.kind === 'case',
        )
        const thenChildren = node.children.filter((child) => child.kind !== 'case')
        const thenParam = nextVar('p')
        const thenRoot = singleElementRoot(
            thenChildren,
            '<template if> must contain a single element',
            thenParam,
        )
        const thenThunk = `(${thenParam}) => {\n${thenRoot.code}return ${thenRoot.varName};\n}`
        if (elseBranch === undefined) {
            return `when(${parentVar}, () => (${lowerExpression(node.condition)}), ${thenThunk});\n`
        }
        const elseParam = nextVar('p')
        const elseRoot = singleElementRoot(
            elseBranch.children,
            '<template else> must contain a single element',
            elseParam,
        )
        const elseThunk = `(${elseParam}) => {\n${elseRoot.code}return ${elseRoot.varName};\n}`
        return `when(${parentVar}, () => (${lowerExpression(node.condition)}), ${thenThunk}, ${elseThunk});\n`
    }

    /* A keyed each. The row must have a single element root (it returns one node). */
    function generateEach(
        node: Extract<TemplateNode, { kind: 'each' }>,
        parentVar: string,
    ): string {
        const rowParam = nextVar('p')
        const row = singleElementRoot(
            node.children,
            '<template each> must contain a single element row',
            rowParam,
        )
        const keyExpression = node.key === undefined ? node.as : lowerExpression(node.key)
        return (
            `each(${parentVar}, () => (${lowerExpression(node.items)}), ` +
            `(${node.as}) => (${keyExpression}), (${rowParam}, ${node.as}) => {\n${row.code}return ${row.varName};\n});\n`
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
            throw new Error(`[belte] ${message}`)
        }
        return generateElement(root, `openRoot(${parentVar}, ${JSON.stringify(root.tag)})`)
    }

    return nodes.map((node) => generateChild(node, hostVar)).join('')
}
