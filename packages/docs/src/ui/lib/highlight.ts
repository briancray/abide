// Compact, dependency-free SSR syntax highlighter for TypeScript and `.abide` markup. Emits HTML
// with `<span class="tok-*">` wrappers so a docs page can render it via `{html(highlight(code,
// lang))}`. It is a pragmatic tokenizer — not a full parser — tuned for readable, correct-enough
// highlighting of the small demo snippets the docs show, in both light and dark themes.

const KEYWORDS: ReadonlySet<string> = new Set([
    'import',
    'from',
    'export',
    'default',
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'of',
    'in',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'new',
    'typeof',
    'instanceof',
    'await',
    'async',
    'yield',
    'class',
    'extends',
    'this',
    'super',
    'try',
    'catch',
    'finally',
    'throw',
    'void',
    'delete',
    'true',
    'false',
    'null',
    'undefined',
    'as',
    'interface',
    'type',
    'enum',
    'implements',
    'public',
    'private',
    'protected',
    'readonly',
    'static',
    'get',
    'set',
])

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function span(kind: string, text: string): string {
    return `<span class="tok-${kind}">${escapeHtml(text)}</span>`
}

function isIdentifierStart(ch: string): boolean {
    return /[A-Za-z_$]/.test(ch)
}

function isIdentifierPart(ch: string): boolean {
    return /[A-Za-z0-9_$]/.test(ch)
}

// Highlights a run of JavaScript/TypeScript source (also used for the inside of `.abide` `{…}`).
function highlightJs(code: string): string {
    let out = ''
    let position = 0
    const length = code.length
    while (position < length) {
        const ch = code.charAt(position)
        if (ch === '/' && code[position + 1] === '/') {
            let end = position + 2
            while (end < length && code[end] !== '\n') end++
            out += span('comment', code.slice(position, end))
            position = end
            continue
        }
        if (ch === '/' && code[position + 1] === '*') {
            let end = position + 2
            while (end < length && !(code[end] === '*' && code[end + 1] === '/')) end++
            end = Math.min(length, end + 2)
            out += span('comment', code.slice(position, end))
            position = end
            continue
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            let end = position + 1
            while (end < length) {
                if (code[end] === '\\') {
                    end += 2
                    continue
                }
                if (code[end] === ch) {
                    end++
                    break
                }
                end++
            }
            out += span('string', code.slice(position, end))
            position = end
            continue
        }
        if (ch >= '0' && ch <= '9') {
            let end = position
            while (end < length && /[0-9._eExXa-fA-F]/.test(code.charAt(end))) end++
            out += span('number', code.slice(position, end))
            position = end
            continue
        }
        if (isIdentifierStart(ch)) {
            let end = position
            while (end < length && isIdentifierPart(code.charAt(end))) end++
            const word = code.slice(position, end)
            if (KEYWORDS.has(word)) out += span('keyword', word)
            else if (code[end] === '(') out += span('fn', word)
            else out += escapeHtml(word)
            position = end
            continue
        }
        out += escapeHtml(ch)
        position++
    }
    return out
}

// Highlights a single `.abide`/HTML tag, e.g. `<button onclick={() => count++} class="x">`. Brace
// attribute values are re-highlighted as JS; `>` inside `{…}` or quotes does not end the tag.
function highlightTag(raw: string): string {
    let out = `<span class="tok-punct">&lt;</span>`
    let position = 1
    const length = raw.length
    if (raw[position] === '/') {
        out += `<span class="tok-punct">/</span>`
        position++
    }
    let end = position
    while (end < length && /[A-Za-z0-9_.:-]/.test(raw.charAt(end))) end++
    out += span('tag', raw.slice(position, end))
    position = end
    while (position < length) {
        const ch = raw.charAt(position)
        if (ch === '>') {
            out += `<span class="tok-punct">&gt;</span>`
            position++
            continue
        }
        if (ch === '/' && raw[position + 1] === '>') {
            out += `<span class="tok-punct">/&gt;</span>`
            position += 2
            continue
        }
        if (ch === '{') {
            let depth = 0
            let brace = position
            while (brace < length) {
                if (raw[brace] === '{') depth++
                else if (raw[brace] === '}') {
                    depth--
                    if (depth === 0) {
                        brace++
                        break
                    }
                }
                brace++
            }
            out += `<span class="tok-brace">{</span>${highlightJs(raw.slice(position + 1, brace - 1))}<span class="tok-brace">}</span>`
            position = brace
            continue
        }
        if (ch === '"' || ch === "'") {
            let quote = position + 1
            while (quote < length && raw[quote] !== ch) quote++
            quote = Math.min(length, quote + 1)
            out += span('string', raw.slice(position, quote))
            position = quote
            continue
        }
        if (/[A-Za-z_@:]/.test(ch)) {
            let attr = position
            while (attr < length && /[A-Za-z0-9_@:.-]/.test(raw.charAt(attr))) attr++
            out += span('attr', raw.slice(position, attr))
            position = attr
            continue
        }
        out += escapeHtml(ch)
        position++
    }
    return out
}

// Highlights the inside of a `.abide` `{…}` region, tagging leading control markers (`#if`, `:else`,
// `/for`) and highlighting the remainder as JS.
function highlightBrace(inner: string): string {
    const match = inner.match(/^(\s*)([#:/][A-Za-z]+)(.*)$/s)
    if (match) {
        const [, indent = '', marker = '', rest = ''] = match
        return `${indent}${span('block', marker)}${highlightJs(rest)}`
    }
    return highlightJs(inner)
}

// Highlights `.abide` markup: tags, attributes, `{…}` template expressions, and `<!-- comments -->`.
function highlightAbide(code: string): string {
    let out = ''
    let position = 0
    const length = code.length
    while (position < length) {
        const ch = code.charAt(position)
        if (code.startsWith('<!--', position)) {
            const close = code.indexOf('-->', position)
            const end = close === -1 ? length : close + 3
            out += span('comment', code.slice(position, end))
            position = end
            continue
        }
        if (ch === '{') {
            let depth = 0
            let brace = position
            while (brace < length) {
                if (code[brace] === '{') depth++
                else if (code[brace] === '}') {
                    depth--
                    if (depth === 0) {
                        brace++
                        break
                    }
                }
                brace++
            }
            out += `<span class="tok-brace">{</span>${highlightBrace(code.slice(position + 1, brace - 1))}<span class="tok-brace">}</span>`
            position = brace
            continue
        }
        if (ch === '<' && /[A-Za-z/]/.test(code[position + 1] ?? '')) {
            let depth = 0
            let tag = position + 1
            while (tag < length) {
                const c = code.charAt(tag)
                if (c === '{') depth++
                else if (c === '}') depth--
                else if ((c === '"' || c === "'") && depth === 0) {
                    tag++
                    while (tag < length && code[tag] !== c) tag++
                } else if (c === '>' && depth === 0) {
                    tag++
                    break
                }
                tag++
            }
            out += highlightTag(code.slice(position, tag))
            position = tag
            continue
        }
        let text = position
        while (text < length && code[text] !== '<' && code[text] !== '{') text++
        out += escapeHtml(code.slice(position, text))
        position = text
    }
    return out
}

export function highlight(code: string, lang: string): string {
    if (lang === 'abide' || lang === 'html') return highlightAbide(code)
    return highlightJs(code)
}
