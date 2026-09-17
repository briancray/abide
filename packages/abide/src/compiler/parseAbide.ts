import type { Attribute, TemplateNode } from './TemplateNode.ts'

// A `.abide` file is a script, a style and a template, and this splits it into the three
// and parses the third. The expression grammar is NOT parsed here: `{expr}` is captured as
// source text and handed to the emitter verbatim, which is what keeps 19.12 a property of
// the file rather than a promise this parser has to keep.

export type AbideFile = {
    // `<script>` bodies in source order — per-instance setup, 34.1.
    scripts: string[]
    // `<style>` bodies in source order. Scoping is 34.3 and is not implemented yet.
    styles: string[]
    template: TemplateNode[]
}

// Elements that never have children and never take a close tag.
const VOID_ELEMENTS = new Set([
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
    'source',
    'track',
    'wbr',
])

export function parseAbide(source: string): AbideFile {
    const scripts: string[] = []
    const styles: string[] = []
    let template = ''

    let at = 0
    while (at < source.length) {
        const open = source.indexOf('<', at)
        if (open === -1) {
            template += source.slice(at)
            break
        }
        const block = blockAt(source, open)
        if (block === undefined) {
            template += source.slice(at, open + 1)
            at = open + 1
            continue
        }
        template += source.slice(at, open)
        ;(block.tag === 'script' ? scripts : styles).push(block.body)
        at = block.end
    }

    return { scripts, styles, template: parseTemplate(template) }
}

// A `<script>` or `<style>` starting at `open`, or undefined where this is an ordinary tag.
// The body is taken to the first literal close tag, so a `</script>` inside a string in a
// script block ends it early — the case is real and is not handled yet.
function blockAt(
    source: string,
    open: number,
): { tag: 'script' | 'style'; body: string; end: number } | undefined {
    for (const tag of ['script', 'style'] as const) {
        if (!source.startsWith(`<${tag}`, open)) continue
        const after = source[open + tag.length + 1]
        if (after !== '>' && after !== ' ' && after !== '\n' && after !== '\t')
            continue
        const bodyStart = source.indexOf('>', open)
        if (bodyStart === -1) continue
        const close = source.indexOf(`</${tag}>`, bodyStart)
        if (close === -1) continue
        return {
            tag,
            body: source.slice(bodyStart + 1, close),
            end: close + tag.length + 3,
        }
    }
    return undefined
}

function parseTemplate(source: string): TemplateNode[] {
    const root: TemplateNode[] = []
    // The open elements, innermost last. `root` is the floor and is never popped.
    const stack: TemplateNode[][] = [root]
    let at = 0

    while (at < source.length) {
        const children = stack[stack.length - 1] as TemplateNode[]
        const char = source[at]

        if (char === '<' && source[at + 1] === '/') {
            const close = source.indexOf('>', at)
            if (close === -1) break
            if (stack.length > 1) stack.pop()
            at = close + 1
            continue
        }

        if (char === '<') {
            const tag = readTag(source, at)
            if (tag === undefined) {
                at += 1
                continue
            }
            const element: TemplateNode = {
                kind: 'element',
                tag: tag.name,
                attributes: tag.attributes,
                children: [],
            }
            children.push(element)
            if (!tag.selfClosing && !VOID_ELEMENTS.has(tag.name))
                stack.push(element.children)
            at = tag.end
            continue
        }

        if (char === '{') {
            const end = readExpression(source, at)
            children.push({
                kind: 'expression',
                source: source.slice(at + 1, end).trim(),
            })
            at = end + 1
            continue
        }

        let next = at
        while (
            next < source.length &&
            source[next] !== '<' &&
            source[next] !== '{'
        )
            next += 1
        children.push({ kind: 'text', text: source.slice(at, next) })
        at = next
    }

    collapseWhitespace(root)
    return root
}

function readTag(
    source: string,
    open: number,
):
    | {
          name: string
          attributes: Attribute[]
          selfClosing: boolean
          end: number
      }
    | undefined {
    let at = open + 1
    const nameStart = at
    while (at < source.length && /[\w:-]/.test(source[at] as string)) at += 1
    if (at === nameStart) return undefined
    const name = source.slice(nameStart, at)
    const attributes: Attribute[] = []

    while (at < source.length) {
        while (at < source.length && /\s/.test(source[at] as string)) at += 1
        if (source[at] === '>')
            return { name, attributes, selfClosing: false, end: at + 1 }
        if (source[at] === '/' && source[at + 1] === '>')
            return { name, attributes, selfClosing: true, end: at + 2 }

        const attrStart = at
        while (at < source.length && /[^\s=/>]/.test(source[at] as string))
            at += 1
        if (at === attrStart)
            return { name, attributes, selfClosing: false, end: at + 1 }
        const attrName = source.slice(attrStart, at)

        if (source[at] !== '=') {
            attributes.push({ name: attrName, value: '', expression: false })
            continue
        }
        at += 1

        // `attr={expr}` — the braces are found the same way a slot's are, so `onclick={f('}')}`
        // ends where it reads as ending.
        if (source[at] === '{') {
            const close = readExpression(source, at)
            attributes.push({
                name: attrName,
                value: source.slice(at + 1, close).trim(),
                expression: true,
            })
            at = close + 1
            continue
        }

        const quote = source[at]
        if (quote === '"' || quote === "'") {
            const close = source.indexOf(quote, at + 1)
            if (close === -1)
                return {
                    name,
                    attributes,
                    selfClosing: false,
                    end: source.length,
                }
            attributes.push({
                name: attrName,
                value: source.slice(at + 1, close),
                expression: false,
            })
            at = close + 1
            continue
        }
        const valueStart = at
        while (at < source.length && /[^\s>]/.test(source[at] as string))
            at += 1
        attributes.push({
            name: attrName,
            value: source.slice(valueStart, at),
            expression: false,
        })
    }
    return { name, attributes, selfClosing: false, end: at }
}

// The index of the `}` closing the `{` at `open`. Braces nest and strings are skipped, so
// `{f('}')}` and `{ { a: 1 } }` both end where they read as ending.
function readExpression(source: string, open: number): number {
    let depth = 0
    let at = open
    while (at < source.length) {
        const char = source[at]
        if (char === '"' || char === "'" || char === '`') {
            at = skipString(source, at)
            continue
        }
        if (char === '{') depth += 1
        else if (char === '}') {
            depth -= 1
            if (depth === 0) return at
        }
        at += 1
    }
    return source.length
}

function skipString(source: string, open: number): number {
    const quote = source[open]
    let at = open + 1
    while (at < source.length) {
        if (source[at] === '\\') {
            at += 2
            continue
        }
        if (source[at] === quote) return at + 1
        at += 1
    }
    return at
}

// 33.17 and 33.18. A whitespace run with a newline and no space or tab is dropped wherever it
// stands; one that also carries indentation is dropped only at the ends of a body, where it is
// the author's layout rather than a space the document asked for.
function collapseWhitespace(children: TemplateNode[]): void {
    for (let i = children.length - 1; i >= 0; i -= 1) {
        const node = children[i] as TemplateNode
        if (node.kind === 'element') {
            collapseWhitespace(node.children)
            continue
        }
        if (node.kind !== 'text' || node.text.trim() !== '') continue
        if (!node.text.includes('\n')) continue
        const indented = /[ \t]/.test(node.text)
        if (!indented || i === 0 || i === children.length - 1)
            children.splice(i, 1)
    }
}
