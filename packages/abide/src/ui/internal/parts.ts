// What a slot becomes once the template is DOM: a part that owns a range, a list that reconciles by
// key, and the instance that binds one to each slot.
//
// Every write compares before it writes. That is not defensive coding: a binding that assigns the
// value already present still costs a full DOM write, and on a list where one row changes it is the
// difference between touching 2 nodes and touching all of them. It is also what makes ADOPTION
// nearly free: a part handed server markup that is already right runs its ordinary update and writes
// nothing, so hydration is the build path with a different way of getting its nodes.

import {
    Awaited,
    attributeText,
    Boundary,
    type Branches,
    isKeyed,
    isTemplate,
    KEY,
    Raw,
    type SlotKind,
    Streamed,
    settledArms,
    settledBoundary,
    type TemplateResult,
} from '$shared/html.ts'
import { type Node, rerun, untrackCall, watchNode } from '$shared/internal/graph.ts'
import { CLOSE_FORM, SLOT_OPEN } from '$shared/internal/MARKERS.ts'
import { isThenable } from '$shared/internal/probes.ts'
import { unwrap } from '$shared/internal/slots.ts'
import { abideLog } from '$shared/log.ts'
import { type Prepared, type PreparedPart, prepare } from './prepare.ts'

// A `warning`, so the DEBUG gate never swallows it: a page that silently rebuilt half of what the
// server sent looks exactly like a page that adopted it.
const hydrateLog = abideLog.channel('hydrate')

// A sentinel distinct from every value an operand could be, `undefined` included — `{#await}` over a
// cell that has not loaded yet awaits `undefined`, and that is a real operand, not the absence of one.
const NOTHING = Symbol('abide.nothing')

// --- adoption -----------------------------------------------------------------
//
// Two walks in step: the prepared template says what the markup SHOULD be, the live document holds
// what the server wrote. They differ in exactly one way — a child slot's content is a value, which
// the template does not contain — and the server's markers say where each of those ranges is.

/** Where the adopt walk has got to. One per LEVEL, so a nested walk cannot run the outer one past its end. */
interface Cursor {
    node: ChildNode | null
}

/** The two counters the walk keeps in step with `prepare`'s own numbering. */
interface Walk {
    /** Index into the document-order ELEMENT|COMMENT walk — the same one `PreparedPart` records. */
    index: number
    /** How far through `plan.parts`, which is in ascending `index` order for the same reason. */
    partAt: number
}

/** The server's markup is not what this template makes. Recoverable: the subtree is built instead. */
class Mismatch extends Error {}

function mismatch(what: string): never {
    // No `abide:` prefix: the message reaches a console through `abide:hydrate`, which already says so.
    throw new Mismatch(`hydration mismatch — ${what}`)
}

function describe(node: ChildNode | null): string {
    if (node === null) return 'nothing'
    if (node.nodeType === 1) return `<${(node as Element).tagName.toLowerCase()}>`
    if (node.nodeType === 8) return `<!--${(node as Comment).data}-->`
    return JSON.stringify((node as Text).data)
}

function isOpen(node: ChildNode | null): boolean {
    return node !== null && node.nodeType === 8 && (node as Comment).data === SLOT_OPEN
}

function isClose(node: ChildNode): boolean {
    return node.nodeType === 8 && CLOSE_FORM.test((node as Comment).data)
}

/** What a plain value renders as. Nullish and BOTH booleans are nothing, not their spelling. */
function textOf(value: unknown): string {
    return value === null || value === undefined || value === false || value === true ? '' : String(value)
}

// --- child parts ----------------------------------------------------------

// Owns the range between its anchor comment and whatever it last inserted before it.
export class ChildPart {
    private owned: ChildNode[] = []
    private text: Text | null = null
    private nested: Instance | null = null
    private list: ListPart | null = null
    // Stamps what the part is currently showing, so a promise that settles after it has been
    // superseded (or disposed) is discarded instead of painting over the newer content.
    private generation = 0

    /**
     * The operand of the block this part is currently showing — an awaited value or a stream source.
     * An unchanged one is not restarted, so a re-run of the enclosing effect for some OTHER reason
     * does not throw a settled branch back to `pending` or replay a list from the top.
     */
    private holding: unknown = NOTHING

    /** The last `Raw` html this part painted, so re-running a `{html(...)}` slot does not reparse it. */
    private rawHtml: string | null = null

    /** Server nodes waiting to be interpreted, until the first value says what they are. */
    private claimed: ChildNode[] | null = null

    /** The server's opening marker. Outlives the adoption, but not a rebuild. */
    private opened: Comment | null = null

    constructor(private readonly anchor: Comment) {}

    /**
     * Hand this part the range the server wrote for it. Nothing is interpreted yet: what those nodes
     * ARE depends on the value, and the value arrives with the first update. Deferring it that far is
     * what keeps every slot thunk to ONE call during hydration.
     */
    adopt(nodes: ChildNode[], open: Comment | null): void {
        this.claimed = nodes
        this.opened = open
    }

    set(value: unknown): void {
        // Text is what a slot holds nearly every time — every row of every list, every `${count}` —
        // and it was the LAST branch below, six instanceof tests and an Array.isArray away. The two
        // fields the general path would have written are written here too: `holding` back to
        // nothing, because a text value replaces whatever block owned this slot, and the generation
        // bumped, because a load still in flight must not paint over it.
        if (this.claimed === null) {
            const type = typeof value
            if (type === 'string' || type === 'number') {
                this.holding = NOTHING
                this.generation++
                this.clearExcept('text')
                const next = type === 'string' ? (value as string) : String(value)
                const text = this.text
                if (text === null) {
                    const made = document.createTextNode(next)
                    this.text = made
                    this.owned = [made]
                    this.anchor.before(made)
                    return
                }
                if (text.data !== next) text.data = next
                return
            }
        }

        const claimed = this.claimed
        if (claimed !== null) {
            this.claimed = null
            try {
                this.take(claimed, value)
                return
            } catch (error) {
                if (!(error instanceof Mismatch)) throw error
                // Recover here rather than failing the page: drop what the server wrote for this one
                // slot and fall through to the ordinary build. The rest of the tree keeps its markup.
                hydrateLog.warning(`${error.message} — building this slot instead of adopting it`)
                for (const node of claimed) node.remove()
                this.dropOpened()
            }
        }
        if (value instanceof Awaited) {
            this.await_(value)
            return
        }
        if (value instanceof Streamed) {
            this.stream_(value)
            return
        }
        if (value instanceof Boundary) {
            // Synchronous, exactly like the `try` it is named after — see `settledBoundary`, which is
            // the same decision the server makes.
            this.set(settledBoundary(value))
            return
        }
        this.holding = NOTHING
        this.generation++
        if (isThenable(value)) {
            // Keep showing what is there until it lands — the server awaits the same value, so a
            // promise in a slot means the same thing on both sides.
            this.settle(value, null, this.generation)
            return
        }
        if (Array.isArray(value)) {
            this.clearExcept('list')
            if (this.list === null) this.list = new ListPart(this.anchor)
            this.list.set(value)
            return
        }
        if (isTemplate(value)) {
            this.clearExcept('nested')
            // Same call site → patch the existing DOM instead of rebuilding it.
            if (this.nested !== null && this.nested.strings === value.strings) {
                this.nested.update(value.values)
                return
            }
            this.clearExcept(null)
            this.nested = instantiate(value)
            this.owned = this.nested.nodes
            this.anchor.before(...this.owned)
            return
        }
        if (value instanceof Raw) {
            // Compare before writing, like every other binding: re-parsing markup that is already on
            // screen is the most expensive way there is to produce the same nodes.
            if (this.rawHtml === value.html) return
            this.clearExcept(null)
            const fragment = document.createElement('template')
            fragment.innerHTML = value.html
            this.owned = Array.from(fragment.content.childNodes) as ChildNode[]
            this.anchor.before(...this.owned)
            this.rawHtml = value.html
            return
        }

        const next = textOf(value)
        this.clearExcept('text')
        if (this.text === null) {
            this.text = document.createTextNode(next)
            this.owned = [this.text]
            this.anchor.before(this.text)
            return
        }
        // Compare before writing.
        if (this.text.data !== next) this.text.data = next
    }

    /**
     * Interpret the server's range in the light of the value that produced it.
     *
     * Every branch here mirrors one branch of `set`, and the pairing is the contract: whatever `set`
     * would have BUILT, this claims instead. Anything that cannot be claimed raises a `Mismatch` and
     * the caller builds it, so a wrong guess costs a rebuild rather than a wrong screen.
     */
    private take(claimed: ChildNode[], value: unknown): void {
        if (value instanceof Boundary) {
            // Synchronous, so the client reaches the same arm the server did by running the same body.
            this.take(claimed, settledBoundary(value))
            return
        }

        if (value instanceof Awaited) {
            // The server AWAITED the operand and painted the settled arm. Keep it: showing `pending`
            // over correct markup is a flash back to a state the reader never saw.
            const operand = value.value
            this.generation++
            if (!isThenable(operand)) {
                this.take(claimed, settledArms(value.branches, undefined, operand, false))
                this.holding = operand
                return
            }
            // Still in flight here, so which arm those nodes are is not knowable yet — hold them as
            // an opaque range and let the settle replace them.
            this.owned = claimed
            this.holding = operand
            this.settle(operand, value.branches, this.generation)
            return
        }

        if (value instanceof Streamed) {
            // The server drained the stream; this side re-streams from the top and cannot know how
            // far the server got, so the rows are rebuilt. See README "Known limits".
            for (const node of claimed) node.remove()
            this.dropOpened()
            this.stream_(value)
            return
        }

        if (isThenable(value)) {
            // Same shape as the awaited case: the server has the answer, this side does not yet.
            this.owned = claimed
            this.generation++
            this.settle(value, null, this.generation)
            return
        }

        if (value instanceof Raw) {
            this.owned = claimed
            this.rawHtml = value.html
            return
        }

        if (Array.isArray(value)) {
            const cursor: Cursor = { node: claimed[0] ?? this.anchor }
            const list = new ListPart(this.anchor)
            list.adopt(value, cursor)
            if (cursor.node !== this.anchor) {
                mismatch(
                    `a list left ${describe(cursor.node)} over — the server wrote more rows than this one has`,
                )
            }
            this.list = list
            this.owned = claimed
            return
        }

        if (isTemplate(value)) {
            const cursor: Cursor = { node: claimed[0] ?? this.anchor }
            const nested = new Instance(value, cursor)
            if (cursor.node !== this.anchor) {
                mismatch(`a nested template left ${describe(cursor.node)} over`)
            }
            this.nested = nested
            this.owned = nested.nodes
            return
        }

        const next = textOf(value)
        if (next === '') {
            if (claimed.length !== 0)
                mismatch(`expected an empty slot, found ${describe(claimed[0] ?? null)}`)
            return
        }
        const text = claimed[0]
        if (claimed.length !== 1 || text === undefined || text.nodeType !== 3) {
            mismatch(`expected one text node for ${JSON.stringify(next)}, found ${describe(text ?? null)}`)
        }
        this.text = text as Text
        this.owned = claimed
        // Compare before writing. Equal is the whole point of hydration; unequal is a real divergence
        // in the data, which is a text write rather than a rebuild.
        if ((text as Text).data !== next) (text as Text).data = next
    }

    /**
     * Paint a promise's result, discarding a load that has been superseded.
     *
     * `branches` null is a bare promise in a slot: what it resolves to IS what renders, and a
     * rejection has nowhere to go but the microtask queue. With branches it is `{#await}`, so the
     * settled arm renders and `holding` is put back — `set` clears it, and this block still owns the
     * slot. Both callers bump the generation before handing it over rather than having this do it:
     * `{#await}` stamps once for the whole block, including the arm it paints synchronously.
     */
    private settle(operand: PromiseLike<unknown>, branches: Branches | null, generation: number): void {
        Promise.resolve(operand).then(
            (value) => {
                if (generation !== this.generation) return
                if (branches === null) {
                    this.set(value)
                    return
                }
                this.set(settledArms(branches, undefined, value, false))
                this.holding = operand
            },
            (error: unknown) => {
                if (generation !== this.generation) return
                // No `{:catch}` means the author did not claim to handle it, so it stays a failure.
                if (branches === null || branches.catch === undefined) {
                    queueMicrotask(() => {
                        throw error
                    })
                    return
                }
                this.set(settledArms(branches, error, undefined, true))
                this.holding = operand
            },
        )
    }

    /**
     * `{#await}`: show `pending`, then paint the settled arm when it lands.
     *
     * The settle writes through `set` DIRECTLY rather than through a reactive read, so the effect
     * that produced this block never wakes — which is what stops the operand being re-evaluated into
     * a fresh promise on every settle. The generation stamp is the same one a bare promise in a slot
     * already uses: a load that lands after it has been superseded is discarded.
     *
     * An unchanged operand is left alone. A re-run of the enclosing effect (some other dependency
     * moved) must not throw a settled branch back to `pending`.
     */
    private await_(block: Awaited): void {
        if (this.holding === block.value) return
        this.holding = block.value
        const branches = block.branches
        const operand = block.value

        this.set(branches.pending?.() ?? null)
        this.holding = operand // `set` cleared it; this block owns the slot again
        const generation = this.generation

        if (!isThenable(operand)) {
            this.set(settledArms(branches, undefined, operand, false))
            this.holding = operand
            return
        }
        this.settle(operand, branches, generation)
    }

    /**
     * `{#for await}`: rows appended as they arrive. The generation stamp is what makes a re-run tear
     * the list down and re-stream rather than interleaving two sources into one list.
     */
    private stream_(block: Streamed): void {
        if (this.holding === block.source) return
        const source = block.source
        this.set([])
        this.holding = source
        // Re-read after every write rather than pinning one stamp: this part writes per ROW, and each
        // write bumps the generation itself. A fixed stamp would make the stream supersede itself
        // after the first row — which looks exactly like a stream that only ever yielded one.
        let generation = this.generation
        const rows: unknown[] = []
        void (async () => {
            try {
                let index = 0
                for await (const item of source as AsyncIterable<never>) {
                    if (generation !== this.generation) return
                    rows.push(block.row(item, index++))
                    // The SAME array every time. `ListPart.set` compares against its own `Row[]` and
                    // reads `items` only within the call, so a copy per row would be n allocations
                    // and n²/2 element copies to stream a list that only ever appends.
                    this.set(rows)
                    this.holding = source
                    generation = this.generation
                }
            } catch (error) {
                if (generation !== this.generation) return
                if (block.failure === undefined) {
                    queueMicrotask(() => {
                        throw error
                    })
                    return
                }
                this.set(block.failure(error))
                this.holding = source
            }
        })()
    }

    /**
     * The server's opening marker outlives the adoption but not a rebuild: once this part has thrown
     * away what it adopted, the marker brackets nothing.
     */
    private dropOpened(): void {
        if (this.opened === null) return
        this.opened.remove()
        this.opened = null
    }

    private clearExcept(keep: 'text' | 'nested' | 'list' | null): void {
        if (keep === 'text' && this.text !== null) return
        if (keep === 'nested' && this.nested !== null) return
        if (keep === 'list' && this.list !== null) return
        if (this.list !== null) this.list.dispose()
        if (this.nested !== null) this.nested.dispose()
        for (const node of this.owned) node.remove()
        this.dropOpened()
        this.owned = []
        this.text = null
        this.nested = null
        this.list = null
        this.rawHtml = null
    }

    dispose(): void {
        this.generation++ // a load still in flight must not paint into a disposed part
        this.holding = NOTHING
        // A part disposed before its first update still owns server nodes nobody else will remove.
        if (this.claimed !== null) {
            this.owned = this.claimed
            this.claimed = null
        }
        this.clearExcept(null)
    }
}

// --- lists ----------------------------------------------------------------

interface Row {
    key: unknown
    instance: Instance
    /**
     * Which pass last carried this row forward.
     *
     * A stamp rather than a boolean, so nothing has to walk the previous rows to clear it first.
     * Before this it was a `Set` of surviving instances, which cost a mapped array AND a set of every
     * row on every update — two whole-list allocations to answer a question one field per row answers.
     */
    usedAt: number
}

class ListPart {
    private rows: Row[] = []
    /** Bumped per `set`, and written into every row carried forward. */
    private pass = 0
    /** Has this list ever held a KEYED row? Until it has, there is no index to build. */
    private keyed = false

    constructor(private readonly anchor: Comment) {}

    /**
     * Claim one row per item, in order, off the same cursor. No per-row marker is needed and none is
     * emitted: a row IS a template, and adopting a template consumes exactly the nodes it describes,
     * so each row delimits itself and hands the cursor to the next.
     */
    adopt(items: unknown[], cursor: Cursor): void {
        const rows: Row[] = []
        for (const item of items) {
            const keyed = isKeyed(item)
            const template = keyed ? item.template : (item as TemplateResult)
            if (keyed) this.keyed = true
            rows.push({
                key: keyed ? item[KEY] : undefined,
                instance: new Instance(template, cursor),
                usedAt: 0,
            })
        }
        this.rows = rows
    }

    set(items: unknown[]): void {
        const previous = this.rows
        const pass = ++this.pass

        // The index is built only for a list that has actually held a keyed row. An unkeyed list —
        // the one a plain `.map()` produces, and the one a thousand-row update walks — would
        // otherwise pay for an empty `Map` and a whole pass over its rows for a lookup it never makes.
        let byKey: Map<unknown, Row> | null = null
        if (this.keyed) {
            for (let i = 0; i < previous.length; i++) {
                const row = previous[i] as Row
                if (row.key === undefined) continue
                if (byKey === null) byKey = new Map<unknown, Row>()
                byKey.set(row.key, row)
            }
        }

        // Where the list actually differs from the one before it. Everything outside `[firstChanged,
        // lastChanged]` is the SAME row object at the SAME index, which is what lets the placement
        // walk below start late and stop early instead of touching every row to find out that most
        // of them are where they already were.
        const next: Row[] = new Array<Row>(items.length)
        let firstChanged = items.length
        let lastChanged = -1
        let carried = 0
        for (let i = 0; i < items.length; i++) {
            const item = items[i]
            // ONE `isKeyed` per item. The symbol probe is a prototype-chain lookup, and asking twice
            // for the template and then the key doubled it on every row of every list.
            const keyed = isKeyed(item)
            const template = keyed ? item.template : (item as TemplateResult)
            const key = keyed ? item[KEY] : undefined
            if (keyed) this.keyed = true

            let row = key === undefined ? previous[i] : byKey?.get(key)
            if (row !== undefined && row.instance.strings === template.strings) {
                if (key !== undefined) byKey?.delete(key)
                // Counted only on the FIRST claim, so a mixed list that reaches one row twice cannot
                // make the survivor count say every previous row was kept.
                if (row.usedAt !== pass) {
                    row.usedAt = pass
                    carried++
                }
                row.instance.update(template.values)
            } else {
                row = { key, instance: instantiate(template), usedAt: pass }
            }
            next[i] = row
            if (row === previous[i]) continue
            if (i < firstChanged) firstChanged = i
            lastChanged = i
        }

        // Drop rows no longer present before placing, so the placement walk sees only survivors.
        if (carried !== previous.length) {
            for (let i = 0; i < previous.length; i++) {
                const row = previous[i] as Row
                if (row.usedAt === pass) continue
                for (const node of row.instance.nodes) node.remove()
                row.instance.dispose()
            }
        }
        this.rows = next
        if (lastChanged < 0) return // nothing moved and nothing was rebuilt

        // Place in order, walking backwards. A row already sitting where it belongs is not touched,
        // so a change at one end of the list does not disturb the other.
        //
        // The cost of a swap is the DISTANCE between the two rows, not 2 and not n: once the walk
        // moves the later row, every row between them has the wrong `nextSibling` and is moved in
        // turn. Adjacent rows cost 1 move; rows 1 and 198 of 200 cost 197. A minimal-move (LIS)
        // reconcile would cost 2 — this is the trade, not an oversight, and the example package
        // benches it at both distances.
        //
        // The WALK, though, no longer costs n. Rows after `lastChanged` are the same objects at the
        // same indices and were in order already, so the walk starts against the first of them
        // instead of against the anchor; and once it is below `firstChanged` and finds a row already
        // in place, every row below that one is in place too. A one-row edit of a thousand now reads
        // one `nextSibling` rather than a thousand, and an adjacent swap of two hundred reads three.
        let reference: ChildNode = this.anchor
        for (let i = lastChanged + 1; i < next.length; i++) {
            const first = (next[i] as Row).instance.nodes[0]
            if (first !== undefined) {
                reference = first
                break
            }
        }
        for (let i = lastChanged; i >= 0; i--) {
            const instance = (next[i] as Row).instance
            const first = instance.nodes[0]
            if (first === undefined) continue
            if (first.nextSibling !== reference || first.parentNode === null) {
                const parent = this.anchor.parentNode as ParentNode
                for (const node of instance.nodes) parent.insertBefore(node, reference)
            } else if (i < firstChanged) {
                break
            }
            reference = instance.nodes[0] as ChildNode
        }
    }

    dispose(): void {
        for (const row of this.rows) {
            for (const node of row.instance.nodes) node.remove()
            row.instance.dispose()
        }
        this.rows = []
    }
}

// --- instances ------------------------------------------------------------

class Instance {
    readonly nodes: ChildNode[]
    readonly strings: readonly string[]
    private readonly plan: Prepared
    private readonly binders: ((value: unknown) => void)[] = []
    private readonly children: ChildPart[] = []
    /**
     * One effect per thunk slot, alive for as long as the instance is.
     *
     * The body reads its thunk out of `lastValues`, so a patch RE-RUNS the same node instead of
     * disposing it and building another — which cost a Node, an observer `Set` and two closures per
     * reactive slot per patch, on the path every compiled template takes. Allocated lazily and left
     * null throughout for a template with nothing reactive in it, which is most list rows.
     */
    private slotEffects: (Node | null)[] | null = null
    /**
     * Teardowns that must survive a patch — a `&ref` handler's, and nothing else so far. Separate
     * from the slot effects because the lifetimes differ: one array for both meant a ref teardown was
     * drained by the first update, before the binder that would have set it had even run.
     */
    private readonly partDisposers: (() => void)[] = []
    /** What the last update was handed, so an update that moves nothing can be skipped whole. */
    private lastValues: readonly unknown[] | null = null

    /** `cursor` null builds fresh DOM; a cursor adopts the live DOM the server already wrote. */
    constructor(result: TemplateResult, cursor: Cursor | null) {
        this.strings = result.strings
        const plan = prepare(result)
        this.plan = plan

        if (cursor !== null) {
            const first = cursor.node
            this.level(plan.element.content, cursor, plan, { index: -1, partAt: 0 })
            const claimed: ChildNode[] = []
            for (let node = first; node !== null && node !== cursor.node; node = node.nextSibling) {
                claimed.push(node)
            }
            this.nodes = claimed
            this.update(result.values)
            return
        }

        // A template that IS one element — a list row, a card, most components — clones that element
        // rather than the fragment holding it. One fewer DOM node per instance, and `nodes` is the
        // clone itself instead of a walk over a fragment's children.
        const single = plan.root
        const clone = (single === null ? plan.element.content : single).cloneNode(true)

        // Walk straight to each slot down its recorded path. The alternative — a `TreeWalker` that
        // materialises every element and comment in the clone — costs more to CONSTRUCT than a row
        // costs to build: 1825 ns against 660 ns here and 500 ns for the clone alone.
        //
        // Consecutive parts on one element share a nodeIndex (five attribute slots on one tag), and
        // `parts` is in ascending order, so the walk is done once and reused for the run.
        const parts = plan.parts
        let atIndex = -1
        let target: globalThis.Node = clone
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i] as PreparedPart
            if (part.nodeIndex !== atIndex) {
                atIndex = part.nodeIndex
                const path = part.path
                let node: globalThis.Node = clone
                for (let level = 0; level < path.length; level++) {
                    node = node.firstChild as globalThis.Node
                    for (let step = path[level] as number; step > 0; step--) {
                        node = node.nextSibling as globalThis.Node
                    }
                }
                target = node
            }
            this.binders[part.slot] = this.bind(part.kind, target)
        }

        if (single !== null) {
            // The element is its own node list, and its slots live INSIDE it — so unlike the
            // fragment case below there is nothing an update could orphan.
            this.nodes = [clone as ChildNode]
            this.update(result.values)
            return
        }

        // AFTER the first update, not before. A child slot at the TOP level of a template —
        // `html`${rows}`` with no wrapping element — inserts what it renders before its anchor
        // comment, which is still sitting in this fragment. Recording `nodes` first captured only
        // the anchor, so the caller inserted the anchor and left the content orphaned in the
        // fragment: the template painted blank until some later update happened to re-place it.
        this.update(result.values)
        // Not `Array.from`: a NodeList's iterator is ~646 ns per instance against ~130 ns for the
        // sibling walk, on a list that is one node most of the time.
        const nodes: ChildNode[] = []
        for (let node = clone.firstChild; node !== null; node = node.nextSibling) {
            nodes.push(node as ChildNode)
        }
        this.nodes = nodes
    }

    /**
     * One level of the two walks, in step: prepared children against live siblings.
     *
     * `walk.index` is the SAME counter `prepare` used when it recorded each slot's position, so the
     * two agree on which node a part belongs to without either of them writing a locator into the
     * server's markup. That is why an attribute slot needs no marker: its element is found by shape.
     */
    private level(prepared: ParentNode, cursor: Cursor, plan: Prepared, walk: Walk): void {
        for (let node = prepared.firstChild; node !== null; node = node.nextSibling) {
            const type = node.nodeType

            if (type === 3) {
                // Static text. Both sides parsed the same string, so one live text node answers for it.
                if ((node as Text).data === '') continue
                if (cursor.node === null || cursor.node.nodeType !== 3) {
                    mismatch(
                        `expected the static text ${JSON.stringify((node as Text).data)}, found ${describe(cursor.node)}`,
                    )
                }
                cursor.node = cursor.node.nextSibling
                continue
            }

            if (type === 8) {
                walk.index++
                const data = (node as Comment).data
                if (!data.startsWith('$')) {
                    // A comment the author wrote. The server emitted it too.
                    if (cursor.node === null || cursor.node.nodeType !== 8) {
                        mismatch(`expected the comment <!--${data}-->, found ${describe(cursor.node)}`)
                    }
                    cursor.node = cursor.node.nextSibling
                    continue
                }
                const part = plan.parts[walk.partAt]
                if (part === undefined || part.nodeIndex !== walk.index) {
                    mismatch(`slot ${data.slice(1)} is not where the template plan says it is`)
                }
                walk.partAt++
                this.claimChild(part.slot, cursor)
                continue
            }

            walk.index++
            const element = cursor.node
            const tag = (node as Element).tagName
            if (element === null || element.nodeType !== 1 || (element as Element).tagName !== tag) {
                mismatch(`expected <${tag.toLowerCase()}>, found ${describe(element)}`)
            }
            while (walk.partAt < plan.parts.length) {
                const part = plan.parts[walk.partAt] as PreparedPart
                if (part.nodeIndex !== walk.index) break
                walk.partAt++
                this.binders[part.slot] = this.bind(part.kind, element)
            }
            const inner: Cursor = { node: element.firstChild }
            this.level(node as Element, inner, plan, walk)
            if (inner.node !== null) {
                mismatch(
                    `<${tag.toLowerCase()}> holds ${describe(inner.node)}, which this template does not write`,
                )
            }
            cursor.node = element.nextSibling
        }
    }

    /**
     * Claim one child slot's range: its opening marker, the nodes between, and the anchor that closes
     * it. The scan counts depth rather than matching the first close it meets — a nested slot at the
     * same sibling level writes its own balanced pair, and `${a}${b}` with a template in `a` would
     * otherwise hand `a`'s close to `b`.
     */
    private claimChild(slot: number, cursor: Cursor): void {
        const open = cursor.node
        if (!isOpen(open)) {
            mismatch(
                `slot ${slot} has no opening marker (found ${describe(open)}) — ` +
                    `was this rendered with { hydratable: true }?`,
            )
        }
        const claimed: ChildNode[] = []
        let close: Comment | null = null
        let depth = 1
        for (let node = (open as ChildNode).nextSibling; node !== null; node = node.nextSibling) {
            if (isOpen(node)) depth++
            else if (isClose(node) && --depth === 0) {
                close = node as Comment
                break
            }
            claimed.push(node)
        }
        if (close === null) mismatch(`slot ${slot} was opened but never closed`)
        if (close.data !== `$${slot}`) mismatch(`slot ${slot} is closed by <!--${close.data}-->`)

        const part = new ChildPart(close)
        part.adopt(claimed, open as Comment)
        this.children.push(part)
        this.binders[slot] = (value) => part.set(value)
        cursor.node = close.nextSibling
    }

    private bind(kind: SlotKind, target: globalThis.Node): (value: unknown) => void {
        if (kind.kind === 'child') {
            const part = new ChildPart(target as Comment)
            this.children.push(part)
            return (value) => part.set(value)
        }
        const element = target as Element
        if (kind.kind === 'event') {
            // One listener for the life of the element, with the handler behind it swapped by
            // assignment. A row's `@click` closes over its item, so it is a FRESH function on every
            // reconcile — comparing identities meant a removeEventListener plus an addEventListener
            // per row per update, and a thousand-row list re-attached a thousand listeners to change
            // one. Nothing outside can observe which function is registered, so the indirection is
            // invisible: `dispatch` sits on the same element, so `event.currentTarget` is unchanged.
            let handler: EventListener | null = null
            let listening = false
            const dispatch: EventListener = (event) => {
                if (handler !== null) handler.call(element, event)
            }
            return (value) => {
                handler = (value ?? null) as EventListener | null
                // Never detached. A slot that goes null and back is the only case it would serve, and
                // a dead branch in `dispatch` answers it for nothing — the listener dies with the node.
                if (handler === null || listening) return
                listening = true
                element.addEventListener(kind.name, dispatch)
            }
        }
        if (kind.kind === 'property') {
            return (value) => {
                const record = element as unknown as Record<string, unknown>
                if (record[kind.name] !== value) record[kind.name] = value
            }
        }
        if (kind.kind === 'ref') {
            // The NODE itself, handed over once. A cell takes it through `set`; a function is a
            // per-instance handler whose return is its teardown — the contract `watch` already has,
            // rather than a second lifecycle spelling.
            let teardown: (() => void) | null = null
            this.partDisposers.push(() => {
                if (teardown !== null) teardown()
                teardown = null
            })
            return (value) => {
                if (teardown !== null) {
                    teardown()
                    teardown = null
                }
                if (value === null || value === undefined) return
                const cell = value as { set?: unknown }
                if (typeof cell.set === 'function') (cell.set as (node: unknown) => void).call(value, element)
                else teardown = (value as (node: Element) => (() => void) | undefined)(element) ?? null
            }
        }
        if (kind.kind === 'spread') {
            // Which attributes this slot owns is only known from the value, so the PREVIOUS object is
            // the record of what to take back: anything it set and no longer names is removed.
            let previous: Record<string, unknown> = {}
            return (value) => {
                const next = (value ?? {}) as Record<string, unknown>
                for (const name in previous) if (!(name in next)) element.removeAttribute(name)
                for (const name in next) {
                    const item = attributeText(next[name])
                    if (item === null) {
                        if (element.hasAttribute(name)) element.removeAttribute(name)
                        continue
                    }
                    const text = item === true ? '' : item
                    // Compare before writing.
                    if (element.getAttribute(name) !== text) element.setAttribute(name, text)
                }
                previous = next
            }
        }
        return (value) => {
            const text = attributeText(value)
            if (text === null) {
                if (element.hasAttribute(kind.name)) element.removeAttribute(kind.name)
                return
            }
            const next = text === true ? '' : text
            // Compare before writing.
            if (element.getAttribute(kind.name) !== next) element.setAttribute(kind.name, next)
        }
    }

    update(values: readonly unknown[]): void {
        // Nothing in the values MOVED, so nothing under them can have. A list update hands every
        // surviving row a fresh `values` array holding the same contents — one changed row of a
        // thousand means 999 arrays that are new objects over identical entries — and running the
        // full update on each of them re-enters `untrack`, the binder and the part only to compare a
        // string with itself.
        //
        // Identity is the whole test, and it is sound because a THUNK is never identical: an
        // authored `${() => x()}` and a compiled slot both allocate a fresh closure per evaluation,
        // so anything reactive takes the full path below and re-subscribes. What this skips is
        // exactly the case where a fresh envelope holds the values already on screen.
        const last = this.lastValues
        if (last !== null && last.length === values.length) {
            let moved = false
            for (let i = 0; i < values.length; i++) {
                if (values[i] !== last[i]) {
                    moved = true
                    break
                }
            }
            if (!moved) return
        }
        this.lastValues = values

        // Every thunk slot creates an effect, so an update that did not first tear down the previous
        // run's would leave one live effect PER update, each closing over the superseded values and each
        // still writing to the same binder. Invisible while templates are hand-written — a keyed row of
        // static text has nothing reactive to wake it — but this is the path a compiled template takes
        // on every patch, both here and from `ChildPart.set`.
        // Indexed, and only entered when there is something to tear down. A `for…of` over an array
        // allocates an iterator whether or not the array holds anything, and this array is EMPTY on
        // every row of a list of static text — a thousand iterators per update to run nothing.
        const takesRawFunction = this.plan.takesRawFunction
        let effects = this.slotEffects
        for (let i = 0; i < values.length; i++) {
            const binder = this.binders[i]
            if (binder === undefined) continue
            const value = values[i]
            // A thunk is the reactivity convention: subscribe here, so only THIS slot re-runs.
            // An `@click=${fn}` or `&ref=${fn}` value is a function that IS the value.
            if (typeof value === 'function' && takesRawFunction[i] !== true) {
                if (effects === null) {
                    effects = new Array<Node | null>(values.length).fill(null)
                    this.slotEffects = effects
                }
                const existing = effects[i] ?? null
                // The body reads `lastValues[slot]`, assigned above, so the re-run picks up the new
                // thunk without the node — or the closure — being rebuilt.
                if (existing !== null) {
                    rerun(existing)
                    continue
                }
                const slot = i
                effects[i] = watchNode(() => binder(unwrap((this.lastValues as readonly unknown[])[slot])))
            } else {
                // A slot whose value STOPPED being a thunk: its effect is still subscribed and would
                // paint over this write when one of its old sources moved.
                const stale = effects === null ? null : (effects[i] ?? null)
                if (stale !== null) {
                    stale.dispose()
                    ;(effects as (Node | null)[])[i] = null
                }
                // Threaded rather than captured: `untrack(() => binder(value))` allocates a closure
                // per slot per row on every patch, which on a thousand-row list is a thousand
                // allocations for a call the engine can make directly.
                untrackCall(binder, value)
            }
        }
    }

    dispose(): void {
        const effects = this.slotEffects
        if (effects !== null) {
            for (let i = 0; i < effects.length; i++) effects[i]?.dispose()
            effects.length = 0
        }
        const partDisposers = this.partDisposers
        for (let i = 0; i < partDisposers.length; i++) (partDisposers[i] as () => void)()
        partDisposers.length = 0
        const children = this.children
        for (let i = 0; i < children.length; i++) (children[i] as ChildPart).dispose()
    }
}

function instantiate(result: TemplateResult): Instance {
    return new Instance(result, null)
}
