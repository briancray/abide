// 34.4, 34.5 — A COMPONENT'S `<style>`, SCOPED TO THE COMPONENT. Every element the component authors
// carries its scope token as a bare attribute, and every selector in its styles requires the token on
// its rightmost compound — so a rule in one component cannot reach an element another component wrote,
// and `:global(…)` is the one way to ask it to.
//
// THE TOKEN IS AN ATTRIBUTE rather than a class, because the `class` attribute is the author's and
// `class:` directives merge into it (32.10) — a token there would be one more writer of a value three
// mechanisms already share.

import { isComponentTag, isSlot } from './classifyTemplate.ts'
import { childListsOf, type TemplateNode } from './TemplateNode.ts'
import { skipQuoted } from './tokenise.ts'

// What never carries a token: a document-level tag, and the tags a head contributes. The head's
// own contributions never reach here — `parseAbide` splits them off the template.
const UNSCOPED = new Set([
    'html',
    'body',
    'script',
    'style',
    'title',
    'meta',
    'link',
    'base',
])

/** The scope token for the component at `relative`: `a-` and six base-36 characters of its hash. */
export function scopeToken(relative: string): string {
    return `a-${Bun.hash(relative).toString(36).slice(0, 6)}`
}

/**
 * Adds the scope token to every element the component authors; returns each styled body's CSS and
 * token.
 *
 * The token is added as a static bare attribute — so the server's markup, a row the browser builds
 * and hydration all carry it with nothing added to any of them.
 *
 * 34.11 — AND A BODY WITH A `<style>` OF ITS OWN adds a token of its own to every element it holds,
 * beside the component's and any enclosing body's, so its rules reach that body and nothing else
 * the component wrote. Numbered in the order the walk meets them, which is the file's, so a body's
 * token is stable across builds.
 */
export function markScoped(
    nodes: TemplateNode[],
    token: string,
    tokens: string[] = [token],
    bodies: { css: string; token: string }[] = [],
): { css: string; token: string }[] {
    for (const node of nodes) {
        if (node.kind === 'block') {
            const arms = node.block === 'for' ? [node] : node.branches
            for (const arm of arms) {
                let own = tokens
                if (arm.style !== null) {
                    const body = `${token}-${bodies.length}`
                    bodies.push({ css: arm.style, token: body })
                    own = [...tokens, body]
                }
                markScoped(arm.children, token, own, bodies)
            }
            continue
        }
        for (const children of childListsOf(node))
            markScoped(children, token, tokens, bodies)
        if (node.kind !== 'element') continue
        // A child's own elements are the child's; what the caller passes between its tags is the
        // caller's, and is marked as the caller's.
        const own =
            !isComponentTag(node.tag) &&
            !isSlot(node) &&
            !UNSCOPED.has(node.lowerTag)
        if (own)
            for (const each of tokens)
                node.attributes.push({
                    name: each,
                    lowerName: each,
                    value: '',
                    expression: false,
                })
    }
    return bodies
}

/** The styles, every selector made to require the token. */
export function scopeCss(css: string, token: string): string {
    return scopeRules(css, `[${token}]`)
}

/**
 * Whether a stylesheet names a view transition.
 *
 * 39.7 — a `view-transition-*` property, a `::view-transition*` pseudo-element or an
 * `@view-transition` rule. Comments and strings are skipped, so a rule that was commented out, or a
 * `content:` that spells the words, turns nothing on.
 */
export function namesViewTransition(css: string): boolean {
    for (let at = 0; at < css.length; at += 1) {
        const past = skipOpaque(css, at)
        if (past !== at) {
            at = past - 1
            continue
        }
        if (
            css.startsWith('view-transition', at) &&
            !/[\w-]/.test(css[at - 1] ?? '')
        )
            return true
    }
    return false
}

// The block at-rules that hold rules, which `scopeRules` walks into.
const NESTING =
    /^@(media|supports|container|layer|document|starting-style|scope)\b/i

/**
 * `css` with every selector at every level made to require `attribute`.
 *
 * Statements at one level: declarations, at-rules, and qualified rules whose preludes are selector
 * lists. Block at-rules holding rules — `@media`, `@supports`, `@container`, `@layer`,
 * `@document`, `@starting-style`, `@scope` — are walked into; every other at-rule is copied as
 * written, a `@keyframes`' selectors being percentages rather than elements.
 *
 * A QUALIFIED RULE'S BODY IS WALKED TOO, because CSS nests: `.card { .title {…} }` is `.card .title`,
 * and a nested selector left as written reaches a child component's `.title` inside the card. A
 * declaration is a statement ending at its `;` or at the body's end, so it is copied as it stands.
 */
function scopeRules(css: string, attribute: string): string {
    let out = ''
    let at = 0
    while (at < css.length) {
        const open = nextOf(css, at, '{;')
        if (open === -1) {
            out += css.slice(at)
            break
        }
        const prelude = css.slice(at, open)
        if (css[open] === ';') {
            out += css.slice(at, open + 1)
            at = open + 1
            continue
        }
        const close = matching(css, open)
        const body = css.slice(open + 1, close)
        const trimmed = prelude.trim()
        if (trimmed.startsWith('@'))
            out += NESTING.test(trimmed)
                ? `${prelude}{${scopeRules(body, attribute)}}`
                : `${prelude}{${body}}`
        else
            out += `${scopeSelectorList(prelude, attribute)}{${scopeRules(body, attribute)}}`
        at = close + 1
    }
    return out
}

/** The index of the next of `stops` at depth zero, outside strings and comments, or -1. */
function nextOf(css: string, from: number, stops: string): number {
    let depth = 0
    for (let at = from; at < css.length; at += 1) {
        const past = skipOpaque(css, at)
        if (past !== at) {
            at = past - 1
            continue
        }
        const char = css[at] as string
        if (char === '(' || char === '[') depth += 1
        else if (char === ')' || char === ']') depth -= 1
        else if (depth === 0 && stops.includes(char)) return at
    }
    return -1
}

/** The offset past the comment or string starting at `at`, or `at` when neither does. */
function skipOpaque(css: string, at: number): number {
    const char = css[at]
    if (char === '/' && css[at + 1] === '*') {
        const end = css.indexOf('*/', at + 2)
        return end === -1 ? css.length : end + 2
    }
    if (char === '"' || char === "'") return skipQuoted(css, at)
    return at
}

/** The index of the `}` closing the block the `{` at `open` opens. */
function matching(css: string, open: number): number {
    let depth = 0
    for (let at = open; at < css.length; at += 1) {
        const past = skipOpaque(css, at)
        if (past !== at) {
            at = past - 1
            continue
        }
        const char = css[at] as string
        if (char === '{') depth += 1
        else if (char === '}') {
            depth -= 1
            if (depth === 0) return at
        }
    }
    return css.length
}

function scopeSelectorList(list: string, attribute: string): string {
    const selectors: string[] = []
    let from = 0
    for (;;) {
        const comma = nextOf(list, from, ',')
        const one = list.slice(from, comma === -1 ? list.length : comma)
        selectors.push(scopeSelector(one, attribute))
        if (comma === -1) break
        from = comma + 1
    }
    return selectors.join(',')
}

/**
 * One selector with the token on its rightmost compound and every `:global(…)` unwrapped.
 *
 * 34.4 — THE RIGHTMOST COMPOUND carries the token, ahead of any pseudo-element; 34.5 — one inside
 * `:global(…)` does not, and every `:global(…)` is unwrapped to what it holds.
 */
function scopeSelector(selector: string, attribute: string): string {
    const lead = selector.match(/^\s*/)?.[0] ?? ''
    const trail = selector.match(/\s*$/)?.[0] ?? ''
    const body = selector.trim()
    if (body === '') return selector
    const split = lastCombinator(body)
    const before = body.slice(0, split)
    const compound = body.slice(split)
    const scoped = compound.startsWith(':global(')
        ? unwrapGlobal(compound)
        : withToken(unwrapGlobal(compound), attribute)
    return `${lead}${unwrapGlobal(before)}${scoped}${trail}`
}

/**
 * Where the rightmost compound starts: just past the last combinator at depth zero.
 *
 * A comment ends a compound and is never inside one, so its own spaces are not combinators.
 */
function lastCombinator(selector: string): number {
    let depth = 0
    let start = 0
    for (let at = 0; at < selector.length; at += 1) {
        const past = skipOpaque(selector, at)
        if (past !== at) {
            if (selector[at] === '/') start = past
            at = past - 1
            continue
        }
        const char = selector[at] as string
        if (char === '(' || char === '[') depth += 1
        else if (char === ')' || char === ']') depth -= 1
        else if (
            depth === 0 &&
            (char === ' ' ||
                char === '\n' ||
                char === '\t' ||
                char === '>' ||
                char === '+' ||
                char === '~')
        )
            start = at + 1
    }
    return start
}

const PSEUDO_ELEMENT = /::|:(before|after|first-line|first-letter)\b/i

function withToken(compound: string, attribute: string): string {
    const pseudo = compound.search(PSEUDO_ELEMENT)
    if (pseudo === -1) return compound + attribute
    return compound.slice(0, pseudo) + attribute + compound.slice(pseudo)
}

function unwrapGlobal(text: string): string {
    let out = ''
    let at = 0
    for (;;) {
        const found = text.indexOf(':global(', at)
        if (found === -1) return out + text.slice(at)
        out += text.slice(at, found)
        let depth = 0
        let end = found + ':global('.length
        for (; end < text.length; end += 1) {
            if (text[end] === '(') depth += 1
            else if (text[end] === ')') {
                if (depth === 0) break
                depth -= 1
            }
        }
        out += text.slice(found + ':global('.length, end)
        at = end + 1
    }
}
