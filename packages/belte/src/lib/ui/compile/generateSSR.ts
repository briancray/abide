import { lowerDocAccess } from './lowerDocAccess.ts'
import { renameSignalRefs } from './renameSignalRefs.ts'
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
            return `if (${lowerExpression(node.condition)}) {\n${generateInto(node.children, target)}}\n`
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
               Props pass as thunks, matching the client. */
            const tag = node.name.toLowerCase()
            const props = node.props
                .map(
                    (prop) => `${JSON.stringify(prop.name)}: () => (${lowerExpression(prop.code)})`,
                )
                .join(', ')
            return (
                push(target, `<${tag}>`) +
                `${target}.push(${node.name}.render({ ${props} }).html);\n` +
                push(target, `</${tag}>`)
            )
        }
        let code = push(target, `<${node.tag}`)
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
        code += generateInto(pending, target)
        code += push(target, `<!--/belte:await:${id}-->`)
        code +=
            `$awaits.push({ id: ${id}, ` +
            `promise: () => (${lowerExpression(node.promise)}), ` +
            `then: (${thenBranch?.as ?? '_value'}) => { const $o = []; ${generateInto(thenBranch?.children ?? [], '$o')}return $o.join(''); }, ` +
            `catch: (${catchBranch?.as ?? '_error'}) => { const $o = []; ${generateInto(catchBranch?.children ?? [], '$o')}return $o.join(''); } });\n`
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
