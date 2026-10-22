import { REGION_CLOSE, REGION_OPEN, ROW_OPEN } from '#shared/ANCHORS.ts'
import { anchorMarkup, regionMarkup } from '#shared/anchorMarkup.ts'
import { armAnchor } from '#shared/armAnchor.ts'
import { CHILDREN } from '#shared/CHILDREN.ts'
import { escapeQuote } from '#shared/escapeText.ts'
import { headKeyOf } from '#shared/headKeyOf.ts'
import { Cursor, type PlacedNode, placeTemplate } from './Cursor.ts'
import {
    attributeOf,
    type ClassifiedAttribute,
    classifyAttributes,
    holdsSetup,
    isComponentTag,
    isSingleRooted,
    isSlot,
    type MergeGroup,
} from './classifyTemplate.ts'
import { invocationProps, passedName } from './invocationProps.ts'
import { type Lowering, PROPS } from './Lowering.ts'
import type { AbideFile } from './parseAbide.ts'
import { shareScope } from './shareScope.ts'
import type {
    Attribute,
    ElementNode,
    InlineComponent,
    TemplateNode,
} from './TemplateNode.ts'
import { VOID_ELEMENTS } from './VOID_ELEMENTS.ts'

// A TEMPLATE AS MARKUP, as one emitted expression, for either module that writes it: the server's,
// which renders a document, and the client's, which renders a region the browser makes — an arm,
// a row, a page navigated to. Rendered from what `placeTemplate` placed, the same positions a build
// constructs from and a mount walks, so there is one escaping rule and one description of where a
// node stands, whichever side writes it.

/**
 * Which module a markup is rendered into, and what that module leaves to another to fill.
 *
 * THE SERVER RENDERS EVERYTHING: a component by CALLING it, a slot by its fallback or the caller's
 * thunk, and a region's inline components declared ahead of its markup. THE CLIENT renders where
 * the child's server module is not reachable and the bindings are the mount's own: so where another
 * module fills a region — the child, the slot's own unit, a block's own swap — it writes the anchor
 * pair for that module to fill, and it declares nothing, because the mount does (`emitClient`).
 */
export type MarkupLane = {
    /** What stands for a node another module fills, or `undefined` where this lane renders it. */
    leftEmpty: (node: TemplateNode) => string | undefined
    /** 32.43 — the statements declaring a region's inline components ahead of its markup. */
    declarations: (sink: Cursor, lowering: Lowering) => string
    /**
     * 41.24 — the open anchor of an `{#if}` arm that painted, as a string literal.
     *
     * The server's names the arm, for the hydrating swap to check; the client's does not, because
     * the browser adopts what it rendered in the turn it chose the arm.
     */
    armAnchor: (arm: number) => string
}

export const SERVER_LANE: MarkupLane = {
    leftEmpty: () => undefined,
    declarations: (sink, lowering) => definitions(sink, lowering),
    armAnchor: (arm) => JSON.stringify(anchorMarkup(armAnchor(arm))),
}

export const CLIENT_LANE: MarkupLane = {
    leftEmpty: (node) => {
        // 32.18 — the slot's own unit fills it with the caller's children or this file's fallback,
        // by building whichever it is (`emitClient`'s `emitSlot`). Writing either here would make
        // the caller hand its children over as a string as well as a build.
        if (isSlot(node)) return EMPTY_REGION
        // 34.7 — A BLOCK WITH A BRANCH-LOCAL `<script>` IS LEFT EMPTY, for its own swap or list to
        // fill. Rendered inline here the script ran once for the markup and again in the setup its
        // mount closes over, so each arm or row the browser built ran it twice — and the first
        // run's watches had no scope to land in (12.13). An empty region is what the block already
        // fills without a word (32.17, 41.4), so it costs one more fill and adds nothing.
        if (holdsSetup(node)) return `${OPEN_ANCHOR} + ${CLOSE_ANCHOR}`
        // 32.17 — the child's own client module fills its region.
        if (node.kind === 'element' && isComponentTag(node.tag))
            return EMPTY_REGION
        return undefined
    },
    declarations: () => '',
    armAnchor: () => OPEN_ANCHOR,
}

// A region's anchors, as the JS string literals the emitted server render concatenates.
const OPEN_ANCHOR = JSON.stringify(anchorMarkup(REGION_OPEN))
const CLOSE_ANCHOR = JSON.stringify(anchorMarkup(REGION_CLOSE))
// 32.16 — the catch is the `{#try}`'s arm 1, named so the client hydrates the catch the server
// painted rather than walking it as the body.
const CAUGHT_ANCHOR = JSON.stringify(anchorMarkup(armAnchor(1)))
const ROW_ANCHOR = JSON.stringify(anchorMarkup(ROW_OPEN))
const EMPTY_REGION = JSON.stringify(regionMarkup(''))

// Where a component's own head contributions land. Under `__` for the reason every framework name
// in an emitted module is.
export const HEADS = '__heads'

/**
 * A lowered markup position wrapped in `slotValue` where it is live, so an unlanded read aborts it.
 *
 * 32.23 and 41.4 — THE POSITION ABORTS, NOT THE DOCUMENT. `emitComponent` builds the markup as
 * ONE concatenation, so an unlanded read anywhere in it threw out of `Component()` and took the
 * static markup, every other position and the `<head>` with it. Passed as a THUNK because the
 * throw happens while the expression is being evaluated, so nothing a helper is HANDED can catch
 * it; `slotValue` says what that costs.
 *
 * EVERY MARKUP POSITION THAT EVALUATES AN AUTHOR EXPRESSION, rather than the two that were found
 * first. A GUARD HERE IS HALF A MECHANISM — it trades a throw for a HOLE, and something on the
 * client has to fill that hole once the value lands: a text slot has `runHere` and `textHere`, a
 * `{#for}` has `List.hydrate`'s count check, an attribute has its own binding rerunning on the
 * value that landed (32.3), and the `{#if}` chain has `isEmptyRegion` — which is why that one is
 * guarded at the REGION rather than per subject, and says so at its own arm. The ESCAPER STAYS
 * OUTSIDE: absence is `undefined` here and what it means is already decided where it lands (see
 * `slotValue`).
 *
 * ONLY WHERE THE POSITION IS LIVE (`Lowering.isLive`), because a position the checker proved reads
 * nothing reactive cannot be unlanded — and one it could not prove can, through a function it
 * calls as much as through a name it reads. A row body reading its own item — `{row.title}`, which
 * is most slots on most pages — is proven, and wrapping it anyway put a closure in the hot loop:
 * the card bench went 0.9 µs -> 1.7 µs at 10 cards and 0.70x -> 1.20x against the hand-written
 * page, which is the headline ratio inverted for a guard that could never fire.
 */
export function unlandable(
    lowering: Lowering,
    holder: object,
    lowered: string,
): string {
    if (!lowering.isLive(holder)) return lowered
    return slotValueOf(lowering, lowered)
}

/**
 * A lowered expression wrapped in `slotValue`, whatever `isLive` says.
 *
 * The wrap itself, apart from the `isLive` that decides it. The `{#if}` chain asks that question
 * of its BRANCHES rather than of one holder (see its arm), so it cannot call `unlandable` — but it
 * emits the same call, and one spelling is what keeps it the same call.
 */
function slotValueOf(lowering: Lowering, lowered: string): string {
    return `${lowering.use('slotValue')}(() => ${lowered})`
}

/**
 * One position's markup, as an emitted expression.
 *
 * The markup is RENDERED from what `placeTemplate` placed, the same positions a build constructs
 * from and a mount walks, rather than written by a walk of its own.
 *
 * `lane` is the module this markup is for (`MarkupLane`).
 */
function renderPosition(
    at: PlacedNode,
    lowering: Lowering,
    lane: MarkupLane,
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
                    : `${lowering.use('escapeText')}(${unlandable(lowering, piece, lowering.expression(piece))})`,
            )
        // 32.30 — A RUN THAT CAN HOLD MARKUP IS ANCHORED WHILE IT DOES (`markupRun`), so the client
        // finds the end of what a `Raw` part parsed into. The count is read BEFORE the parts are
        // escaped: arguments are evaluated in order.
        if (lowering.holdsMarkup(at.run))
            return `${lowering.use('markupRun')}(${lowering.use('RAW_WRITES')}.count, ${parts.join(' + ')})`
        return parts.join(' + ')
    }

    const left = lane.leftEmpty(node)
    if (left !== undefined) return left

    if (isSlot(node)) return slotMarkup(at, lowering)

    if (node.kind === 'block' && node.block === 'for') {
        // 32.13 — the body repeats. 32.22: an absent subject iterates zero times, which is what
        // the guard is for rather than a `?? []` that would also swallow a genuine mistake.
        // 32.21: the subject is read ONCE for the whole block, not once per row.
        const subject = lowering.expression(node)
        const row = rowMarkup(
            at.inner[0] as Cursor,
            !isSingleRooted(node.children),
            lowering,
            lane,
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
        // that as absent, and 32.22's zero rows is already what absent means here. Read ONCE for
        // the block (32.21), so the thunk is per block rather than per row.
        const guarded = unlandable(lowering, node, subject)
        // 14.8 — the row's branch-local `<script>`, run at the head of each row, untracked like the
        // component's own setup (14.7) since the render tracks nothing.
        // 32.43 — and the components it declares, each closing over the row.
        const setup = `${node.setup === null ? '' : `${lowering.setup(node.setup)}\n`}${lane.declarations(at.inner[0] as Cursor, lowering)}`
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
        const body = renderMarkup(at.inner[0] as Cursor, lowering, lane)
        const rescue = renderMarkup(at.inner[1] as Cursor, lowering, lane)
        const bound = node.error === '' ? '__failure' : node.error
        return `(() => {
        try {
            ${lane.declarations(at.inner[0] as Cursor, lowering)}return ${OPEN_ANCHOR} + ${body}
        } catch (__thrown) {
            return ${CAUGHT_ANCHOR} + ((${bound}) => ${scoped(lane.declarations(at.inner[1] as Cursor, lowering), rescue)})(__thrown)
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
        // AN EMPTY REGION IS THE ONE SIGNAL THAT ALREADY MEANS "NOBODY PAINTED THIS" — 32.17 gave
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
        const bodies = node.branches.map((branch, arm) =>
            scoped(
                `${branch.setup === null ? '' : `${lowering.setup(branch.setup)}\n`}${lane.declarations(at.inner[arm] as Cursor, lowering)}`,
                renderMarkup(at.inner[arm] as Cursor, lowering, lane),
            ),
        )
        // 41.24 — EACH ARM OPENS ON ITS OWN ANCHOR, which on the server names it. The floor and an
        // aborted chain paint nothing, and the plain open is all an empty region needs.
        let expression = `(${chosenArm(node.branches, lowering, (arm) => `${lane.armAnchor(arm)} + (${bodies[arm]})`, OPEN_ANCHOR)})`
        // ONLY WHERE A SUBJECT IS LIVE, for `unlandable`'s reason: nothing else can be
        // unlanded, and the thunk is a closure per region per render where it is emitted. Asked
        // of the SUBJECTS alone — a slot inside an arm carries its own guard already, so a body
        // cannot be what throws through here.
        //
        // `?? OPEN_ANCHOR` IS THE ABORT'S OWN ANSWER, not a fallback decided twice: `slotValue` hands
        // back `undefined` and what `undefined` MEANS here is the empty region above.
        if (lowering.isLiveChain(node.branches))
            expression = `(${slotValueOf(lowering, expression)} ?? ${OPEN_ANCHOR})`
        return `${expression} + ${CLOSE_ANCHOR}`
    }

    // EVERYTHING LEFT IS AN ELEMENT: a run returned above as a text position, and every block as a
    // region. A position of either kind holding anything else is the walk disagreeing with itself.
    if (node.kind !== 'element')
        throw new Error(
            `abide: a ${at.kind} position holds a ${node.kind} node.`,
        )

    // 32.17 — A CAPITALIZED TAG IS AN INVOCATION, and the capital is the whole of the
    // distinction. It is emitted as a CALL, so the child's own module renders it.
    if (isComponentTag(node.tag)) return invocationMarkup(node, at, lowering)

    const parts: string[] = []
    let open = `<${node.tag}`
    // 32.61 — a `<textarea>`'s or `<select>`'s bound value, which is written inside the tag.
    let within: string | undefined
    // WHAT IS NOT MARKUP IS NOT WRITTEN: a listener, `bind:element`, a refused URL, a bind whose
    // value is not an attribute, and every merge member after the one the group is written at.
    for (const one of classifyAttributes(node, lowering)) {
        if (one.kind === 'static') {
            if (one.bytes !== undefined) open += staticMarkup(one, one.bytes)
            continue
        }
        if (one.kind === 'bound') {
            if (one.reflects === undefined) {
                if (one.bind === 'value') within = boundRead(one, lowering)
                continue
            }
            parts.push(JSON.stringify(open), boundMarkup(one, lowering))
            open = ''
            continue
        }
        if (one.kind === 'spread') {
            parts.push(
                JSON.stringify(open),
                `${lowering.use('spreadAttributes')}(${unlandable(lowering, one.attribute, lowering.expression(one.attribute))}, ${JSON.stringify(one.explicit)})`,
            )
            open = ''
            continue
        }
        // 32.37 — a whole-value attribute may be absent, so it writes its own name and quotes.
        if (one.kind === 'dynamic') {
            parts.push(
                JSON.stringify(open),
                dynamicMarkup(one.attribute, lowering),
            )
            open = ''
            continue
        }
        if (one.kind !== 'merged' || one.group === undefined) continue
        // A computed value breaks the static run: what precedes it is a literal, the value is an
        // expression, and the tag carries on after it.
        parts.push(
            JSON.stringify(`${open} ${one.group.name}="`),
            mergedValue(one.group, lowering, markupRender(lowering)),
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
    // 32.61 — THE VALUE AS THE TEXT, led by the newline the parser drops after `<textarea>` so a
    // value opening on one keeps it. The author wrote none: 32.72 refuses it beside the bind.
    if (within !== undefined && node.lowerTag === 'textarea')
        return [
            ...parts,
            `'\\n' + ${lowering.use('escapeAttribute')}(${within})`,
            JSON.stringify(`</${node.tag}>`),
        ].join(' + ')
    const children = renderLevel(at.children, lowering, lane)
    if (within !== undefined && node.lowerTag === 'select')
        return [
            ...parts,
            `${lowering.use('selectedMarkup')}(${concat(children)}, ${within})`,
            JSON.stringify(`</${node.tag}>`),
        ].join(' + ')
    return [...parts, ...children, JSON.stringify(`</${node.tag}>`)].join(' + ')
}

/**
 * A `<slot/>`'s markup: the caller's children, or the fallback where there are none, anchored.
 *
 * 32.18 — A REGION, for the reason an invocation is one: what stands here is another file's
 * markup, so the siblings after it cannot be addressed by counting through it.
 *
 * THE TWO LANES CARRY DIFFERENT THINGS UNDER THE SAME KEY. On the server the caller passes a
 * thunk of its rendered markup, because a server writes markup and never addresses it; in the
 * browser it passes a build AND the mount for it, because the bindings between those tags are the
 * CALLER's and only the caller's module has them — so the client lane leaves the slot empty
 * (`MarkupLane`).
 *
 * THE FALLBACK IS THE CHILD'S OWN REGION, placed from the slot's anchors exactly as an arm is
 * (`placeTemplate`). What the CALLER passed instead is the caller's markup and the caller's
 * addressing, so it is not this file's to place.
 */
function slotMarkup(at: PlacedNode, lowering: Lowering): string {
    const given = `${PROPS}[${JSON.stringify(CHILDREN)}]`
    const fallback = renderMarkup(at.inner[0] as Cursor, lowering, SERVER_LANE)
    return `${OPEN_ANCHOR} + (${given} === undefined ? ${scoped(definitions(at.inner[0] as Cursor, lowering), fallback)} : ${given}()) + ${CLOSE_ANCHOR}`
}

/**
 * One component invocation's markup: the child called, its markup landing between the anchors.
 *
 * The child is a function taking a record of ACCESSORS (33.4, 33.5): the prop is the caller's
 * expression, not a snapshot of it, so the child re-reads when the parent's value moves and
 * neither of them arranges that.
 *
 * A REGION, ANCHORED. The child's markup is written inline, and how many top-level nodes it has is
 * a fact about ANOTHER FILE — so the parent cannot address the siblings that follow it by
 * counting, the way it does for an element whose shape it can see. The anchors are what make the
 * child's nodes one addressable thing, and they are the same pair `{#if}` uses.
 */
function invocationMarkup(
    node: ElementNode,
    at: PlacedNode,
    lowering: Lowering,
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
    // THE CALLER WRITES THE ANCHORS AND THE CHILD FILLS THEM: here by calling the child, and in the
    // browser by the child's own module (`MarkupLane`).
    // 32.18 — THE CHILDREN ARE THE CALLER'S MARKUP, handed over as a thunk under the one key the
    // compiler owns. Not a prop the child declares: `props<T>()` is a shape an author wrote and
    // this is the tag's own body, so the child reaches it through `<slot/>` and nothing else.
    if (node.children.length > 0)
        props.push(
            `${JSON.stringify(CHILDREN)}: () => ${scoped(definitions(at.inner[0] as Cursor, lowering), `(${renderMarkup(at.inner[0] as Cursor, lowering, SERVER_LANE)})`)}`,
        )
    return `${lowering.use('renderComponent')}(${lowering.chosenTag(node) ?? node.tag}, { ${props.join(', ')} }, ${HEADS})`
}

/**
 * A file's head contributions, merged and placed.
 *
 * Merged before it is placed (39.12), so the head is the one markup placed here rather than
 * rendered from positions the template walk already placed. 39.6 — and placed for both lanes: a
 * page the reader NAVIGATED to was never rendered by a server, so its `<title>` and its `<meta>`
 * exist nowhere unless its own client module carries them, through the same merge so the two
 * lanes cannot disagree about which contribution won.
 */
export function headSink(file: AbideFile): Cursor {
    const sink = new Cursor()
    placeTemplate(mergeHead(file.head), sink)
    return sink
}

/**
 * A region's markup, as an emitted expression, rendered from its positions.
 *
 * Exported because a region made once is filled from it on the CLIENT too — a branch swap on a
 * page re-renders the arm — and a second emitter for it would be a second escaping rule.
 */
export function renderMarkup(
    sink: Cursor,
    lowering: Lowering,
    lane: MarkupLane,
): string {
    return concat(renderLevel(sink.top, lowering, lane))
}

/** Each position's markup, apart: the server's body reads them before it joins them. */
export function renderLevel(
    positions: PlacedNode[],
    lowering: Lowering,
    lane: MarkupLane,
): string[] {
    const out: string[] = []
    for (const at of positions) out.push(renderPosition(at, lowering, lane))
    return out
}

/**
 * Which arm of an `{#if}` chain takes, as one expression: each subject in turn, then `{:else}`, and
 * `none` where no arm takes.
 *
 * 32.12, 41.24 — ONE FOLD FOR BOTH SIDES, because the arm the server paints is the arm the client
 * hydrates against: `arm` is what each side makes of the arm it chose.
 */
export function chosenArm(
    branches: readonly { subject: string }[],
    lowering: Lowering,
    arm: (index: number) => string,
    none: string,
): string {
    let chosen = none
    for (let index = branches.length - 1; index >= 0; index -= 1) {
        const branch = branches[index] as { subject: string }
        chosen =
            branch.subject === ''
                ? arm(index)
                : `(${lowering.expression(branch)}) ? ${arm(index)} : ${chosen}`
    }
    return chosen
}

/**
 * One `{#for}` row's markup, led by a row anchor where `anchored`.
 *
 * A row with several top-level nodes has no node that IS the row, so it carries one anchor; a
 * single-element row carries nothing.
 */
export function rowMarkup(
    row: Cursor,
    anchored: boolean,
    lowering: Lowering,
    lane: MarkupLane,
): string {
    const markup = renderMarkup(row, lowering, lane)
    return anchored ? `${ROW_ANCHOR} + ${markup}` : markup
}

/**
 * The statements declaring a region's inline components on the server: the ones its body declares
 * (32.43), each under its name, and the ones an invocation in it is passed (32.50), each under
 * `passedName`.
 *
 * 32.42 — DECLARED WHERE THE REGION IS BUILT, so each is a closure over every name in scope there:
 * the setup's, a row's item, an arm's own, an enclosing component's props.
 */
export function definitions(sink: Cursor, lowering: Lowering): string {
    let out = ''
    for (const component of sink.components)
        out += `${serverComponent(component, lowering)}\n`
    for (const at of sink.positions)
        if (at.kind === 'region' && at.holder.kind === 'element')
            for (const passed of at.holder.passed)
                out += `const ${passedName(passed)} = ${serverComponent(passed, lowering)}\n`
    return out
}

/**
 * An inline component on the server: the function a file component's module exports, declared in
 * place.
 *
 * 32.17, 32.40 — CALLED AS A FILE COMPONENT IS (`renderComponent`), with the record of accessors its
 * pattern binds from, and answering its head and its body apart. It has no head of its own (39.2).
 */
function serverComponent(
    component: InlineComponent,
    lowering: Lowering,
): string {
    const sink = new Cursor()
    sink.components = component.components
    placeTemplate(component.children, sink)
    const head =
        component.pattern === '' ? '' : `${lowering.setup(component)}\n`
    const setup =
        component.setup === null ? '' : `${lowering.setup(component.setup)}\n`
    // 10.5, 32.46 — AN INSTANCE OPENS ITS OWN SHARE SCOPE, as a file component's does: two of it
    // standing side by side are two instances, each creating what no ancestor holds (10.6).
    const { opened, closed } = shareScope(lowering, '')
    return `function ${component.name}(${PROPS} = {}) {
${opened}${head}${setup}${definitions(sink, lowering)}return { head: '', body: ${renderMarkup(sink, lowering, SERVER_LANE)}, document: undefined }${closed}
}`
}

/** `markup` with `prelude` run ahead of it, in a scope of its own where there is one. */
function scoped(prelude: string, markup: string): string {
    return prelude === ''
        ? markup
        : `(() => {\n${prelude}\nreturn ${markup}\n})()`
}

/** Emitted parts as one concatenation, and the empty string for none. */
export function concat(parts: string[]): string {
    return parts.length === 0 ? "''" : parts.join(' + ')
}

/**
 * An expression attribute's markup at render, through `attributeMarkup`.
 *
 * 32.3 — an expression attribute is reactive. Its CURRENT value is written here, and
 * `emitClient`'s own attribute loop is what keeps writing it after hydration.
 *
 * 32.20 IS THE INTERPOLATION'S CLAUSE: `<a href={u}>` is where untrusted data actually arrives, not
 * the literal `href`. The value is not known here, so the guard is a call in the emitted markup —
 * `attributeMarkup`, which also decides 32.37's absence, and which the client's binding answers
 * through the same `attributeText`.
 *
 * 41.4 INSIDE BOTH GUARDS. The abort is nearest the read and the scheme check wraps it, so a `href`
 * still in flight is checked as the empty value it renders as rather than skipping 32.20 on its way
 * past.
 */
function dynamicMarkup(attribute: Attribute, lowering: Lowering): string {
    const value = unlandable(
        lowering,
        attribute,
        lowering.expression(attribute),
    )
    return `${lowering.use('attributeMarkup')}(${JSON.stringify(attribute.name)}, ${value})`
}

/**
 * A bind's value at render, as the attribute its property reflects.
 *
 * 32.5, 32.7, 32.8 — under 41.4's guard: a value still in flight writes nothing, which is what an
 * empty input and an unchecked box already are.
 */
function boundMarkup(
    written: ClassifiedAttribute & { kind: 'bound' },
    lowering: Lowering,
): string {
    const read = boundRead(written, lowering)
    if (written.bind === 'value')
        return `' value="' + ${lowering.use('escapeAttribute')}(${read}) + '"'`
    const on =
        written.bind === 'group'
            ? `${lowering.use('groupHolds')}(${read}, ${
                  written.own === undefined
                      ? "'on'"
                      : written.own.expression
                        ? unlandable(
                              lowering,
                              written.own,
                              lowering.expression(written.own),
                          )
                        : JSON.stringify(written.own.value)
              })`
            : read
    return `(${on} ? ' ${written.reflects}' : '')`
}

/** A bind's value at render, under 41.4's guard: `undefined` while it is in flight. */
function boundRead(
    written: ClassifiedAttribute & { kind: 'bound' },
    lowering: Lowering,
): string {
    return slotValueOf(
        lowering,
        `${lowering.use('boundValue')}(${lowering.reference(written.attribute)})`,
    )
}

/**
 * A static attribute's markup: the bare name, or the name and its value's bytes (`staticBytes`).
 *
 * 32.27 — STATIC TEMPLATE TEXT IS MARKUP, in an attribute value as much as in body text, so
 * `title="AT&amp;T"` renders `AT&T` on the page as the same six characters between two tags do.
 */
function staticMarkup(one: ClassifiedAttribute, bytes: string): string {
    const { name, value } = one.attribute
    return value === '' ? ` ${name}` : ` ${name}="${bytes}"`
}

/**
 * A file's `<head>` contributions merged by key, the LAST one for a key kept.
 *
 * 39.4, 39.11, 39.12 — 39.11 gives the key: the tag for the two elements a document holds one of,
 * the `name` or `property` for a `<meta>`, and `rel` with `href` for a `<link>`. Anything else has
 * no key and keeps its place, which is 39.5 and is what walking the list once and dropping only
 * the shadowed entries gives.
 *
 * WITHIN ONE FILE IS ALL OF IT HERE. 39.4's deepest contributor needs a layout to be deeper than,
 * and a page and its layouts are composed at run time (`render`), not in this compiler — so there
 * is no depth to order by here, and nothing here stands in for one.
 */
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

/**
 * The key a head contribution merges by, or `undefined` for one that appends.
 *
 * 39.11 THROUGH THE ONE GRAMMAR (`headKeyOf`), asked with what the COMPILER can read: an expression
 * is present but unknown, so `<meta name={x}>` appends under 39.5 rather than merging against a
 * string that is not its value. `<TITLE>` is the same singleton as `<title>`, which `lowerTag`
 * already gives.
 */
function headKey(node: TemplateNode): string | undefined {
    if (node.kind !== 'element') return undefined
    return headKeyOf(node.lowerTag, (name) => {
        const attribute = attributeOf(node, name)
        if (attribute === undefined) return null
        return attribute.expression ? undefined : attribute.value
    })
}

/**
 * How a merged value's pieces are written: escaped for markup, or as a built row writes them.
 *
 * Which is all that differs between the two ways of making an element. The markup ESCAPES — the
 * bytes are parsed — and a built row writes what the parser would have made of them. The
 * STRUCTURE — the order, the separators, which names — is `styleValue` and `classValue`'s alone,
 * so a built `style` and a served one are the same string.
 */
export type ValueRender = {
    /** A whole attribute's value from an expression. */
    dynamic: (attribute: Attribute) => string
    /** One `style:prop`'s value from an expression — cut at its first `;` on both sides. */
    declaration: (attribute: Attribute) => string
    /** The author's own bytes, as the server writes them (32.27). */
    bytes: (bytes: string) => string
}

/** The `ValueRender` for server markup: every interpolated piece escaped. */
function markupRender(lowering: Lowering): ValueRender {
    return {
        dynamic: (attribute) =>
            `${lowering.use('escapeAttribute')}(${unlandable(lowering, attribute, lowering.expression(attribute))})`,
        declaration: (attribute) =>
            `${lowering.use('escapeStyleValue')}(${unlandable(lowering, attribute, lowering.expression(attribute))})`,
        bytes: (bytes) => JSON.stringify(bytes),
    }
}

/** A merged `style` or `class` group's value, as an emitted expression, rendered by `render`. */
export function mergedValue(
    group: MergeGroup,
    lowering: Lowering,
    render: ValueRender,
): string {
    return group.name === 'style'
        ? styleValue(group.plain, group.directives, render)
        : classValue(group.plain, group.directives, lowering, render)
}

/**
 * The declaration list a set of `style:prop` attributes renders as.
 *
 * Each value takes the same rewrite the whole-value path takes, so one attribute has one answer
 * however the author spelled it: 32.27 for a STATIC declaration, which is the author's own markup,
 * and the full escape for an interpolated one, which is 32.1's.
 */
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

/**
 * The class list a set of `class:name` attributes renders as.
 *
 * 32.10 — A NAME IS MARKUP AND A VALUE IS A CONDITION, which is the whole of what makes this
 * shorter than its `style` sibling: the name is the author's own source and takes 32.27's rewrite
 * where the module is emitted, and the expression decides only whether it is written at all.
 *
 * EACH NAME CARRIES ITS OWN LEADING SPACE rather than a separator being computed between them,
 * because how many of them render is not known until the values are read. A run of spaces and a
 * leading one are both nothing in a class attribute — the value is split on whitespace — where
 * `style`'s `;` has to be counted.
 */
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
        //
        // THE CONDITION IS ECMASCRIPT'S ToBoolean, which `setClass`'s `Boolean(on)` is too, so a
        // hydrated page never flips a class it was served with (`classifyAttributes.test.ts`).
        parts.push(
            attribute.expression
                ? `(${unlandable(lowering, attribute, lowering.expression(attribute))} ? ${written} : '')`
                : written,
        )
    }
    return concat(parts)
}
