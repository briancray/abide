import { decodeHtmlEntities } from './decodeHtmlEntities.ts'
import type { TemplateAttr } from './types/TemplateAttr.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import type { TextPart } from './types/TextPart.ts'

/*
A minimal compile-time parser for the abide template subset: elements, text with
`{expr}` interpolation, static/`{expr}`/`on<event>={expr}` attributes, and
`<template each as key>` control flow. Not a full HTML parser — it covers what
components need and reads brace expressions with quote/nesting awareness so an
expression containing `<`, `>`, or `}` parses intact. Void elements self-close.
`<!-- … -->` comments are dropped (no node emitted) so they leave no trace in the
SSR/client output or hydration cursor.

A `<style>` becomes a `style` node IN PLACE (not hoisted): its CSS body is read
structurally (not via a raw-source regex) so a `<style>` sitting inside a `{expr}`
or attribute — e.g. one quoted in a code sample — is read as that expression's
text, never mistaken for a real style. Keeping it in the tree lets the front-end
scope it to its sibling subtree (`analyzeComponent`); the node emits no DOM/markup.
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

/* A braced template expression with the absolute source offset of its first
   (post-trim) character, so the type-checking shadow can map a diagnostic back. */
type Braced = { code: string; loc: number }

export function parseTemplate(source: string, baseOffset = 0): { nodes: TemplateNode[] } {
    let cursor = 0

    /* Reads a `{...}` expression starting at `cursor` (on the `{`), tracking
       string literals and nested braces so the matching `}` is found. `loc` is the
       absolute offset (baseOffset-relative) of the trimmed code's first char. */
    function readBracedExpression(): Braced {
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
        const raw = source.slice(start, cursor - 1)
        const leading = raw.length - raw.trimStart().length
        return { code: raw.trim(), loc: baseOffset + start + leading }
    }

    /* Skips an HTML comment starting at `cursor` (on `<!--`), advancing past its
       `-->`; an unterminated comment runs to the end of source. Emits no node. */
    function skipComment(): void {
        const close = source.indexOf('-->', cursor)
        cursor = close === -1 ? source.length : close + '-->'.length
    }

    /* True when `cursor` is on a `<style>` open tag — read raw (`readStyle`) so its
       CSS braces never misparse as `{expr}` interpolations. */
    function atStyleTag(): boolean {
        return source.startsWith('<style', cursor) && /[\s>]/.test(source.charAt(cursor + 6))
    }

    /* Reads a `<style>…</style>` block into a `style` node carrying its CSS body; an
       unterminated block runs to end. The body is read raw (not parsed as markup) so
       CSS braces never misparse as `{expr}`. */
    function readStyle(): TemplateNode {
        const openEnd = source.indexOf('>', cursor)
        const close = source.indexOf('</style>', cursor)
        const css =
            openEnd !== -1 && (close === -1 || openEnd < close)
                ? source.slice(openEnd + 1, close === -1 ? source.length : close).trim()
                : ''
        cursor = close === -1 ? source.length : close + '</style>'.length
        return { kind: 'style', css }
    }

    function readText(): TemplateNode {
        const parts: TextPart[] = []
        let literal = ''
        while (cursor < source.length && source.charAt(cursor) !== '<') {
            if (source.charAt(cursor) === '{') {
                if (literal !== '') {
                    parts.push({ kind: 'static', value: decodeHtmlEntities(literal) })
                    literal = ''
                }
                const { code, loc } = readBracedExpression()
                parts.push({ kind: 'expression', code, loc })
            } else {
                literal += source.charAt(cursor)
                cursor += 1
            }
        }
        if (literal !== '') {
            parts.push({ kind: 'static', value: decodeHtmlEntities(literal) })
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
                const { code, loc } = readBracedExpression()
                if (name.startsWith('on')) {
                    attrs.push({ kind: 'event', event: name.slice(2), code, loc })
                } else if (name.startsWith('bind:')) {
                    attrs.push({ kind: 'bind', property: name.slice(5), code, loc })
                } else {
                    attrs.push({ kind: 'expression', name, code, loc })
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
        /* A nested `<script>` is a scoped reactive block: its body is raw JS read
           verbatim to its `</script>` (not parsed as markup), scoped by the
           containing branch when compiled. */
        if (tag === 'script' && !selfClosing) {
            const close = source.indexOf('</script>', cursor)
            const end = close === -1 ? source.length : close
            const code = source.slice(cursor, end)
            cursor = close === -1 ? source.length : end + '</script>'.length
            return { kind: 'script', code }
        }
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
            if (source.startsWith('<!--', cursor)) {
                skipComment()
            } else if (atStyleTag()) {
                nodes.push(readStyle())
            } else if (source.charAt(cursor) === '<') {
                nodes.push(readElement())
            } else {
                nodes.push(readText())
            }
        }
        return nodes
    }

    const roots: TemplateNode[] = []
    while (cursor < source.length) {
        if (source.startsWith('<!--', cursor)) {
            skipComment()
        } else if (atStyleTag()) {
            roots.push(readStyle())
        } else if (source.charAt(cursor) === '<') {
            roots.push(readElement())
        } else {
            roots.push(readText())
        }
    }
    return { nodes: roots }
}

/* Turns a component's attributes into props: a static value becomes a string
   literal, an expression keeps its code (event/bind on components ignored). */
function toProps(attrs: TemplateAttr[]): { name: string; code: string; loc?: number }[] {
    const props: { name: string; code: string; loc?: number }[] = []
    for (const attr of attrs) {
        if (attr.kind === 'static') {
            props.push({ name: attr.name, code: JSON.stringify(attr.value) })
        } else if (attr.kind === 'expression') {
            props.push({ name: attr.name, code: attr.code, loc: attr.loc })
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

/* The source offset of an attribute expression's code (see TextPart.loc); only
   expression attributes carry one — a static value isn't a checkable expression. */
function attrLoc(attr: TemplateAttr | undefined): number | undefined {
    return attr !== undefined && attr.kind === 'expression' ? attr.loc : undefined
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
    /* `<template name="row" args={item}>` declares a snippet — a named builder, not
       a control branch. `args` (its parameter list) rides the `{…}` expression slot. */
    const snippet = find('name')
    if (snippet !== undefined) {
        const name = attrText(snippet)
        if (name === undefined || name === '') {
            throw new Error('[abide] <template name> requires a snippet name')
        }
        const params = find('args')
        return {
            kind: 'snippet',
            name,
            params: params === undefined ? undefined : attrText(params),
            children,
            loc: attrLoc(params),
        }
    }
    /* `<template try>` is a synchronous error boundary: its children are the guarded
       subtree; `catch`/`finally` branches handle a throw while building them. */
    if (find('try') !== undefined) {
        return { kind: 'try', children }
    }
    /* `await` alongside `each` is the async-list switch (handled in the each branch
       below), not an await block. */
    const promise = find('await')
    if (promise !== undefined && find('each') === undefined) {
        const promiseCode = attrText(promise)
        if (promiseCode === undefined) {
            throw new Error('[abide] <template await> requires a promise expression')
        }
        /* A `then` attribute ON the await tag is the blocking switch: children become
           the resolved content bound to its value (a `then` *child* is a streaming
           branch, handled separately below when its own tag is parsed). */
        const boundThen = find('then')
        return {
            kind: 'await',
            promise: promiseCode,
            blocking: boundThen !== undefined,
            as: boundThen === undefined ? undefined : attrText(boundThen) || undefined,
            children,
            loc: attrLoc(promise),
        }
    }
    const thenAttr = find('then')
    if (thenAttr !== undefined) {
        return { kind: 'branch', branch: 'then', as: attrText(thenAttr) || undefined, children }
    }
    const catchAttr = find('catch')
    if (catchAttr !== undefined) {
        return { kind: 'branch', branch: 'catch', as: attrText(catchAttr) || undefined, children }
    }
    /* `<template finally>` renders after settle on BOTH outcomes — outcome-agnostic,
       so it binds no value. */
    if (find('finally') !== undefined) {
        return { kind: 'branch', branch: 'finally', as: undefined, children }
    }
    const subject = find('switch')
    if (subject !== undefined) {
        const subjectCode = attrText(subject)
        if (subjectCode === undefined) {
            throw new Error('[abide] <template switch> requires a subject expression')
        }
        return { kind: 'switch', subject: subjectCode, children, loc: attrLoc(subject) }
    }
    const caseAttr = find('case')
    if (caseAttr !== undefined) {
        const matchCode = attrText(caseAttr)
        if (matchCode === undefined) {
            throw new Error('[abide] <template case> requires a value expression')
        }
        return { kind: 'case', match: matchCode, children, loc: attrLoc(caseAttr) }
    }
    if (find('default') !== undefined || find('else') !== undefined) {
        return { kind: 'case', match: undefined, children } // default (switch) / else (if)
    }
    const condition = find('if')
    if (condition !== undefined) {
        const conditionCode = attrText(condition)
        if (conditionCode === undefined) {
            throw new Error('[abide] <template if> requires a condition expression')
        }
        return { kind: 'if', condition: conditionCode, children, loc: attrLoc(condition) }
    }
    const items = find('each')
    const itemsCode = items === undefined ? undefined : attrText(items)
    if (itemsCode === undefined) {
        throw new Error('[abide] <template> without a supported directive (if/each)')
    }
    const as = find('as')
    const key = find('key')
    return {
        kind: 'each',
        items: itemsCode,
        as: (as === undefined ? undefined : attrText(as)) ?? '_item',
        key: key === undefined ? undefined : attrText(key),
        async: find('await') !== undefined, // `<template each await>` over an AsyncIterable
        children,
        loc: attrLoc(items),
    }
}
