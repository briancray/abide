import type { TemplateAttr } from './types/TemplateAttr.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import type { TextPart } from './types/TextPart.ts'

/*
A minimal compile-time parser for the belte template subset: elements, text with
`{expr}` interpolation, static/`{expr}`/`on<event>={expr}` attributes, and
`<template each as key>` control flow. Not a full HTML parser — it covers what
components need and reads brace expressions with quote/nesting awareness so an
expression containing `<`, `>`, or `}` parses intact. Void elements self-close.
*/

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

export function parseTemplate(source: string): TemplateNode[] {
    let cursor = 0

    /* Reads a `{...}` expression starting at `cursor` (on the `{`), tracking
       string literals and nested braces so the matching `}` is found. */
    function readBracedExpression(): string {
        cursor += 1 // past '{'
        const start = cursor
        let depth = 1
        while (cursor < source.length && depth > 0) {
            const char = source.charAt(cursor)
            if (char === '"' || char === "'" || char === '`') {
                cursor += 1
                while (cursor < source.length && source.charAt(cursor) !== char) {
                    if (source.charAt(cursor) === '\\') {
                        cursor += 1
                    }
                    cursor += 1
                }
            } else if (char === '{') {
                depth += 1
            } else if (char === '}') {
                depth -= 1
            }
            cursor += 1
        }
        return source.slice(start, cursor - 1).trim()
    }

    function readText(): TemplateNode {
        const parts: TextPart[] = []
        let literal = ''
        while (cursor < source.length && source.charAt(cursor) !== '<') {
            if (source.charAt(cursor) === '{') {
                if (literal !== '') {
                    parts.push({ kind: 'static', value: literal })
                    literal = ''
                }
                parts.push({ kind: 'expression', code: readBracedExpression() })
            } else {
                literal += source.charAt(cursor)
                cursor += 1
            }
        }
        if (literal !== '') {
            parts.push({ kind: 'static', value: literal })
        }
        return { kind: 'text', parts }
    }

    function readAttributes(): TemplateAttr[] {
        const attrs: TemplateAttr[] = []
        while (cursor < source.length) {
            while (/\s/.test(source.charAt(cursor))) {
                cursor += 1
            }
            const char = source.charAt(cursor)
            if (char === '>' || char === '/' || char === undefined) {
                break
            }
            let name = ''
            while (cursor < source.length && !/[\s=>/]/.test(source.charAt(cursor))) {
                name += source.charAt(cursor)
                cursor += 1
            }
            while (/\s/.test(source.charAt(cursor))) {
                cursor += 1
            }
            if (source.charAt(cursor) !== '=') {
                attrs.push({ kind: 'static', name, value: '' }) // boolean attribute
                continue
            }
            cursor += 1 // past '='
            while (/\s/.test(source.charAt(cursor))) {
                cursor += 1
            }
            if (source.charAt(cursor) === '{') {
                const code = readBracedExpression()
                if (name.startsWith('on')) {
                    attrs.push({ kind: 'event', event: name.slice(2), code })
                } else if (name.startsWith('bind:')) {
                    attrs.push({ kind: 'bind', property: name.slice(5), code })
                } else {
                    attrs.push({ kind: 'expression', name, code })
                }
            } else {
                const quote = source.charAt(cursor)
                cursor += 1
                let value = ''
                while (cursor < source.length && source.charAt(cursor) !== quote) {
                    value += source.charAt(cursor)
                    cursor += 1
                }
                cursor += 1 // past closing quote
                attrs.push({ kind: 'static', name, value })
            }
        }
        return attrs
    }

    function readElement(): TemplateNode {
        cursor += 1 // past '<'
        let tag = ''
        while (cursor < source.length && !/[\s>/]/.test(source.charAt(cursor))) {
            tag += source.charAt(cursor)
            cursor += 1
        }
        const attrs = readAttributes()
        let selfClosing = false
        if (source.charAt(cursor) === '/') {
            selfClosing = true
            cursor += 1
        }
        cursor += 1 // past '>'
        /* A capitalised tag is a child component; its attributes become props and
           its children become slot content (rendered where the child puts <slot>). */
        if (/^[A-Z]/.test(tag)) {
            const slotted = selfClosing ? [] : readChildren(tag)
            return { kind: 'component', name: tag, props: toProps(attrs), children: slotted }
        }
        const children = selfClosing || VOID_TAGS.has(tag) ? [] : readChildren(tag)
        if (tag === 'template') {
            return toControlFlow(attrs, children)
        }
        return { kind: 'element', tag, attrs, children }
    }

    function readChildren(closeTag: string): TemplateNode[] {
        const nodes: TemplateNode[] = []
        while (cursor < source.length) {
            if (source.startsWith(`</${closeTag}`, cursor)) {
                cursor = source.indexOf('>', cursor) + 1
                break
            }
            if (source.charAt(cursor) === '<') {
                nodes.push(readElement())
            } else {
                nodes.push(readText())
            }
        }
        return nodes
    }

    const roots: TemplateNode[] = []
    while (cursor < source.length) {
        if (source.charAt(cursor) === '<') {
            roots.push(readElement())
        } else {
            roots.push(readText())
        }
    }
    return roots
}

/* Turns a component's attributes into props: a static value becomes a string
   literal, an expression keeps its code (event/bind on components ignored). */
function toProps(attrs: TemplateAttr[]): { name: string; code: string }[] {
    const props: { name: string; code: string }[] = []
    for (const attr of attrs) {
        if (attr.kind === 'static') {
            props.push({ name: attr.name, code: JSON.stringify(attr.value) })
        } else if (attr.kind === 'expression') {
            props.push({ name: attr.name, code: attr.code })
        }
    }
    return props
}

/* The literal text of an attribute (a static value or an expression's code);
   undefined for event/bind attributes, which a directive never is. */
function attrText(attr: TemplateAttr): string | undefined {
    if (attr.kind === 'static') {
        return attr.value
    }
    if (attr.kind === 'expression') {
        return attr.code
    }
    return undefined
}

/* The attribute's source name (`on<event>`/`bind:<property>` reconstructed). */
function attrName(attr: TemplateAttr): string {
    if (attr.kind === 'event') {
        return `on${attr.event}`
    }
    if (attr.kind === 'bind') {
        return `bind:${attr.property}`
    }
    return attr.name
}

/* Turns a `<template>` directive into a control node (if/each/await + then/catch). */
function toControlFlow(attrs: TemplateAttr[], children: TemplateNode[]): TemplateNode {
    const find = (name: string) => attrs.find((attr) => attrName(attr) === name)
    const promise = find('await')
    if (promise !== undefined) {
        const promiseCode = attrText(promise)
        if (promiseCode === undefined) {
            throw new Error('[belte] <template await> requires a promise expression')
        }
        return { kind: 'await', promise: promiseCode, children }
    }
    const thenAttr = find('then')
    if (thenAttr !== undefined) {
        return { kind: 'branch', branch: 'then', as: attrText(thenAttr) || undefined, children }
    }
    const catchAttr = find('catch')
    if (catchAttr !== undefined) {
        return { kind: 'branch', branch: 'catch', as: attrText(catchAttr) || undefined, children }
    }
    const subject = find('switch')
    if (subject !== undefined) {
        const subjectCode = attrText(subject)
        if (subjectCode === undefined) {
            throw new Error('[belte] <template switch> requires a subject expression')
        }
        return { kind: 'switch', subject: subjectCode, children }
    }
    const caseAttr = find('case')
    if (caseAttr !== undefined) {
        const matchCode = attrText(caseAttr)
        if (matchCode === undefined) {
            throw new Error('[belte] <template case> requires a value expression')
        }
        return { kind: 'case', match: matchCode, children }
    }
    if (find('default') !== undefined || find('else') !== undefined) {
        return { kind: 'case', match: undefined, children } // default (switch) / else (if)
    }
    const condition = find('if')
    if (condition !== undefined) {
        const conditionCode = attrText(condition)
        if (conditionCode === undefined) {
            throw new Error('[belte] <template if> requires a condition expression')
        }
        return { kind: 'if', condition: conditionCode, children }
    }
    const items = find('each')
    const itemsCode = items === undefined ? undefined : attrText(items)
    if (itemsCode === undefined) {
        throw new Error('[belte] <template> without a supported directive (if/each)')
    }
    const as = find('as')
    const key = find('key')
    return {
        kind: 'each',
        items: itemsCode,
        as: (as === undefined ? undefined : attrText(as)) ?? '_item',
        key: key === undefined ? undefined : attrText(key),
        children,
    }
}
