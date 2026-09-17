import { lowerNames } from './lowerNames.ts'
import type { AbideFile } from './parseAbide.ts'
import { SERVER_SPECIFIER } from './SERVER_SPECIFIER.ts'
import { splitImports } from './splitImports.ts'
import type { TemplateNode } from './TemplateNode.ts'

// A parsed `.abide` file becomes one ESM module exporting a component. The `<script>` body is
// copied VERBATIM into the component function, which is the whole of 19.12 at this stage: the
// compiler does not read the expression grammar, so anything TypeScript accepts survives.
//
// The component returns its head and its body apart. 39.3 is why the split is HERE and not in
// `render`: the hoist is a compile-time partition of the template, so the emitted function has
// two returns rather than one string a renderer has to go looking through. 35.5 is answered by
// `render`, which turns the two into the byte stream a document is served as.

// Attributes whose value is a URL, for 32.22. Static-only today, so the check is on the literal.
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:']

export function emitComponent(
    file: AbideFile,
    reactive: ReadonlySet<string> = new Set(),
): string {
    // 39.1, 39.3 — a top-level `<head>` contributes its children to the document head, and the
    // hoist happens at compile time. 39.5: with no merge key they append in tree order, which is
    // what partitioning the top level in place already gives.
    const head: string[] = []
    const body: string[] = []
    for (const node of file.template) {
        if (node.kind === 'element' && node.tag === 'head') {
            for (const child of node.children)
                head.push(emitNode(child, reactive))
            continue
        }
        assertNoNestedHead(node)
        body.push(emitNode(node, reactive))
    }
    // 31.1 and 31.4 hold INSIDE a `.abide` file, not just in its template, so the script
    // block is lowered with the same rewrite the slots get.
    const setup = splitImports(lowerNames(file.scripts.join('\n'), reactive))
    return `import { escapeText } from '${SERVER_SPECIFIER}'
${setup.imports}
export default function Component() {
${indent(setup.body)}
    return {
        head: ${head.length === 0 ? "''" : head.join(' + ')},
        body: ${body.length === 0 ? "''" : body.join(' + ')},
    }
}
`
}

// 39.2 — a `<head>` MUST be top level. Nested, it would render inside the body, which is the
// silent wrong answer this refuses instead.
function assertNoNestedHead(node: TemplateNode): void {
    if (node.kind !== 'element') return
    for (const child of node.children) {
        if (child.kind === 'element' && child.tag === 'head')
            throw new Error(
                'abide: a <head> must be top level in a .abide file, and this one is inside <' +
                    node.tag +
                    '>. RULEBOOK 39.2.',
            )
        assertNoNestedHead(child)
    }
}

function emitNode(node: TemplateNode, reactive: ReadonlySet<string>): string {
    if (node.kind === 'text') return JSON.stringify(node.text)
    // 32.1 — the slot is escaped at run time, never at compile time: the value is not known here.
    if (node.kind === 'expression')
        return `escapeText(${lowerNames(node.source, reactive)})`

    const open = `<${node.tag}${node.attributes.map(emitAttribute).join('')}>`
    if (node.children.length === 0 && isVoid(node.tag))
        return JSON.stringify(open)
    const children = node.children.map((child) => emitNode(child, reactive))
    const close = `</${node.tag}>`
    if (children.length === 0) return JSON.stringify(open + close)
    return [JSON.stringify(open), ...children, JSON.stringify(close)].join(
        ' + ',
    )
}

function emitAttribute(attribute: { name: string; value: string }): string {
    if (isUrlAttribute(attribute.name) && !isSafeUrl(attribute.value)) return ''
    if (attribute.value === '') return ` ${attribute.name}`
    return ` ${attribute.name}="${attribute.value.replaceAll('"', '&quot;')}"`
}

function isUrlAttribute(name: string): boolean {
    return (
        name === 'href' ||
        name === 'src' ||
        name === 'action' ||
        name === 'formaction'
    )
}

// 32.22 — a scheme outside the safe set is dropped. A relative reference carries no scheme and
// is always allowed; `javascript:` is the case this exists for.
function isSafeUrl(value: string): boolean {
    const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(value)
    if (scheme === null) return true
    return SAFE_SCHEMES.includes(scheme[0].toLowerCase())
}

function isVoid(tag: string): boolean {
    return (
        tag === 'area' ||
        tag === 'base' ||
        tag === 'br' ||
        tag === 'col' ||
        tag === 'embed' ||
        tag === 'hr' ||
        tag === 'img' ||
        tag === 'input' ||
        tag === 'link' ||
        tag === 'meta' ||
        tag === 'source' ||
        tag === 'track' ||
        tag === 'wbr'
    )
}

function indent(text: string): string {
    const lines = text.split('\n')
    let out = ''
    for (const line of lines) out += line.trim() === '' ? '\n' : `    ${line}\n`
    return out.trimEnd()
}
