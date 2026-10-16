import { SyntaxKind } from 'typescript/unstable/ast'
import { URL_ATTRIBUTES } from '#shared/URL_ATTRIBUTES.ts'
import { isComponentTag, isSlot, propKeyOf } from './classifyTemplate.ts'
import { decodeCharacterReferences } from './decodeCharacterReferences.ts'
import { isNamedAlone } from './isNamedAlone.ts'
import { lineOf } from './lineOf.ts'
import { PositionedRefusal } from './PositionedRefusal.ts'
import { TEMPLATE_BLOCKS } from './TEMPLATE_BLOCKS.ts'
import { importedNames } from './splitImports.ts'
import {
    type Attribute,
    type Branch,
    bodiesOf,
    type ElementNode,
    type ForBlock,
    type InlineComponent,
    type Setup,
    type TemplateNode,
} from './TemplateNode.ts'
import {
    isSpace,
    nesting,
    skipQuoted,
    slotEnd,
    startsToken,
    type Token,
    tokenize,
} from './tokenize.ts'
import { VOID_ELEMENTS } from './VOID_ELEMENTS.ts'

// A `.abide` file is a script, a style and a template, and this splits it into the three
// and parses the third. The expression grammar is NOT parsed here: `{expr}` is captured as
// source text and handed to the emitter verbatim, which is what keeps 19.11 a property of
// the file rather than a promise this parser has to keep.

/** 32.64 — a close tag, naming the block it closes. */
const CLOSER = new RegExp(
    `^\\/\\s*(${Object.keys(TEMPLATE_BLOCKS).join('|')})$`,
)

/** A `.abide` file split into its script, module, style and head blocks and its parsed template. */
export type AbideFile = {
    /** `<script>` bodies in source order — per-instance setup, 34.1. */
    scripts: string[]
    /**
     * `<script module>` bodies in source order — 34.2, module scope on both sides. Apart from
     * `scripts` because the two run a different number of times, which is the whole of the clause.
     */
    modules: string[]
    /**
     * `<script server>` bodies in source order — 34.19, module scope on a server alone. Apart from
     * `modules` because the browser's module never carries them.
     */
    servers: string[]
    /**
     * `<style>` bodies in source order, outside any block body — each scoped to the component (34.4). A
     * body's own is on its block (34.11).
     */
    styles: string[]
    /**
     * 39.1, 39.3 — what every top-level `<head>` contributes to the document head, split off the
     * template here so no walk over the body steps around it. In tree order, which is 39.5.
     */
    head: TemplateNode[]
    /**
     * 35.15 — the document's `<html>` and `<body>`, where the file is written inside them: each with
     * its attributes and none of its children, which are the head and the template. `undefined`
     * where the template is not.
     */
    document: { html: ElementNode; body: ElementNode } | undefined
    template: TemplateNode[]
    /** 32.43 — the inline components the template's own body declares, in source order. */
    components: InlineComponent[]
    /**
     * 34.13 — the type parameters the component's `<script generics="…">` declares, as written, or
     * `undefined` where it declares none.
     */
    generics: string | undefined
    /**
     * Where each piece the projection copies starts in the source.
     *
     * WHERE EACH PIECE THE PROJECTION COPIES STARTS IN THE SOURCE, so a checker's position in the
     * projection is a line of the `.abide` (38.3). A script block by index; a template expression
     * by the holder the projection keys its span by, a `{#for}` key by its block, an element's tag
     * name by the element, and a literal attribute's name by the attribute. A value the
     * parser rewrote — an interpolated attribute becomes a template literal — is placed where its
     * text starts, which is its line if not its column.
     */
    origins: Origins
}

/** Every script body a file holds — module, server and per-instance — for a walk over its imports. */
export function scriptBodies(file: AbideFile): string[] {
    return [...file.modules, ...file.servers, ...file.scripts]
}

type Origins = {
    modules: number[]
    servers: number[]
    scripts: number[]
    holders: Map<object, number>
    keys: Map<object, number>
    /** 38.39 — per `{#for}` block, where its item and its index start (`-1` where it has none). */
    bindings: Map<object, { item: number; index: number }>
    /** 38.116 — per attribute but a spread, where its name starts. */
    names: Map<object, number>
    /** 38.116 — per element closed by a tag of its own, where that close tag's name starts. */
    closes: Map<object, number>
}

/**
 * What an open level is when it is a control block's ARM rather than an element. Not a string, so
 * no close tag — `<//>` and `</>` included — can name one.
 */
const ARM = null

/** The innermost open level that is a control block's arm, or 0 when none is open. */
function armLevel(open: (string | null)[]): number {
    let level = open.length - 1
    while (level > 0 && open[level] !== ARM) level -= 1
    return level
}

/** The name a block's own tags spell — `if` for `{#if}` and `{/if}`. */
function blockName(block: TemplateNode | InlineComponent): string {
    return block.kind === 'block' ? block.block : 'component'
}

/** Which block IS open where a tag closes or continues another, and where it opened — or none. */
function innermostOpen(
    source: string,
    blocks: (TemplateNode | InlineComponent)[],
    openedAt: number[],
): string {
    const block = blocks[blocks.length - 1]
    if (block === undefined) return ' No block is open here.'
    const { line, column } = lineOf(
        source,
        openedAt[openedAt.length - 1] as number,
    )
    return ` The block open here is the {#${blockName(block)}} at ${line}:${column}.`
}

/** What to write instead of a block abide has none of, where there is one thing to write. */
function unknownHint(inner: string): string {
    if (/^#each(?![\w$])/.test(inner)) return ' — a list is {#for item of list}'
    if (/^#await(?![\w$])/.test(inner))
        return ' — there is no {#await}, and a loading arm is {#if value.ready()}'
    if (/^@html(?![\w$])/.test(inner)) return ' — markup is {raw(value)}'
    if (/^:else/.test(inner))
        return ' — an else arm is {:else} or {:else if condition}'
    return ''
}

/**
 * 32.63 — a close tag that names an element opened OUTSIDE a block still open: the block was never
 * closed inside it. Ignored, the close tag was dropped and the block took the rest of the element
 * and everything after it as its body — `<p>{#component Card()}x</p>` lost the `<p>` entirely. A
 * close tag that names no open element at all is still dropped (`parseAbide`).
 */
function refuseCrossing(
    closing: string,
    open: (string | null)[],
    blocks: (TemplateNode | InlineComponent)[],
    openedAt: number[],
): void {
    let arms = 0
    for (let level = open.length - 1; level > 0; level -= 1) {
        const name = open[level]
        if (name === ARM) arms += 1
        else if (typeof name === 'string' && sameTag(name, closing)) {
            if (arms === 0) return
            // The first block opened inside the element, which every block above it sits in.
            const index = blocks.length - arms
            const block = blocks[index] as TemplateNode | InlineComponent
            throw new PositionedRefusal(
                `abide: {#${blockName(block)}} is never closed before </${closing}>, and the element it was opened in ends there. Write {/${blockName(block)}} before </${closing}>. RULEBOOK 32.63.`,
                openedAt[index] as number,
            )
        }
    }
}

/** Pops `open` and `stack` together down to `level`, closing whatever the arm still holds open. */
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

/**
 * Splits a `.abide` source into its scripts, styles and head, and parses its template.
 *
 * ONE LEXICAL PASS. A `<script>` or `<style>` is only a tag where the walk below reaches it: a scan
 * run ahead of the template has no idea what a position IS, and lifts the string literal out of
 * `{ok ? "<script>boom()</script>" : ''}` into component setup — the author's text moved from a
 * data position into an executable one.
 */
export function parseAbide(source: string): AbideFile {
    const scripts: string[] = []
    const modules: string[] = []
    const servers: string[] = []
    const styles: string[] = []
    let generics: string | undefined
    const origins: Origins = {
        modules: [],
        servers: [],
        scripts: [],
        holders: new Map(),
        keys: new Map(),
        bindings: new Map(),
        names: new Map(),
        closes: new Map(),
    }
    const root: TemplateNode[] = []
    // The open elements, innermost last. `root` is the floor and is never popped.
    const stack: TemplateNode[][] = [root]
    // WHAT EACH OPEN LEVEL IS, so a close tag only closes the thing it names. Popping whatever is
    // innermost lets `</br>` end the `<p>` around it and a stray `{/if}` end the `<div>` around
    // it — the nodes after it then hang outside the element the author wrote them in, which is a
    // document nobody asked for and nothing about it says so. A `{#if}` arm is `ARM`, which no
    // tag name can be.
    const open: (string | null)[] = [ARM]
    // The open control blocks, so a `{:else}` knows which block it belongs to, and the open
    // `{#component}` blocks, whose body a `<script>` or a `<style>` written in it belongs to.
    const blocks: (TemplateNode | InlineComponent)[] = []
    // Where each open block's own tag starts, beside `blocks`, so a block left open is refused at
    // the tag that opened it.
    const openedAt: number[] = []
    // 32.43 — each `{#component}` under the list it was written in, which says whose scope it is in
    // once the tree is whole (`fileComponents`).
    const declared = new Map<TemplateNode[], InlineComponent[]>()
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
            // position the client walks to after it is a different node and the page hydrates
            // against the wrong tree.
            const closing = source.slice(at + 2, close).trim()
            // 34.29 — a `<script>` is raw text whose body takes its close tag with it, so one met
            // here is what is left of a block that ended early: a `</script>` in a comment or a
            // string in it, and the source after it would be rendered as the page.
            if (sameTag(closing, 'script'))
                throw new Error(
                    'abide: a </script> that closes no <script> — a block ends at the first `</script>` in it, even one in a comment or a string. Write it `<\\/script>` there. RULEBOOK 34.29.',
                )
            const innermost = open[open.length - 1]
            if (typeof innermost === 'string' && sameTag(innermost, closing)) {
                // The element closed is the last node of the level around it, written before
                // every node now inside it — and placed only where the close spells its name.
                const around = stack[stack.length - 2] as TemplateNode[]
                if (closing === innermost) {
                    let named = at + 2
                    while (isSpace(source[named] as string)) named += 1
                    origins.closes.set(
                        around[around.length - 1] as TemplateNode,
                        named,
                    )
                }
                stack.pop()
                open.pop()
            } else refuseCrossing(closing, open, blocks, openedAt)
            at = close + 1
            continue
        }

        if (char === '<') {
            // A COMMENT AND A DOCTYPE ARE NOT TAGS, and `readTag` refuses both. Stepping over the
            // `<` it refused is what rendered `<!-- todo -->` as the visible text `!-- todo -->`
            // and turned `<!DOCTYPE html>` into one too.
            //
            // A COMMENT IS DROPPED RATHER THAN KEPT. It is a real `childNodes` entry, so keeping
            // one means the client's walk passing it and every emitter writing it, and the region
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

            const tag = readTag(source, at, origins)
            if (tag === undefined) {
                // A `<` THAT OPENS NO TAG IS TEXT. `<p>a < b</p>` lost its `<` to a parser that
                // stepped over what it could not read.
                at = pushText(children, source, at, at + 1)
                continue
            }

            // 34.1, 34.4 — a `<script>` or a `<style>` is the FILE's, or inside a block the BODY's
            // (14.8, 34.11), never markup, and its body is taken raw. Here rather than in a pass of its own: a scan that runs before the
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
            // A `<style>` HAS NO SECOND FORM — no attribute decides where one goes, only whether it
            // stands in a block body (34.11) — so this is one rule about `<script>` rather than an
            // exception carved out of a rule about both.
            const block =
                lowerTag === 'style'
                    ? styles
                    : lowerTag === 'script'
                      ? scriptBlock(tag.attributes, scripts, modules, servers)
                      : undefined
            const declared =
                block === undefined || block === styles
                    ? undefined
                    : genericsOf(source.slice(at, tag.end))
            if (declared !== undefined) {
                // 34.13 — the component's own type parameters, which a module block and a body's
                // setup have no call to be generic over.
                if (block !== scripts || blocks.length > 0)
                    throw new Error(
                        'abide: generics="…" belongs on the component\'s own <script>, and this one is a <script module>, a <script server> or a block body\'s. RULEBOOK 34.13.',
                    )
                if (generics !== undefined)
                    throw new Error(
                        'abide: two <script> blocks declare generics="…". A component declares its type parameters once. RULEBOOK 34.13.',
                    )
                generics = declared
            }
            if (lowerTag === 'script' || lowerTag === 'style') {
                const raw = rawBody(
                    source,
                    lowerTag,
                    tag,
                    block !== undefined && block !== styles,
                )
                // 14.8 — A `<script>` INSIDE A BLOCK IS THAT BODY'S, set up once each time the body is
                // built, and not the component's: lifted, it ran once for the page and a row's own
                // names (`{#for item …}`) were not in scope.
                // 34.11 — AND A `<style>` INSIDE A BLOCK IS THAT BODY'S, scoped to the elements it
                // holds (`markScoped`) rather than to the whole component.
                // 32.46, 32.47 — AND IN AN INLINE COMPONENT'S OWN BODY, its setup and its own style.
                if (block === styles && blocks.length > 0) {
                    const owner = bodyOf(
                        blocks[blocks.length - 1] as
                            | TemplateNode
                            | InlineComponent,
                    )
                    owner.style =
                        owner.style === null
                            ? raw.body
                            : `${owner.style}\n${raw.body}`
                    at = raw.end
                    continue
                }
                if (block === scripts && blocks.length > 0) {
                    const holder = blocks[blocks.length - 1] as
                        | TemplateNode
                        | InlineComponent
                    const owner = bodyOf(holder)
                    if (owner.setup !== null)
                        throw new Error(
                            holder.kind === 'component'
                                ? `abide: {#component ${holder.name}} has two <script> blocks. A component is set up once, by one. RULEBOOK 32.48.`
                                : 'abide: this block body has two <script> blocks. A body is set up once, by one. RULEBOOK 14.8.',
                        )
                    owner.setup = { text: raw.body }
                    origins.holders.set(owner.setup, tag.end)
                    at = raw.end
                    continue
                }
                if (block !== undefined) {
                    if (block === scripts) origins.scripts.push(tag.end)
                    else if (block === modules) origins.modules.push(tag.end)
                    else if (block === servers) origins.servers.push(tag.end)
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
                    components: [],
                    passed: [],
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
                components: [],
                passed: [],
            }
            origins.holders.set(element, at + 1)
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
            const slot = trimmed(source, at + 1, end)
            const inner = slot.text

            // 32.41 — `{#component Name(pattern)}` and `{/component}`, wherever a node may stand. It
            // opens an arm as a block does, and is filed under the list it stands in rather than
            // pushed into it: it renders nothing there, so the text either side is one run.
            if (/^#component(?![\w$])/.test(inner)) {
                const component = inlineComponent(
                    trimmed(source, slot.at + '#component'.length, end),
                )
                const here = declared.get(children)
                if (here === undefined) declared.set(children, [component])
                else here.push(component)
                blocks.push(component)
                openedAt.push(at)
                stack.push(component.children)
                open.push(ARM)
                at = end + 1
                continue
            }
            // `{#if}`, `{:else}`, `{:else if}`, `{/if}` — a control block opens a new ARM rather
            // than a new element, so it keeps its own stack beside the element one.
            if (/^#if(?![\w$])/.test(inner)) {
                const subject = trimmed(source, slot.at + 3, end)
                const branch = newBranch(subject.text)
                origins.holders.set(branch, subject.at)
                const block: TemplateNode = {
                    kind: 'block',
                    block: 'if',
                    branches: [branch],
                }
                children.push(block)
                blocks.push(block)
                openedAt.push(at)
                stack.push(branch.children)
                open.push(ARM)
                at = end + 1
                continue
            }
            if (/^:else(?![\w$])/.test(inner)) {
                const block = blocks[blocks.length - 1]
                // 32.64 — AN ELSE ARM OUTSIDE A `{#if}` IS REFUSED, for the reason 32.56 refuses a
                // stray catch: dropped, the text after it read as the body it stood in.
                if (
                    block === undefined ||
                    block.kind !== 'block' ||
                    block.block !== 'if'
                )
                    throw new PositionedRefusal(
                        `abide: {${inner}} stands outside a {#if}, and only a {#if} has an else arm.${innermostOpen(source, blocks, openedAt)} RULEBOOK 32.64.`,
                        at,
                    )
                // `{:else}` carries no condition, which is what makes it always take.
                const subject = trimmed(
                    source,
                    slot.at + elseSubjectAt(inner),
                    end,
                )
                const branch = newBranch(subject.text)
                if (branch.subject !== '')
                    origins.holders.set(branch, subject.at)
                // UNWOUND TO THE ARM'S OWN LEVEL, for the reason `{/if}` below is: an
                // element the author left open in the PREVIOUS arm sits above it, and
                // popping one level left `open` naming that element while `stack` held the
                // new arm — so its close tag popped the arm and every node after it landed
                // in the first arm, which renders on the opposite condition.
                unwindTo(armLevel(open), open, stack)
                block.branches.push(branch)
                stack.push(branch.children)
                open.push(ARM)
                at = end + 1
                continue
            }
            // 32.16 — `{#try}`, `{:catch e}`, `{:finally}`, `{/try}`.
            if (inner === '#try') {
                const body = newBranch('')
                const block: TemplateNode = {
                    kind: 'block',
                    block: 'try',
                    branches: [body],
                    error: '',
                }
                children.push(block)
                blocks.push(block)
                openedAt.push(at)
                stack.push(body.children)
                open.push(ARM)
                at = end + 1
                continue
            }
            if (/^:catch(?![\w$])/.test(inner) || inner === ':finally') {
                const block = blocks[blocks.length - 1]
                // 32.56 — ONLY A `{#try}` HAS THESE ARMS. Anywhere else the tag was dropped and what
                // followed it read as the body it stood in: a `{#for}`'s catch rendered in every row.
                if (
                    block === undefined ||
                    block.kind !== 'block' ||
                    block.block !== 'try'
                )
                    throw new PositionedRefusal(
                        `abide: {${inner}} stands outside a {#try}, and only a {#try} has a catch or a finally arm. RULEBOOK 32.56.`,
                        at,
                    )
                unwindTo(armLevel(open), open, stack)
                // The finally arm is a third branch until `{/try}` folds it into the other two.
                if (inner.startsWith(':catch'))
                    block.error = inner.slice(6).trim()
                const branch = newBranch(inner === ':finally' ? FINALLY : '')
                block.branches.push(branch)
                stack.push(branch.children)
                open.push(ARM)
                at = end + 1
                continue
            }
            if (/^#for(?![\w$])/.test(inner)) {
                const block = forBlock(
                    source,
                    trimmed(source, slot.at + 4, end),
                    origins,
                )
                children.push(block)
                blocks.push(block)
                openedAt.push(at)
                stack.push(block.children)
                open.push(ARM)
                at = end + 1
                continue
            }
            // 32.64 — A CLOSE TAG CLOSES THE BLOCK IT NAMES, AND ONLY THAT ONE. Ignored, a stray
            // `{/if}` let the text after it stand where the author never put it; and closing
            // whatever was innermost let `{/if}` end a `{#try}` without folding its arms.
            const closer = CLOSER.exec(inner)
            if (closer !== null) {
                const name = closer[1] as string
                const block = blocks[blocks.length - 1]
                if (block === undefined || blockName(block) !== name)
                    throw new PositionedRefusal(
                        `abide: {/${name}} closes no {#${name}}.${innermostOpen(source, blocks, openedAt)} RULEBOOK 32.64.`,
                        at,
                    )
                blocks.pop()
                openedAt.pop()
                // UNWOUND TO THE ARM'S OWN LEVEL, because an element the author left open inside
                // the block sits above it. Requiring the arm to be innermost, `<div>{#if a}<b>x
                // {/if}</div><p>after</p>` closed NOTHING — the `</div>` then matched nothing
                // either, and the `<p>` landed inside the if-arm and vanished whenever the
                // condition was false. Closing whatever the block still holds open is what the
                // close tag of the element AROUND it would have to do anyway.
                unwindTo(armLevel(open), open, stack)
                if (block.kind === 'block' && block.block === 'try') {
                    const after = closeTry(block)
                    const around = stack[stack.length - 1] as TemplateNode[]
                    around.push(...after)
                    // The `{:finally}` markup stands in the list around the block now, and so
                    // does what it declares.
                    const moved = declared.get(after)
                    if (moved !== undefined) {
                        const here = declared.get(around)
                        if (here === undefined) declared.set(around, moved)
                        else here.push(...moved)
                    }
                }
                at = end + 1
                continue
            }
            // 32.65 — `{#each}`, `{#await}`, `{@html}` and every other tag abide has no block for.
            // Read as an expression, each surfaced as a TypeScript syntax error about a `#` or an
            // `@`, which names nothing the author wrote.
            const unknown = /^(?:[#:@][A-Za-z]|\/\s*[A-Za-z][\w$]*$)/.test(
                inner,
            )
            if (unknown)
                throw new PositionedRefusal(
                    `abide: {${inner}} is not a block abide has. A template has {#if}, {#for}, {#try} and {#component Name(pattern)}, each closed by its own {/if}, {/for}, {/try} or {/component}${unknownHint(inner)}. RULEBOOK 32.65.`,
                    at,
                )

            const expression: TemplateNode = {
                kind: 'expression',
                source: inner,
            }
            origins.holders.set(expression, slot.at)
            children.push(expression)
            at = end + 1
            continue
        }

        at = pushText(children, source, at, at)
    }
    // 32.63 — a block still open at the end of the file closes nowhere, and what it holds would
    // render only where its arm takes.
    const unclosed = blocks[blocks.length - 1]
    if (unclosed !== undefined)
        throw new PositionedRefusal(
            `abide: {#${blockName(unclosed)}} is never closed. Write {/${blockName(unclosed)}} where its body ends. RULEBOOK 32.63.`,
            openedAt[openedAt.length - 1] as number,
        )

    const components = fileComponents(root, declared)
    refuseImported(components, [...modules, ...servers, ...scripts])
    collapseWhitespace(root)
    const head: TemplateNode[] = []
    const template: TemplateNode[] = []
    let document: AbideFile['document']
    for (const node of root) {
        if (node.kind === 'element' && node.lowerTag === 'html') {
            document = documentOf(node, head, template)
            continue
        }
        if (node.kind === 'element' && node.lowerTag === 'head') {
            assertNoNestedHead(node.children, '<head>')
            for (const child of node.children) head.push(child)
            continue
        }
        assertNoNestedHead([node], '')
        template.push(node)
    }
    // 35.16 — the document is written once, around everything else.
    if (document !== undefined)
        for (const node of root)
            if (
                !(node.kind === 'element' && node.lowerTag === 'html') &&
                !(node.kind === 'text' && node.text.trim() === '')
            )
                throw new Error(
                    `abide: ${node.kind === 'element' ? `<${node.tag}>` : 'markup'} stands beside <html>, and a file written inside <html> has nothing outside it. RULEBOOK 35.16.`,
                )
    return {
        scripts,
        modules,
        servers,
        styles,
        head,
        document,
        template,
        components,
        generics,
        origins,
    }
}

/**
 * An inline component's header — `Name(pattern)` or `Name(pattern: Type)` — read into its parts.
 *
 * 32.39 — THE NAME IS TITLECASE, for the reason a tag is (32.17): `<row/>` is the element, so a
 * lowercase inline component could never be invoked. The parentheses hold what a file component's
 * `props` call destructures into, and the annotation is the type argument that call would take.
 */
function inlineComponent(header: {
    text: string
    at: number
}): InlineComponent {
    const tokens = tokenize(header.text)
    const name = tokens[0]
    const opener = tokens[1]
    if (
        name === undefined ||
        opener?.kind !== SyntaxKind.OpenParenToken ||
        !isNamedAlone(name.text)
    )
        throw new Error(
            `abide: {#component ${header.text}} names no component. Write {#component Name(props)}. RULEBOOK 32.39.`,
        )
    if (!isComponentTag(name.text))
        throw new Error(
            `abide: {#component ${name.text}} is not TitleCase, and <${name.text}> is an element. Write {#component ${name.text.charAt(0).toUpperCase()}${name.text.slice(1)}(…)}. RULEBOOK 32.39.`,
        )
    let depth = 0
    let close = -1
    let colon: Token | undefined
    for (let index = 1; index < tokens.length; index += 1) {
        const token = tokens[index] as Token
        depth += nesting(token.kind)
        if (depth === 0) {
            close = index
            break
        }
        if (
            depth === 1 &&
            colon === undefined &&
            token.kind === SyntaxKind.ColonToken
        )
            colon = token
    }
    if (close !== tokens.length - 1)
        throw new Error(
            `abide: {#component ${header.text}} is not a name and one parenthesized props pattern. Write {#component ${name.text}(props)}. RULEBOOK 32.39.`,
        )
    const inside = (from: number, to: number): { text: string; at: number } =>
        trimmed(header.text, from, to)
    const closing = (tokens[close] as Token).start
    const pattern = inside(opener.end, colon?.start ?? closing)
    const type =
        colon === undefined
            ? { text: '', at: closing }
            : inside(colon.end, closing)
    return {
        kind: 'component',
        name: name.text,
        at: header.at + name.start,
        pattern: pattern.text,
        patternAt: header.at + pattern.at,
        type: type.text,
        typeAt: header.at + type.at,
        children: [],
        setup: null,
        style: null,
        components: [],
    }
}

/**
 * Files every inline component on the body whose scope it is in; returns the template's own.
 *
 * 32.43 — A BODY IS A SCOPE, AND AN ELEMENT IS NOT ONE: the template, a row, an arm, an inline
 * component's body, and what stands between an invocation's or a `<slot>`'s tags. A component
 * written inside an ordinary element is filed on the body around the element. 32.50 — one written
 * DIRECTLY between an invocation's tags is the invocation's, passed rather than declared.
 *
 * Each body's own are then walked in turn, and its whitespace collapsed: nothing else reaches a
 * component's body, which is not in any list the template's walks descend.
 */
function fileComponents(
    template: TemplateNode[],
    declared: ReadonlyMap<TemplateNode[], InlineComponent[]>,
): InlineComponent[] {
    // The components `nodes` declares, filed on `scope`, down through every ordinary element.
    const collect = (
        nodes: TemplateNode[],
        scope: InlineComponent[],
        own: boolean,
    ): void => {
        if (own) for (const one of declared.get(nodes) ?? []) scope.push(one)
        for (const node of nodes) {
            if (node.kind === 'element') {
                if (isSlot(node)) open(node.children, node.components, true)
                else if (isComponentTag(node.tag)) {
                    node.passed = declared.get(node.children) ?? []
                    refuseTwice(node.passed, `<${node.tag}>`)
                    for (const passed of node.passed)
                        for (const attribute of node.attributes)
                            if (propKeyOf(attribute) === passed.name)
                                throw new Error(
                                    `abide: <${node.tag}> is given ${passed.name} as an attribute and as the {#component ${passed.name}} between its tags — one prop, two values. RULEBOOK 32.53.`,
                                )
                    open(node.children, node.components, false)
                    for (const passed of node.passed) inside(passed)
                } else collect(node.children, scope, true)
                continue
            }
            for (const body of bodiesOf(node))
                open(body.children, body.components, true)
        }
    }
    // A body: what it declares, each of those walked in turn.
    const open = (
        nodes: TemplateNode[],
        scope: InlineComponent[],
        own: boolean,
    ): void => {
        collect(nodes, scope, own)
        refuseTwice(scope, 'one body')
        for (const one of scope) inside(one)
    }
    const inside = (component: InlineComponent): void => {
        assertNoNestedHead(component.children, `{#component ${component.name}}`)
        open(component.children, component.components, true)
        collapseWhitespace(component.children)
    }
    const file: InlineComponent[] = []
    open(template, file, true)
    return file
}

/** Throws where two inline components in one list share a name (32.49). */
function refuseTwice(components: InlineComponent[], where: string): void {
    for (let at = 1; at < components.length; at += 1) {
        const name = (components[at] as InlineComponent).name
        for (let before = 0; before < at; before += 1)
            if ((components[before] as InlineComponent).name === name)
                throw new Error(
                    `abide: {#component ${name}} is declared twice in ${where} — one name, two components. Rename one. RULEBOOK 32.49.`,
                )
    }
}

/**
 * Throws where an inline component the template's own body declares shares a name with an import.
 *
 * 32.55 — the template's own body is its file's scope. A name the `<script>` DECLARES is the
 * checker's to find (`TypeSession`); an import is found here, without one.
 */
function refuseImported(components: InlineComponent[], blocks: string[]): void {
    if (components.length === 0) return
    for (const block of blocks)
        for (const imported of importedNames(block))
            for (const component of components)
                if (component.name === imported.name)
                    throw new Error(
                        `abide: {#component ${imported.name}} is declared inline and ${imported.name} is also imported from '${imported.specifier}' — one name, two components. Rename one. RULEBOOK 32.55.`,
                    )
}

/**
 * 35.15 — the `<html>` a file is written inside: its `<head>`'s children added to `head`, its
 * `<body>`'s to `template`, and the two elements handed back with their attributes alone.
 */
function documentOf(
    html: ElementNode,
    head: TemplateNode[],
    template: TemplateNode[],
): { html: ElementNode; body: ElementNode } {
    let body: ElementNode | undefined
    for (const child of html.children) {
        if (child.kind === 'text' && child.text.trim() === '') continue
        if (child.kind === 'element' && child.lowerTag === 'head') {
            assertNoNestedHead(child.children, '<head>')
            for (const node of child.children) head.push(node)
            continue
        }
        if (child.kind === 'element' && child.lowerTag === 'body' && !body) {
            body = child
            assertNoNestedHead(child.children, '<body>')
            for (const node of child.children) template.push(node)
            continue
        }
        throw new Error(
            `abide: <html> holds a <head> and a <body> and nothing else, and this one holds ${child.kind === 'element' ? `<${child.tag}>` : 'more'}. RULEBOOK 35.16.`,
        )
    }
    if (body === undefined)
        throw new Error(
            'abide: <html> holds no <body>, so the page has nowhere to go. RULEBOOK 35.16.',
        )
    // The elements themselves, emptied, so where each attribute was written is still known.
    html.children = []
    body.children = []
    return { html, body }
}

/**
 * Throws where a `<head>` stands anywhere but the top level of the file.
 *
 * 39.2 — a `<head>` MUST be top level, and MUST NOT appear inside a control block. Nested, it
 * would render inside the body, which is the silent wrong answer this refuses instead.
 *
 * BOTH HALVES OF THE CLAUSE. The walk returned on anything that was not an element, so a block
 * was a floor it never went through and `{#if a}<head>…{/if}` emitted `<head>` markup into the
 * body — the exact wrong answer, from the check written to stop it. A `<head>` inside a top-level
 * `<head>` was the other way past it, the hoist pushing its children without asking.
 */
function assertNoNestedHead(nodes: TemplateNode[], within: string): void {
    for (const node of nodes) {
        if (node.kind === 'element' && node.lowerTag === 'head')
            throw new Error(
                `abide: a <head> must be top level in a .abide file, and this one is inside ${within}. RULEBOOK 39.2.`,
            )
        // 35.16 — the document's own elements are written once, at the top, around the rest.
        if (
            node.kind === 'element' &&
            (node.lowerTag === 'html' || node.lowerTag === 'body')
        )
            throw new Error(
                `abide: <${node.tag}> ${within === '' ? 'stands among the markup' : `is inside ${within}`}, and the document's <html> and <body> are written once, at the top of the root layout.abide. RULEBOOK 35.16.`,
            )
        const label =
            node.kind === 'element'
                ? `<${node.tag}>`
                : node.kind === 'block'
                  ? `{#${node.block}}`
                  : ''
        for (const body of bodiesOf(node))
            assertNoNestedHead(body.children, label)
    }
}

/** The subject a `{:finally}` branch is parsed under, until `closeTry` folds it away. */
const FINALLY = '\u0000finally'

/**
 * Folds a `{#try}`'s arms into its body and catch, and returns its `{:finally}` markup.
 *
 * 32.16 — THE TWO ARMS A `{#try}` RENDERS ONE OF: the body, and the catch — an empty one where the
 * author wrote none. The `{:finally}` markup stands on both paths, so it stands AFTER the region
 * rather than in either arm, and is handed back for the caller to place there.
 */
function closeTry(
    block: TemplateNode & { kind: 'block'; block: 'try' },
): TemplateNode[] {
    let after: TemplateNode[] = []
    const kept: Branch[] = []
    for (const branch of block.branches)
        if (branch.subject === FINALLY) after = branch.children
        else kept.push(branch)
    if (kept.length === 1) kept.push(newBranch(''))
    block.branches = kept.slice(0, 2)
    return after
}

/** An arm under `subject`, with nothing in it yet. */
function newBranch(subject: string): Branch {
    return { subject, children: [], setup: null, style: null, components: [] }
}

/**
 * The body a `<script>` or `<style>` written inside `block` belongs to.
 *
 * 14.8 — a row's, or the arm open where it stands. A `{#try}` body refuses one: what a boundary sets up when its body is replaced
 * by the catch (32.16) is not decided, and a guess here would be the decision.
 */
function bodyOf(block: TemplateNode | InlineComponent): {
    setup: Setup | null
    style: string | null
} {
    if (block.kind === 'component') return block
    if (block.kind === 'block' && block.block === 'for') return block
    if (block.kind === 'block' && block.block === 'if')
        return block.branches[block.branches.length - 1] as Branch
    throw new Error(
        'abide: a <script> or a <style> inside a {#try} belongs to no body. Move it into a component the {#try} holds, or into a {#for} or {#if} inside it. RULEBOOK 34.10.',
    )
}

/**
 * Whether two tag names match, ASCII case-insensitively.
 *
 * An HTML tag name is ASCII case-INSENSITIVE, so `</DIV>` closes a `<div>`. A component name is
 * TitleCase (32.17) and an exact match is a case of this one, so there is no second rule here.
 */
function sameTag(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase()
}

/**
 * The list a `<script>`'s body belongs in, or `undefined` where it is markup.
 *
 * 34.1 is the bare tag, 34.2 the bare `module` attribute and 34.19 the bare `server` one; anything
 * else on the tag — `src`, `type`, `defer`, `nonce` —
 * is a `<script>` the author wrote for the DOCUMENT, and lifting it into component setup moves it
 * out of the markup and throws its attributes away — save beside `server`, which 34.28 refuses.
 *
 * 34.13 — BUT `generics="…"` IS THE COMPONENT'S. 34.12 — `lang` is refused on any `<script>`: every
 * block is TypeScript, so it says nothing, and read as markup it took the author's whole setup out of
 * the component without a word.
 */
function scriptBlock(
    attributes: Attribute[],
    scripts: string[],
    modules: string[],
    servers: string[],
): string[] | undefined {
    let module = false
    let server = false
    let markup = false
    for (const attribute of attributes) {
        // `<script module>` carries the marker and no value. `module="x"` names something else.
        if (attribute.lowerName === 'module' && attribute.value === '')
            module = true
        else if (attribute.lowerName === 'server') {
            server = true
            if (attribute.value !== '') markup = true
        } else if (attribute.lowerName === 'lang')
            throw new Error(
                'abide: every <script> in a .abide file is TypeScript, so `lang` says nothing — remove it. RULEBOOK 34.12.',
            )
        else if (attribute.lowerName !== 'generics') markup = true
    }
    // 34.28 — a `server` attribute on a tag that would be markup ships the server's source to the
    // document and the browser's module, so it is refused rather than demoted.
    if (server && markup)
        throw new Error(
            'abide: a <script> carrying `server` is a server block, written `<script server>` with nothing beside it. RULEBOOK 34.28.',
        )
    if (markup) return undefined
    if (module && server)
        throw new Error(
            'abide: a <script> is `module` or `server`, not both — a server block is module scope already. RULEBOOK 34.19.',
        )
    return server ? servers : module ? modules : scripts
}

/**
 * 34.13 — what a component `<script>`'s `generics` attribute declares, or `undefined`.
 *
 * READ OFF THE TAG'S OWN TEXT rather than its parsed attribute: `T extends { id: string }` holds a
 * brace, and an attribute value with one in it is parsed as an interpolation.
 */
function genericsOf(tag: string): string | undefined {
    return /\sgenerics\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag)?.[2]
}

/**
 * A RAW-TEXT ELEMENT'S BODY AND WHERE THE TAG ENDS. One answer for all three destinations, so a
 * markup `<script>` and a `<script module>` cannot disagree about where the close tag was.
 */
function rawBody(
    source: string,
    lowerTag: string,
    tag: { selfClosing: boolean; end: number },
    code: boolean,
): { body: string; end: number } {
    if (tag.selfClosing) return { body: '', end: tag.end }
    // The body ends at the first literal close tag, as a browser's does, so a `</script>` inside
    // a string or a comment in a script block ends it early — and the real close tag after it
    // is refused where the template meets it (34.29).
    const close = closeTagAt(source, lowerTag, tag.end)
    if (close === null)
        return { body: source.slice(tag.end), end: source.length }
    // 34.30 — a component block's early end is refused AT the early end, because what is left
    // over can open a `<script>` of its own that takes the real close tag, and then 34.29 meets
    // nothing to refuse while the block's source between them renders as the page.
    if (code && !startsToken(source, tag.end, close.start))
        throw new Error(
            'abide: a </script> inside a string, a comment or a regex ends the <script> block there, as a browser would. Write it `<\\/script>`. RULEBOOK 34.30.',
        )
    return { body: source.slice(tag.end, close.start), end: close.end }
}

/**
 * Where a raw-text block's close tag begins and ends, or `null` where it has none.
 *
 * Matched the way `sameTag` matches — `indexOf` over the literal spelling missed `</SCRIPT>` and ran the block to the end of the file.
 *
 * WHITESPACE IS LEGAL BEFORE THE `>`, and demanding it at a fixed offset was the same class of
 * miss one layer down: `</script >` and `</style\n>` matched nothing, so the rest of the document
 * became the script body and the template came back EMPTY. The ordinary close-tag path above
 * already `trim()`s for this, which is one question with two answers until now — so the end is
 * handed back rather than recomputed from the tag's length.
 */
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

/**
 * Appends the text run from `at` to `children` and returns where the run ends.
 *
 * Scanned from `from` — one node, so the `<` that opened no tag is carried by the run that
 * follows it rather than becoming a node of its own.
 */
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
    // the markup walk places one position. The only way to produce two is the `<` that opened no tag, and
    // this is where that run rejoins the one before it.
    const last = children[children.length - 1]
    if (last?.kind === 'text') last.text += text
    else children.push({ kind: 'text', text })
    return next
}

/**
 * Where the condition on a `{:else …}` arm starts in `inner`, or its end for the bare `{:else}`
 * that always takes.
 *
 * A DIRECTIVE ENDS AT A WORD BOUNDARY. `startsWith` has none, so `{:elseif b}` was silently read
 * as `{:else if b}` and `{:else ifValid}` as `{:else if}` over the subject `Valid` — a condition
 * the author never wrote, deciding which arm renders.
 */
function elseSubjectAt(inner: string): number {
    const rest = inner.slice(':else'.length)
    if (rest.trim() === '') return inner.length
    const keyword = /^\s+if(?=[\s(])/.exec(rest)
    if (keyword === null || rest.slice(keyword[0].length).trim() === '')
        throw new Error(
            `abide: {${inner}} is not a control block. Write {:else} or {:else if <condition>}.`,
        )
    return ':else'.length + keyword[0].length
}

/**
 * `source` from `start` to `end`, trimmed, and where what is left starts — the position a
 * checker's answer about it is placed at (38.3).
 */
function trimmed(
    source: string,
    start: number,
    end: number,
): { text: string; at: number } {
    const raw = source.slice(start, end)
    const text = raw.trimStart()
    return { text: text.trimEnd(), at: start + raw.length - text.length }
}

/**
 * Parses a `{#for}` header into its item, index, subject and key.
 *
 * `item, index of list by key` — `index` and `by` are optional, and everything after `of` up to
 * a top-level `by` is the subject. Split on the KEYWORDS rather than on commas, because the
 * subject may hold both.
 *
 * THE SEPARATOR IS THE ONE AT DEPTH ZERO AND OUTSIDE A STRING — all three of them, and each was
 * wrong its own way. `{#for { id, name } of rows}` split on the pattern's own comma and the item
 * became `{ id`, which the emitters write straight into a parameter list. `{#for x of
 * names.filter(n => n !== "run by me")}` split on the ` by ` inside the string literal and the
 * subject ended mid-quote. One scanner for all three rather than one fix for the comma.
 */
function forBlock(
    file: string,
    header: { text: string; at: number },
    origins: Origins,
): ForBlock {
    const source = header.text
    // THE HEADER IS TOKENS, read by the scanner a slot is: an `of`, a `,` or a `by` inside a string,
    // a call or an object pattern is the expression's own, and only one at depth zero divides the
    // header. `by` is a word rather than a keyword, so a member named `by` is not one.
    const tokens = tokenize(source)
    let depth = 0
    let of: Token | undefined
    let comma: Token | undefined
    let by: Token | undefined
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index] as Token
        const kind = token.kind
        const moved = nesting(kind)
        depth += moved
        if (moved !== 0 || depth !== 0) continue
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
    // forever, with nothing saying why (32.22 is an ABSENT subject, not a missing one).
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
    const end = header.at + source.length
    const subject = trimmed(
        file,
        header.at + of.end,
        by === undefined ? end : header.at + by.start,
    )
    const key =
        by === undefined
            ? { text: '', at: end }
            : trimmed(file, header.at + by.end, end)
    const block: ForBlock = {
        kind: 'block',
        block: 'for',
        item,
        index,
        subject: subject.text,
        key: key.text,
        children: [],
        setup: null,
        style: null,
        components: [],
    }
    origins.holders.set(block, subject.at)
    if (key.text !== '') origins.keys.set(block, key.at)
    origins.bindings.set(block, {
        item: header.at + leadingSpace(source),
        index:
            comma === undefined
                ? -1
                : header.at + comma.end + leadingSpace(source.slice(comma.end)),
    })
    return block
}

function leadingSpace(text: string): number {
    return text.length - text.trimStart().length
}

function readTag(
    source: string,
    open: number,
    origins: Origins,
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
    // creates — so the markup walk placed a node the document does not have and every position
    // after it in that parent lands one node off. That is the one failure marker-free addressing
    // cannot survive: it binds to whatever is there, silently.
    if (!/[A-Za-z]/.test(source[at] ?? '')) return undefined
    while (at < source.length && /[\w:-]/.test(source[at] as string)) at += 1
    if (at === nameStart) return undefined
    const name = source.slice(nameStart, at)
    const attributes: Attribute[] = []

    // Every attribute read from `from` on is placed: an expression at `position` — where its value
    // starts, or, where the parser rewrote the value, where the text it was rewritten from does — and
    // a literal at its name, `named`, which is where a finding about it is read.
    const place = (from: number, position: number, named: number): void => {
        for (let index = from; index < attributes.length; index += 1) {
            const placed = attributes[index] as Attribute
            origins.holders.set(placed, placed.expression ? position : named)
            if (placed.name !== '...') origins.names.set(placed, named)
        }
    }
    while (at < source.length) {
        while (at < source.length && isSpace(source[at] as string)) at += 1
        if (source[at] === '>')
            return { name, attributes, selfClosing: false, end: at + 1 }
        if (source[at] === '/' && source[at + 1] === '>')
            return { name, attributes, selfClosing: true, end: at + 2 }

        // 32.11 — `{...expr}` IN ATTRIBUTE POSITION IS A SPREAD, not an attribute named by its own
        // braces. Carried as `...` holding the expression, so the shadow projects it and the
        // lowering reads it exactly as it reads any other attribute's.
        if (source[at] === '{') {
            const close = slotEnd(source, at)
            const inner = trimmed(source, at + 1, close)
            if (inner.text.startsWith('...')) {
                const spread = trimmed(source, inner.at + 3, close)
                attributes.push(attribute('...', spread.text, true))
                place(attributes.length - 1, spread.at, at)
                at = close + 1
                continue
            }
        }

        const attributeStart = at
        while (
            at < source.length &&
            !isSpace(source[at] as string) &&
            source[at] !== '=' &&
            source[at] !== '/' &&
            source[at] !== '>'
        )
            at += 1
        if (at === attributeStart)
            return { name, attributes, selfClosing: false, end: at + 1 }
        const attributeName = source.slice(attributeStart, at)

        if (source[at] !== '=') {
            // 33.21 — A BARE PROP IS `true`. Handed over as the expression rather than given a
            // shape of its own, so the build and the checker read `<Name enable>` as they read
            // `enable={true}`. A bare `bind:` names no `Reactive` and stays the literal it was.
            const flag =
                isComponentTag(name) &&
                !attributeName.toLowerCase().startsWith('bind:')
            attributes.push(attribute(attributeName, flag ? 'true' : '', flag))
            place(attributes.length - 1, attributeStart, attributeStart)
            continue
        }
        at += 1

        // `attr={expr}` — the braces are found the same way a slot's are, so `onclick={f('}')}`
        // ends where it reads as ending.
        if (source[at] === '{') {
            const close = slotEnd(source, at)
            const value = trimmed(source, at + 1, close)
            attributes.push(attribute(attributeName, value.text, true))
            place(attributes.length - 1, value.at, attributeStart)
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
                    `abide: the ${quote} opening ${attributeName} on <${name}> is never closed, so the rest of the file reads as part of that attribute.`,
                )
            const from = attributes.length
            pushQuoted(
                attributes,
                attributeName,
                source.slice(at + 1, close),
                name,
            )
            place(from, at + 1, attributeStart)
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
        // lowered and never past the `safeUrl` 32.20 asks a URL attribute for.
        const from = attributes.length
        pushQuoted(
            attributes,
            attributeName,
            source.slice(valueStart, at),
            name,
        )
        place(from, valueStart, attributeStart)
    }
    return { name, attributes, selfClosing: false, end: at }
}

/**
 * Pushes a quoted attribute: a literal, a template-literal expression, or one `style:prop` per
 * declaration.
 *
 * 32.3 — A QUOTED VALUE WITH A SLOT IN IT IS AN EXPRESSION. Captured as a literal,
 * `class="badge {tone}"` wrote the braces into the document verbatim, so the page carried the
 * author's source where a class was due.
 *
 * REWRITTEN AS A TEMPLATE LITERAL rather than given a parts array of its own, because that is one
 * expression and the whole `class={expr}` path already takes one: lowered by `Lowering`,
 * escaped by `escapeAttribute`, and scheme-checked by `safeUrl` where 32.20 asks for it. A second
 * shape here would be a second copy of all three.
 *
 * 32.27 — ITS STATIC TEXT IS DECODED HERE, so what is left is data whole and takes that one path on
 * both sides: `title="AT&amp;T {n}"` is the literal `AT&T ${n}`, escaped as one value by the server
 * and set as it stands by the browser. Each static piece is decoded ON ITS OWN, so a slot's text can
 * never finish a reference the author's began: `&amp{x}` is `&` and then the slot. 32.28 keeps a URL
 * attribute's static text as written, escaped with its slots the way `{expr}` is.
 *
 * 33.19 — A COMPONENT'S PROP IS DECODED WHEN IT IS STATIC TOO, because it is never markup: an element's
 * static value is served as the author's bytes (`classifyAttributes`), and a prop is handed over
 * as a string, so `<Card title="AT&amp;T">` hands the child `AT&T`.
 *
 * 32.19 — AN INTERPOLATED `style` TAKES THE OTHER ROAD and lowers to one `style:prop` per
 * declaration, which is why the split happens here, where the interpolated form is still told
 * apart from the whole `style={expr}` one.
 */
function pushQuoted(
    attributes: Attribute[],
    attributeName: string,
    raw: string,
    tag: string,
): void {
    const prop = isComponentTag(tag)
    const expression = interpolated(
        raw,
        prop || !URL_ATTRIBUTES.has(attributeName.toLowerCase()),
    )
    if (expression === undefined) {
        attributes.push(
            attribute(
                attributeName,
                prop ? decodeCharacterReferences(raw, 'attribute') : raw,
                false,
            ),
        )
        return
    }
    if (attributeName.toLowerCase() !== 'style') {
        attributes.push(attribute(attributeName, expression, true))
        return
    }
    for (const declaration of splitTopLevel(raw, ';')) {
        if (declaration.trim() === '') continue
        const colon = colonAt(declaration)
        // A PROPERTY NAME IS STATIC. `style="{name}: red"` has no property to bind, and built as a
        // string it would let a value decide which property it sets.
        if (colon === -1 || declaration.slice(0, colon).includes('{'))
            throw new Error(
                `abide: an interpolated style on <${tag}> sets one property per declaration under a static name, and \`${declaration.trim()}\` has none. Write style:prop={value}. RULEBOOK 32.19.`,
            )
        const property = declaration.slice(0, colon).trim()
        if (property === '')
            throw new Error(
                `abide: an interpolated style on <${tag}> has a declaration with no property name. Write style:prop={value}. RULEBOOK 32.19.`,
            )
        const value = declaration.slice(colon + 1).trim()
        const slotted = interpolated(value, false)
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

/**
 * The value as a template-literal expression, or `undefined` where it holds no slot at all. An
 * UNCLOSED `{` is text: `slotEnd` runs to the end of the value and the brace was never a
 * slot, so the attribute stays exactly what the author wrote.
 */
function interpolated(raw: string, decode: boolean): string | undefined {
    let out = ''
    let at = 0
    let found = false
    while (at < raw.length) {
        const brace = raw.indexOf('{', at)
        if (brace === -1) break
        const close = slotEnd(raw, brace)
        if (close >= raw.length) break
        out += `${staticText(raw.slice(at, brace), decode)}\${${raw.slice(brace + 1, close).trim()}}`
        at = close + 1
        found = true
    }
    if (!found) return undefined
    return `\`${out}${staticText(raw.slice(at), decode)}\``
}

function staticText(text: string, decode: boolean): string {
    return templateText(
        decode ? decodeCharacterReferences(text, 'attribute') : text,
    )
}

/**
 * The static text of a template literal. A `\`, a backtick and a `${` are the three sequences the
 * grammar reads, and an attribute value carries all three as ordinary characters.
 */
function templateText(text: string): string {
    return text
        .replaceAll('\\', '\\\\')
        .replaceAll('`', '\\`')
        .replaceAll('${', '\\${')
}

/**
 * The pieces of `source` between each `separator` that stands OUTSIDE a slot — a `;` inside
 * `{a ? 'x;y' : 'z'}` is the expression's own.
 */
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

/** The `:` that separates a declaration's property from its value, outside any slot. */
function colonAt(declaration: string): number {
    return topLevelAt(declaration, ':', 0)
}

/**
 * The first `target` at or after `from` that stands outside a slot and outside a quoted CSS
 * string, or -1.
 */
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
        // `url('data:image/svg+xml;utf8,<svg/>')` split one style declaration into two and 32.19's
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

/**
 * Drops the whitespace-only text runs that are the author's layout rather than content.
 *
 * 33.17 and 33.18. A whitespace run with a newline and no space or tab is dropped wherever it
 * stands; one that also carries indentation is dropped only at the ends of a body, where it is
 * the author's layout rather than a space the document asked for.
 */
function collapseWhitespace(children: TemplateNode[]): void {
    for (let i = children.length - 1; i >= 0; i -= 1) {
        const node = children[i] as TemplateNode
        for (const body of bodiesOf(node)) collapseWhitespace(body.children)
        if (node.kind !== 'text' || node.text.trim() !== '') continue
        if (!node.text.includes('\n')) continue
        const indented = /[ \t]/.test(node.text)
        if (!indented || i === 0 || i === children.length - 1)
            children.splice(i, 1)
    }
}
