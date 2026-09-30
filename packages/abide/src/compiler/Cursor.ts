import {
    isBlankRun,
    isComponentTag,
    isParserOwned,
    isSingleRooted,
    isSlot,
    isTextish,
} from './classifyTemplate.ts'
import type { InlineComponent, TemplateNode } from './TemplateNode.ts'

// WHAT A TEMPLATE IS, ONCE, as the positions its nodes stand at: every text run, element and region,
// in document order and as a tree. `placeTemplate` is the one walk over the template nodes, and
// three things are RENDERED from what it places rather than each walking the template again:
//
// - the markup (`emitComponent`'s `renderMarkup`) — what the server writes, and what a region
//   made once fills from;
// - the build (`emitClient`'s `emitBuild`) — what a region made once a row is constructed by;
// - the adopt walk (`emitRegion`) — how a mount finds each node the server or the build made.
//
// So where a node stands, and what it is, is decided once.
//
// A LINEAR CURSOR: each position is found from the one BEFORE it — `previous.nextSibling` — or
// from the node it hangs inside. Nothing arithmetic, so a region standing in the middle of a run of
// siblings is one more position, and what follows it is found from its closing anchor.
//
// EVERY `from` IS WRITTEN WITH `?.`, and that is 41.10 rather than style. On a page the walk
// stands outside every guard — it must not throw, or a node missing near the top takes every
// binding below it down with it — so an absent node is carried forward as `undefined` and refused
// by `elementHere`, `textHere` or `regionFound` in the one unit that needed it.
//
// ONE SINK PER REGION: a `{#if}` arm, a `{#for}` row, a `<slot/>` fallback and a caller's children
// each address from their own root, so their slot names are their own and restart at `__c0`.

/**
 * The name a nested region's own root goes by in emitted code.
 *
 * WHAT A NESTED REGION'S OWN ROOT IS CALLED. Its slot names restart at `__c0`, so it cannot
 * borrow the name the ENCLOSING sink gave the region — `__c1` there and `__c1` here are two
 * different nodes, and a head spelled that way addresses the arm's second slot rather than the
 * arm. In the emitted form the region arrives as the mount's own parameter (`emitClient`'s
 * `mountFunction`), which is exactly one name, and this is it.
 */
export const REGION_ROOT = '__root'

/**
 * The name a row's mount gives the row's record.
 *
 * WHAT A ROW'S MOUNT CALLS THE ROW'S RECORD — `REGION_ROOT`'s counterpart for a `{#for}` row, and
 * the one name the emitted mount and its rebuild share (`emitClient`'s `emitList`).
 */
export const ROW_ROOT = '__row'

export type PositionKind = 'text' | 'element' | 'region'

/** Where one text run, element or region stands in a template, and how the walk finds it. */
export type Position = {
    /**
     * The slot the adopt half binds this node to. Unique within the region, and the name the
     * positions after it are found from.
     */
    name: string
    kind: PositionKind
    /**
     * The template node this position stands for, and the key a binding is looked up by: a run's
     * FIRST piece, the element itself, or the block, invocation or `<slot/>` a region is.
     */
    holder: TemplateNode
    /**
     * The expression the node is found at — the previous sibling's `nextSibling`, the enclosing
     * element's `firstChild`, or whatever the region's root said its run starts at.
     */
    from: string
    /**
     * What the run hangs off, which `textHere` needs for 32.23's hole: a run every part of which
     * is an expression renders NO node when they are all empty, and the position still has to
     * exist because the walk continues through it.
     */
    parent: string
    /**
     * An element's FOLDED tag, for the kind check `elementHere` makes. '' for the other two kinds.
     */
    tag: string
    /**
     * A text run's pieces, in order — the text and expressions the parser merges into this one
     * node. Empty for the other two kinds.
     */
    run: TemplateNode[]
    /**
     * The element this position stands inside, or null at the region's own root. What the walk's
     * pruning reads: a position is walked only when something at or after it in its parent is.
     */
    within: Position | null
    /**
     * Whether this position is, or stands inside, content only the parser makes right
     * (`isParserOwned`) — which is what sends a row the browser grows to the parser instead of a
     * build. Carried down through nested regions, so a list inside an `<svg>` arm knows it.
     */
    parserOwned: boolean
    /** Whether a text run can render as no node at all (32.23). False for the other two kinds. */
    blank: boolean
    /**
     * A nested region's own sink, one per root the walk descends into: one for a `{#for}` row, one
     * per `{#if}` arm, one for a `<slot/>` fallback, one for an invocation's children. Empty for an
     * invocation with nothing between its tags.
     */
    inner: Cursor[]
    /**
     * An element's own positions, in order — the tree the markup is rendered from. Empty for the
     * other two kinds, whose insides are their `inner` sinks or nothing at all.
     */
    children: Position[]
}

/** A run of siblings being walked: the region's own root, or the inside of one element. */
type Frame = {
    /**
     * The slot holding the node these children hang off, or the region root's own parent expression.
     */
    parent: string
    within: Position | null
    parserOwned: boolean
    /**
     * The expression the next sibling follows: the last slot placed, the last region's `close`, or
     * null where nothing has been placed in this frame yet.
     */
    after: string | null
}

/** One region's positions, placed in document order by `placeTemplate`. */
export class Cursor {
    /** In document order, which is the order the walk visits them in. */
    readonly positions: Position[] = []
    /** The positions at the region's own root, in order — what a renderer starts from. */
    readonly top: Position[] = []
    /**
     * Whether this region can be made more than once in one document.
     *
     * WHETHER THIS REGION CAN BE MADE MORE THAN ONCE IN ONE DOCUMENT — a row, anything inside one,
     * and all of an invoked component, which can itself stand in a row. What decides how the
     * browser makes it (`emitMaker`): the parser invoked once for a region made once costs what
     * building it costs and ships as smaller strings, and invoked once a ROW it is the whole of the
     * cost. Carried down, so an arm three regions inside a row knows it is one of a thousand.
     */
    readonly repeated: boolean
    /**
     * Whether a component is invoked anywhere in this region, at any depth.
     *
     * WHETHER A COMPONENT IS INVOKED ANYWHERE IN THIS REGION, at any depth — what decides whether a
     * deferred mount has to resume its instance's share scope (10.5). Set from the invocation up
     * through every sink it stands inside, so a component three regions down marks all three.
     */
    holdsComponent = false
    /**
     * 32.43 — the inline components this region's body declares, which both lanes declare at its
     * head. What an invocation in it is passed (32.50) is on the invocation.
     */
    components: readonly InlineComponent[] = []
    /** The sink this one is nested in (`nest`), or null at a page's or component's own root. */
    private outer: Cursor | null = null
    private readonly head: string
    private readonly frames: Frame[]
    private next = 0

    /**
     * `head` is where this region's first node is found and `parent` what its run hangs off. Every
     * region but a row hangs off the anchor pair its mount is handed (`REGION_ROOT`) — the page, an
     * arm, a slot and a caller's children alike, since the server writes a page's pair too — so
     * that is the default; a row starts at the first node of the RECORD the reconcile hands its
     * mount, and spells its own.
     */
    constructor(
        head = `${REGION_ROOT}.open.nextSibling`,
        parent = `${REGION_ROOT}.close.parentNode`,
        parserOwned = false,
        repeated = false,
    ) {
        this.head = head
        this.repeated = repeated
        this.frames = [{ parent, within: null, parserOwned, after: null }]
    }

    /**
     * Places a run of adjacent text and expressions as one text position.
     *
     * A run of adjacent text and expressions, which a browser parses as ONE text node however many
     * pieces it was written as — see `classifyTemplate`'s head for why that is the unit.
     */
    text(run: TemplateNode[], blank: boolean): Position {
        return this.record('text', run[0] as TemplateNode, '', blank, run)
    }

    /**
     * Places an element and descends into it, until `leave`.
     *
     * An element, and the walk DESCENDS into it: what is placed next is its first child, until
     * `leave`. The stack discipline the markup emitter already walks in — an element's children are
     * emitted between its open and close tags and nowhere else. A void element is left at once.
     */
    element(node: TemplateNode & { kind: 'element' }): Position {
        const at = this.record('element', node, node.lowerTag, false, [])
        this.frames.push({
            parent: at.name,
            within: at,
            parserOwned: at.parserOwned,
            after: null,
        })
        return at
    }

    /**
     * Places a block, an invocation or a `<slot/>` as one anchor-pair position.
     *
     * A block, an invocation or a `<slot/>`: an anchor PAIR, and the walk continues from its CLOSE
     * rather than by counting — which is the negative-step encoding falling out rather than being
     * ported. How many nodes stand between the anchors depends on a value, and a cursor never asks.
     */
    region(holder: TemplateNode): Position {
        if (holder.kind === 'element' && !isSlot(holder))
            for (
                let sink: Cursor | null = this;
                sink !== null && !sink.holdsComponent;
                sink = sink.outer
            )
                sink.holdsComponent = true
        return this.record('region', holder, '', false, [])
    }

    /** Ascends out of the element `element` last descended into. */
    leave(): void {
        this.frames.pop()
    }

    /**
     * A nested region's sink, hung off the region's position. A `{#for}` row passes its own head
     * and parent, because a row's root is the row's first node and not a pair of anchors.
     */
    nest(at: Position, head?: string, parent?: string, row = false): Cursor {
        const sink = new Cursor(
            head,
            parent,
            at.parserOwned,
            // A row repeats, and everything below it repeats too.
            this.repeated || row,
        )
        sink.outer = this
        at.inner.push(sink)
        return sink
    }

    private here(): Frame {
        return this.frames[this.frames.length - 1] as Frame
    }

    private record(
        kind: PositionKind,
        holder: TemplateNode,
        tag: string,
        blank: boolean,
        run: TemplateNode[],
    ): Position {
        const frame = this.here()
        const at: Position = {
            name: `__c${this.next}`,
            kind,
            holder,
            from:
                frame.after !== null
                    ? `${frame.after}?.nextSibling`
                    : this.frames.length === 1
                      ? this.head
                      : `${frame.parent}?.firstChild`,
            parent: frame.parent,
            tag,
            blank,
            run,
            within: frame.within,
            parserOwned:
                frame.parserOwned || (kind === 'element' && isParserOwned(tag)),
            inner: [],
            children: [],
        }
        this.next += 1
        frame.after = kind === 'region' ? `${at.name}?.close` : at.name
        this.positions.push(at)
        if (frame.within === null) this.top.push(at)
        else frame.within.children.push(at)
        return at
    }
}

/**
 * Places every node of a template on `cursor`, with a nested sink per region.
 *
 * THE ONE WALK. What it places is what the markup, the build and the mount are all rendered from
 * (see the head of this file), so a new kind of node is taught here once. It asks the template's
 * own predicates and nothing else — no lowering, no lane — because where a node stands does not
 * depend on which side is rendering it: what differs between the lanes is what goes BETWEEN a
 * region's anchors, and a region is one position whatever is inside it.
 *
 * A RUN OF ADJACENT TEXT AND EXPRESSIONS IS PLACED ONCE, at its head: the parser makes one text node
 * of it, and placing one per piece put every sibling after it short by the rest — the defect row
 * construction once shipped, found by reading emitted output rather than by any assertion.
 *
 * A NESTED REGION IS A SINK OF ITS OWN: one per `{#if}` arm, one for a `{#for}` row (whose root is
 * the first node of the row the reconcile holds, so it starts there, a node along where the row
 * carries its own anchor), one for a `<slot/>` fallback, one for the children between an
 * invocation's tags.
 */
export function placeTemplate(nodes: TemplateNode[], cursor: Cursor): void {
    for (let at = 0; at < nodes.length; at += 1) {
        const node = nodes[at] as TemplateNode
        if (isTextish(node)) {
            if (at > 0 && isTextish(nodes[at - 1] as TemplateNode)) continue
            let end = at
            while (end < nodes.length && isTextish(nodes[end] as TemplateNode))
                end += 1
            cursor.text(nodes.slice(at, end), isBlankRun(nodes, at))
            continue
        }
        if (node.kind === 'block') {
            const here = cursor.region(node)
            if (node.block === 'for') {
                const single = isSingleRooted(node.children)
                const row = cursor.nest(
                    here,
                    single
                        ? `${ROW_ROOT}.node`
                        : `${ROW_ROOT}.node.nextSibling`,
                    `${ROW_ROOT}.node.parentNode`,
                    true,
                )
                row.components = node.components
                placeTemplate(node.children, row)
                continue
            }
            for (const branch of node.branches) {
                const arm = cursor.nest(here)
                arm.components = branch.components
                placeTemplate(branch.children, arm)
            }
            continue
        }
        if (node.kind !== 'element') continue
        if (isSlot(node) || isComponentTag(node.tag)) {
            const here = cursor.region(node)
            // A slot's fallback is always a sink, empty or not; an invocation's children are one
            // only where the caller wrote some.
            if (isSlot(node) || node.children.length > 0) {
                const inside = cursor.nest(here)
                inside.components = node.components
                placeTemplate(node.children, inside)
            }
            continue
        }
        cursor.element(node)
        placeTemplate(node.children, cursor)
        cursor.leave()
    }
}
