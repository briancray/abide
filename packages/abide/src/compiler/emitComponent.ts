import { ELEMENT_ATTRIBUTE, SLOT_CLOSE, SLOT_OPEN } from '#ui/MARKERS.ts'
import { lowerNames } from './lowerNames.ts'
import type { AbideFile } from './parseAbide.ts'
import { planTemplate, type TemplatePlan } from './planTemplate.ts'
import { SERVER_SPECIFIER } from './SPECIFIERS.ts'
import { splitImports } from './splitImports.ts'
import type { Attribute, TemplateNode } from './TemplateNode.ts'

// A parsed `.abide` file becomes one ESM module exporting a component. The `<script>` body is
// copied VERBATIM into the component function, which is the whole of 19.12 at this stage: the
// compiler does not read the expression grammar, so anything TypeScript accepts survives.
//
// The component returns its head and its body apart. 39.3 is why the split is HERE and not in
// `render`: the hoist is a compile-time partition of the template, so the emitted function has
// two returns rather than one string a renderer has to go looking through. 35.5 is answered by
// `render`, which turns the two into the byte stream a document is served as.

// Attributes whose value is a URL, for 32.22. The check is on the literal, so an expression
// attribute is not scheme-checked yet.
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:']

export function emitComponent(
    file: AbideFile,
    reactive: ReadonlySet<string> = new Set(),
): string {
    // 39.1, 39.3 — a top-level `<head>` contributes its children to the document head, and the
    // hoist happens at compile time. 39.5: with no merge key they append in tree order, which is
    // what partitioning the top level in place already gives.
    const isHead = (node: TemplateNode): boolean =>
        node.kind === 'element' && node.tag === 'head'

    // The plan is over the BODY only: a head contribution is static once the server wrote it, so
    // it carries no marker and the client never counts one there.
    const plan = planTemplate(file.template.filter((node) => !isHead(node)))

    const head: string[] = []
    const body: string[] = []
    for (const node of file.template) {
        if (isHead(node) && node.kind === 'element') {
            for (const child of node.children)
                head.push(emitNode(child, reactive, undefined))
            continue
        }
        assertNoNestedHead(node)
        body.push(emitNode(node, reactive, plan))
    }

    // 31.1 and 31.4 hold INSIDE a `.abide` file, not just in its template, so the script block is
    // lowered with the same rewrite the slots get.
    const setup = splitImports(lowerNames(file.scripts.join('\n'), reactive))

    // Only what the page actually uses. An emitted module carrying an import nothing calls is a
    // name the app's own tooling reports as unused, in a file nobody wrote.
    const markup = [...head, ...body].join(' + ')
    const used: string[] = []
    if (markup.includes('escapeAttribute(')) used.push('escapeAttribute')
    if (markup.includes('escapeText(')) used.push('escapeText')

    return `${used.length === 0 ? '' : `import { ${used.join(', ')} } from '${SERVER_SPECIFIER}'\n`}\
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

function emitNode(
    node: TemplateNode,
    reactive: ReadonlySet<string>,
    plan: TemplatePlan | undefined,
): string {
    if (node.kind === 'text') return JSON.stringify(node.text)

    if (node.kind === 'expression') {
        // 32.1 — the slot is escaped at run time, never at compile time: the value is not known
        // here.
        const value = `escapeText(${lowerNames(node.source, reactive)})`
        const at = plan?.slotIndex.get(node)
        // 41.10 — the markers are what the client finds the slot by, and a slot with no plan
        // (a head contribution) gets none because nothing hydrates it.
        if (at === undefined) return value
        return `"<!--${SLOT_OPEN}-->" + ${value} + "<!--${SLOT_CLOSE}-->"`
    }

    const parts: string[] = []
    let open = `<${node.tag}`
    for (const attribute of node.attributes) {
        const emitted = emitAttribute(attribute, reactive)
        if (emitted.kind === 'static') {
            open += emitted.text
            continue
        }
        // A computed value breaks the static run: what precedes it is a literal, the value is an
        // expression, and the tag carries on after it.
        parts.push(
            JSON.stringify(`${open} ${emitted.name}="`),
            emitted.value,
            "'\"'",
        )
        open = ''
    }
    const element = plan?.elementIndex.get(node)
    if (element !== undefined) open += ` ${ELEMENT_ATTRIBUTE}="${element}"`
    open += '>'
    parts.push(JSON.stringify(open))

    if (node.children.length === 0 && isVoid(node.tag)) return parts.join(' + ')
    const children = node.children.map((child) =>
        emitNode(child, reactive, plan),
    )
    return [...parts, ...children, JSON.stringify(`</${node.tag}>`)].join(' + ')
}

type EmittedAttribute =
    | { kind: 'static'; text: string; name: string; value: string }
    | { kind: 'computed'; text: string; name: string; value: string }

function emitAttribute(
    attribute: Attribute,
    reactive: ReadonlySet<string>,
): EmittedAttribute {
    const nothing: EmittedAttribute = {
        kind: 'static',
        text: '',
        name: attribute.name,
        value: '',
    }
    if (attribute.expression) {
        // 32.5 — `on<event>` is a listener, never markup. The server writes nothing, so a handler
        // cannot fire from a document that never hydrated.
        if (isEventName(attribute.name)) return nothing
        // 32.4 — an expression attribute is reactive. Its CURRENT value is written here; the
        // client binding that keeps it live is not built yet.
        return {
            kind: 'computed',
            text: '',
            name: attribute.name,
            value: `escapeAttribute(${lowerNames(attribute.value, reactive)})`,
        }
    }
    if (isUrlAttribute(attribute.name) && !isSafeUrl(attribute.value))
        return nothing
    if (attribute.value === '')
        return { ...nothing, text: ` ${attribute.name}` }
    return {
        ...nothing,
        text: ` ${attribute.name}="${attribute.value.replaceAll('"', '&quot;')}"`,
    }
}

function isEventName(name: string): boolean {
    return name.length > 2 && name.startsWith('on')
}

// 39.2 — a `<head>` MUST be top level. Nested, it would render inside the body, which is the
// silent wrong answer this refuses instead.
function assertNoNestedHead(node: TemplateNode): void {
    if (node.kind !== 'element') return
    for (const child of node.children) {
        if (child.kind === 'element' && child.tag === 'head')
            throw new Error(
                `abide: a <head> must be top level in a .abide file, and this one is inside <${node.tag}>. RULEBOOK 39.2.`,
            )
        assertNoNestedHead(child)
    }
}

function isUrlAttribute(name: string): boolean {
    return (
        name === 'href' ||
        name === 'src' ||
        name === 'action' ||
        name === 'formaction'
    )
}

// 32.22 — a scheme outside the safe set is dropped. A relative reference carries no scheme and is
// always allowed; `javascript:` is the case this exists for.
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
