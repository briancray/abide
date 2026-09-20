import { escapeAttribute } from '#shared/escapeText.ts'
import { headKeyOf } from '#shared/headKeyOf.ts'
import { safeUrl } from '#shared/safeUrl.ts'
import { REGION_CLOSE, REGION_OPEN, ROW_OPEN } from '#ui/REGION.ts'
import type { Read } from './classifyRead.ts'
import { Lowering, PROPS } from './Lowering.ts'
import type { AbideFile } from './parseAbide.ts'
import {
    isComponentTag,
    isEventName,
    isHead,
    isSingleRooted,
} from './planTemplate.ts'
import { SERVER_SPECIFIER } from './SPECIFIERS.ts'
import { componentImports, splitImports, withoutProps } from './splitImports.ts'
import type { Attribute, TemplateNode } from './TemplateNode.ts'
import { VOID_ELEMENTS } from './VOID_ELEMENTS.ts'

// Where a component's own head contributions land, and the name the body is bound to while they
// do. Under `__` for the reason every framework name in an emitted module is.
const HEADS = '__heads'
const BODY = '__body'

// The share scope an instance opens (10.5), named apart from the client's binding `Scope`: one is
// what a component's descendants look a key up through, the other is what stops its bindings.
export const SHARED = '__shared'

// A parsed `.abide` file becomes one ESM module exporting a component. The `<script>` body is
// copied VERBATIM into the component function, which is the whole of 19.12 at this stage: the
// compiler does not read the expression grammar, so anything TypeScript accepts survives.
//
// The component returns its head and its body apart. 39.3 is why the split is HERE and not in
// `render`: the hoist is a compile-time partition of the template, so the emitted function has
// two returns rather than one string a renderer has to go looking through. 35.5 is answered by
// `render`, which turns the two into the byte stream a document is served as.

export function emitComponent(
    file: AbideFile,
    reads: readonly Read[] = [],
): string {
    // 39.1, 39.3 — a top-level `<head>` contributes its children to the document head, and the
    // hoist happens at compile time. 39.5: with no merge key they append in tree order, which is
    // what partitioning the top level in place already gives.
    // Only what the page actually uses. An emitted module carrying an import nothing calls is a
    // name the app's own tooling reports as unused, in a file nobody wrote.
    const lowering = new Lowering(file, reads)
    const used = lowering.used

    const body: string[] = []
    for (const node of file.template) {
        if (node.kind === 'element' && isHead(node)) {
            assertNoNestedHead(node.children, '<head>')
            continue
        }
        assertNoNestedHead([node], '')
        body.push(emitNode(node, lowering, false))
    }

    // EMITTED AFTER THE BODY, NOT BEFORE. 39.13 merges across the whole FILE, so a second `<head>`
    // further down the template shadows the first one's `<title>` — and `emitNode` adds to `used`,
    // so emitting a contribution the merge then drops leaves the module importing a name nothing
    // calls. `emitHead` is the client lane's too, which is what keeps the two from drifting.
    const head = emitHead(file, lowering, false)

    // 31.1 and 31.4 hold INSIDE a `.abide` file, not just in its template, so the script block is
    // lowered with the same rewrite the slots get.
    //
    // 34.2 — A `<script module>` IS REQUEST-LOCAL ON A SERVER, which is the head of the component
    // rather than module scope: at module scope it is evaluated once per PROCESS and every request
    // after the first sees the first one's values. One `Component()` call is one request today,
    // and this moves the moment 32.19 lets a component be invoked more than once inside one.
    const moduleSetup = splitImports(lowering.modules())
    const setup = splitImports(lowering.scripts())
    const componentBody = [moduleSetup.body, setup.body]
        .filter((part) => part !== '')
        .join('\n')

    const heads = body.some((part) => part.includes(HEADS))
    // 10.5 — the instance's own scope, opened around everything the instance does: the setup that
    // calls `reactive.share`, and the body whose children are rendered inside it and find it on
    // the way up. Closed in a `finally`, so a component that threw leaves the scope it entered.
    const shares = lowering.opensShareScope()
    const opened = shares
        ? `    const ${SHARED} = ${lowering.use('enterShare')}()\n    try {\n`
        : ''
    const closed = shares
        ? `\n    } finally { ${lowering.use('leaveShare')}(${SHARED}) }`
        : ''
    const names = [...used].sort()

    // THE SETUP IS NOT RE-INDENTED. Adding a margin to every line rewrites the INSIDE of a
    // multi-line template literal, so `\`line one\nline two\`` gains four spaces it never had —
    // a changed string constant, in a file nobody reads.
    // 39.1 THROUGH A COMPONENT. A child contributes to the document head as a page does, and the
    // call that renders it stands inside the BODY expression — so the heads are collected as the
    // body is built and the body is bound to a name before the return reads them. The array is
    // emitted only where the page invokes something: a page with no component pays nothing.
    return `${names.length === 0 ? '' : `import { ${importClause(names)} } from '${SERVER_SPECIFIER}'\n`}\
${componentImports(withoutProps(moduleSetup.imports), '')}${componentImports(withoutProps(setup.imports), '')}
export default function Component(${lowering.takesProps() ? `${PROPS} = {}` : ''}) {
${opened}${componentBody}
${heads ? `    const ${HEADS} = []\n` : ''}\
    const ${BODY} = ${concat(body)}
    return {
        head: ${head}${heads ? ` + ${HEADS}.join('')` : ''},
        body: ${BODY},
    }${closed}
}
`
}

// `client` is the LANE this markup is for. The server writes a component by CALLING it; the
// client builds a row's markup in the browser, where the child's server module is not reachable —
// so there it asks the child's own client module for the same markup instead.
function emitNode(
    node: TemplateNode,
    lowering: Lowering,
    client: boolean,
): string {
    if (node.kind === 'text') return JSON.stringify(node.text)

    if (node.kind === 'expression') {
        // 32.1 — escaped at run time, never at compile time: the value is not known here.
        // 32.25 and 41.4 — THE SLOT ABORTS, NOT THE DOCUMENT. Passed as a thunk because the throw
        // happens while the expression is being evaluated, so nothing a helper is HANDED can catch
        // it; `renderSlot` says what that costs.
        //
        // ONLY WHERE A `Reactive` IS READ, because only that can be unlanded. A row body reading
        // its own item — `{row.title}`, which is most slots on most pages — cannot throw this, and
        // wrapping it anyway put a closure in the hot loop: the card bench went 0.9 µs -> 1.7 µs at
        // 10 cards and 0.70x -> 1.20x against the hand-written page, which is the headline ratio
        // inverted for a guard that could never fire. `readsIn` is asked of the READS rather than
        // of the rewrite, which is the distinction its own note draws.
        const lowered = lowering.slot(node)
        return lowering.readsIn(node)
            ? `${lowering.use('renderSlot')}(() => ${lowered})`
            : `${lowering.use('escapeText')}(${lowered})`
    }

    if (node.kind === 'block' && node.block === 'for') {
        // 32.14 — the body repeats. 32.24: an absent subject iterates zero times, which is what
        // the guard is for rather than a `?? []` that would also swallow a genuine mistake.
        // 32.23: the subject is read ONCE for the whole block, not once per row.
        const subject = lowering.expression(node)
        const row = emitRow(node.children, lowering, client)
        const index = node.index === '' ? '__at' : node.index
        const item = node.item
        // 32.16 and 41.3 — AN ASYNC SUBJECT WRITES NO ROWS INLINE. The render is not held for an
        // unfinished stream, and an async iterable has produced nothing at the moment a document
        // is generated; the client appends each item as it arrives instead.
        //
        // THE SAME TEST THE CLIENT MAKES, because it is the same function: `listOf` answers an
        // array for everything a row can be built from now and hands an async iterable back as
        // itself, on both sides. Two copies of the test disagreed once — a stream carrying a
        // convenience `[Symbol.iterator]` was async here and sync there, so the page was blank
        // without JS and whole after hydration.
        const listOf = lowering.use('listOf')
        // AND 41.4 FOR A SUBJECT STILL IN FLIGHT. The read is the block's one expression, so an
        // unlanded one aborts it and nothing else: `slotValue` answers `undefined`, `listOf` reads
        // that as absent, and 32.24's zero rows is already what absent means here. Read ONCE for
        // the block (32.23), so the thunk is per block rather than per row — and still only where
        // the subject is a `Reactive`, for the slot's reason above.
        const guarded = lowering.readsIn(node)
            ? `${lowering.use('slotValue')}(() => ${subject})`
            : subject
        return `${JSON.stringify(`<!--${REGION_OPEN}-->`)} + ((__list) => {
        if (!Array.isArray(__list)) return ''
        let __out = ''
        let ${index} = 0
        for (const ${item} of __list) { __out += ${row}; ${index} += 1 }
        return __out
    })(${listOf}(${guarded})) + ${JSON.stringify(`<!--${REGION_CLOSE}-->`)}`
    }

    if (node.kind === 'block') {
        // 32.13 — ONE branch renders. The anchors go in whichever one that is, and stay when the
        // branch changes, which is what keeps every sibling after the region addressable.
        const arms = node.branches.map((branch) => ({
            subject: branch.subject === '' ? '' : lowering.expression(branch),
            body: emitMarkup(branch.children, lowering, client),
        }))
        let expression = "''"
        for (let at = arms.length - 1; at >= 0; at -= 1) {
            const arm = arms[at] as (typeof arms)[number]
            expression =
                arm.subject === ''
                    ? `(${arm.body})`
                    : `(${arm.subject} ? ${arm.body} : ${expression})`
        }
        return `${JSON.stringify(`<!--${REGION_OPEN}-->`)} + ${expression} + ${JSON.stringify(`<!--${REGION_CLOSE}-->`)}`
    }

    // 32.19 — A CAPITALISED TAG IS AN INVOCATION, and the capital is the whole of the
    // distinction. It is emitted as a CALL, so the child's own module renders it.
    if (isComponentTag(node.tag)) return emitInvocation(node, lowering, client)

    const parts: string[] = []
    let open = `<${node.tag}`
    // 32.11, 32.21 — EVERY `style:prop` ON ONE ELEMENT IS ONE `style` ATTRIBUTE. Written apart
    // they are two `style=` attributes on one tag, and a browser keeps the first: the second
    // declaration is dropped in silence, by the markup rather than by anything the compiler said.
    // The combined attribute stands where the FIRST of them did, so the tag keeps the author's
    // attribute order.
    const styles = node.attributes.filter(isStyleProperty)
    let stylesPending = styles.length > 0
    // A PLAIN `style` IS THE SAME ATTRIBUTE AND JOINS THE SAME MERGE. `isStyleProperty` answers
    // only for the `style:` prefix, so `<div style="color: red" style:width={w}>` wrote TWO
    // `style=` attributes and a browser keeps the first — the reactive declaration dropped in
    // silence, which is the loss the merge above exists to stop, arriving by the one spelling it
    // did not cover. Whichever of the two the author wrote first carries the merged attribute, so
    // the tag keeps its order either way.
    const plainStyle = stylesPending ? attributeOf(node, 'style') : undefined
    for (const attribute of node.attributes) {
        if (isStyleProperty(attribute) || attribute === plainStyle) {
            if (!stylesPending) continue
            stylesPending = false
            parts.push(JSON.stringify(`${open} style="`))
            if (plainStyle !== undefined) {
                if (plainStyle.expression) {
                    parts.push(
                        `${lowering.use('escapeAttribute')}(${lowering.slot(plainStyle)})`,
                    )
                } else parts.push(JSON.stringify(quoteOnly(plainStyle.value)))
                parts.push(JSON.stringify('; '))
            }
            parts.push(styleValue(styles, lowering), "'\"'")
            open = ''
            continue
        }
        const emitted = emitAttribute(attribute, lowering)
        if (typeof emitted === 'string') {
            open += emitted
            continue
        }
        // A computed value breaks the static run: what precedes it is a literal, the value is an
        // expression, and the tag carries on after it.
        parts.push(
            JSON.stringify(`${open} ${attribute.name}="`),
            emitted.value,
            "'\"'",
        )
        open = ''
    }
    open += '>'
    parts.push(JSON.stringify(open))

    // Folded for the reason `parseAbide` folds: `<BR>` is the same void element as
    // `<br>`, and a close tag written for one is markup no browser accepts.
    if (node.children.length === 0 && VOID_ELEMENTS.has(node.lowerTag))
        return parts.join(' + ')
    return [
        ...parts,
        ...emitChildren(node.children, lowering, client),
        JSON.stringify(`</${node.tag}>`),
    ].join(' + ')
}

// One invocation. The child is a function taking a record of ACCESSORS (33.4, 33.5): the prop is
// the caller's expression, not a snapshot of it, so the child re-reads when the parent's value
// moves and neither of them arranges that.
//
// A REGION, ANCHORED. The child's markup is written inline, and how many top-level nodes it has is
// a fact about ANOTHER FILE — so the parent cannot address the siblings that follow it by
// counting, the way it does for an element whose shape it can see. The anchors are what make the
// child's nodes one addressable thing, and they are the same pair `{#if}` uses.
function emitInvocation(
    node: Extract<TemplateNode, { kind: 'element' }>,
    lowering: Lowering,
    client: boolean,
): string {
    if (node.children.length > 0)
        throw new Error(
            `abide: <${node.tag}> is given children, and <slot/> is not built yet. RULEBOOK 32.20.`,
        )
    const props: string[] = []
    for (const attribute of node.attributes) {
        if (attribute.name.startsWith('...'))
            throw new Error(
                `abide: a spread on <${node.tag}> is not built yet. RULEBOOK 33.12.`,
            )
        if (attribute.name.includes(':'))
            throw new Error(
                `abide: ${attribute.name} on <${node.tag}> is not built yet. RULEBOOK 33.8.`,
            )
        // A STATIC PROP IS STILL AN ACCESSOR. One shape per prop whatever the call site spelled
        // (33.10), so the child reads every key the same way and a literal is not a second case.
        const value = attribute.expression
            ? lowering.expression(attribute)
            : JSON.stringify(attribute.value)
        props.push(`${JSON.stringify(attribute.name)}: () => (${value})`)
    }
    // IN THE BROWSER THE CHILD ANSWERS FOR ITSELF. `Row.html(props)` is the same template this
    // emitter writes on the server, emitted a second time into the child's client module — which
    // is the scheme `{#if}` and `{#for}` already use for their own markup, and the reason
    // `escapeText` is in #shared. A `<head>` contribution is the one thing it cannot carry: a row
    // built after the document was written has no head to add to (39.1).
    // THE ANCHORS ARE THE CALLER'S EITHER WAY. `renderComponent` writes them on the server, so the
    // client's own markup has to carry the same pair — the row is hydrated by `regionAt`, which
    // counts them, and a row built without them addresses the wrong nodes on its first update.
    // THE CALLER WRITES THE ANCHORS AND THE CHILD FILLS THEM. In the browser the child's markup is
    // the child's own business (see `emitClient`), so a row builder writes the empty pair and the
    // mount that follows puts the markup in. On the server the child is CALLED, its markup landing
    // between the same two anchors.
    return client
        ? JSON.stringify(`<!--${REGION_OPEN}--><!--${REGION_CLOSE}-->`)
        : `${lowering.use('renderComponent')}(${node.tag}, { ${props.join(', ')} }, ${HEADS})`
}

// 39.7 — THE CONTRIBUTIONS A PAGE MAKES TO THE DOCUMENT HEAD, as an expression, for the lane that
// has no document to have written them. A page the reader NAVIGATED to was never rendered by a
// server, so its `<title>` and its `<meta>` exist nowhere unless its own client module carries
// them — the same second copy the body already gets (32.19), through the same merge (39.13) so
// the two lanes cannot disagree about which contribution won.
export function emitHead(
    file: AbideFile,
    lowering: Lowering,
    client = false,
): string {
    const contributions: TemplateNode[] = []
    for (const node of file.template)
        if (node.kind === 'element' && isHead(node))
            for (const child of node.children) contributions.push(child)
    return emitMarkup(mergeHead(contributions), lowering, client)
}

// The markup for a set of nodes, as an expression. Exported because a `{#if}` arm's markup is
// needed on the CLIENT too — a branch swap re-renders the region — and a second emitter for it
// would be a second escaping rule.
export function emitMarkup(
    nodes: TemplateNode[],
    lowering: Lowering,
    client = false,
): string {
    return concat(emitChildren(nodes, lowering, client))
}

// One `{#for}` row's markup, which the client's `make` builds from too. A row with several
// top-level nodes has no node that IS the row, so it carries one anchor; a single-element row
// carries nothing.
export function emitRow(
    children: TemplateNode[],
    lowering: Lowering,
    client = false,
): string {
    const markup = emitMarkup(children, lowering, client)
    return isSingleRooted(children)
        ? markup
        : `${JSON.stringify(`<!--${ROW_OPEN}-->`)} + ${markup}`
}

// Emitted parts as one concatenation, and the empty string for none.
function concat(parts: string[]): string {
    return parts.length === 0 ? "''" : parts.join(' + ')
}

// One import specifier's clause. EVERY FRAMEWORK NAME IS BOUND UNDER `__`, the namespace an
// author does not write in: the escaping helpers are public on `abide`, so an author may import the
// same name into the same `<script>` — `import { safeUrl } from './mine.ts'` beside one
// `<a href={u}>` was `Identifier 'safeUrl' has already been declared` — and a `<script module>`
// declaring `setText` at module scope collides with a runtime import made as written just the same.
export function importClause(names: string[]): string {
    const written: string[] = []
    for (const name of names) written.push(`${name} as __${name}`)
    return written.join(', ')
}

// A run of adjacent text and expressions is emitted as ONE concatenation and carries no marker.
// The client finds it by its position, so nothing has to be put in the document to mark it — and
// nothing added is the only scheme that leaves CSS and `childNodes` answering what they would
// have answered for the page the author wrote.
function emitChildren(
    nodes: TemplateNode[],
    lowering: Lowering,
    client: boolean,
): string[] {
    const out: string[] = []
    for (const node of nodes) out.push(emitNode(node, lowering, client))
    return out
}

// The static markup an attribute writes into the tag, or the expression a computed one's value is.
function emitAttribute(
    attribute: Attribute,
    lowering: Lowering,
): string | { value: string } {
    if (attribute.expression) {
        // 32.5 — `on<event>` is a listener, never markup. The server writes nothing, so a handler
        // cannot fire from a document that never hydrated.
        if (isEventName(attribute.lowerName)) return ''
        // 32.4 — an expression attribute is reactive. Its CURRENT value is written here; the
        // client binding that keeps it live is not built yet.
        //
        // 32.22 IS THE INTERPOLATION'S CLAUSE, and the check used to run on the path it does not
        // name: the literal `href` was scheme-checked and `<a href={u}>` was served verbatim,
        // which is the one of the two where untrusted data actually arrives. The value is not
        // known here, so the guard is a call in the emitted markup — the same shape the escaping
        // already is, and the same one on both sides.
        const value = lowering.slot(attribute)
        const guarded = isUrlAttribute(attribute.lowerName)
            ? `${lowering.use('safeUrl')}(${value})`
            : value
        return {
            value: `${lowering.use('escapeAttribute')}(${guarded})`,
        }
    }
    // Dropped where the guard did not hand the value back — an empty `href` is its own answer and
    // is kept, which `=== ''` would have thrown away.
    if (
        isUrlAttribute(attribute.lowerName) &&
        safeUrl(attribute.value) !== attribute.value
    )
        return ''
    if (attribute.value === '') return ` ${attribute.name}`
    // 32.29 — STATIC TEMPLATE TEXT IS MARKUP, in an attribute value as much as in body text. A
    // static value is the AUTHOR'S OWN SOURCE and never a place untrusted data arrives, so the
    // rewrite is not a trust boundary here — it was a second answer to "is this markup?", and
    // `title="AT&amp;T"` rendered `AT&amp;T` on the page while the same six characters between
    // two tags rendered `AT&T`. The `"` is still encoded: it would end the attribute.
    //
    // 32.30 — AN ATTRIBUTE 32.22 SCHEME-CHECKS KEEPS THE WHOLE REWRITE, and that one IS a
    // boundary. `safeUrl` reads the bytes, and `&#106;avascript:` is not `javascript:` until a
    // browser decodes the entity — so encoding the `&` is what stops the entity forming at all,
    // and it is the only thing that does.
    return ` ${attribute.name}="${
        isUrlAttribute(attribute.lowerName)
            ? escapeAttribute(attribute.value)
            : quoteOnly(attribute.value)
    }"`
}

// The one rewrite a static attribute value still takes. Not `escapeAttribute`'s tail: that one
// runs over a value `escapeText` has already been through, and this runs over the author's bytes.
function quoteOnly(value: string): string {
    return value.includes('"') ? value.replaceAll('"', '&quot;') : value
}

// 39.4, 39.12, 39.13 — the contributions a `<head>` makes, merged by key, the LAST one for a key
// kept. 39.12 gives the key: the tag for the two elements a document holds one of, the `name` or
// `property` for a `<meta>`, and `rel` with `href` for a `<link>`. Anything else has no key and
// keeps its place, which is 39.5 and is what walking the list once and dropping only the shadowed
// entries gives.
//
// WITHIN ONE FILE IS ALL OF IT. 39.4's deepest contributor needs a layout to be deeper than, and
// there is no layout composition in this compiler — a page and its layout are not composed
// anywhere, so there is no depth to order by. Depth arrives with that composition and this is
// where it lands; nothing here stands in for one.
function mergeHead(children: TemplateNode[]): TemplateNode[] {
    const keys: (string | undefined)[] = []
    const winner = new Map<string, number>()
    for (let at = 0; at < children.length; at += 1) {
        const key = headKey(children[at] as TemplateNode)
        keys.push(key)
        if (key !== undefined) winner.set(key, at)
    }
    if (winner.size === 0) return children
    const kept: TemplateNode[] = []
    for (let at = 0; at < children.length; at += 1) {
        const key = keys[at]
        if (key !== undefined && winner.get(key) !== at) continue
        kept.push(children[at] as TemplateNode)
    }
    return kept
}

// 39.12 THROUGH THE ONE GRAMMAR (`headKeyOf`), asked with what the COMPILER can read. A key the
// compiler cannot read is no key: `<meta name={x}>` carries a name only the run time knows, so it
// appends under 39.5 rather than merging against a string that is not its value. `<TITLE>` is the
// same singleton as `<title>`, which `lowerTag` already gives.
function headKey(node: TemplateNode): string | undefined {
    if (node.kind !== 'element') return undefined
    // An `href` that is an EXPRESSION is a different URL per render, so the pair is not a key —
    // told apart from an ABSENT one, which is, and which two `<link rel="canonical">` share.
    // `headKeyOf` cannot tell the two apart, both reaching it as `undefined`, so the bail is here.
    if (node.lowerTag === 'link' && attributeOf(node, 'href')?.expression)
        return undefined
    return headKeyOf(node.lowerTag, (name) => staticAttribute(node, name))
}

function attributeOf(
    node: TemplateNode & { kind: 'element' },
    name: string,
): Attribute | undefined {
    for (const attribute of node.attributes)
        if (attribute.lowerName === name) return attribute
    return undefined
}

function staticAttribute(
    node: TemplateNode & { kind: 'element' },
    name: string,
): string | undefined {
    const attribute = attributeOf(node, name)
    return attribute === undefined || attribute.expression
        ? undefined
        : attribute.value
}

// 39.2 — a `<head>` MUST be top level, and MUST NOT appear inside a control block. Nested, it
// would render inside the body, which is the silent wrong answer this refuses instead.
//
// BOTH HALVES OF THE CLAUSE. The walk returned on anything that was not an element, so a block
// was a floor it never went through and `{#if a}<head>…{/if}` emitted `<head>` markup into the
// body — the exact wrong answer, from the check written to stop it. A `<head>` inside a top-level
// `<head>` was the other way past it, the hoist pushing its children without asking.
function assertNoNestedHead(nodes: TemplateNode[], within: string): void {
    for (const node of nodes) {
        if (node.kind === 'element') {
            if (isHead(node))
                throw new Error(
                    `abide: a <head> must be top level in a .abide file, and this one is inside ${within}. RULEBOOK 39.2.`,
                )
            assertNoNestedHead(node.children, `<${node.tag}>`)
            continue
        }
        if (node.kind !== 'block') continue
        if (node.block === 'for') assertNoNestedHead(node.children, '{#for}')
        else
            for (const branch of node.branches)
                assertNoNestedHead(branch.children, '{#if}')
    }
}

// 32.11 — `style:prop` sets ONE style property. The prefix is matched on the folded name; the
// PROPERTY is read from the author's spelling, because a CSS custom property is case-sensitive and
// `--Brand` is not `--brand`.
function isStyleProperty(attribute: Attribute): boolean {
    return (
        attribute.lowerName.length > 6 &&
        attribute.lowerName.startsWith('style:')
    )
}

// The declaration list a set of `style:prop` attributes renders as, as one expression. Each value
// takes the same rewrite the whole-value path takes, so one attribute has one answer however the
// author spelled it: 32.29 for a STATIC declaration, which is the author's own markup, and the
// full escape for an interpolated one, which is 32.1's.
function styleValue(styles: Attribute[], lowering: Lowering): string {
    const parts: string[] = []
    for (const attribute of styles) {
        const property = attribute.name.slice('style:'.length)
        const lead = parts.length === 0 ? '' : '; '
        if (!attribute.expression) {
            parts.push(
                JSON.stringify(
                    `${lead}${property}: ${quoteOnly(attribute.value)}`,
                ),
            )
            continue
        }
        parts.push(
            JSON.stringify(`${lead}${property}: `),
            `${lowering.use('escapeStyleValue')}(${lowering.slot(attribute)})`,
        )
    }
    return concat(parts)
}

// Given the FOLDED name (`Attribute.lowerName`): compared as written, `<a HREF={u}>` took the
// ordinary computed branch with no `safeUrl` around it — 32.22's check, skipped by a capital letter.
//
// A LEAF OF NAMES RATHER THAN FOUR COMPARISONS, because four was not the set: `xlink:href` is how
// an `<a>` inside `<svg>` spells the same attribute and `<svg><a xlink:href="javascript:…">`
// navigates in every browser, and `poster`, `cite`, `ping` and `object`'s `data` are URL-valued
// by the same HTML rule `href` is. The check is name-keyed and tag-blind, which is what makes an
// inert extra safe — a `cite` on something that is not a `<blockquote>` is not a URL a browser
// follows, so dropping a `javascript:` value there costs nothing — and `srcset` stays OUT because
// its value is a LIST with descriptors, which the scheme scan would read as one URL and drop
// whole. `srcdoc` is markup rather than a URL and is guarded by the escaping instead.
const URL_ATTRIBUTES = new Set([
    'href',
    'xlink:href',
    'src',
    'action',
    'formaction',
    'poster',
    'cite',
    'ping',
    'data',
    'manifest',
    'background',
])

function isUrlAttribute(lowerName: string): boolean {
    return URL_ATTRIBUTES.has(lowerName)
}
