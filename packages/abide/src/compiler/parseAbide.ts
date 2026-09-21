import { SyntaxKind } from 'typescript/unstable/ast'
import type { Attribute, Branch, TemplateNode } from './TemplateNode.ts'
import { isSpace, slotEnd, type Token, tokenise } from './tokenise.ts'
import { VOID_ELEMENTS } from './VOID_ELEMENTS.ts'

// A `.abide` file is a script, a style and a template, and this splits it into the three
// and parses the third. The expression grammar is NOT parsed here: `{expr}` is captured as
// source text and handed to the emitter verbatim, which is what keeps 19.12 a property of
// the file rather than a promise this parser has to keep.

export type AbideFile = {
    // `<script>` bodies in source order — per-instance setup, 34.1.
    scripts: string[]
    // `<script module>` bodies in source order — 34.2, request-local on a server and process-wide
    // in a browser. Apart from `scripts` because the two run a different number of times, which is
    // the whole of the clause.
    modules: string[]
    // `<style>` bodies in source order. Scoping is 34.3 and is not implemented yet.
    styles: string[]
    template: TemplateNode[]
}

// What an open level is when it is a control block's ARM rather than an element. Not a string, so
// no close tag — `<//>` and `</>` included — can name one.
const ARM = null

// The innermost open level that is a control block's arm, or 0 when none is open.
function armLevel(open: (string | null)[]): number {
    let level = open.length - 1
    while (level > 0 && open[level] !== ARM) level -= 1
    return level
}

// Pops `open` and `stack` together down to `level`, closing whatever the arm still holds open.
function unwindTo(
    level: number,
    open: (string | null)[],
    stack: TemplateNode[][],
): void {
    while (open.length > level) {
        open.pop()
        stack.pop()
    }
}

// ONE LEXICAL PASS. A `<script>` or `<style>` is only a tag where the walk below reaches it: a scan
// run ahead of the template has no idea what a position IS, and lifts the string literal out of
// `{ok ? "<script>boom()</script>" : ''}` into component setup — the author's text moved from a
// data position into an executable one.
export function parseAbide(source: string): AbideFile {
    const scripts: string[] = []
    const modules: string[] = []
    const styles: string[] = []
    const root: TemplateNode[] = []
    // The open elements, innermost last. `root` is the floor and is never popped.
    const stack: TemplateNode[][] = [root]
    // WHAT EACH OPEN LEVEL IS, so a close tag only closes the thing it names. Popping whatever is
    // innermost lets `</br>` end the `<p>` around it and a stray `{/if}` end the `<div>` around
    // it — the nodes after it then hang outside the element the author wrote them in, which is a
    // document nobody asked for and nothing about it says so. A `{#if}` arm is `ARM`, which no
    // tag name can be.
    const open: (string | null)[] = [ARM]
    // The open control blocks, so a `{:else}` knows which block it belongs to.
    const blocks: TemplateNode[] = []
    let at = 0

    while (at < source.length) {
        const children = stack[stack.length - 1] as TemplateNode[]
        const char = source[at]

        if (char === '<' && source[at + 1] === '/') {
            const close = source.indexOf('>', at)
            if (close === -1) break
            // An unmatched close tag is dropped rather than closing something else. Recovering
            // the way a browser does — closing every open element up to the match — is a second
            // parser, and refusing to guess is what keeps the tree the one the author wrote.
            //
            // MATCHED CASE-INSENSITIVELY, because an HTML tag name is. Compared as written,
            // `<div>x</DIV><footer>f</footer>` dropped the close tag and put the `<footer>` INSIDE
            // the div — while the browser re-parsing that markup closes at `</DIV>`, so every
            // child index after it addresses a different node and the page hydrates against the
            // wrong tree.
            const innermost = open[open.length - 1]
            if (
                typeof innermost === 'string' &&
                sameTag(innermost, source.slice(at + 2, close).trim())
            ) {
                stack.pop()
                open.pop()
            }
            at = close + 1
            continue
        }

        if (char === '<') {
            // A COMMENT AND A DOCTYPE ARE NOT TAGS, and `readTag` refuses both. Stepping over the
            // `<` it refused is what rendered `<!-- todo -->` as the visible text `!-- todo -->`
            // and turned `<!DOCTYPE html>` into one too.
            //
            // A COMMENT IS DROPPED RATHER THAN KEPT. It is a real `childNodes` entry, so keeping
            // one means `planTemplate` counting it and every emitter writing it, and the region
            // anchors are already the only comments the document carries (41.10). The document
            // loses the author's note and the two sides still agree on every index.
            if (source.startsWith('<!--', at)) {
                const close = source.indexOf('-->', at + 4)
                at = close === -1 ? source.length : close + 3
                continue
            }
            if (source.startsWith('<!', at)) {
                const close = source.indexOf('>', at)
                at = close === -1 ? source.length : close + 1
                continue
            }

            const tag = readTag(source, at)
            if (tag === undefined) {
                // A `<` THAT OPENS NO TAG IS TEXT. `<p>a < b</p>` lost its `<` to a parser that
                // stepped over what it could not read.
                at = pushText(children, source, at, at + 1)
                continue
            }

            // 34.1, 34.3 — a `<script>` or a `<style>` is the FILE's, not markup, and its body is
            // taken raw. Here rather than in a pass of its own: a scan that runs before the
            // template is parsed cannot tell a tag from the same characters inside a string in an
            // expression, and lifted the second into component setup.
            // LOWERCASED, for the reason the close tag above is: `<SCRIPT>let z = 1</SCRIPT>` was
            // not lifted, so the author's component setup was emitted into the served document as
            // a live inline script.
            const lowerTag = tag.name.toLowerCase()
            // 34.1 AND 34.2 ARE THE TWO FORMS A `<script>` BLOCK TAKES, AND EVERY OTHER `<script>`
            // IS MARKUP. `<script src="/a.js">` and `<script type="application/ld+json">` are
            // neither per-instance setup nor a module block — lifted into the component anyway,
            // their attributes were discarded and a JSON-LD body was emitted as a JavaScript
            // statement, so the module did not parse and the document lost the tag.
            //
            // A `<style>` HAS NO SECOND FORM — 34.3 makes every one of them the component's, with
            // no attribute deciding otherwise — so this is one rule about `<script>` rather than an
            // exception carved out of a rule about both.
            const block =
                lowerTag === 'style'
                    ? styles
                    : lowerTag === 'script'
                      ? scriptBlock(tag.attributes, scripts, modules)
                      : undefined
            if (lowerTag === 'script' || lowerTag === 'style') {
                const raw = rawBody(source, lowerTag, tag)
                if (block !== undefined) {
                    block.push(raw.body)
                    at = raw.end
                    continue
                }
                // A markup `<script>` keeps its attributes AND its body, and the body is TEXT
                // rather than template: a `{` in JavaScript is a block, and read as a slot it
                // takes the rest of the file with it.
                const kept: TemplateNode = {
                    kind: 'element',
                    tag: tag.name,
                    lowerTag,
                    attributes: tag.attributes,
                    children:
                        raw.body === ''
                            ? []
                            : [{ kind: 'text', text: raw.body }],
                }
                children.push(kept)
                at = raw.end
                continue
            }

            const element: TemplateNode = {
                kind: 'element',
                tag: tag.name,
                lowerTag,
                attributes: tag.attributes,
                children: [],
            }
            children.push(element)
            // The same rule again: `<BR>` read as an ordinary element was pushed onto the open
            // stack and swallowed the rest of the file as its children, and the emitter wrote a
            // `</BR>` no browser accepts.
            if (!tag.selfClosing && !VOID_ELEMENTS.has(lowerTag)) {
                stack.push(element.children)
                open.push(tag.name)
            }
            at = tag.end
            continue
        }

        if (char === '{') {
            const end = slotEnd(source, at)
            const inner = source.slice(at + 1, end).trim()

            // `{#if}`, `{:else}`, `{:else if}`, `{/if}` — a control block opens a new ARM rather
            // than a new element, so it keeps its own stack beside the element one.
            if (inner.startsWith('#if')) {
                const branch: Branch = {
                    subject: inner.slice(3).trim(),
                    children: [],
                }
                const block: TemplateNode = {
                    kind: 'block',
                    block: 'if',
                    branches: [branch],
                }
                children.push(block)
                blocks.push(block)
                stack.push(branch.children)
                open.push(ARM)
                at = end + 1
                continue
            }
            if (inner.startsWith(':else')) {
                const block = blocks[blocks.length - 1]
                if (
                    block !== undefined &&
                    block.kind === 'block' &&
                    block.block === 'if'
                ) {
                    const branch: Branch = {
                        // `{:else}` carries no condition, which is what makes it always take.
                        subject: elseSubject(inner),
                        children: [],
                    }
                    // UNWOUND TO THE ARM'S OWN LEVEL, for the reason `{/if}` below is: an
                    // element the author left open in the PREVIOUS arm sits above it, and
                    // popping one level left `open` naming that element while `stack` held the
                    // new arm — so its close tag popped the arm and every node after it landed
                    // in the first arm, which renders on the opposite condition.
                    unwindTo(armLevel(open), open, stack)
                    block.branches.push(branch)
                    stack.push(branch.children)
                    open.push(ARM)
                }
                at = end + 1
                continue
            }
            if (inner.startsWith('#for')) {
                const block = forBlock(inner.slice(4).trim())
                children.push(block)
                blocks.push(block)
                stack.push(block.children)
                open.push(ARM)
                at = end + 1
                continue
            }
            // A `{/if}` with no block open closes NOTHING — left to pop, it ends the element
            // around it and every node after it hangs outside.
            if (inner === '/for' || inner === '/if') {
                // UNWOUND TO THE ARM'S OWN LEVEL, because an element the author left open inside
                // the block sits above it. Requiring the arm to be innermost, `<div>{#if a}<b>x
                // {/if}</div><p>after</p>` closed NOTHING — the `</div>` then matched nothing
                // either, and the `<p>` landed inside the if-arm and vanished whenever the
                // condition was false. Closing whatever the block still holds open is what the
                // close tag of the element AROUND it would have to do anyway.
                const level = armLevel(open)
                if (blocks.length > 0 && level > 0) {
                    blocks.pop()
                    unwindTo(level, open, stack)
                }
                at = end + 1
                continue
            }

            children.push({ kind: 'expression', source: inner })
            at = end + 1
            continue
        }

        at = pushText(children, source, at, at)
    }

    collapseWhitespace(root)
    return { scripts, modules, styles, template: root }
}

// An HTML tag name is ASCII case-INSENSITIVE, so `</DIV>` closes a `<div>`. A component name is
// TitleCase (32.18) and an exact match is a case of this one, so there is no second rule here.
function sameTag(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase()
}

// WHICH BLOCK A `<script>` BELONGS TO, or `undefined` where it is markup. 34.1 is the bare tag and
// 34.2 is the bare `module` attribute; anything else on the tag — `src`, `type`, `defer`, `nonce` —
// is a `<script>` the author wrote for the DOCUMENT, and lifting it into component setup moves it
// out of the markup and throws its attributes away.
function scriptBlock(
    attributes: Attribute[],
    scripts: string[],
    modules: string[],
): string[] | undefined {
    if (attributes.length === 0) return scripts
    if (attributes.length > 1) return undefined
    const only = attributes[0] as Attribute
    // `<script module>` carries the marker and no value. `module="x"` names something else.
    if (only.lowerName !== 'module' || only.value !== '') return undefined
    return modules
}

// A RAW-TEXT ELEMENT'S BODY AND WHERE THE TAG ENDS. One answer for all three destinations, so a
// markup `<script>` and a `<script module>` cannot disagree about where the close tag was.
function rawBody(
    source: string,
    lowerTag: string,
    tag: { selfClosing: boolean; end: number },
): { body: string; end: number } {
    if (tag.selfClosing) return { body: '', end: tag.end }
    // The body ends at the first literal close tag, so a `</script>` inside a string in a script
    // block ends it early — the case is real and is not handled yet.
    const close = closeTagAt(source, lowerTag, tag.end)
    if (close === null)
        return { body: source.slice(tag.end), end: source.length }
    return { body: source.slice(tag.end, close.start), end: close.end }
}

// Where a raw-text block's close tag begins and ends, matched the way `sameTag` matches —
// `indexOf` over the literal spelling missed `</SCRIPT>` and ran the block to the end of the file.
//
// WHITESPACE IS LEGAL BEFORE THE `>`, and demanding it at a fixed offset was the same class of
// miss one layer down: `</script >` and `</style\n>` matched nothing, so the rest of the document
// became the script body and the template came back EMPTY. The ordinary close-tag path above
// already `trim()`s for this, which is one question with two answers until now — so the end is
// handed back rather than recomputed from the tag's length.
function closeTagAt(
    source: string,
    tag: string,
    from: number,
): { start: number; end: number } | null {
    for (let at = from; at < source.length; at += 1) {
        if (source[at] !== '<' || source[at + 1] !== '/') continue
        if (!sameTag(source.slice(at + 2, at + 2 + tag.length), tag)) continue
        let end = at + 2 + tag.length
        while (end < source.length && isSpace(source[end] as string)) end += 1
        if (source[end] !== '>') continue
        return { start: at, end: end + 1 }
    }
    return null
}

// A run of text from `at`, scanned from `from` — one node, so the `<` that opened no tag is
// carried by the run that follows it rather than becoming a node of its own.
function pushText(
    children: TemplateNode[],
    source: string,
    at: number,
    from: number,
): number {
    let next = from
    while (next < source.length && source[next] !== '<' && source[next] !== '{')
        next += 1
    const text = source.slice(at, next)
    // A browser MERGES adjacent text on parse, so the tree the client walks has one node here and
    // `planTemplate` counts one. The only way to produce two is the `<` that opened no tag, and
    // this is where that run rejoins the one before it.
    const last = children[children.length - 1]
    if (last?.kind === 'text') last.text += text
    else children.push({ kind: 'text', text })
    return next
}

// The condition on a `{:else …}` arm, or '' for the bare `{:else}` that always takes.
//
// A DIRECTIVE ENDS AT A WORD BOUNDARY. `startsWith` has none, so `{:elseif b}` was silently read
// as `{:else if b}` and `{:else ifValid}` as `{:else if}` over the subject `Valid` — a condition
// the author never wrote, deciding which arm renders.
function elseSubject(inner: string): string {
    const rest = inner.slice(':else'.length)
    if (rest.trim() === '') return ''
    const condition = /^\s+if(?=[\s(])([\s\S]*)$/.exec(rest)?.[1]?.trim()
    if (condition === undefined || condition === '')
        throw new Error(
            `abide: {${inner}} is not a control block. Write {:else} or {:else if <condition>}.`,
        )
    return condition
}

// `item, index of list by key` — `index` and `by` are optional, and everything after `of` up to
// a top-level `by` is the subject. Split on the KEYWORDS rather than on commas, because the
// subject may hold both.
//
// THE SEPARATOR IS THE ONE AT DEPTH ZERO AND OUTSIDE A STRING — all three of them, and each was
// wrong its own way. `{#for { id, name } of rows}` split on the pattern's own comma and the item
// became `{ id`, which the emitters write straight into a parameter list. `{#for x of
// names.filter(n => n !== "run by me")}` split on the ` by ` inside the string literal and the
// subject ended mid-quote. One scanner for all three rather than one fix for the comma.
function forBlock(
    source: string,
): TemplateNode & { kind: 'block'; block: 'for' } {
    // THE HEADER IS TOKENS, read by the scanner a slot is: an `of`, a `,` or a `by` inside a string,
    // a call or an object pattern is the expression's own, and only one at depth zero divides the
    // header. `by` is a word rather than a keyword, so a member named `by` is not one.
    const tokens = tokenise(source)
    let depth = 0
    let of: Token | undefined
    let comma: Token | undefined
    let by: Token | undefined
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index] as Token
        const kind = token.kind
        if (
            kind === SyntaxKind.OpenBraceToken ||
            kind === SyntaxKind.OpenBracketToken ||
            kind === SyntaxKind.OpenParenToken
        )
            depth += 1
        else if (
            kind === SyntaxKind.CloseBraceToken ||
            kind === SyntaxKind.CloseBracketToken ||
            kind === SyntaxKind.CloseParenToken
        )
            depth -= 1
        else if (depth !== 0) continue
        else if (of === undefined) {
            if (kind === SyntaxKind.OfKeyword) of = token
            else if (kind === SyntaxKind.CommaToken && comma === undefined)
                comma = token
        } else if (
            by === undefined &&
            kind === SyntaxKind.Identifier &&
            token.text === 'by' &&
            (tokens[index - 1] as Token).kind !== SyntaxKind.DotToken
        )
            by = token
    }
    // A `{#for}` with nothing to iterate rendered as a block over the subject '' — zero rows,
    // forever, with nothing saying why (32.23 is an ABSENT subject, not a missing one).
    if (of === undefined)
        throw new Error(
            `abide: {#for ${source}} has no \` of \`, so there is nothing to iterate. Write {#for item of list}.`,
        )
    const item = source.slice(0, (comma ?? of).start).trim()
    const index =
        comma === undefined ? '' : source.slice(comma.end, of.start).trim()
    // Refused here rather than papered over in each emitter: `{#for , i of rows}` has no binding
    // for the row, and `for (const  of …)` is a syntax error in a file nobody wrote.
    if (item === '')
        throw new Error(
            `abide: {#for ${source}} names no item, so a row has nothing to call itself. Write {#for item of list}.`,
        )
    return {
        kind: 'block',
        block: 'for',
        item,
        index,
        subject: source
            .slice(of.end, by === undefined ? source.length : by.start)
            .trim(),
        key: by === undefined ? '' : source.slice(by.end).trim(),
        children: [],
    }
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
    // A TAG NAME OPENS WITH AN ASCII LETTER, which is HTML's own production and not a case here.
    // Read as `[\w:-]`, `<p>a <3 b</p>` opened an element named `3` carrying the attribute `b<`,
    // swallowed the `</p>` and hung every node after it inside a phantom the browser never
    // creates — so `planTemplate` counted a child the document does not have and every path after
    // it in that parent is short by one. That is the one failure marker-free addressing cannot
    // survive: it binds to whatever is at the index, silently.
    if (!/[A-Za-z]/.test(source[at] ?? '')) return undefined
    while (at < source.length && /[\w:-]/.test(source[at] as string)) at += 1
    if (at === nameStart) return undefined
    const name = source.slice(nameStart, at)
    const attributes: Attribute[] = []

    while (at < source.length) {
        while (at < source.length && isSpace(source[at] as string)) at += 1
        if (source[at] === '>')
            return { name, attributes, selfClosing: false, end: at + 1 }
        if (source[at] === '/' && source[at + 1] === '>')
            return { name, attributes, selfClosing: true, end: at + 2 }

        const attrStart = at
        while (
            at < source.length &&
            !isSpace(source[at] as string) &&
            source[at] !== '=' &&
            source[at] !== '/' &&
            source[at] !== '>'
        )
            at += 1
        if (at === attrStart)
            return { name, attributes, selfClosing: false, end: at + 1 }
        const attrName = source.slice(attrStart, at)

        if (source[at] !== '=') {
            attributes.push(attribute(attrName, '', false))
            continue
        }
        at += 1

        // `attr={expr}` — the braces are found the same way a slot's are, so `onclick={f('}')}`
        // ends where it reads as ending.
        if (source[at] === '{') {
            const close = slotEnd(source, at)
            attributes.push(
                attribute(attrName, source.slice(at + 1, close).trim(), true),
            )
            at = close + 1
            continue
        }

        const quote = source[at]
        if (quote === '"' || quote === "'") {
            const close = source.indexOf(quote, at + 1)
            // AN UNCLOSED QUOTE ATE THE FILE. The tag was handed back ending at `source.length`,
            // so `<div class="card>` followed by a page yielded `<div>` with no children and the
            // whole remainder was dropped — the one failure a reader cannot see in the output,
            // because the output is a document that parses.
            if (close === -1)
                throw new Error(
                    `abide: the ${quote} opening ${attrName} on <${name}> is never closed, so the rest of the file reads as part of that attribute.`,
                )
            pushQuoted(attributes, attrName, source.slice(at + 1, close), name)
            at = close + 1
            continue
        }
        const valueStart = at
        while (
            at < source.length &&
            !isSpace(source[at] as string) &&
            source[at] !== '>'
        )
            at += 1
        // 32.3 HOLDS WHETHER OR NOT THE VALUE IS QUOTED. Pushed straight as a literal, a slot in
        // an unquoted value — `<a href=/x/{id}>` — was served as the author's own braces, never
        // lowered and never past the `safeUrl` 32.21 asks a URL attribute for.
        pushQuoted(attributes, attrName, source.slice(valueStart, at), name)
    }
    return { name, attributes, selfClosing: false, end: at }
}

// 32.3 — A QUOTED VALUE WITH A SLOT IN IT IS AN EXPRESSION. Captured as a literal,
// `class="badge {tone}"` wrote the braces into the document verbatim, so the page carried the
// author's source where a class was due.
//
// REWRITTEN AS A TEMPLATE LITERAL rather than given a parts array of its own, because that is one
// expression and the whole `class={expr}` path already takes one: lowered by `Lowering`,
// escaped by `escapeAttribute`, and scheme-checked by `safeUrl` where 32.21 asks for it. A second
// shape here would be a second copy of all three.
//
// 32.20 — AN INTERPOLATED `style` TAKES THE OTHER ROAD and lowers to one `style:prop` per
// declaration, which is why the split happens here, where the interpolated form is still told
// apart from the whole `style={expr}` one.
function pushQuoted(
    attributes: Attribute[],
    attrName: string,
    raw: string,
    tag: string,
): void {
    const expression = interpolated(raw)
    if (expression === undefined) {
        attributes.push(attribute(attrName, raw, false))
        return
    }
    if (attrName.toLowerCase() !== 'style') {
        attributes.push(attribute(attrName, expression, true))
        return
    }
    for (const declaration of splitTopLevel(raw, ';')) {
        if (declaration.trim() === '') continue
        const colon = colonAt(declaration)
        // A PROPERTY NAME IS STATIC. `style="{name}: red"` has no property to bind, and built as a
        // string it would let a value decide which property it sets.
        if (colon === -1 || declaration.slice(0, colon).includes('{'))
            throw new Error(
                `abide: an interpolated style on <${tag}> sets one property per declaration under a static name, and \`${declaration.trim()}\` has none. Write style:prop={value}. RULEBOOK 32.20.`,
            )
        const property = declaration.slice(0, colon).trim()
        if (property === '')
            throw new Error(
                `abide: an interpolated style on <${tag}> has a declaration with no property name. Write style:prop={value}. RULEBOOK 32.20.`,
            )
        const value = declaration.slice(colon + 1).trim()
        const slotted = interpolated(value)
        attributes.push(
            attribute(
                `style:${property}`,
                slotted ?? value,
                slotted !== undefined,
            ),
        )
    }
}

function attribute(
    name: string,
    value: string,
    expression: boolean,
): Attribute {
    return { name, lowerName: name.toLowerCase(), value, expression }
}

// The value as a template-literal expression, or `undefined` where it holds no slot at all. An
// UNCLOSED `{` is text: `slotEnd` runs to the end of the value and the brace was never a
// slot, so the attribute stays exactly what the author wrote.
function interpolated(raw: string): string | undefined {
    let out = ''
    let at = 0
    let found = false
    while (at < raw.length) {
        const brace = raw.indexOf('{', at)
        if (brace === -1) break
        const close = slotEnd(raw, brace)
        if (close >= raw.length) break
        out += `${templateText(raw.slice(at, brace))}\${${raw.slice(brace + 1, close).trim()}}`
        at = close + 1
        found = true
    }
    if (!found) return undefined
    return `\`${out}${templateText(raw.slice(at))}\``
}

// The static text of a template literal. A `\`, a backtick and a `${` are the three sequences the
// grammar reads, and an attribute value carries all three as ordinary characters.
function templateText(text: string): string {
    return text
        .replaceAll('\\', '\\\\')
        .replaceAll('`', '\\`')
        .replaceAll('${', '\\${')
}

// The pieces of `source` between each `separator` that stands OUTSIDE a slot — a `;` inside
// `{a ? 'x;y' : 'z'}` is the expression's own.
function splitTopLevel(source: string, separator: string): string[] {
    const pieces: string[] = []
    let from = 0
    for (
        let at = topLevelAt(source, separator, 0);
        at !== -1;
        at = topLevelAt(source, separator, from)
    ) {
        pieces.push(source.slice(from, at))
        from = at + 1
    }
    pieces.push(source.slice(from))
    return pieces
}

// The `:` that separates a declaration's property from its value, outside any slot.
function colonAt(declaration: string): number {
    return topLevelAt(declaration, ':', 0)
}

// The first `target` at or after `from` that stands outside a slot and outside a quoted CSS
// string, or -1.
function topLevelAt(source: string, target: string, from: number): number {
    let at = from
    while (at < source.length) {
        const char = source[at]
        if (char === '{') {
            const close = slotEnd(source, at)
            at = close >= source.length ? source.length : close + 1
            continue
        }
        // A QUOTED VALUE IS NOT A LIST OF DECLARATIONS. The `;` inside
        // `url('data:image/svg+xml;utf8,<svg/>')` split one style declaration into two and 32.20's
        // refusal named a fragment the author never wrote — a build failure on valid CSS.
        if (char === '"' || char === "'") {
            at = skipQuoted(source, at)
            continue
        }
        if (char === target) return at
        at += 1
    }
    return -1
}

// Past the CSS string opening at `open`. A `;` or a `:` inside one is the value's own.
function skipQuoted(source: string, open: number): number {
    const quote = source[open]
    let at = open + 1
    while (at < source.length) {
        const char = source[at]
        if (char === '\\') {
            at += 2
            continue
        }
        if (char === quote) return at + 1
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
        if (node.kind === 'block') {
            if (node.block === 'for') collapseWhitespace(node.children)
            else
                for (const branch of node.branches)
                    collapseWhitespace(branch.children)
            continue
        }
        if (node.kind !== 'text' || node.text.trim() !== '') continue
        if (!node.text.includes('\n')) continue
        const indented = /[ \t]/.test(node.text)
        if (!indented || i === 0 || i === children.length - 1)
            children.splice(i, 1)
    }
}
