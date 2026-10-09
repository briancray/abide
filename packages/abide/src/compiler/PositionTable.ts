import type { Node } from 'typescript/unstable/ast'
import type { Span } from './projectShadow.ts'

/**
 * What a projected span is, by where the template put it.
 *
 * - `slot` — a text slot, `{expr}`.
 * - `attribute` — an element's attribute value that is neither a listener nor a `bind:`.
 * - `condition` — an `{#if}` or `{:else if}` subject.
 * - `subject` — a `{#for}` subject.
 * - `key` — a `{#for}`'s `by` key.
 * - `listener` — an element's `on…` handler (14.9).
 * - `prop` — a value handed to a component, spread or keyed.
 * - `elementBind` / `componentBind` — a `bind:` operand on an element and on a component (32.6).
 * - `untyped` — a value the shadow types as `any`: an attribute 32.10 refuses on a component, or
 *   one on a component tag no call can spell.
 * - `setup` — a branch-local `<script>` (14.8).
 * - `head` — an inline component's `props` statement (32.40).
 * - `tag` — an invocation's tag (32.34).
 */
export type PositionKind =
    | 'slot'
    | 'attribute'
    | 'condition'
    | 'subject'
    | 'key'
    | 'listener'
    | 'prop'
    | 'elementBind'
    | 'componentBind'
    | 'untyped'
    | 'setup'
    | 'head'
    | 'tag'

/** A span of the projection copied out of the template, and what it is. */
export type Position = Span & { kind: PositionKind }

/** 31.3 — whether a position is a `bind:` operand, which holds the `Reactive` rather than reading it. */
export function holdsReactive(position: Position | undefined): boolean {
    const kind = position?.kind
    return kind === 'elementBind' || kind === 'componentBind'
}

/**
 * Every template position a projection holds, ascending, and the checker node each one is.
 *
 * THE KIND IS RECORDED WHERE THE SPAN IS WRITTEN, so a reader of the checker's tree asks the table
 * what a node is rather than re-recognizing the scaffolding the projection wrapped it in — two
 * readers doing that with different case sets disagreed about which positions there were.
 *
 * A NODE IS A POSITION WHEN IT IS THE WHOLE OF ONE: it starts inside the span, and its parent
 * starts before it. By START, because a setup's last statement takes the `;` the scaffolding writes
 * after it, and ends past its span. The spans never nest, so at most one position holds a node, and
 * a setup's span is as many nodes as it has statements.
 */
export class PositionTable {
    readonly all: readonly Position[]

    constructor(all: readonly Position[]) {
        this.all = all
    }

    /** The position `node` is the whole of, or `undefined` where it is none or only part of one. */
    of(node: Node): Position | undefined {
        const start = node.getStart()
        let low = 0
        let high = this.all.length
        while (low < high) {
            const middle = (low + high) >>> 1
            if ((this.all[middle] as Position).start <= start) low = middle + 1
            else high = middle
        }
        const position = this.all[low - 1]
        if (position === undefined || start >= position.end) return undefined
        const parent = node.parent
        return parent === undefined || parent.getStart() < position.start
            ? position
            : undefined
    }

    /** Whether any position is of a kind `kinds` holds. */
    has(kinds: ReadonlySet<PositionKind>): boolean {
        for (const position of this.all)
            if (kinds.has(position.kind)) return true
        return false
    }

    /**
     * Each node under `root` that is the whole of a position of a kind `kinds` holds, in order.
     *
     * One walk in source order beside a cursor into the table, so a subtree that ends before the
     * next wanted position is never entered.
     */
    nodesIn(
        root: Node,
        kinds: ReadonlySet<PositionKind>,
    ): { position: Position; node: Node }[] {
        const wanted: Position[] = []
        for (const position of this.all)
            if (kinds.has(position.kind)) wanted.push(position)
        const found: { position: Position; node: Node }[] = []
        if (wanted.length === 0) return found
        let next = 0
        const visit = (node: Node): void => {
            if (next === wanted.length) return
            const start = node.getStart()
            while (
                next < wanted.length &&
                (wanted[next] as Position).end <= start
            )
                next += 1
            const position = wanted[next]
            if (position === undefined || node.end <= position.start) return
            // Entered from a parent that started before the span, so this is the whole of it.
            if (start >= position.start) {
                found.push({ position, node })
                return
            }
            node.forEachChild(visit)
        }
        root.forEachChild(visit)
        return found
    }
}
