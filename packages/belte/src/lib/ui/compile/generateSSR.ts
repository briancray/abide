import { branchElements } from './branchElements.ts'
import { lowerDocAccess } from './lowerDocAccess.ts'
import { partitionSlots } from './partitionSlots.ts'
import { renameSignalRefs } from './renameSignalRefs.ts'
import { staticAttrValue } from './staticAttrValue.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
Server code generator: turns the parsed template into statements that push HTML
fragments onto an output array, reading the document synchronously (no DOM, no
listeners). Same expression lowering as the client back-end, so server and client
render the same markup. Dynamic values go through `$esc`; `if` is a plain `if`,
`each` a `for…of`.

An `await` block emits its pending branch wrapped in boundary comments
(`<!--belte:await:N-->…<!--/belte:await:N-->`) and registers the promise plus its
resolved/error string-renderers on `$awaits`. The non-streaming render returns the
shell (pending); `renderToStream` resolves each `$awaits` entry and flushes the
resolved fragment out of order — the await-block-streams half of the cache rule.
*/
export function generateSSR(
    nodes: TemplateNode[],
    stateNames: ReadonlySet<string>,
    derivedNames: ReadonlySet<string>,
    scopeAttribute: string | undefined,
): string {
    let awaitId = 0

    function lowerExpression(code: string): string {
        return lowerDocAccess(renameSignalRefs(code, stateNames, derivedNames), 'model')
            .trim()
            .replace(/;$/, '')
    }

    function push(target: string, literal: string): string {
        return `${target}.push(${JSON.stringify(literal)});\n`
    }

    function generateInto(children: TemplateNode[], target: string): string {
        return children.map((child) => generate(child, target)).join('')
    }

    function generate(node: TemplateNode, target: string): string {
        if (node.kind === 'text') {
            return node.parts
                .map((part) => {
                    if (part.kind === 'static') {
                        return part.value.trim() === '' ? '' : push(target, part.value)
                    }
                    return `${target}.push($esc(${lowerExpression(part.code)}));\n`
                })
                .join('')
        }
        if (node.kind === 'if') {
            const elseBranch = node.children.find((child) => child.kind === 'case')
            const thenChildren = node.children.filter((child) => child.kind !== 'case')
            let code = `if (${lowerExpression(node.condition)}) {\n${generateInto(branchElements(thenChildren, '<template if>'), target)}}`
            if (elseBranch !== undefined && elseBranch.kind === 'case') {
                code += ` else {\n${generateInto(branchElements(elseBranch.children, '<template else>'), target)}}`
            }
            return `${code}\n`
        }
        if (node.kind === 'switch') {
            const cases = node.children.filter(
                (child): child is Extract<TemplateNode, { kind: 'case' }> => child.kind === 'case',
            )
            let code = `{ const $s = (${lowerExpression(node.subject)});\n`
            let started = false
            for (const branch of cases) {
                if (branch.match !== undefined) {
                    code += `${started ? 'else ' : ''}if ($s === (${lowerExpression(branch.match)})) {\n${generateInto(branchElements(branch.children, '<template case>'), target)}}\n`
                    started = true
                }
            }
            const fallback = cases.find((branch) => branch.match === undefined)
            if (fallback !== undefined) {
                code += `${started ? 'else ' : ''}{\n${generateInto(branchElements(fallback.children, '<template case>'), target)}}\n`
            }
            return `${code}}\n`
        }
        if (node.kind === 'case') {
            return ''
        }
        if (node.kind === 'each') {
            return `for (const ${node.as} of (${lowerExpression(node.items)})) {\n${generateInto(node.children, target)}}\n`
        }
        if (node.kind === 'await') {
            return generateAwait(node, target)
        }
        if (node.kind === 'branch') {
            return ''
        }
        if (node.kind === 'component') {
            /* Server-render the child via its `render` and inline the HTML inside
               the same wrapper the client mounts into, so SSR and client agree.
               Props pass as thunks; slot content passes as a string-returning
               `$children` the child invokes from its <slot>. */
            const tag = node.name.toLowerCase()
            const parts = node.props.map(
                (prop) => `${JSON.stringify(prop.name)}: () => (${lowerExpression(prop.code)})`,
            )
            const groups = partitionSlots(node.children)
            const slotCode = generateInto(groups.default, '$slot')
            if (slotCode.trim() !== '') {
                parts.push(
                    `"$children": () => { const $slot = []; ${slotCode}return $slot.join(''); }`,
                )
            }
            if (groups.named.length > 0) {
                const entries = groups.named
                    .map((group) => {
                        const code = generateInto(group.nodes, '$slot')
                        return `${JSON.stringify(group.name)}: () => { const $slot = []; ${code}return $slot.join(''); }`
                    })
                    .join(', ')
                parts.push(`"$slots": { ${entries} }`)
            }
            return (
                push(target, `<${tag}>`) +
                `${target}.push(${node.name}.render({ ${parts.join(', ')} }).html);\n` +
                push(target, `</${tag}>`)
            )
        }
        if (node.kind === 'element' && node.tag === 'slot') {
            return generateSlot(node, target)
        }
        let code = push(target, `<${node.tag}`)
        if (scopeAttribute !== undefined) {
            code += push(target, ` ${scopeAttribute}=""`)
        }
        for (const attr of node.attrs) {
            if (attr.kind === 'static') {
                code += push(target, ` ${attr.name}="${attr.value}"`)
            } else if (attr.kind === 'expression') {
                code += `${target}.push(${JSON.stringify(` ${attr.name}="`)} + $esc(${lowerExpression(attr.code)}) + '"');\n`
            } else if (attr.kind === 'bind') {
                code += `${target}.push(${JSON.stringify(` ${attr.property}="`)} + $esc(${lowerExpression(attr.code)}) + '"');\n`
            }
        }
        code += push(target, '>')
        if (!VOID_TAGS.has(node.tag)) {
            code += generateInto(node.children, target)
            code += push(target, `</${node.tag}>`)
        }
        return code
    }

    /* A `<slot>` outlet: emit the parent-provided content for this slot (default
       via `$children`, named via `$slots[name]`), falling back to the slot's own
       children when none was supplied. */
    function generateSlot(
        node: Extract<TemplateNode, { kind: 'element' }>,
        target: string,
    ): string {
        const name = staticAttrValue(node, 'name')
        const guard =
            name === undefined
                ? '$props && $props.$children'
                : `$props && $props.$slots && $props.$slots[${JSON.stringify(name)}]`
        const provided =
            name === undefined ? '$props.$children' : `$props.$slots[${JSON.stringify(name)}]`
        const fallback = generateInto(node.children, target)
        if (fallback.trim() === '') {
            return `if (${guard}) { ${target}.push(${provided}()); }\n`
        }
        return `if (${guard}) { ${target}.push(${provided}()); } else {\n${fallback}}\n`
    }

    /* Pending shell with boundary markers + a `$awaits` registration carrying the
       promise and string-renderers for the resolved/error branches. */
    function generateAwait(node: Extract<TemplateNode, { kind: 'await' }>, target: string): string {
        const id = awaitId++
        const pending = node.children.filter((child) => child.kind !== 'branch')
        const thenBranch = node.children.find(
            (child): child is Extract<TemplateNode, { kind: 'branch' }> =>
                child.kind === 'branch' && child.branch === 'then',
        )
        const catchBranch = node.children.find(
            (child): child is Extract<TemplateNode, { kind: 'branch' }> =>
                child.kind === 'branch' && child.branch === 'catch',
        )
        let code = push(target, `<!--belte:await:${id}-->`)
        code += generateInto(branchElements(pending, '<template await> pending', true), target)
        code += push(target, `<!--/belte:await:${id}-->`)
        code +=
            `$awaits.push({ id: ${id}, ` +
            `promise: () => (${lowerExpression(node.promise)}), ` +
            `then: (${thenBranch?.as ?? '_value'}) => { const $o = []; ${generateInto(branchElements(thenBranch?.children ?? [], '<template then>', true), '$o')}return $o.join(''); }, ` +
            `catch: (${catchBranch?.as ?? '_error'}) => { const $o = []; ${generateInto(branchElements(catchBranch?.children ?? [], '<template catch>', true), '$o')}return $o.join(''); } });\n`
        return code
    }

    return generateInto(nodes, '$out')
}

const VOID_TAGS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
])
