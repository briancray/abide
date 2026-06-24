import { decodeHtmlEntities } from './decodeHtmlEntities.ts'
import { isWhitespaceText } from './isWhitespaceText.ts'
import type { TemplateAttr } from './types/TemplateAttr.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import type { TextPart } from './types/TextPart.ts'
import { VOID_TAGS } from './VOID_TAGS.ts'

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

/* A line-leading static `import` in a nested script body. The `(?=\s)` requires
   whitespace after the keyword (sparing `import.meta` and no-space `import(...)`),
   and `(?!\s*\()` spares a dynamic `import (...)` written with whitespace before the
   paren — both legitimate lazy paths — so only a true static import statement matches. */
const NESTED_STATIC_IMPORT = /^[ \t]*import(?=\s)(?!\s*\()/m

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

    /* True when the cursor sits on a block-directive open `{#`. A `{:`/`{/` is only
       valid INSIDE a block (consumed by readBlockChildren), so at top level it would be
       a stray-branch error — handled where blocks are read, not here. */
    function atBlock(): boolean {
        return source.charAt(cursor) === '{' && source.charAt(cursor + 1) === '#'
    }

    /* Reads a `{#…}` / `{:…}` / `{/…}` token starting on `{`. Tracks string literals
       and nested braces (same scan as readBracedExpression) so a brace/quote inside an
       expression (`{#if obj.has('}')}`) doesn't end the token early. Returns the sigil,
       the trimmed directive body WITHOUT the sigil, and the absolute loc of the body's
       first post-trim char. */
    function readBlockToken(): { sigil: '#' | ':' | '/'; body: string; loc: number } {
        const sigil = source.charAt(cursor + 1) as '#' | ':' | '/'
        cursor += 2 // past `{` and the sigil
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
        return { sigil, body: raw.trim(), loc: baseOffset + start + leading }
    }

    /* The leading keyword of a directive body (`if`, `for`, `await`, `switch`, `try`,
       `else`, `then`, `catch`, `finally`, `case`, `default`). */
    function headKeyword(body: string): string {
        const match = body.match(/^\s*(\S+)/)
        return match === undefined || match === null ? '' : match[1]
    }

    /* Reads a `{#…}` control block: the open token, its children up to a continuation
       `{:…}` (a branch) or close `{/…}`, recursing. Emits the same nodes toControlFlow
       does today (if/each/await/switch/try + case/branch children). */
    function readBlock(): TemplateNode {
        const open = readBlockToken() // sigil is '#'
        const keyword = headKeyword(open.body)
        if (keyword === 'if') {
            const condition = open.body.slice(open.body.indexOf('if') + 2).trim()
            if (condition === '') {
                throw new Error('[abide] {#if} requires a condition expression')
            }
            const children = readBlockChildren('if')
            return {
                kind: 'if',
                condition,
                children,
                loc: open.loc + (open.body.indexOf('if') + 2),
            }
        }
        if (keyword === 'for') {
            const head = parseForHead(open.body)
            const children = readBlockChildren('for')
            return {
                kind: 'each',
                items: head.items,
                as: head.as,
                index: head.index,
                key: head.key,
                async: head.async,
                children,
                loc: open.loc,
            }
        }
        if (keyword === 'await') {
            const afterAwait = open.body.slice(open.body.indexOf('await') + 5).trim()
            const thenAt = indexOfKeywordAtDepthZero(afterAwait, ' then ')
            const promise = (thenAt === -1 ? afterAwait : afterAwait.slice(0, thenAt)).trim()
            if (promise === '') {
                throw new Error('[abide] {#await} requires a promise expression')
            }
            const as =
                thenAt === -1
                    ? undefined
                    : afterAwait.slice(thenAt + ' then '.length).trim() || undefined
            const children = readBlockChildren('await')
            return { kind: 'await', promise, blocking: thenAt !== -1, as, children, loc: open.loc }
        }
        if (keyword === 'switch') {
            const subject = open.body.slice(open.body.indexOf('switch') + 6).trim()
            if (subject === '') {
                throw new Error('[abide] {#switch} requires a subject expression')
            }
            const children = readBlockChildren('switch')
            return { kind: 'switch', subject, children, loc: open.loc }
        }
        if (keyword === 'try') {
            const children = readBlockChildren('try')
            return { kind: 'try', children }
        }
        throw new Error(
            `[abide] unknown control block {#${keyword}} — expected if/for/await/switch/try`,
        )
    }

    /* Shared scan body for block/branch child loops. Reads one node at the current
       cursor position and pushes it onto `nodes`. Returns false when the caller's
       terminator fires (caller decides what to do next); returns true while scanning
       continues. `onBranch` fires when `{:` is seen — block-children consume it as a
       new branch node; branch-children let the caller exit instead. */
    function scanNode(nodes: TemplateNode[], onBranch: (() => boolean) | null): boolean {
        /* Branch/close tokens — delegate to the caller's terminator logic. */
        if (source.startsWith('{/', cursor)) {
            return false
        }
        if (source.startsWith('{:', cursor)) {
            return onBranch === null ? false : onBranch()
        }
        if (atBlock()) {
            nodes.push(readBlock())
        } else if (source.startsWith('<!--', cursor)) {
            skipComment()
        } else if (atStyleTag()) {
            nodes.push(readStyle())
        } else if (source.charAt(cursor) === '<') {
            nodes.push(readElement())
        } else {
            nodes.push(readText())
        }
        return true
    }

    /* Reads children of a block until its close `{/<keyword>}`. A continuation token
       `{:…}` ends the current branch's children and starts a new `case`/`branch` node
       (per construct). The leading children (before the first `{:…}`) are the block's
       own children (the `if`/`await`/`try` then-content). Returns the full children list
       INCLUDING the case/branch nodes, matching toControlFlow's output. */
    function readBlockChildren(keyword: string): TemplateNode[] {
        const nodes: TemplateNode[] = []
        while (cursor < source.length) {
            const keepGoing = scanNode(nodes, () => {
                nodes.push(readBranch(keyword))
                return true
            })
            if (!keepGoing) {
                readBlockToken() // consume the close `{/keyword}`
                return nodes
            }
        }
        throw new Error(`[abide] unterminated {#${keyword}} block — missing {/${keyword}}`)
    }

    /* Reads a continuation token `{:…}` and the children up to the NEXT continuation or
       close, returning the branch node for the parent construct. Handles `if`-chain
       branches (else / else if) and `for await` catch branches. */
    function readBranch(parentKeyword: string): TemplateNode {
        const token = readBlockToken() // sigil ':'
        const keyword = headKeyword(token.body)
        const branchChildren = readBranchChildren()
        if (parentKeyword === 'if') {
            if (keyword === 'else' && headKeyword(token.body.slice(4).trim()) === 'if') {
                const condition = token.body.slice(token.body.indexOf('if') + 2).trim()
                return { kind: 'case', match: undefined, condition, children: branchChildren }
            }
            if (keyword === 'else') {
                return { kind: 'case', match: undefined, children: branchChildren }
            }
        }
        if (parentKeyword === 'for' && keyword === 'catch') {
            const as = token.body.slice(token.body.indexOf('catch') + 5).trim() || undefined
            return { kind: 'branch', branch: 'catch', as, children: branchChildren }
        }
        if (parentKeyword === 'switch') {
            if (keyword === 'case') {
                const match = token.body.slice(token.body.indexOf('case') + 4).trim()
                if (match === '') {
                    throw new Error('[abide] {:case} requires a value expression')
                }
                return { kind: 'case', match, children: branchChildren }
            }
            if (keyword === 'default') {
                return { kind: 'case', match: undefined, children: branchChildren }
            }
        }
        if (parentKeyword === 'await') {
            if (keyword === 'then') {
                const as = token.body.slice(token.body.indexOf('then') + 4).trim() || undefined
                return { kind: 'branch', branch: 'then', as, children: branchChildren }
            }
            if (keyword === 'catch') {
                const as = token.body.slice(token.body.indexOf('catch') + 5).trim() || undefined
                return { kind: 'branch', branch: 'catch', as, children: branchChildren }
            }
            if (keyword === 'finally') {
                return {
                    kind: 'branch',
                    branch: 'finally',
                    as: undefined,
                    children: branchChildren,
                }
            }
        }
        if (parentKeyword === 'try') {
            if (keyword === 'catch') {
                const as = token.body.slice(token.body.indexOf('catch') + 5).trim() || undefined
                return { kind: 'branch', branch: 'catch', as, children: branchChildren }
            }
            if (keyword === 'finally') {
                return {
                    kind: 'branch',
                    branch: 'finally',
                    as: undefined,
                    children: branchChildren,
                }
            }
        }
        throw new Error(`[abide] {:${keyword}} is not valid inside {#${parentKeyword}}`)
    }

    /* Children of a branch: read until the next `{:…}` or `{/…}` WITHOUT consuming it
       (the caller's readBlockChildren loop handles those). */
    function readBranchChildren(): TemplateNode[] {
        const nodes: TemplateNode[] = []
        /* Pass null for onBranch so scanNode returns false on `{:`, leaving it unconsumed. */
        while (cursor < source.length && scanNode(nodes, null)) {
            // continue
        }
        return nodes
    }

    function readText(): TemplateNode {
        const parts: TextPart[] = []
        let literal = ''
        while (cursor < source.length && source.charAt(cursor) !== '<') {
            if (source.charAt(cursor) === '{') {
                const next = source.charAt(cursor + 1)
                if (next === '#' || next === ':' || next === '/') {
                    break // a block/continuation/close token — not interpolation
                }
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
            /* `{...expr}` standing where an attribute name would — a spread of an object's
               keys onto the tag: props on a component, attributes on a native element. Only
               a `<template>` directive rejects it (see `readElement`). */
            if (char === '{') {
                const { code, loc } = readBracedExpression()
                if (!code.startsWith('...')) {
                    throw new Error(
                        `[abide] a bare {expr} is not a valid attribute — write {...expr} to spread an object's keys as props`,
                    )
                }
                /* Advance `loc` past `...` and any whitespace so it points at the spread
                   EXPRESSION, not the dots — the shadow source-map invariant (source text at
                   `loc` equals the emitted code) requires `loc` and `code` to align. */
                const inner = code.slice(3)
                const leading = inner.length - inner.trimStart().length
                attrs.push({ kind: 'spread', code: inner.trim(), loc: loc + 3 + leading })
                continue
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
                attrs.push({ kind: 'static', name, value: '', bare: true }) // boolean attribute
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
                } else if (name === 'attach') {
                    attrs.push({ kind: 'attach', code, loc })
                } else {
                    attrs.push({ kind: 'expression', name, code, loc })
                }
            } else if (source.charAt(cursor) === '"' || source.charAt(cursor) === "'") {
                const quote = source.charAt(cursor)
                cursor += 1
                let value = ''
                while (cursor < source.length && source.charAt(cursor) !== quote) {
                    value += source.charAt(cursor)
                    cursor += 1
                }
                cursor += 1 // past closing quote
                attrs.push({ kind: 'static', name, value })
            } else {
                /* Unquoted value (`<input type=text>`): runs to the next whitespace or
                   `>`, per the HTML unquoted-attribute rule. No delimiter to consume. */
                let value = ''
                while (cursor < source.length && !/[\s>]/.test(source.charAt(cursor))) {
                    /* Stop before a `/` that closes the tag (`<Comp x=y/>`) so the value
                       doesn't swallow the self-closing slash and defeat detection; a `/`
                       elsewhere (e.g. a URL `href=/a/b`) stays part of the value. */
                    if (source.charAt(cursor) === '/' && source.charAt(cursor + 1) === '>') {
                        break
                    }
                    value += source.charAt(cursor)
                    cursor += 1
                }
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
            /* A static `import` can't live here: a nested script compiles INTO the
               branch's render-function body, where an import is illegal — and an
               import nested in a branch falsely implies conditional/lazy loading ES
               imports can't do (they hoist module-wide and load unconditionally). The
               leading `<script>` hoists imports to module scope for the whole template,
               so they belong there. The pattern spares dynamic `import(...)` (with or
               without whitespace) and `import.meta` — the real lazy paths. */
            if (NESTED_STATIC_IMPORT.test(code)) {
                throw new Error(
                    "import statements must live in the component's leading <script>, not a nested <template> script — they hoist to module scope for the whole template. For lazy loading, use a dynamic import() inside an effect.",
                )
            }
            return { kind: 'script', code }
        }
        /* A capitalised tag is a child component; its attributes become props and
           its children become slot content (rendered where the child puts <slot>). */
        if (/^[A-Z]/.test(tag)) {
            const slotted = selfClosing ? [] : readChildren(tag)
            return { kind: 'component', name: tag, props: toProps(attrs), children: slotted }
        }
        /* `{...expr}` spreads onto a component (its props) or a native element (its
           attributes), but a `<template>` directive has no such bag — reject it there. */
        if (tag === 'template' && attrs.some((attr) => attr.kind === 'spread')) {
            throw new Error('[abide] {...expr} spread is not supported on a <template> directive')
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
            } else if (atBlock()) {
                nodes.push(readBlock())
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
        } else if (atBlock()) {
            roots.push(readBlock())
        } else if (source.charAt(cursor) === '<') {
            roots.push(readElement())
        } else {
            roots.push(readText())
        }
    }
    rejectStrayBranches(roots, undefined)
    return { nodes: roots }
}

/* Finds the index of a ` <token> ` keyword (` of `, ` by `) at brace/paren/bracket
   depth 0, scanning left to right, skipping string literals. Returns -1 if absent. */
function indexOfKeywordAtDepthZero(text: string, keyword: string): number {
    let depth = 0
    let i = 0
    while (i < text.length) {
        const char = text.charAt(i)
        if (char === '"' || char === "'" || char === '`') {
            i += 1
            while (i < text.length && text.charAt(i) !== char) {
                if (text.charAt(i) === '\\') {
                    i += 1
                }
                i += 1
            }
        } else if (char === '{' || char === '(' || char === '[') {
            depth += 1
        } else if (char === '}' || char === ')' || char === ']') {
            depth -= 1
        } else if (depth === 0 && text.startsWith(keyword, i)) {
            return i
        }
        i += 1
    }
    return -1
}

/* The depth-0 comma index in a binding (`{id, title}, i` → the comma after `}`),
   so a destructuring pattern's inner commas don't split the binding from its index. */
function bindingCommaAtDepthZero(text: string): number {
    let depth = 0
    let i = 0
    while (i < text.length) {
        const char = text.charAt(i)
        if (char === '{' || char === '(' || char === '[') {
            depth += 1
        } else if (char === '}' || char === ')' || char === ']') {
            depth -= 1
        } else if (char === ',' && depth === 0) {
            return i
        }
        i += 1
    }
    return -1
}

/* Parses `for [await] <binding>[, <index>] of <iterable> [by <key>]`. */
function parseForHead(body: string): {
    items: string
    as: string
    index: string | undefined
    key: string | undefined
    async: boolean
} {
    let rest = body.slice(body.indexOf('for') + 3).trim()
    const isAsync = /^await\b/.test(rest)
    if (isAsync) {
        rest = rest.slice('await'.length).trim()
    }
    const ofAt = indexOfKeywordAtDepthZero(rest, ' of ')
    if (ofAt === -1) {
        throw new Error('[abide] {#for} requires `<binding> of <iterable>`')
    }
    const left = rest.slice(0, ofAt).trim()
    let right = rest.slice(ofAt + ' of '.length).trim()
    const byAt = indexOfKeywordAtDepthZero(right, ' by ')
    const key = byAt === -1 ? undefined : right.slice(byAt + ' by '.length).trim()
    if (byAt !== -1) {
        right = right.slice(0, byAt).trim()
    }
    const commaAt = bindingCommaAtDepthZero(left)
    const as = (commaAt === -1 ? left : left.slice(0, commaAt)).trim()
    const index = commaAt === -1 ? undefined : left.slice(commaAt + 1).trim()
    return { items: right, as: as === '' ? '_item' : as, index, key, async: isAsync }
}

/* A `case` node (`<template else>`/`<template case>`/`<template default>`) is valid
   only as a direct child of its `<template if>`/`<template switch>`; a `branch`
   (`then`/`catch`/`finally`) only inside its `<template await>`/`<template try>`.
   A sibling `<template else>` — closed off from its `if` — parses to a stray `case`
   sitting beside the `if`, which would otherwise be silently dropped. Reject it so
   the mistake surfaces at compile time. Recurses so a stray branch nested anywhere
   is caught, not just at the root. */
function rejectStrayBranches(
    nodes: TemplateNode[],
    parentKind: TemplateNode['kind'] | undefined,
): void {
    for (const node of nodes) {
        if (node.kind === 'case' && parentKind !== 'if' && parentKind !== 'switch') {
            throw new Error(
                '[abide] <template else>/<template case> must be nested inside its <template if>/<template switch> — a sibling branch is not supported',
            )
        }
        /* `elseif` is an `if`-chain branch; inside a `switch` it would silently read as the
           default (match-less), so reject the cross-construct mix. */
        if (node.kind === 'case' && node.condition !== undefined && parentKind === 'switch') {
            throw new Error(
                '[abide] <template elseif> belongs to a <template if> chain, not a <template switch> — use <template case>',
            )
        }
        if (
            node.kind === 'branch' &&
            parentKind !== 'await' &&
            parentKind !== 'try' &&
            parentKind !== 'each'
        ) {
            throw new Error(
                '[abide] <template then>/<template catch>/<template finally> must be nested inside its <template await>/<template try>/<template each await>',
            )
        }
        if (node.kind === 'if' || node.kind === 'switch') {
            rejectMisplacedBranchContent(node)
        }
        if ('children' in node) {
            rejectStrayBranches(node.children, node.kind)
        }
    }
}

/* A `<template if>` chain's `then` content precedes its first branch tag
   (`elseif`/`else`); a `<template switch>` renders only its branch tags. So rendered
   content sitting AFTER the first branch in an `if` — or ANYWHERE in a `switch` —
   belongs to no branch: today it silently folds into `then` / is dropped. Reject it so
   the misplacement surfaces. Whitespace stays transparent, and `<script>`/`<style>` are
   directives (scoping, not rendered output), so both remain legal anywhere. */
function rejectMisplacedBranchContent(
    node: Extract<TemplateNode, { kind: 'if' | 'switch' }>,
): void {
    const firstBranch = node.children.findIndex((child) => child.kind === 'case')
    node.children.forEach((child, index) => {
        const isRenderedContent =
            child.kind !== 'case' &&
            child.kind !== 'script' &&
            child.kind !== 'style' &&
            !isWhitespaceText(child)
        /* In a switch nothing but branches renders, so every position is illegal; in an if
           only content past the first branch is (the leading then-content is legal). */
        const illegalPosition =
            node.kind === 'switch' || (firstBranch !== -1 && index > firstBranch)
        if (isRenderedContent && illegalPosition) {
            throw new Error(
                node.kind === 'switch'
                    ? '[abide] a <template switch> renders only its <template case>/<template default> branches — move stray content into a branch'
                    : '[abide] content after a <template elseif>/<template else> belongs to no branch — the then-content must precede the first branch tag',
            )
        }
    })
    /* In an `if` chain the match-less `<template else>` is the trailing block, so any
       branch after it (a second `else`, or an `elseif`) compiles to invalid `} else {…}
       else if {…}` (SSR/type-shadow) or a silently-shadowed branch (the `switchBlock`
       default wins). Reject so the misordering surfaces here, not as opaque codegen. */
    if (node.kind === 'if') {
        const branches = node.children.filter(
            (child): child is Extract<TemplateNode, { kind: 'case' }> => child.kind === 'case',
        )
        const elseIndex = branches.findIndex(
            (branch) => branch.match === undefined && branch.condition === undefined,
        )
        if (elseIndex !== -1 && elseIndex < branches.length - 1) {
            throw new Error(
                '[abide] <template else> must be the last branch of its <template if> chain — no <template elseif>/<template else> may follow it',
            )
        }
    }
}

/* Turns a component's attributes into props. A component has no directives —
   every attribute is a prop under its written name, so `on*`/`bind:`/`attach`
   round-trip to their original names (the kinds the tag-blind attribute parser
   assigned) instead of being dropped. A static value becomes a string literal —
   a bare attribute coerces to `true` instead; every other kind keeps its `code`,
   letting a prop hold any value, functions included (e.g. an `onclick` callback). */
function toProps(
    attrs: TemplateAttr[],
): { name: string; code: string; loc?: number; spread?: boolean }[] {
    return attrs.map((attr) => {
        /* A `{...expr}` spread carries no name — its keys merge in at runtime
           (`mergeProps`/`spreadProps`); `spread: true` marks it for the back-ends. */
        if (attr.kind === 'spread') {
            return { name: '', code: attr.code, loc: attr.loc, spread: true }
        }
        if (attr.kind === 'static') {
            /* A bare attribute (`<Toggle on />`) is a boolean flag: coerce it to
               `true` so the prop reads as a boolean, not the empty string a native
               element would serialise. An explicit `on=""` stays the empty string. */
            return { name: attr.name, code: attr.bare ? 'true' : JSON.stringify(attr.value) }
        }
        /* Every non-static kind keeps its `code`/`loc`; only the prop name differs —
           a directive (`event`/`bind`/`attach`) round-trips to its written name. */
        const name =
            attr.kind === 'event'
                ? `on${attr.event}`
                : attr.kind === 'bind'
                  ? `bind:${attr.property}`
                  : attr.kind === 'attach'
                    ? 'attach'
                    : attr.name
        return { name, code: attr.code, loc: attr.loc }
    })
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
    if (attr.kind === 'attach') {
        return 'attach'
    }
    /* A spread has no name. `attrName` only feeds `<template>` directive lookups, and a
       spread on a `<template>` is rejected at parse, so this branch is unreachable in
       practice. (Spread itself IS supported — on components as props and on native
       elements as attributes; only `<template>` directives reject it.) */
    if (attr.kind === 'spread') {
        return ''
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
    /* `<template elseif={c}>` is a match-less case carrying a condition — a branch of the
       enclosing `<template if>` chain, truthy-tested in source order. */
    const elseif = find('elseif')
    if (elseif !== undefined) {
        const conditionCode = attrText(elseif)
        if (conditionCode === undefined) {
            throw new Error('[abide] <template elseif> requires a condition expression')
        }
        return {
            kind: 'case',
            match: undefined,
            condition: conditionCode,
            children,
            loc: attrLoc(elseif),
        }
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
    const index = find('index')
    return {
        kind: 'each',
        items: itemsCode,
        as: (as === undefined ? undefined : attrText(as)) ?? '_item',
        key: key === undefined ? undefined : attrText(key),
        index: index === undefined ? undefined : attrText(index),
        async: find('await') !== undefined, // `<template each await>` over an AsyncIterable
        children,
        loc: attrLoc(items),
    }
}
