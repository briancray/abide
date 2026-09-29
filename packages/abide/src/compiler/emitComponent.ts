import { escapeAttribute, escapeQuote } from '#shared/escapeText.ts'
import { headKeyOf } from '#shared/headKeyOf.ts'
import { isEventName } from '#shared/isEventName.ts'
import { safeUrl } from '#shared/safeUrl.ts'
import { URL_ATTRIBUTES } from '#shared/URL_ATTRIBUTES.ts'
import {
    REGION_CAUGHT,
    REGION_CLOSE,
    REGION_OPEN,
    ROW_OPEN,
} from '#ui/REGION.ts'
import { CHILDREN } from './CHILDREN.ts'
import { Cursor, type Position, placeTemplate } from './Cursor.ts'
import type { Read } from './classifyRead.ts'
import {
    explicitNames,
    isClassToggle,
    isComponentTag,
    isElementBind,
    isSingleRooted,
    isSlot,
    isStyleProperty,
    type ValueBind,
    valueBindOf,
} from './classifyTemplate.ts'
import { invocationProps } from './invocationProps.ts'
import { Lowering, PROPS } from './Lowering.ts'
import type { AbideFile } from './parseAbide.ts'
import { SERVER_SPECIFIER } from './SPECIFIERS.ts'
import { componentImports, splitImports, withoutProps } from './splitImports.ts'
import type { Attribute, TemplateNode } from './TemplateNode.ts'
import { VOID_ELEMENTS } from './VOID_ELEMENTS.ts'

// A region's anchors, as the JS string literals the emitted server render concatenates.
const OPEN_ANCHOR = JSON.stringify(`<!--${REGION_OPEN}-->`)
const CLOSE_ANCHOR = JSON.stringify(`<!--${REGION_CLOSE}-->`)
const CAUGHT_ANCHOR = JSON.stringify(`<!--${REGION_CAUGHT}-->`)
const EMPTY_REGION = JSON.stringify(
    `<!--${REGION_OPEN}--><!--${REGION_CLOSE}-->`,
)

// Where a component's own head contributions land, and the name the body is bound to while they
// do. Under `__` for the reason every framework name in an emitted module is.
const HEADS = '__heads'
const BODY = '__body'
// A page's or a layout's deferred build (41.19), and the share scope it resumes.
const SETTLED_AT = '__settledAt'
const BUILT = '__built'
const BUILD = '__build'
const BACK = '__back'

// The share scope an instance opens (10.5), named apart from the client's binding `Scope`: one is
// what a component's descendants look a key up through, the other is what stops its bindings.
const SHARED = '__shared'

// 10.5 — THE INSTANCE'S OWN SHARE SCOPE, opened around everything the instance does on either side,
// or nothing where it shares nothing. Closed in a `finally`, so an instance that threw leaves the
// scope it entered.
export function shareScope(
    lowering: Lowering,
    indent: string,
): { opened: string; closed: string } {
    if (!lowering.opensShareScope()) return { opened: '', closed: '' }
    return {
        opened: `${indent}const ${SHARED} = ${lowering.use('enterShare')}()\n${indent}try {\n`,
        closed: `\n${indent}} finally { ${lowering.use('leaveShare')}(${SHARED}) }`,
    }
}

// A parsed `.abide` file becomes one ESM module exporting a component. The `<script>` body is
// copied VERBATIM into the component function, which is the whole of 19.12 at this stage: the
// compiler does not read the expression grammar, so anything TypeScript accepts survives.
//
// The component returns its head and its body apart. 39.3 is why the split is HERE and not in
// `render`: the hoist is a compile-time partition of the template, so the emitted function has
// two returns rather than one string a renderer has to go looking through. 35.5 is answered by
// `render`, which turns the two into the byte stream a document is served as.

// `settles` IS A PAGE OR A LAYOUT, which `render` builds a level at a time (41.19): its setup runs at
// the call and its markup is built on the first read of `head` or `body`, so the calls the setup
// started are given the turn to answer that a component built inside its caller's markup is not.
// Every other component builds where it is called, and pays nothing for the difference.
export function emitComponent(
    file: AbideFile,
    reads: readonly Read[] = [],
    settles = false,
    // Where each `.abide` this file imports landed in the build (`componentGraph`).
    components: ReadonlyMap<string, string> = new Map(),
): string {
    // Only what the page actually uses. An emitted module carrying an import nothing calls is a
    // name the app's own tooling reports as unused, in a file nobody wrote.
    const lowering = new Lowering(file, reads)
    const used = lowering.used

    const page = new Cursor()
    placeTemplate(file.template, page)
    const body = renderLevel(page.top, lowering, false)

    // EMITTED AFTER THE BODY, NOT BEFORE. 39.12 merges across the whole FILE, so a second `<head>`
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
    // and this moves the moment 32.18 lets a component be invoked more than once inside one.
    const moduleSetup = splitImports(lowering.modules())
    const setup = splitImports(lowering.scripts())
    const componentBody = [moduleSetup.body, setup.body]
        .filter((part) => part !== '')
        .join('\n')

    // A child invoked inside `<head>` pushes to the same array from the head expression.
    const heads =
        head.includes(HEADS) || body.some((part) => part.includes(HEADS))
    // 10.5 — around the setup that calls `reactive.share`, and the body whose children are
    // rendered inside it and find it on the way up.
    const { opened, closed } = shareScope(lowering, '    ')

    // THE SETUP IS NOT RE-INDENTED. Adding a margin to every line rewrites the INSIDE of a
    // multi-line template literal, so `\`line one\nline two\`` gains four spaces it never had —
    // a changed string constant, in a file nobody reads.
    // 39.1 THROUGH A COMPONENT. A child contributes to the document head as a page does, and the
    // call that renders it stands inside the BODY expression — so the heads are collected as the
    // body is built and the body is bound to a name before the return reads them. The array is
    // emitted only where the page invokes something: a page with no component pays nothing.
    // `head` is read before `__heads.join` in the return, so a child in the head lands too.
    const build = `${heads ? `    const ${HEADS} = []\n` : ''}\
    const ${BODY} = ${concat(body)}
    return {
        head: ${head}${heads ? ` + ${HEADS}.join('')` : ''},
        body: ${BODY},
    }`
    // 41.19 — BUILT ON THE FIRST READ, and ONCE: `render` reads `head` and then `body`, and a
    // child the markup invokes must not be set up twice. The build resumes the share scope the
    // setup ran in (10.5), since by the time it is read the caller's has long been left — and that
    // scope is `scope` on the answer, so `composePage` sets the level below up inside it too.
    const answer = settles
        ? `    const ${SETTLED_AT} = ${lowering.use('currentShare')}()
    let ${BUILT}
    const ${BUILD} = () => {
        if (${BUILT} !== undefined) return ${BUILT}
        const ${BACK} = ${lowering.use('resumeShare')}(${SETTLED_AT})
        try {
            ${BUILT} = (() => {
${build}
            })()
        } finally {
            ${lowering.use('leaveShare')}(${BACK})
        }
        return ${BUILT}
    }
    return {
        scope: ${SETTLED_AT},
        get head() { return ${BUILD}().head },
        get body() { return ${BUILD}().body },
    }`
        : build
    const namesUsed = [...used].sort()
    return `${namesUsed.length === 0 ? '' : `import { ${importClause(namesUsed)} } from '${SERVER_SPECIFIER}'\n`}\
${componentImports(withoutProps(moduleSetup.imports), '', components)}${componentImports(withoutProps(setup.imports), '', components)}
export default function Component(${lowering.takesProps() ? `${PROPS} = {}` : ''}) {
${opened}${componentBody}
${answer}${closed}
}
`
}

// 32.24 and 41.4 — THE POSITION ABORTS, NOT THE DOCUMENT. `emitComponent` builds the markup as
// ONE concatenation, so an unlanded read anywhere in it threw out of `Component()` and took the
// static markup, every other position and the `<head>` with it. Passed as a THUNK because the
// throw happens while the expression is being evaluated, so nothing a helper is HANDED can catch
// it; `slotValue` says what that costs.
//
// EVERY MARKUP POSITION THAT EVALUATES AN AUTHOR EXPRESSION, rather than the two that were found
// first. A GUARD HERE IS HALF A MECHANISM — it trades a throw for a HOLE, and something on the
// client has to fill that hole once the value lands: a text slot has `runHere` and `textHere`, a
// `{#for}` has `List.hydrate`'s count check, an attribute has its own binding re-running on the
// value that landed (32.3), and the `{#if}` chain has `isEmptyRegion` — which is why that one is
// guarded at the REGION rather than per subject, and says so at its own arm. The ESCAPER STAYS
// OUTSIDE: absence is `undefined` here and what it means is already decided where it lands (see
// `slotValue`).
//
// ONLY WHERE THE POSITION IS LIVE (`Lowering.isLive`), because a position the checker proved reads
// nothing reactive cannot be unlanded — and one it could not prove can, through a function it
// calls as much as through a name it reads. A row body reading its own item — `{row.title}`, which
// is most slots on most pages — is proven, and wrapping it anyway put a closure in the hot loop:
// the card bench went 0.9 µs -> 1.7 µs at 10 cards and 0.70x -> 1.20x against the hand-written
// page, which is the headline ratio inverted for a guard that could never fire.
export function unlandable(
    lowering: Lowering,
    holder: object,
    lowered: string,
): string {
    if (!lowering.isLive(holder)) return lowered
    return slotValueOf(lowering, lowered)
}

// The wrap itself, apart from the `isLive` that decides it. The `{#if}` chain asks that question
// of its BRANCHES rather than of one holder (see its arm), so it cannot call `unlandable` — but it
// emits the same call, and one spelling is what keeps it the same call.
function slotValueOf(lowering: Lowering, lowered: string): string {
    return `${lowering.use('slotValue')}(() => ${lowered})`
}

// ONE POSITION'S MARKUP — the markup is RENDERED from what `placeTemplate` placed, the same
// positions a build constructs from and a mount walks, rather than written by a walk of its own.
//
// `client` is the LANE this markup is for. The server writes a component by CALLING it; the
// client builds a row's markup in the browser, where the child's server module is not reachable —
// so there it asks the child's own client module for the same markup instead.
function renderPosition(
    at: Position,
    lowering: Lowering,
    client: boolean,
): string {
    const node = at.holder

    // A RUN OF ADJACENT TEXT AND EXPRESSIONS is written as ONE concatenation and carries no marker.
    // The client finds it by its position, so nothing has to be put in the document to mark it —
    // and nothing added is the only scheme that leaves CSS and `childNodes` answering what they
    // would have answered for the page the author wrote.
    //
    // 32.1 — an expression is escaped at run time, never at compile time: the value is not known
    // here. The escaping is OUTSIDE the guard: `escapeText` reads the abort's `undefined` as '', so
    // a slot still in flight and one that genuinely answered nothing render the same.
    if (at.kind === 'text') {
        const parts: string[] = []
        for (const piece of at.run)
            parts.push(
                piece.kind === 'text'
                    ? JSON.stringify(piece.text)
                    : `${lowering.use('escapeText')}(${unlandable(lowering, piece, lowering.slot(piece))})`,
            )
        // 32.31 — A RUN THAT CAN HOLD MARKUP IS ANCHORED WHILE IT DOES (`markupRun`), so the client
        // finds the end of what a `Raw` part parsed into. The count is read BEFORE the parts are
        // escaped: arguments are evaluated in order.
        if (lowering.holdsMarkup(at.run))
            return `${lowering.use('markupRun')}(${lowering.use('RAW_WRITES')}.count, ${parts.join(' + ')})`
        return parts.join(' + ')
    }

    if (isSlot(node)) return emitSlot(at, lowering, client)

    if (node.kind === 'block' && node.block === 'for') {
        // 32.13 — the body repeats. 32.23: an absent subject iterates zero times, which is what
        // the guard is for rather than a `?? []` that would also swallow a genuine mistake.
        // 32.22: the subject is read ONCE for the whole block, not once per row.
        const subject = lowering.expression(node)
        const row = emitRow(
            at.inner[0] as Cursor,
            !isSingleRooted(node.children),
            lowering,
            client,
        )
        const index = node.index === '' ? '__at' : node.index
        const item = node.item
        // 32.15 and 41.3 — AN ASYNC SUBJECT WRITES NO ROWS INLINE. The render is not held for an
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
        // unlanded one aborts it and nothing else: the abort answers `undefined`, `listOf` reads
        // that as absent, and 32.23's zero rows is already what absent means here. Read ONCE for
        // the block (32.22), so the thunk is per block rather than per row.
        const guarded = unlandable(lowering, node, subject)
        // 14.8 — the row's branch-local `<script>`, run at the head of each row, untracked like the
        // component's own setup (14.7) since the render tracks nothing.
        const setup =
            node.setup === null ? '' : `${lowering.setup(node.setup)}\n`
        return `${OPEN_ANCHOR} + ((__list) => {
        if (!Array.isArray(__list)) return ''
        let __out = ''
        let ${index} = 0
        for (const ${item} of __list) { ${setup}__out += ${row}; ${index} += 1 }
        return __out
    })(${listOf}(${guarded})) + ${CLOSE_ANCHOR}`
    }

    // 32.16 — THE BODY, AND WHERE IT THROWS, THE CATCH IN ITS PLACE: rendered whole, so a failure
    // anywhere in the body replaces all of it rather than leaving the markup up to the hole that
    // raised it. The catch arm reads the failure under the name the author bound, and opens on the
    // anchor that tells the client which arm it is standing on.
    if (node.kind === 'block' && node.block === 'try') {
        const body = renderMarkup(at.inner[0] as Cursor, lowering, client)
        const rescue = renderMarkup(at.inner[1] as Cursor, lowering, client)
        const bound = node.error === '' ? '__failure' : node.error
        return `(() => {
        try {
            return ${OPEN_ANCHOR} + ${body}
        } catch (__thrown) {
            return ${CAUGHT_ANCHOR} + ((${bound}) => ${rescue})(__thrown)
        }
    })() + ${CLOSE_ANCHOR}`
    }

    if (node.kind === 'block') {
        // 32.12 — ONE branch renders. The anchors go in whichever one that is, and stay when the
        // branch changes, which is what keeps every sibling after the region addressable.
        //
        // 41.4 ABORTS THE REGION, NOT THE ARM, and that is why the guard is around the WHOLE
        // chain rather than around each subject the way every other position takes it. Guarded
        // per subject, an unlanded first condition is `undefined`, which is falsy — so the chain
        // walks on and paints the `{:else}` arm, a decision the client then has no way to know
        // was never really made. It reads the landed value a turn later, picks the other arm, and
        // hydrates its bindings against the arm the server actually wrote; where that arm has no
        // bindings there is nothing to walk, so 41.10 never fires and the region stays wrong for
        // as long as the condition does not CHANGE.
        //
        // AN EMPTY REGION IS THE ONE SIGNAL THAT ALREADY MEANS "NOBODY PAINTED THIS" — 32.18 gave
        // it to a component whose row the browser grew, and `isEmptyRegion` is how the client
        // reads it. So an aborted chain writes the anchor pair and nothing between it, and the
        // block's first run fills it from the arm it picks instead of hydrating markup that is
        // not there. Nothing is added to the document to carry any of this.
        //
        // A GENUINELY EMPTY ARM TAKES THE SAME PATH and costs a `fillRegion` with no build — no
        // node removed and none made. One answer for both beats a second way of saying
        // which arm was painted.
        // EACH ARM IS ITS OWN REGION ROOT — one sink apiece, so two arms may hold the same slot
        // names and neither can see the other's.
        // 14.8 — an arm's branch-local `<script>` runs before its markup, in a scope of its own.
        const arms = node.branches.map((branch, arm) => {
            const body = renderMarkup(at.inner[arm] as Cursor, lowering, client)
            return {
                subject:
                    branch.subject === '' ? '' : lowering.expression(branch),
                body:
                    branch.setup === null
                        ? body
                        : `(() => {\n${lowering.setup(branch.setup)}\nreturn ${body}\n})()`,
            }
        })
        let expression = "''"
        for (let at = arms.length - 1; at >= 0; at -= 1) {
            const arm = arms[at] as (typeof arms)[number]
            expression =
                arm.subject === ''
                    ? `(${arm.body})`
                    : `(${arm.subject} ? ${arm.body} : ${expression})`
        }
        // ONLY WHERE A SUBJECT IS LIVE, for `unlandable`'s reason: nothing else can be
        // unlanded, and the thunk is a closure per region per render where it is emitted. Asked
        // of the SUBJECTS alone — a slot inside an arm carries its own guard already, so a body
        // cannot be what throws through here.
        const guardable = node.branches.some(
            (branch) =>
                branch.subject !== '' && lowering.isLive(branch as object),
        )
        // `?? ''` IS THE ABORT'S OWN ANSWER, not a fallback decided twice: `slotValue` hands back
        // `undefined` and what `undefined` MEANS here is the empty region above.
        if (guardable)
            expression = `(${slotValueOf(lowering, expression)} ?? '')`
        return `${OPEN_ANCHOR} + ${expression} + ${CLOSE_ANCHOR}`
    }

    // EVERYTHING LEFT IS AN ELEMENT: a run returned above as a text position, and every block as a
    // region. A position of either kind holding anything else is the walk disagreeing with itself.
    if (node.kind !== 'element')
        throw new Error(
            `abide: a ${at.kind} position holds a ${node.kind} node.`,
        )

    // 32.18 — A CAPITALISED TAG IS AN INVOCATION, and the capital is the whole of the
    // distinction. It is emitted as a CALL, so the child's own module renders it.
    if (isComponentTag(node.tag))
        return emitInvocation(node, at, lowering, client)

    const parts: string[] = []
    let open = `<${node.tag}`
    for (const written of writtenAttributes(node)) {
        if (written.kind === 'static') {
            open += staticMarkup(written)
            continue
        }
        if (written.kind === 'bound') {
            parts.push(JSON.stringify(open), boundMarkup(written, lowering))
            open = ''
            continue
        }
        if (written.kind === 'spread') {
            parts.push(
                JSON.stringify(open),
                `${lowering.use('spreadAttributes')}(${unlandable(lowering, written.attribute, lowering.expression(written.attribute))}, ${JSON.stringify(written.explicit)})`,
            )
            open = ''
            continue
        }
        // 32.38 — a whole-value attribute may be absent, so it writes its own name and quotes.
        if (written.kind === 'dynamic') {
            parts.push(
                JSON.stringify(open),
                dynamicMarkup(written.attribute, lowering),
            )
            open = ''
            continue
        }
        // A computed value breaks the static run: what precedes it is a literal, the value is an
        // expression, and the tag carries on after it.
        parts.push(
            JSON.stringify(`${open} ${written.name}="`),
            mergedValue(written, lowering, markupRender(lowering)),
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
    const children = renderLevel(at.children, lowering, client)
    return [...parts, ...children, JSON.stringify(`</${node.tag}>`)].join(' + ')
}

// 32.19 — WHERE THE CALLER'S CHILDREN GO, and the fallback where there are none. A REGION, for
// the reason an invocation is one: what stands here is another file's markup, so the siblings
// after it cannot be addressed by counting through it.
//
// THE TWO LANES CARRY DIFFERENT THINGS UNDER THE SAME KEY. On the server the caller passes a
// thunk of its rendered markup, because a server writes markup and never addresses it; in the
// browser it passes a build AND the mount for it, because the bindings between those tags are the
// CALLER's and only the caller's module has them.
function emitSlot(at: Position, lowering: Lowering, client: boolean): string {
    const given = `${PROPS}[${JSON.stringify(CHILDREN)}]`
    // ON THE CLIENT LANE THE SLOT IS AN EMPTY PAIR, as an invocation is: what goes in it is either
    // the caller's children or this file's fallback, and the slot's own unit fills it by building
    // whichever it is (`emitClient`'s `emitSlot`). Writing either into this markup would make the
    // caller hand over its children as a string as well as a build.
    //
    // THE FALLBACK IS THE CHILD'S OWN REGION, placed from the slot's anchors exactly as an arm is
    // (`placeTemplate`). What the CALLER passed instead is the caller's markup and the caller's
    // addressing, so it is not this file's to place.
    if (client) return EMPTY_REGION
    const fallback = renderMarkup(at.inner[0] as Cursor, lowering, client)
    return `${OPEN_ANCHOR} + (${given} === undefined ? ${fallback} : ${given}()) + ${CLOSE_ANCHOR}`
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
    at: Position,
    lowering: Lowering,
    client: boolean,
): string {
    // 33.16 — `children` IS NEVER DECLARED, so a caller writing it as an attribute beside a body
    // is passing the same prop twice; the record would carry the key twice and the last one
    // would silently win.
    if (
        node.children.length > 0 &&
        node.attributes.some((attribute) => attribute.name === CHILDREN)
    )
        throw new Error(
            `abide: <${node.tag}> is given children as an attribute and between its tags. RULEBOOK 33.16.`,
        )
    const props = invocationProps(node, lowering)
    // THE CALLER WRITES THE ANCHORS AND THE CHILD FILLS THEM. On the server the child is CALLED,
    // its markup landing between the pair; in the browser the child's own module fills it (see
    // `emitClient`), which is why the client lane returns the empty pair.
    // 32.19 — THE CHILDREN ARE THE CALLER'S MARKUP, handed over as a thunk under the one key the
    // compiler owns. Not a prop the child declares: `props<T>()` is a shape an author wrote and
    // this is the tag's own body, so the child reaches it through `<slot/>` and nothing else.
    if (!client && node.children.length > 0)
        props.push(
            `${JSON.stringify(CHILDREN)}: () => (${renderMarkup(at.inner[0] as Cursor, lowering, client)})`,
        )
    return client
        ? EMPTY_REGION
        : `${lowering.use('renderComponent')}(${lowering.chosenTag(node) ?? node.tag}, { ${props.join(', ')} }, ${HEADS})`
}

// 39.6 — THE CONTRIBUTIONS A PAGE MAKES TO THE DOCUMENT HEAD, as an expression, for the lane that
// has no document to have written them. A page the reader NAVIGATED to was never rendered by a
// server, so its `<title>` and its `<meta>` exist nowhere unless its own client module carries
// them — the same second copy the body already gets (32.18), through the same merge (39.12) so
// the two lanes cannot disagree about which contribution won.
export function emitHead(
    file: AbideFile,
    lowering: Lowering,
    client: boolean,
): string {
    return renderMarkup(headSink(file), lowering, client)
}

// A file's head, placed. Merged before it is placed (39.12), so the head is the one markup placed
// here rather than rendered from positions the template walk already placed.
export function headSink(file: AbideFile): Cursor {
    const sink = new Cursor()
    placeTemplate(mergeHead(file.head), sink)
    return sink
}

// A region's markup, as an expression, rendered from its positions. Exported because a region made
// once is filled from it on the CLIENT too — a branch swap on a page re-renders the arm — and a
// second emitter for it would be a second escaping rule.
export function renderMarkup(
    sink: Cursor,
    lowering: Lowering,
    client: boolean,
): string {
    return concat(renderLevel(sink.top, lowering, client))
}

function renderLevel(
    positions: Position[],
    lowering: Lowering,
    client: boolean,
): string[] {
    const out: string[] = []
    for (const at of positions) out.push(renderPosition(at, lowering, client))
    return out
}

// One `{#for}` row's markup. A row with several top-level nodes has no node that IS the row, so it
// carries one anchor; a single-element row carries nothing.
export function emitRow(
    row: Cursor,
    anchored: boolean,
    lowering: Lowering,
    client: boolean,
): string {
    const markup = renderMarkup(row, lowering, client)
    return anchored
        ? `${JSON.stringify(`<!--${ROW_OPEN}-->`)} + ${markup}`
        : markup
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

// WHAT AN ELEMENT'S TAG CARRIES, in the order it carries it — the one answer both ways of making
// an element read. The markup writes each entry as bytes; a row the browser BUILDS writes each
// through `setAttribute` (`emitClient`'s `emitBuild`). Two readings of the attributes were two
// answers to "what does this tag say", and the build's copy had already drifted: it wrote a static
// `AT&amp;T` as those seven characters where the parser reads the server's bytes as `AT&T`.
//
// WHAT IS NOT MARKUP IS NOT HERE. 32.4 — `on<event>` is a listener, and the server writes nothing,
// so a handler cannot fire from a document that never hydrated. 32.9 — `bind:element` hands over
// the NODE, which a server has none of; written out it was `bind:element=""`, inert and a tell. A
// static URL 32.21 refuses is dropped here too, where the value is known — an empty `href` is its
// own answer and is kept, which `=== ''` would have thrown away.
//
// A MERGE GROUP STANDS AT ITS FIRST MEMBER and the rest write nothing, which is what keeps the tag
// in the author's attribute order (see `Merge`).
export type WrittenAttribute =
    // The author's own bytes, as written in the source.
    | { kind: 'static'; name: string; lowerName: string; value: string }
    | { kind: 'dynamic'; name: string; attribute: Attribute }
    // 32.11 — a spread's attributes, less the ones the element names itself.
    | { kind: 'spread'; name: '...'; attribute: Attribute; explicit: string[] }
    // 32.5, 32.7, 32.8 — a bind's value standing at render, as the attribute the property reflects:
    // `value` for text, and `checked` or `open` as a boolean attribute.
    | {
          kind: 'bound'
          name: 'value' | 'checked' | 'open'
          bind: ValueBind
          attribute: Attribute
          // 32.8 — a group member's own `value`, which the group is compared against.
          own: string
      }
    | {
          kind: 'merged'
          name: 'class' | 'style'
          plain: Attribute | undefined
          directives: Attribute[]
      }

export function writtenAttributes(
    node: TemplateNode & { kind: 'element' },
): WrittenAttribute[] {
    const merges = mergesOf(node)
    const written: WrittenAttribute[] = []
    for (const attribute of node.attributes) {
        const merge = merges.find((candidate) =>
            candidate.members.has(attribute),
        )
        if (merge !== undefined) {
            if (!merge.pending) continue
            merge.pending = false
            written.push({
                kind: 'merged',
                name: merge.name,
                plain: merge.plain,
                directives: merge.directives,
            })
            continue
        }
        if (attribute.expression) {
            if (attribute.name === '...') {
                written.push({
                    kind: 'spread',
                    name: '...',
                    attribute,
                    explicit: explicitNames(node),
                })
                continue
            }
            const bind = valueBindOf(attribute.lowerName)
            if (bind !== undefined) {
                // Only where the attribute is the property's own: `value` on an `<input>`, `checked`
                // on one, `open` on a `<details>`. A `<textarea>`'s or `<select>`'s value is not an
                // attribute, and is the client's to set.
                if (bind === 'value' && node.lowerTag !== 'input') continue
                written.push({
                    kind: 'bound',
                    name: bind === 'group' ? 'checked' : bind,
                    bind,
                    attribute,
                    own: staticAttribute(node, 'value') ?? 'on',
                })
                continue
            }
            if (
                isEventName(attribute.lowerName) ||
                isElementBind(attribute.lowerName)
            )
                continue
            written.push({ kind: 'dynamic', name: attribute.name, attribute })
            continue
        }
        // `URL_ATTRIBUTES` is keyed by the FOLDED name (`Attribute.lowerName`): compared as
        // written, `<a HREF={u}>` took the ordinary computed branch with no `safeUrl` around it —
        // 32.21's check, skipped by a capital letter.
        //
        // A LEAF OF NAMES RATHER THAN FOUR COMPARISONS, because four was not the set: `xlink:href`
        // is how an `<a>` inside `<svg>` spells the same attribute and
        // `<svg><a xlink:href="javascript:…">` navigates in every browser, and `poster`, `cite`,
        // `ping` and `object`'s `data` are URL-valued by the same HTML rule `href` is. The check
        // is name-keyed and tag-blind, which is what makes an inert extra safe — a `cite` on
        // something that is not a `<blockquote>` is not a URL a browser follows, so dropping a
        // `javascript:` value there costs nothing — and `srcset` stays OUT because its value is a
        // LIST with descriptors, which the scheme scan would read as one URL and drop whole.
        // `srcdoc` is markup rather than a URL and is guarded by the escaping instead.
        if (
            URL_ATTRIBUTES.has(attribute.lowerName) &&
            safeUrl(attribute.value) !== attribute.value
        )
            continue
        written.push({
            kind: 'static',
            name: attribute.name,
            lowerName: attribute.lowerName,
            value: attribute.value,
        })
    }
    return written
}

// 32.3 — an expression attribute is reactive. Its CURRENT value is written here, and `emitClient`'s
// own attribute loop is what keeps writing it after hydration.
//
// 32.21 IS THE INTERPOLATION'S CLAUSE: `<a href={u}>` is where untrusted data actually arrives, not
// the literal `href`. The value is not known here, so the guard is a call in the emitted markup —
// `attributeMarkup`, which also decides 32.38's absence, and which the client's binding answers
// through the same `attributeText`.
//
// 41.4 INSIDE BOTH GUARDS. The abort is nearest the read and the scheme check wraps it, so a `href`
// still in flight is checked as the empty value it renders as rather than skipping 32.21 on its way
// past.
function dynamicMarkup(attribute: Attribute, lowering: Lowering): string {
    const value = unlandable(lowering, attribute, lowering.slot(attribute))
    return `${lowering.use('attributeMarkup')}(${JSON.stringify(attribute.name)}, ${value})`
}

// 32.5, 32.7, 32.8 — A BIND'S VALUE AT RENDER, under 41.4's guard: a value still in flight writes
// nothing, which is what an empty input and an unchecked box already are.
function boundMarkup(
    written: WrittenAttribute & { kind: 'bound' },
    lowering: Lowering,
): string {
    const read = slotValueOf(
        lowering,
        `${lowering.use('boundValue')}(${lowering.reference(written.attribute)})`,
    )
    if (written.bind === 'value')
        return `' value="' + ${lowering.use('escapeAttribute')}(${read}) + '"'`
    const on =
        written.bind === 'group'
            ? `${lowering.use('groupHolds')}(${read}, ${JSON.stringify(written.own)})`
            : read
    return `(${on} ? ' ${written.name}' : '')`
}

// The static `value` an element carries, which a `bind:group` member is compared by.
// 32.28 — STATIC TEMPLATE TEXT IS MARKUP, in an attribute value as much as in body text. A static
// value is the AUTHOR'S OWN SOURCE and never a place untrusted data arrives, so the rewrite is not a
// trust boundary here — it was a second answer to "is this markup?", and `title="AT&amp;T"`
// rendered `AT&amp;T` on the page while the same six characters between two tags rendered `AT&T`.
// The `"` is still encoded: it would end the attribute.
//
// 32.29 — AN ATTRIBUTE 32.21 SCHEME-CHECKS KEEPS THE WHOLE REWRITE, and that one IS a boundary.
// `safeUrl` reads the bytes, and `&#106;avascript:` is not `javascript:` until a browser decodes
// the entity — so encoding the `&` is what stops the entity forming at all, and it is the only
// thing that does.
function staticMarkup(written: WrittenAttribute & { kind: 'static' }): string {
    if (written.value === '') return ` ${written.name}`
    return ` ${written.name}="${staticAttributeBytes(written.lowerName, written.value)}"`
}

// The bytes between the quotes a static value is served as — which is also what a BUILT row decodes
// (`decodeCharacterReferences`), so the two cannot read one value two ways.
export function staticAttributeBytes(lowerName: string, value: string): string {
    return URL_ATTRIBUTES.has(lowerName)
        ? escapeAttribute(value)
        : escapeQuote(value)
}

// 39.4, 39.11, 39.12 — the contributions a `<head>` makes, merged by key, the LAST one for a key
// kept. 39.11 gives the key: the tag for the two elements a document holds one of, the `name` or
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

// 39.11 THROUGH THE ONE GRAMMAR (`headKeyOf`), asked with what the COMPILER can read: an expression
// is present but unknown, so `<meta name={x}>` appends under 39.5 rather than merging against a
// string that is not its value. `<TITLE>` is the
// same singleton as `<title>`, which `lowerTag` already gives.
function headKey(node: TemplateNode): string | undefined {
    if (node.kind !== 'element') return undefined
    return headKeyOf(node.lowerTag, (name) => {
        const attribute = attributeOf(node, name)
        if (attribute === undefined) return null
        return attribute.expression ? undefined : attribute.value
    })
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

// 32.10, 32.20 — EVERY `style:prop` ON ONE ELEMENT IS ONE `style` ATTRIBUTE, and every
// `class:name` is ONE `class`. Written apart they are two attributes of the same name on one tag,
// and a browser keeps the first: the second is dropped in silence, by the markup rather than by
// anything the compiler said.
//
// THE AUTHOR'S OWN PLAIN `style=` OR `class=` IS A MEMBER OF THE GROUP, not an attribute beside
// it. `isStyleProperty` answers only for the prefix, so `<div style="color: red"
// style:width={w}>` wrote TWO `style=` attributes and a browser kept the first — the reactive
// declaration dropped in silence, which is the loss the merge exists to stop, arriving by the one
// spelling it did not cover.
type Merge = {
    // The attribute the group is written under.
    name: 'class' | 'style'
    // Every attribute the group swallows, the plain one included.
    members: Set<Attribute>
    plain: Attribute | undefined
    directives: Attribute[]
    // Whether the group still has to be written — see where it is read.
    pending: boolean
}

// TWO GROUPS, ONE FRAME. What differs between them is the value alone, so the finding and the
// ordering are written once and each way of making an element renders the value its own way.
const MERGED = [
    { name: 'style', is: isStyleProperty },
    { name: 'class', is: isClassToggle },
] as const

function mergesOf(node: TemplateNode & { kind: 'element' }): Merge[] {
    const merges: Merge[] = []
    for (const kind of MERGED) {
        const directives = node.attributes.filter(kind.is)
        if (directives.length === 0) continue
        const plain = attributeOf(node, kind.name)
        merges.push({
            name: kind.name,
            members: new Set(
                plain === undefined ? directives : [plain, ...directives],
            ),
            plain,
            directives,
            pending: true,
        })
    }
    return merges
}

// HOW A MERGED VALUE'S PIECES ARE WRITTEN, which is all that differs between the two ways of making
// an element. The markup ESCAPES — the bytes are parsed — and a built row writes what the parser
// would have made of them. The STRUCTURE — the order, the separators, which names — is `styleValue`
// and `classValue`'s alone, so a built `style` and a served one are the same string.
export type ValueRender = {
    // A whole attribute's value from an expression.
    dynamic: (attribute: Attribute) => string
    // One `style:prop`'s value from an expression — cut at its first `;` on both sides.
    declaration: (attribute: Attribute) => string
    // The author's own bytes, as the server writes them (32.28).
    bytes: (bytes: string) => string
}

function markupRender(lowering: Lowering): ValueRender {
    return {
        dynamic: (attribute) =>
            `${lowering.use('escapeAttribute')}(${unlandable(lowering, attribute, lowering.slot(attribute))})`,
        declaration: (attribute) =>
            `${lowering.use('escapeStyleValue')}(${unlandable(lowering, attribute, lowering.slot(attribute))})`,
        bytes: (bytes) => JSON.stringify(bytes),
    }
}

export function mergedValue(
    written: Extract<WrittenAttribute, { kind: 'merged' }>,
    lowering: Lowering,
    render: ValueRender,
): string {
    return written.name === 'style'
        ? styleValue(written.plain, written.directives, render)
        : classValue(written.plain, written.directives, lowering, render)
}

// The declaration list a set of `style:prop` attributes renders as. Each value takes the same
// rewrite the whole-value path takes, so one attribute has one answer however the author spelled
// it: 32.28 for a STATIC declaration, which is the author's own markup, and the full escape for an
// interpolated one, which is 32.1's.
function styleValue(
    plain: Attribute | undefined,
    styles: readonly Attribute[],
    render: ValueRender,
): string {
    const parts: string[] = []
    if (plain !== undefined)
        parts.push(
            plain.expression
                ? render.dynamic(plain)
                : render.bytes(escapeQuote(plain.value)),
            render.bytes('; '),
        )
    for (const attribute of styles) {
        const property = attribute.name.slice('style:'.length)
        const lead = parts.length === 0 ? '' : '; '
        if (!attribute.expression) {
            parts.push(
                render.bytes(
                    `${lead}${property}: ${escapeQuote(attribute.value)}`,
                ),
            )
            continue
        }
        parts.push(
            render.bytes(`${lead}${property}: `),
            render.declaration(attribute),
        )
    }
    return concat(parts)
}

// 32.10 — the class list a set of `class:name` attributes renders as. A NAME IS MARKUP AND A VALUE
// IS A CONDITION, which is the whole of what makes this shorter than its `style` sibling: the name
// is the author's own source and takes 32.28's rewrite where the module is emitted, and the
// expression decides only whether it is written at all.
//
// EACH NAME CARRIES ITS OWN LEADING SPACE rather than a separator being computed between them,
// because how many of them render is not known until the values are read. A run of spaces and a
// leading one are both nothing in a class attribute — the value is split on whitespace — where
// `style`'s `;` has to be counted.
function classValue(
    plain: Attribute | undefined,
    classes: readonly Attribute[],
    lowering: Lowering,
    render: ValueRender,
): string {
    const parts: string[] = []
    if (plain !== undefined)
        parts.push(
            plain.expression
                ? render.dynamic(plain)
                : render.bytes(escapeQuote(plain.value)),
        )
    for (const attribute of classes) {
        const written = render.bytes(
            ` ${escapeQuote(attribute.name.slice('class:'.length))}`,
        )
        // A `class:name` WITH NO EXPRESSION is a name with no condition on it — `class:active`
        // alone, or `class:active="anything"` — and a name that is always written is exactly what
        // the author's own `class` attribute is. Rendered as one rather than refused: there is
        // nothing about it a clause forbids and nothing for a build error to save.
        parts.push(
            attribute.expression
                ? `(${unlandable(lowering, attribute, lowering.slot(attribute))} ? ${written} : '')`
                : written,
        )
    }
    return concat(parts)
}
