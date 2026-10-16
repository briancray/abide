import { importedNames } from './splitImports.ts'
import { TEMPLATE_BLOCKS } from './TEMPLATE_BLOCKS.ts'

/**
 * What the markup at a cursor is waiting for: a block keyword after `{#`, `{:` or `{/`, a component
 * tag after `<`, or an attribute inside a component's tag — `typed` being what is written of it so
 * far. `undefined` in a script, a style, an expression, or text, which is the checker's to answer.
 */
export type TemplateContext =
    | { kind: 'block'; typed: string; offered: string[] }
    | { kind: 'tag'; typed: string; offered: string[] }
    | { kind: 'attribute'; tag: string; typed: string; written: string[] }

/**
 * 38.117 — the template completion a cursor at `offset` in a `.abide`'s `text` stands in.
 *
 * READ OFF THE TEXT, NOT A PARSE: a tag or a block being typed is exactly the text the parser
 * refuses, so the markup is scanned from the last script or style before the cursor.
 */
export function templateContext(
    text: string,
    offset: number,
): TemplateContext | undefined {
    const markup = markupStart(text, offset)
    if (markup === -1) return undefined
    let depth = 0
    let braceAt = -1
    let tagAt = -1
    for (let at = markup; at < offset; at += 1) {
        const char = text[at]
        if (depth > 0) {
            if (char === '{') depth += 1
            else if (char === '}') depth -= 1
            else if (char === '"' || char === "'" || char === '`')
                at = quoteEnd(text, at, offset)
            continue
        }
        if (char === '{') {
            depth = 1
            braceAt = at
        } else if (tagAt !== -1) {
            if (char === '>') tagAt = -1
            else if (char === '"' || char === "'")
                at = quoteEnd(text, at, offset)
        } else if (char === '<' && /[A-Za-z/]/.test(text[at + 1] ?? '')) {
            tagAt = at
        } else if (char === '<' && at + 1 === offset) tagAt = at
    }
    if (depth > 0) {
        const block = /^\{([#:/])([a-z ]*)$/.exec(text.slice(braceAt, offset))
        if (block === null) return undefined
        return {
            kind: 'block',
            typed: block[2] as string,
            offered: blocksAfter(block[1] as string, text, braceAt),
        }
    }
    if (tagAt === -1) return undefined
    const tag = text.slice(tagAt, offset)
    const name = /^<([A-Za-z][\w$.]*)?$/.exec(tag)
    if (name !== null)
        return {
            kind: 'tag',
            typed: name[1] ?? '',
            offered: componentsIn(text),
        }
    const component = /^<([A-Z][\w$]*)\s/.exec(tag)
    const typing = /\s([\w$-]*)$/.exec(tag)
    if (component === null || typing === null) return undefined
    const written: string[] = []
    // The values written so far, taken out, leave the names.
    const names = tag
        .slice(component[0].length, tag.length - (typing[1] as string).length)
        .replace(/"[^"]*"|'[^']*'|\{[^{}]*\}/g, ' ')
    for (const found of names.matchAll(/[A-Za-z_$][\w$:-]*/g))
        written.push(found[0])
    return {
        kind: 'attribute',
        tag: component[1] as string,
        typed: typing[1] as string,
        written,
    }
}

/** Where the markup holding `offset` starts, or -1 where `offset` is inside a script or a style. */
function markupStart(text: string, offset: number): number {
    let start = 0
    const lower = text.toLowerCase()
    const opened = /<(script|style)\b[^>]*>/gi
    for (;;) {
        const open = opened.exec(text)
        if (open === null || open.index >= offset) return start
        const body = open.index + open[0].length
        const close = lower.indexOf(
            `</${(open[1] as string).toLowerCase()}`,
            body,
        )
        if (offset >= body && (close === -1 || offset <= close)) return -1
        if (close === -1) return -1
        start = text.indexOf('>', close) + 1
        opened.lastIndex = start
    }
}

/** The offset of the quote closing the one at `at`, or the last one before `limit`. */
function quoteEnd(text: string, at: number, limit: number): number {
    const quote = text[at]
    for (let next = at + 1; next < limit; next += 1) {
        if (text[next] === '\\') next += 1
        else if (text[next] === quote) return next
    }
    return limit
}

/**
 * The keywords that may follow `sigil`: every block after `{#`, and after `{:` and `{/` the arms and
 * the close of the innermost block still open before `at` — every one where none is.
 */
function blocksAfter(sigil: string, text: string, at: number): string[] {
    const blocks = Object.keys(TEMPLATE_BLOCKS)
    if (sigil === '#') return blocks
    const open: string[] = []
    const marks = new RegExp(`\\{([#/])(${blocks.join('|')})(?![\\w$])`, 'g')
    for (const mark of text.slice(0, at).matchAll(marks)) {
        if (mark[1] === '#') open.push(mark[2] as string)
        else if (open[open.length - 1] === mark[2]) open.pop()
    }
    const innermost = open[open.length - 1]
    if (sigil === '/') return innermost === undefined ? blocks : [innermost]
    if (innermost !== undefined) return [...(TEMPLATE_BLOCKS[innermost] ?? [])]
    const arms: string[] = []
    for (const block of blocks) arms.push(...(TEMPLATE_BLOCKS[block] ?? []))
    return arms
}

/**
 * The components a tag in `text` may name: each TitleCase name its scripts import, and each
 * `{#component}` it declares (32.41).
 */
function componentsIn(text: string): string[] {
    const names = new Set<string>()
    for (const script of text.matchAll(
        /<script\b[^>]*>([\s\S]*?)(?:<\/script|$)/gi,
    ))
        for (const { name } of importedNames(script[1] as string))
            if (/^[A-Z]/.test(name)) names.add(name)
    for (const found of text.matchAll(/\{#component\s+([A-Z][\w$]*)/g))
        names.add(found[1] as string)
    return [...names]
}
