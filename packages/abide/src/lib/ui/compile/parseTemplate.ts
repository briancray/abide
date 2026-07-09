import { AbideCompileError } from './AbideCompileError.ts'
import { decodeHtmlEntities } from './decodeHtmlEntities.ts'
import { interpolatedTemplateLiteral } from './interpolatedTemplateLiteral.ts'
import { isWhitespaceText } from './isWhitespaceText.ts'
import type { TemplateAttr } from './types/TemplateAttr.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import type { TextPart } from './types/TextPart.ts'
import { VOID_TAGS } from './VOID_TAGS.ts'

/* Compiled once — the parser tests these per source character, so a per-call literal
   would recompile them across the whole template scan. */
const WHITESPACE = /\s/
const WHITESPACE_OR_GT = /[\s>]/
const ATTR_NAME_END = /[\s=>/]/
const TAG_NAME_END = /[\s>/]/
const UPPERCASE_START = /^[A-Z]/
const AWAIT_PREFIX = /^await\b/
const LEADING_KEYWORD = /^\s*(\S+)/

/*
A minimal compile-time parser for the abide template subset: elements, text with
`{expr}` interpolation, static/`{expr}`/`on<event>={expr}` attributes, and
`{#if}/{#for}/{#await}/{#switch}/{#try}` block control flow. Not a full HTML parser — it covers what
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

    /* A per-parse counter minting the synthetic binding name for each `{await expr}`
       interpolation — `__await0`, `__await1`, … — so every desugared block in this
       component binds a distinct, collision-safe local. Reset per parse, so the first
       interpolation of any component is always `__await0`. */
    let awaitInterpolationCount = 0

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

    /* True when the cursor sits on a standalone `{await …}` interpolation — a braced
       expression whose first token is a top-level `await`. Peeks WITHOUT consuming
       (skips whitespace after `{`, then matches `await` on a word boundary), so the
       scan loops can route it to `readAwaitInterpolation` before falling to `readText`.
       A `{#`/`{:`/`{/` block token is not interpolation, so it is excluded. */
    function atAwaitInterpolation(): boolean {
        if (source.charAt(cursor) !== '{') {
            return false
        }
        const next = source.charAt(cursor + 1)
        if (next === '#' || next === ':' || next === '/') {
            return false
        }
        let index = cursor + 1
        while (index < source.length && WHITESPACE.test(source.charAt(index))) {
            index += 1
        }
        /* `await` at depth 0 with a following word boundary — spares `awaiting`/`awaitable`. */
        return (
            source.startsWith('await', index) && !/\w/.test(source.charAt(index + 'await'.length))
        )
    }

    /* Reads a `{await expr}` interpolation and desugars it to a BLOCKING `await` node —
       equivalent to `{#await expr then __awaitN}{__awaitN}{/await}`. The leading `await`
       token is stripped from the expression (it marks the syntactic await, not part of
       the promise); the resolved value binds a fresh synthetic name and renders as the
       block's sole text child. No new node kind or codegen — the synthesised node flows
       through the same blocking-await machinery the explicit block uses. */
    function readAwaitInterpolation(): TemplateNode {
        const { code, loc } = readBracedExpression()
        const afterAwait = code.slice('await'.length)
        const promise = afterAwait.trim()
        if (promise === '') {
            throw new AbideCompileError('[abide] {await …} requires an expression to await', loc)
        }
        /* `loc` points at the leading `await`; advance past it (and any whitespace) so the
           node's `loc` aligns with the promise expression — the shadow source-map invariant
           (source text at `loc` equals the emitted code). The synthetic binding has no source
           position, so its `asLoc` and the reading text part's `loc` stay undefined. */
        const promiseLoc =
            loc + 'await'.length + (afterAwait.length - afterAwait.trimStart().length)
        const binding = `__await${awaitInterpolationCount++}`
        return {
            kind: 'await',
            promise,
            blocking: true,
            as: binding,
            children: [{ kind: 'text', parts: [{ kind: 'expression', code: binding }] }],
            loc: promiseLoc,
            asLoc: undefined,
        }
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
        return (
            source.startsWith('<style', cursor) && WHITESPACE_OR_GT.test(source.charAt(cursor + 6))
        )
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

    /* `{children()}` is the slot fill point — the content a parent passed (a component)
       or the route chain below (a layout). It parses to the SAME node the retired `<slot>`
       element produced, so every downstream helper that branches on `tag === 'slot'` is
       unchanged. */
    const CHILDREN_CALL = /^\{\s*children\s*\(\s*\)\s*\}/
    function atChildrenCall(): boolean {
        return source.charAt(cursor) === '{' && CHILDREN_CALL.test(source.slice(cursor))
    }
    function readChildrenCall(): TemplateNode {
        cursor = source.indexOf('}', cursor) + 1 // consume `{children()}`
        return { kind: 'element', tag: 'slot', attrs: [], children: [] }
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
        const match = body.match(LEADING_KEYWORD)
        return match?.[1] ?? ''
    }

    /* Reads a `{#…}` control block: the open token, its children up to a continuation
       `{:…}` (a branch) or close `{/…}`, recursing. Emits `if`/`each`/`await`/`switch`/`try`
       nodes with their `case`/`branch` children — the same TemplateNode kinds the back-ends
       and `skeletonContext` consume. */
    function readBlock(): TemplateNode {
        const open = readBlockToken() // sigil is '#'
        const keyword = headKeyword(open.body)
        if (keyword === 'if') {
            const start = open.body.indexOf('if') + 2
            const condition = open.body.slice(start).trim()
            if (condition === '') {
                throw new Error('[abide] {#if} requires a condition expression')
            }
            const children = readBlockChildren('if')
            return { kind: 'if', condition, children, loc: exprLoc(open.loc, open.body, start) }
        }
        if (keyword === 'for') {
            const head = parseForHead(open.body, open.loc)
            const children = readBlockChildren('for')
            return {
                kind: 'each',
                items: head.items,
                as: head.as,
                index: head.index,
                key: head.key,
                async: head.async,
                children,
                loc: head.loc,
                asLoc: head.asLoc,
                keyLoc: head.keyLoc,
                indexLoc: head.indexLoc,
            }
        }
        if (keyword === 'await') {
            const start = open.body.indexOf('await') + 5
            const afterAwait = open.body.slice(start)
            const thenAt = keywordAtDepthZero(afterAwait, 'then')
            const promise = (thenAt === -1 ? afterAwait : afterAwait.slice(0, thenAt)).trim()
            if (promise === '') {
                throw new Error('[abide] {#await} requires a promise expression')
            }
            const as =
                thenAt === -1
                    ? undefined
                    : afterAwait.slice(thenAt + 'then'.length).trim() || undefined
            const children = readBlockChildren('await')
            return {
                kind: 'await',
                promise,
                blocking: thenAt !== -1,
                as,
                children,
                loc: exprLoc(open.loc, open.body, start),
                asLoc:
                    as === undefined
                        ? undefined
                        : exprLoc(open.loc, open.body, start + thenAt + 'then'.length),
            }
        }
        if (keyword === 'switch') {
            const start = open.body.indexOf('switch') + 6
            const subject = open.body.slice(start).trim()
            if (subject === '') {
                throw new Error('[abide] {#switch} requires a subject expression')
            }
            const children = readBlockChildren('switch')
            return { kind: 'switch', subject, children, loc: exprLoc(open.loc, open.body, start) }
        }
        if (keyword === 'try') {
            const children = readBlockChildren('try')
            return { kind: 'try', children }
        }
        if (keyword === 'snippet') {
            const head = open.body.slice(open.body.indexOf('snippet') + 'snippet'.length).trim()
            const parenAt = head.indexOf('(')
            const name = (parenAt === -1 ? head : head.slice(0, parenAt)).trim()
            if (name === '') {
                throw new Error('[abide] {#snippet} requires a name, e.g. {#snippet row(item)}')
            }
            /* Params ride the parens: `{#snippet row({ item })}` → `{ item }`. */
            const params =
                parenAt === -1
                    ? undefined
                    : head.slice(parenAt + 1, head.lastIndexOf(')')).trim() || undefined
            const children = readBlockChildren('snippet')
            return {
                kind: 'snippet',
                name,
                params,
                children,
                loc:
                    parenAt === -1
                        ? undefined
                        : exprLoc(open.loc, open.body, open.body.indexOf('(') + 1),
            }
        }
        throw new Error(
            `[abide] unknown control block {#${keyword}} — expected if/for/await/switch/try/snippet`,
        )
    }

    /* Shared scan body for block/branch child loops. Reads one node at the current
       cursor position and pushes it onto `nodes`. Returns false when the caller's
       terminator fires (caller decides what to do next); returns true while scanning
       continues. `onBranch` fires when `{:` is seen — block-children consume it as a
       new branch node; branch-children let the caller exit instead. */
    function scanNode(nodes: TemplateNode[], onBranch: (() => boolean) | undefined): boolean {
        /* Branch/close tokens — delegate to the caller's terminator logic. */
        if (source.startsWith('{/', cursor)) {
            return false
        }
        if (source.startsWith('{:', cursor)) {
            return onBranch === undefined ? false : onBranch()
        }
        if (atBlock()) {
            nodes.push(readBlock())
        } else if (atChildrenCall()) {
            nodes.push(readChildrenCall())
        } else if (atAwaitInterpolation()) {
            nodes.push(readAwaitInterpolation())
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
       INCLUDING the case/branch nodes, producing the same TemplateNode tree the back-ends consume. */
    function readBlockChildren(keyword: string): TemplateNode[] {
        const nodes: TemplateNode[] = []
        while (cursor < source.length) {
            const keepGoing = scanNode(nodes, () => {
                nodes.push(readBranch(keyword))
                return true
            })
            if (!keepGoing) {
                const close = readBlockToken() // consume the close `{/keyword}`
                const closeKeyword = headKeyword(close.body)
                /* The close must name its open block — a mismatch (`{#if}…{/for}`) or
                   crossed nesting (`{#if}{#for}…{/if}{/for}`) would otherwise silently
                   mis-parse into a structurally wrong tree. */
                if (closeKeyword !== keyword) {
                    throw new Error(
                        `[abide] {/${closeKeyword}} does not close the open {#${keyword}} — expected {/${keyword}}`,
                    )
                }
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
                const start = token.body.indexOf('if') + 2
                const condition = token.body.slice(start).trim()
                if (condition === '') {
                    throw new Error('[abide] {:else if} requires a condition expression')
                }
                return {
                    kind: 'case',
                    match: undefined,
                    condition,
                    children: branchChildren,
                    loc: exprLoc(token.loc, token.body, start),
                }
            }
            if (keyword === 'else') {
                return { kind: 'case', match: undefined, children: branchChildren }
            }
        }
        if (parentKeyword === 'for' && keyword === 'catch') {
            const as = token.body.slice(token.body.indexOf('catch') + 5).trim() || undefined
            return {
                kind: 'branch',
                branch: 'catch',
                as,
                children: branchChildren,
                asLoc:
                    as === undefined
                        ? undefined
                        : exprLoc(token.loc, token.body, token.body.indexOf('catch') + 5),
            }
        }
        if (parentKeyword === 'switch') {
            if (keyword === 'case') {
                const start = token.body.indexOf('case') + 4
                const match = token.body.slice(start).trim()
                if (match === '') {
                    throw new Error('[abide] {:case} requires a value expression')
                }
                return {
                    kind: 'case',
                    match,
                    children: branchChildren,
                    loc: exprLoc(token.loc, token.body, start),
                }
            }
            if (keyword === 'default') {
                return { kind: 'case', match: undefined, children: branchChildren }
            }
        }
        if (parentKeyword === 'await') {
            if (keyword === 'then') {
                const as = token.body.slice(token.body.indexOf('then') + 4).trim() || undefined
                return {
                    kind: 'branch',
                    branch: 'then',
                    as,
                    children: branchChildren,
                    asLoc:
                        as === undefined
                            ? undefined
                            : exprLoc(token.loc, token.body, token.body.indexOf('then') + 4),
                }
            }
            if (keyword === 'catch') {
                const as = token.body.slice(token.body.indexOf('catch') + 5).trim() || undefined
                return {
                    kind: 'branch',
                    branch: 'catch',
                    as,
                    children: branchChildren,
                    asLoc:
                        as === undefined
                            ? undefined
                            : exprLoc(token.loc, token.body, token.body.indexOf('catch') + 5),
                }
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
                return {
                    kind: 'branch',
                    branch: 'catch',
                    as,
                    children: branchChildren,
                    asLoc:
                        as === undefined
                            ? undefined
                            : exprLoc(token.loc, token.body, token.body.indexOf('catch') + 5),
                }
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
        /* Pass undefined for onBranch so scanNode returns false on `{:`, leaving it unconsumed. */
        while (cursor < source.length && scanNode(nodes, undefined)) {
            // continue
        }
        return nodes
    }

    function readText(): TemplateNode {
        const parts: TextPart[] = []
        let literal = ''
        while (cursor < source.length && source.charAt(cursor) !== '<') {
            if (source.charAt(cursor) === '{') {
                if (atChildrenCall()) {
                    break // a slot fill point — handled by the enclosing scan loop
                }
                const next = source.charAt(cursor + 1)
                if (next === '#' || next === ':' || next === '/') {
                    break // a block/continuation/close token — not interpolation
                }
                if (atAwaitInterpolation()) {
                    break // a `{await …}` — read as its own node by the enclosing scan loop
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
            while (WHITESPACE.test(source.charAt(cursor))) {
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
            const nameLoc = baseOffset + cursor // absolute offset of the attribute name
            while (cursor < source.length && !ATTR_NAME_END.test(source.charAt(cursor))) {
                name += source.charAt(cursor)
                cursor += 1
            }
            while (WHITESPACE.test(source.charAt(cursor))) {
                cursor += 1
            }
            if (source.charAt(cursor) !== '=') {
                attrs.push({ kind: 'static', name, value: '', bare: true, nameLoc }) // boolean attribute
                continue
            }
            cursor += 1 // past '='
            while (WHITESPACE.test(source.charAt(cursor))) {
                cursor += 1
            }
            if (source.charAt(cursor) === '{') {
                const { code, loc } = readBracedExpression()
                if (name.startsWith('on')) {
                    attrs.push({ kind: 'event', event: name.slice(2), code, loc })
                } else if (name.startsWith('bind:')) {
                    attrs.push({ kind: 'bind', property: name.slice(5), code, loc })
                } else if (name.startsWith('class:')) {
                    attrs.push({ kind: 'class', name: name.slice(6), code, loc })
                } else if (name.startsWith('style:')) {
                    attrs.push({ kind: 'style', property: name.slice(6), code, loc })
                } else if (name === 'attach') {
                    attrs.push({ kind: 'attach', code, loc })
                } else {
                    attrs.push({ kind: 'expression', name, code, loc, nameLoc })
                }
            } else if (source.charAt(cursor) === '"' || source.charAt(cursor) === "'") {
                const quote = source.charAt(cursor)
                cursor += 1
                /* Scan the quoted span into static/`{expr}` parts (the text-node model),
                   reusing the brace/quote-aware expression reader so a `}` inside an
                   expression doesn't close the value early. */
                const parts: TextPart[] = []
                let literal = ''
                while (cursor < source.length && source.charAt(cursor) !== quote) {
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
                cursor += 1 // past closing quote
                if (literal !== '') {
                    parts.push({ kind: 'static', value: decodeHtmlEntities(literal) })
                }
                /* No `{expr}` → a plain static attribute; its literal is entity-decoded
                   like a text node (SSR/clone re-escape it), so a value such as `&amp;`
                   round-trips instead of double-escaping. Otherwise an interpolated value. */
                if (parts.every((part) => part.kind === 'static')) {
                    const value = parts
                        .map((part) => (part.kind === 'static' ? part.value : ''))
                        .join('')
                    attrs.push({ kind: 'static', name, value, nameLoc })
                } else {
                    attrs.push({ kind: 'interpolated', name, parts, nameLoc })
                }
            } else {
                /* Unquoted value (`<input type=text>`): runs to the next whitespace or
                   `>`, per the HTML unquoted-attribute rule. No delimiter to consume. */
                let value = ''
                while (cursor < source.length && !WHITESPACE_OR_GT.test(source.charAt(cursor))) {
                    /* Stop before a `/` that closes the tag (`<Comp x=y/>`) so the value
                       doesn't swallow the self-closing slash and defeat detection; a `/`
                       elsewhere (e.g. a URL `href=/a/b`) stays part of the value. */
                    if (source.charAt(cursor) === '/' && source.charAt(cursor + 1) === '>') {
                        break
                    }
                    value += source.charAt(cursor)
                    cursor += 1
                }
                /* Decode entities like the quoted path does — a real HTML parser decodes
                   unquoted attribute values too, so `value=a&amp;b` is the value `a&b`. */
                attrs.push({ kind: 'static', name, value: decodeHtmlEntities(value) })
            }
        }
        return attrs
    }

    function readElement(): TemplateNode {
        cursor += 1 // past '<'
        let tag = ''
        const tagStart = cursor // absolute (baseOffset-relative) offset of the tag name
        while (cursor < source.length && !TAG_NAME_END.test(source.charAt(cursor))) {
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
            /* Body starts at the current cursor; its absolute source offset lets the shadow
               map a diagnostic raised inside it (e.g. a top-level await) back to source. */
            const bodyLoc = baseOffset + cursor
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
            return { kind: 'script', code, loc: bodyLoc }
        }
        /* A capitalised tag is a child component; its attributes become props and
           its children become slot content (rendered where the child puts <slot>). */
        if (UPPERCASE_START.test(tag)) {
            const slotted = selfClosing ? [] : readChildren(tag)
            return {
                kind: 'component',
                name: tag,
                loc: baseOffset + tagStart,
                props: toProps(attrs),
                children: slotted,
            }
        }
        /* `{...expr}` spreads onto a component (its props) or a native element (its
           attributes), but a `<template>` directive has no such bag — reject it there. */
        if (tag === 'template' && attrs.some((attr) => attr.kind === 'spread')) {
            throw new Error('[abide] {...expr} spread is not supported on a <template> directive')
        }
        const children = selfClosing || VOID_TAGS.has(tag) ? [] : readChildren(tag)
        if (tag === 'slot') {
            throw new Error(
                '[abide] the <slot> element was removed — render passed content with {children()} (with {#if children}{children()}{:else}…{/if} for a fallback)',
            )
        }
        if (tag === 'template') {
            return toSnippetOrTemplate(attrs, children)
        }
        return { kind: 'element', tag, attrs, children }
    }

    /* A `{:…}`/`{/…}` reached OUTSIDE a block (the root scan or an element's children —
       not readBlockChildren/readBranchChildren, which consume their own) is a continuation
       or close with no open `{#…}`. Surface it as an error: readText breaks on `{:`/`{/`
       without advancing, so falling through would loop forever. */
    function throwIfStrayBranch(): void {
        if (source.startsWith('{:', cursor) || source.startsWith('{/', cursor)) {
            const end = source.indexOf('}', cursor)
            const token = source.slice(cursor, end === -1 ? source.length : end + 1)
            throw new Error(`[abide] ${token} has no open {#…} block`)
        }
    }

    function readChildren(closeTag: string): TemplateNode[] {
        const nodes: TemplateNode[] = []
        while (cursor < source.length) {
            if (source.startsWith(`</${closeTag}`, cursor)) {
                cursor = source.indexOf('>', cursor) + 1
                break
            }
            throwIfStrayBranch()
            if (source.startsWith('<!--', cursor)) {
                skipComment()
            } else if (atStyleTag()) {
                nodes.push(readStyle())
            } else if (atBlock()) {
                nodes.push(readBlock())
            } else if (atChildrenCall()) {
                nodes.push(readChildrenCall())
            } else if (atAwaitInterpolation()) {
                nodes.push(readAwaitInterpolation())
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
        throwIfStrayBranch()
        if (source.startsWith('<!--', cursor)) {
            skipComment()
        } else if (atStyleTag()) {
            roots.push(readStyle())
        } else if (atBlock()) {
            roots.push(readBlock())
        } else if (atChildrenCall()) {
            roots.push(readChildrenCall())
        } else if (atAwaitInterpolation()) {
            roots.push(readAwaitInterpolation())
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

/* Index of a bare keyword (`then`) at brace/paren/bracket depth 0, requiring whitespace
   on both sides — so it isn't matched inside an identifier (`q.then(x)`) and MAY sit
   terminally. Unlike ` of `/` by `, an await `then` can end the head: `{#await p then}`
   is a blocking await with no value binding, which a trailing-space match would miss
   (folding `then` into the promise). Skips string literals. -1 if absent. */
function keywordAtDepthZero(text: string, word: string): number {
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
        } else if (
            depth === 0 &&
            text.startsWith(word, i) &&
            i > 0 &&
            WHITESPACE.test(text.charAt(i - 1)) &&
            (i + word.length === text.length || WHITESPACE.test(text.charAt(i + word.length)))
        ) {
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

/* Absolute source offset of the trimmed expression beginning at `start` within a
   directive `body` whose first char is at absolute `bodyLoc` — skips the leading
   whitespace `.trim()` drops so the offset points at the expression's first real char
   (the shadow source-map invariant: source text at `loc` equals the emitted code). */
function exprLoc(bodyLoc: number, body: string, start: number): number {
    const raw = body.slice(start)
    return bodyLoc + start + (raw.length - raw.trimStart().length)
}

/* Parses `for [await] <binding>[, <index>] of <iterable> [by <key>]`. Offsets are
   tracked against the original `body` (not trimmed slices) so `loc` points at the
   iterable expression's first char — `bodyLoc` is the absolute offset of `body[0]`. */
function parseForHead(
    body: string,
    bodyLoc: number,
): {
    items: string
    as: string
    index: string | undefined
    key: string | undefined
    async: boolean
    loc: number
    asLoc: number | undefined
    keyLoc: number | undefined
    indexLoc: number | undefined
} {
    const leadingSpace = (text: string): number => text.length - text.trimStart().length
    const skipSpace = (i: number): number => {
        let at = i
        while (at < body.length && WHITESPACE.test(body.charAt(at))) {
            at += 1
        }
        return at
    }
    let bindingStart = skipSpace(body.indexOf('for') + 3)
    const isAsync = AWAIT_PREFIX.test(body.slice(bindingStart))
    if (isAsync) {
        bindingStart = skipSpace(bindingStart + 'await'.length)
    }
    const region = body.slice(bindingStart)
    const ofAt = indexOfKeywordAtDepthZero(region, ' of ')
    if (ofAt === -1) {
        throw new Error('[abide] {#for} requires `<binding> of <iterable>`')
    }
    const left = region.slice(0, ofAt).trim()
    const itemsStart = skipSpace(bindingStart + ofAt + ' of '.length)
    let itemsRegion = body.slice(itemsStart)
    const byAt = indexOfKeywordAtDepthZero(itemsRegion, ' by ')
    const keyRaw = byAt === -1 ? '' : itemsRegion.slice(byAt + ' by '.length)
    const key = byAt === -1 ? undefined : keyRaw.trim()
    const keyLoc =
        byAt === -1 ? undefined : bodyLoc + itemsStart + byAt + ' by '.length + leadingSpace(keyRaw)
    if (byAt !== -1) {
        itemsRegion = itemsRegion.slice(0, byAt)
    }
    const commaAt = bindingCommaAtDepthZero(left)
    const as = (commaAt === -1 ? left : left.slice(0, commaAt)).trim()
    const indexRaw = commaAt === -1 ? '' : left.slice(commaAt + 1)
    const index = commaAt === -1 ? undefined : indexRaw.trim()
    /* `left` is trimmed and starts at `bindingStart` (skipSpace'd), so the binding
       name begins exactly there; the index sits past the comma. */
    return {
        items: itemsRegion.trim(),
        as: as === '' ? '_item' : as,
        index,
        key,
        async: isAsync,
        loc: bodyLoc + itemsStart,
        asLoc: as === '' ? undefined : bodyLoc + bindingStart,
        keyLoc,
        indexLoc:
            commaAt === -1
                ? undefined
                : bodyLoc + bindingStart + commaAt + 1 + leadingSpace(indexRaw),
    }
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
): { name: string; code: string; loc?: number; nameLoc?: number; spread?: boolean }[] {
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
            return {
                name: attr.name,
                code: attr.bare ? 'true' : JSON.stringify(attr.value),
                nameLoc: attr.nameLoc,
            }
        }
        /* `label="hi {name}"` — a string-valued prop, the template-literal concatenation
           of its parts (lowered downstream like any other prop value). */
        if (attr.kind === 'interpolated') {
            return {
                name: attr.name,
                code: interpolatedTemplateLiteral(attr.parts),
                nameLoc: attr.nameLoc,
            }
        }
        /* A `bind:<name>={target}` is a two-way prop under its BARE name (`value`, not
           `bind:value`): the back-ends pass it with a write-back channel so the child can
           push changes upstream (`bindProp`), and the child upgrades it to a writable cell
           (`bindableProp`) when it writes or forwards it. */
        if (attr.kind === 'bind') {
            return { name: attr.property, code: attr.code, loc: attr.loc, bind: true as const }
        }
        /* Every other non-static kind keeps its `code`/`loc`; only the prop name differs —
           a directive (`event`/`class`/`style`/`attach`) round-trips to its written name as
           a passthrough prop. */
        const name =
            attr.kind === 'event'
                ? `on${attr.event}`
                : attr.kind === 'class'
                  ? `class:${attr.name}`
                  : attr.kind === 'style'
                    ? `style:${attr.property}`
                    : attr.kind === 'attach'
                      ? 'attach'
                      : attr.name
        /* Only `expression` carries a name offset; event/attach are framework-handled
           passthrough excluded from the strict prop check, so theirs is unused. */
        const nameLoc = attr.kind === 'expression' ? attr.nameLoc : undefined
        return { name, code: attr.code, loc: attr.loc, nameLoc }
    })
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
    if (attr.kind === 'class') {
        return `class:${attr.name}`
    }
    if (attr.kind === 'style') {
        return `style:${attr.property}`
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

/* The control-flow attribute names that used to drive `<template>` directives — now
   moved to `{#…}` blocks. A `<template>` carrying one is a migration error. */
const CONTROL_DIRECTIVES = new Set([
    'if',
    'elseif',
    'else',
    'each',
    'await',
    'then',
    'catch',
    'finally',
    'switch',
    'case',
    'default',
    'try',
])

/* A `<template>` is now ONLY a plain inert element (e.g. client-side cloning).
   Snippet declarations moved to `{#snippet name(args)}…{/snippet}` blocks; control
   flow moved to `{#…}` blocks — both throw migration errors here. */
function toSnippetOrTemplate(attrs: TemplateAttr[], children: TemplateNode[]): TemplateNode {
    const find = (name: string) => attrs.find((attr) => attrName(attr) === name)
    const directive = attrs.find((attr) => CONTROL_DIRECTIVES.has(attrName(attr)))
    if (directive !== undefined) {
        const name = attrName(directive)
        const block = name === 'elseif' || name === 'else' ? 'if' : name
        throw new Error(
            `[abide] <template ${name}> control flow was removed — use the {#${block}…} block instead`,
        )
    }
    /* `<template name>` snippet declarations were retired for the `{#snippet name(args)}`
       block — reject with a migration error. */
    if (find('name') !== undefined) {
        throw new Error(
            '[abide] <template name> snippet declarations were removed — use a {#snippet name(args)}…{/snippet} block',
        )
    }
    /* A plain inert `<template>` element (e.g. client-side cloning) — keep as an element. */
    return { kind: 'element', tag: 'template', attrs, children }
}
