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
    Suspend,
    settledArms,
    settledBoundary,
    type TemplateResult,
} from '$shared/html.ts'
import { type Node, rerun, untrackCall, watchNode } from '$shared/internal/graph.ts'
import { CLOSE_FORM, PLACEHOLDER_TAG, SLOT_OPEN } from '$shared/internal/MARKERS.ts'
import { isAsyncIterable, isThenable } from '$shared/internal/probes.ts'
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

/**
 * What a plain value renders as. Nullish and BOTH booleans are nothing, not their spelling.
 *
 * The CHILD-position twin of `$shared`'s `attributeText`, and the same hydration mismatch is what the
 * two lanes must agree about — `take` compares this against the text the server wrote, so a
 * disagreement rewrites markup the server already got right and nothing else catches it. Spelled
 * twice rather than shared: the server's half is the `typeof` switch at the top of `$server`'s
 * `emit`, which exists so a thousand-row table's strings and numbers never reach a prototype probe,
 * and a shared call would be the thing that walk is written to avoid. Change one, change the other.
 */
function textOf(value: unknown): string {
    return value === null || value === undefined || value === false || value === true ? '' : String(value)
}

/**
 * A range being filled from a stream — what `ChildPart.reclaiming` hands back.
 *
 * Three verbs rather than one `push`, because the pieces are not alike: the first STANDS in the
 * range and every later one REPLACES something already in it. A single entry point would have to
 * re-derive which kind it was holding, from markup it had already parsed.
 */
export interface Reclaiming {
    insert(fragment: DocumentFragment): void
    /** `false` when there is no placeholder by that id — a patch for a range already replaced. */
    patch(id: string, fragment: DocumentFragment): boolean
    /** The stream ended: snapshot the range so the next update ADOPTS it. */
    done(): void
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
        // and it was the LAST branch below, five instanceof tests, two probe calls and an
        // `Array.isArray` away. The two fields the general path would have written are written here
        // too: `holding` back to nothing, because a text value replaces whatever block owned this
        // slot, and the generation bumped, because a load still in flight must not paint over it.
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
                    // Pushed, not re-assigned: `clearExcept` above left `owned` empty, so the array
                    // the constructor made is the one this row uses.
                    this.owned.push(made)
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
                // Through `clearExcept`, not a bare remove loop. `take` has to BUILD before it can
                // know the range matches, and what it built holds one effect per reactive slot.
                // Nothing else owns those: `watchNode` hands the node to its caller and registers it
                // nowhere, so the instance this part is holding is the only route to them. An effect
                // this part drops is one nothing can ever dispose, and it goes on writing into the
                // nodes removed below.
                this.clearExcept(null)
                for (const node of claimed) node.remove()
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
        if (value instanceof Suspend) {
            // `suspend` is about WHEN the markup is sent, which is a question only a server has. Here
            // the answer is the one this part already gives a promise in a slot: show the fallback,
            // swap when it lands. Rendering the fallback rather than nothing is the whole difference
            // from an ordinary thenable — the author named what to show while waiting, and a server
            // that deferred this subtree sent that same fallback as the placeholder.
            const operand = value.value
            // The same cutoff `{#await}` and `{#for await}` already have: an unchanged operand is
            // not restarted, so a re-run of the enclosing effect for some OTHER reason does not
            // throw a settled panel back to its fallback and rebuild it. `take` records the operand
            // and this is what reads it back.
            if (this.holding === operand) return
            this.holding = NOTHING
            this.generation++
            if (!isThenable(operand)) {
                this.show(value.body(operand as never), operand)
                return
            }
            this.show(value.fallback, operand)
            // A stamp of its OWN, bumped after the fallback is on screen rather than read off it.
            // A fallback may itself be thenable — a cell is, and a cell is ordinary to pass — in
            // which case `set` above started a settle of its own and stamped it with the generation
            // it had just bumped to. Sharing that stamp means whichever lands first discards the
            // other, and the fallback is usually the settled one, so the body would never run. The
            // bump also retires that settle: a placeholder has no business painting over the value
            // it was standing in for. `settle` with no branches is already the policy this wants —
            // no arm to catch a rejection, because `suspend` has a fallback rather than a
            // `{:catch}`, so the fallback stays up and the error is reported.
            this.generation++
            this.settle(operand, null, this.generation, value.body)
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
            this.owned.push(this.text)
            this.anchor.before(this.text)
            return
        }
        // Compare before writing.
        if (this.text.data !== next) this.text.data = next
    }

    /**
     * Paint a block's content and leave the block OWNING the slot.
     *
     * `set` clears `holding` on every path that paints, because an ordinary value replaces whatever
     * block was showing. A block painting its own arm is the exception, and this is the only spelling
     * of it: the nine callers below are the enumeration the rule asks for, rather than nine separate
     * `this.holding = operand // set cleared it` lines that a tenth path could silently forget.
     * That failure is invisible — the arm still renders, and then re-enters and rebuilds its whole
     * subtree on every re-run of the enclosing effect, per row for a block inside a list.
     *
     * Callers: the `suspend` arm of `set` (both settled and in-flight), `settle`'s three landings,
     * `await_`'s pending and synchronous arms, and `stream_`'s start and failure arms. `take` does
     * not go through here — it claims rather than paints, and never clears `holding` to begin with.
     */
    private show(value: unknown, operand: unknown): void {
        this.set(value)
        this.holding = operand
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

        if (value instanceof Suspend) {
            // Whatever the server sent for this subtree is ALREADY the settled body. In a document it
            // was deferred and patched in before `DOMContentLoaded`, which is the earliest this side
            // hydrates; in a render with nowhere to patch it was awaited inline. Either way the
            // fallback is not what is on screen, so claiming it as the body is what keeps hydration
            // free — and re-running the promise to find that out would flash the fallback back up
            // over markup that is already right.
            const operand = value.value
            this.generation++
            if (!isThenable(operand)) {
                this.take(claimed, value.body(operand as never))
                // Recorded here as well as in `set`: an adopted panel is a settled one, and without
                // this the first re-run of the slot finds `holding` still `NOTHING`, re-enters the
                // body and updates the whole subtree it just adopted for free. `Awaited`'s arm below
                // is the same line for the same reason.
                this.holding = operand
                return
            }
            // Still in flight on THIS side — a fresh operand rather than the one the server settled.
            // Hold the server's nodes as an opaque range until it lands, exactly as the awaited case
            // below does, and let the settle replace them.
            this.owned = claimed
            this.holding = operand
            this.settle(operand, null, this.generation, value.body)
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
            // far the server got, so the rows are rebuilt. See SPEC's "Known limits".
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
            // Held BEFORE it is filled, and `adopt` pushes per row: a row that mismatches leaves the
            // rows before it fully built, and the recovery in `set` can only dispose what this part
            // is holding by then.
            this.list = list
            list.adopt(value, cursor)
            if (cursor.node !== this.anchor) {
                mismatch(
                    `a list left ${describe(cursor.node)} over — the server wrote more rows than this one has`,
                )
            }
            this.owned = claimed
            return
        }

        if (isTemplate(value)) {
            const cursor: Cursor = { node: claimed[0] ?? this.anchor }
            const nested = new Instance(value, cursor)
            // Held before the range is checked, for the reason the list arm above is: a constructed
            // instance owns its slot effects, and the recovery cannot reach one this part dropped.
            this.nested = nested
            if (cursor.node !== this.anchor) {
                mismatch(`a nested template left ${describe(cursor.node)} over`)
            }
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
     * slot. Every caller bumps the generation before handing it over rather than having this do it:
     * `{#await}` stamps once for the whole block, including the arm it paints synchronously.
     *
     * `body` is what `suspend` adds over a bare promise: the settled value renders THROUGH it rather
     * than as itself. Nothing else about the policy differs, which is why it is a parameter here
     * rather than a second copy of the generation guard.
     */
    private settle(
        operand: PromiseLike<unknown>,
        branches: Branches | null,
        generation: number,
        body?: Suspend['body'],
    ): void {
        Promise.resolve(operand).then(
            (value) => {
                if (generation !== this.generation) return
                if (branches === null) {
                    // A bare promise in a slot is deliberately NOT recorded — `set` does not put one
                    // in `holding` on the way in either — so it paints through `set` and a suspend,
                    // which owns the slot for as long as its operand is unchanged, through `show`.
                    const painted = body === undefined ? value : body(value as never)
                    if (body === undefined) this.set(painted)
                    else this.show(painted, operand)
                    return
                }
                this.show(settledArms(branches, undefined, value, false), operand)
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
                this.show(settledArms(branches, error, undefined, true), operand)
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
        // Claimed BEFORE the author's `pending()` runs, and again after `set` clears it: the callback
        // is arbitrary code that can reach this part, and the guard above is what stops a re-entrant
        // call from restarting the block it is already inside.
        this.holding = block.value
        const branches = block.branches
        const operand = block.value

        this.show(branches.pending?.() ?? null, operand)
        const generation = this.generation

        if (!isThenable(operand)) {
            this.show(settledArms(branches, undefined, operand, false), operand)
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
        this.show([], source)
        // ONE stamp for the whole stream. Appending a row does not bump the generation — only a `set`
        // does, and a `set` here is something else taking the range over — so the stamp taken at the
        // start stays valid, and a re-run for any other reason is exactly what it has to catch.
        const generation = this.generation
        void (async () => {
            try {
                let index = 0
                // One closure for the whole stream rather than a second copy of the body, so the two
                // arms below differ in how they STEP and in nothing else.
                const took = (item: never): boolean => {
                    if (generation !== this.generation) return false
                    // APPENDED, not re-set. A growing array handed to `set` made the list rebuild
                    // itself once per row; there is no accumulator here at all now, so streaming n
                    // rows costs n rows of work rather than n²/2.
                    this.appendRow(block.row(item, index++))
                    return true
                }
                // `streamed()` takes `AsyncIterable<T> | Iterable<T>`, and a sync source has nothing
                // to wait on: `for await` over one wraps every item in a promise and pays a tick per
                // ROW to learn that. The probe is the same fork every other sync/async junction here
                // takes.
                if (isAsyncIterable(source)) {
                    for await (const item of source as AsyncIterable<never>) if (!took(item)) return
                } else {
                    for (const item of source as Iterable<never>) if (!took(item)) return
                }
            } catch (error) {
                if (generation !== this.generation) return
                if (block.failure === undefined) {
                    queueMicrotask(() => {
                        throw error
                    })
                    return
                }
                this.show(block.failure(error), source)
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

    /** One more row on the end of the list this part is showing — `{#for await}`'s only write. */
    private appendRow(item: unknown): void {
        this.clearExcept('list')
        if (this.list === null) this.list = new ListPart(this.anchor)
        this.list.append(item)
    }

    private clearExcept(keep: 'text' | 'nested' | 'list' | null): void {
        if (keep === 'text' && this.text !== null) return
        if (keep === 'nested' && this.nested !== null) return
        if (keep === 'list' && this.list !== null) return
        if (this.list !== null) this.list.dispose()
        if (this.nested !== null) this.nested.dispose()
        // Only when there IS a range: on the build path a fresh part reaches here holding the empty
        // array its constructor made, and replacing that with a second empty one — which the caller
        // then pushes into — was one discarded array per child slot per row. A fresh array rather
        // than `length = 0` because `owned` is sometimes an array this part does not own: `take`
        // assigns it `claimed`, and the nested arm assigns it `nested.nodes`.
        if (this.owned.length !== 0) {
            for (const node of this.owned) node.remove()
            this.owned = []
        }
        // Outside the guard: the server's opening marker outlives the range it bracketed, so a part
        // that painted through `set` has to let go of it whether or not it was holding nodes.
        this.dropOpened()

        this.text = null
        this.nested = null
        this.list = null
        this.rawHtml = null
    }

    /**
     * Throw away what this part is showing and take a fresh range AS IT ARRIVES.
     *
     * The handover a navigation uses, and `hydrate` is the same one at boot — where the nodes are
     * already in the document and there is nothing to dispose. HTML cannot be parsed halfway, so the
     * unit is a complete piece: the in-order pass, then each deferred subtree. What this owns is
     * where they go — the first piece stands in the range, and every later one replaces the
     * placeholder that was standing in for it.
     *
     * The range is snapshotted at `done` rather than at each push, because a patch can change it: a
     * `suspend` at the top level of a page has its placeholder AS a top-level node, and replacing one
     * rewrites the very list `claimed` would have held.
     */
    reclaiming(): Reclaiming {
        // Exactly `dispose`'s teardown, and it must run BEFORE the range is captured: a load still in
        // flight cannot be allowed to settle into a range that is being replaced. Spelled as the call
        // rather than repeated — the two drifted once already, which is how `reclaiming` came to drop
        // what `dispose` salvaged.
        this.dispose()
        // Where the range begins, captured before anything is inserted. `null` means "the start of
        // the parent" — a part whose anchor is the first thing in its container, which is what the
        // root part is after the teardown above.
        const before = this.anchor.previousSibling
        return {
            insert: (fragment: DocumentFragment): void => {
                // Recorded before it is inserted, because inserting empties the fragment. Until
                // `done()` re-derives the range this is the ONLY reference to what went in, and a
                // part disposed mid-stream — a route change, a teardown, an abandoned navigation —
                // would otherwise leave the page it had already painted in the document.
                for (let node = fragment.firstChild; node !== null; node = node.nextSibling) {
                    this.owned.push(node as ChildNode)
                }
                this.anchor.before(fragment)
            },
            patch: (id: string, fragment: DocumentFragment): boolean => {
                const parent = this.anchor.parentNode as ParentNode | null
                if (parent === null) return false
                // An ATTRIBUTE selector rather than `#id`: a generated id is `s0`, and while that is
                // a legal identifier today, an id selector is one escaping rule away from being the
                // reason a patch silently did not land.
                const standing = parent.querySelector(`${PLACEHOLDER_TAG}[id="${id}"]`)
                if (standing === null) return false
                standing.replaceWith(fragment)
                return true
            },
            done: (): void => {
                const nodes: ChildNode[] = []
                const parent = this.anchor.parentNode as ParentNode | null
                const first = before === null ? (parent?.firstChild ?? null) : before.nextSibling
                for (let node = first; node !== null && node !== this.anchor; node = node.nextSibling) {
                    nodes.push(node as ChildNode)
                }
                this.claimed = nodes
            },
        }
    }

    dispose(): void {
        this.generation++ // a load still in flight must not paint into a disposed part
        this.holding = NOTHING
        // A part torn down before its first update still owns server nodes nobody else will remove,
        // and dropping the reference leaves them in the document — for `reclaiming`, in front of the
        // incoming range. Normally a no-op, since `claimed` is consumed by the first `set`; it is the
        // overlapping navigation that reaches it.
        if (this.claimed !== null) {
            this.owned = this.claimed
            this.claimed = null
        }
        // Through `clearExcept`, because a nested instance still owns live slot effects and `take`
        // overwrites `nested` without disposing it — a part torn down without this leaves one live
        // effect per reactive slot per navigation, each writing into nodes no longer in the document.
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

/** Every keyed row of a pass, for the pass that found one of them somewhere other than its index. */
function indexByKey(rows: Row[]): Map<unknown, Row> {
    const index = new Map<unknown, Row>()
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as Row
        if (row.key !== undefined) index.set(row.key, row)
    }
    return index
}

class ListPart {
    private rows: Row[] = []
    /** Bumped per `set`, and written into every row carried forward. */
    private pass = 0

    constructor(private readonly anchor: Comment) {}

    /**
     * Claim one row per item, in order, off the same cursor. No per-row marker is needed and none is
     * emitted: a row IS a template, and adopting a template consumes exactly the nodes it describes,
     * so each row delimits itself and hands the cursor to the next.
     */
    adopt(items: unknown[], cursor: Cursor): void {
        // Pushed per row rather than assigned at the end: adopting row `k` can find the server's
        // markup does not match and throw, and the rows already built by then are only reachable
        // through here. `dispose` is what the failed adoption's recovery calls.
        this.rows = []
        for (const item of items) {
            const keyed = isKeyed(item)
            const template = keyed ? item.template : (item as TemplateResult)
            this.rows.push({
                key: keyed ? item[KEY] : undefined,
                instance: new Instance(template, cursor),
                usedAt: 0,
            })
        }
    }

    /**
     * One more row on the END, with nothing already on screen reconsidered.
     *
     * `set` compares the whole list against the previous one, which is the only right answer when
     * any row may have changed — and the wrong one n times over for a stream that only ever appends.
     * Handing it a growing array cost a fresh `Row[]` per row plus a re-probe and an `update` of
     * every row already placed: n allocations and n²/2 element visits to stream n rows, which is
     * exactly what `stream_` builds one shared array to avoid one layer up.
     *
     * A separate entry point rather than a fast path inside `set`, because the caller is what knows
     * this: `{#for await}` appends and never reorders, and `set` would have to infer that from an
     * array identity it has no reason to trust.
     */
    append(item: unknown): void {
        const keyed = isKeyed(item)
        const template = keyed ? item.template : (item as TemplateResult)
        const instance = instantiate(template)
        this.rows.push({ key: keyed ? item[KEY] : undefined, instance, usedAt: this.pass })
        // The anchor is what every row sits BEFORE, so appending there is the end of the list. No
        // placement walk: nothing below this row moved, because there is nothing below it.
        const parent = this.anchor.parentNode as ParentNode
        for (const node of instance.nodes) parent.insertBefore(node, this.anchor)
    }

    set(items: unknown[]): void {
        const previous = this.rows
        const pass = ++this.pass

        // Built only when a keyed row is genuinely somewhere OTHER than its own index, and there is
        // still a previous row left for it to be found at. An unkeyed list — the one a plain `.map()`
        // produces, and the one a thousand-row update walks — never asks. A keyed list whose order
        // did not change, which is what a keyed feed does on every edit, would have paid a `Map.set`
        // and a `Map.get` per row to be told what `previous[i]` already said: 0.165 vs 0.234 ms on
        // the thousand-row same-order edit benched in the example package.
        //
        // The `carried` half is what keeps the two ends honest. A cold build has no previous rows at
        // all, and an APPEND has claimed every one of them by position before it reaches the new
        // tail — both would otherwise build an index whose every lookup provably misses, since a row
        // already claimed this pass is dropped by the `usedAt` guard below anyway. Worth 0.074
        // against 0.081 ms on the keyed append benched beside the edit; on the cold build the two
        // are indistinguishable, since the index it skips is an EMPTY map and the misses are cheap.
        // That end is kept for the shape of the thing, not for a number.
        //
        // Duplicate keys resolve differently from a pure index: it keeps the LAST row with a key,
        // the position check takes the one already at `i`.
        let byKey: Map<unknown, Row> | null = null

        // Where the list actually differs from the one before it. Everything outside `[firstChanged,
        // lastChanged]` is the SAME row object at the SAME index, which is what lets the placement
        // walk below start late and stop early instead of touching every row to find out that most
        // of them are where they already were.
        // Grown by `push` for CONSISTENCY, not for speed, and the difference matters: `adopt` and
        // `append` both push, so a pre-sized `new Array(n)` here left `this.rows` one elements kind
        // out of one writer and another out of the other two, and every `previous[i]` and placement
        // read downstream saw both. The timings are indistinguishable either way under the emulator,
        // which is the substrate available — so this is not a performance claim and should not be
        // read as one. The loop fills 0…n-1 in order, so nothing else moves.
        const next: Row[] = []
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

            let row: Row | undefined
            if (key === undefined) row = previous[i]
            else {
                const at = previous[i]
                if (at !== undefined && at.key === key) row = at
                else if (carried < previous.length) {
                    if (byKey === null) byKey = indexByKey(previous)
                    row = byKey.get(key)
                }
            }
            // Already taken this pass, so it is not available to take again: an unkeyed item claims
            // `previous[i]` by INDEX while a keyed one can claim that same row out of `byKey`, and
            // `next` would then hold one `Row` at two indices — the placement walk reads the same
            // `instance.nodes` for both and renders one row where two were asked for. The second
            // claimant builds its own instead.
            if (row !== undefined && row.usedAt === pass) row = undefined
            if (row !== undefined && row.instance.strings === template.strings) {
                if (key !== undefined) byKey?.delete(key)
                row.usedAt = pass
                carried++
                row.instance.update(template.values)
            } else {
                row = { key, instance: instantiate(template), usedAt: pass }
            }
            next.push(row)
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
        // Constant across the loop — the anchor is never moved, only inserted before — and the loop
        // runs once per row from `lastChanged` down, so reading it inside cost a native getter per
        // MOVED row: 197 of them on the two-row swap this list is benched with.
        const parent = this.anchor.parentNode as ParentNode
        for (let i = lastChanged; i >= 0; i--) {
            const instance = (next[i] as Row).instance
            const first = instance.nodes[0]
            if (first === undefined) continue
            if (first.nextSibling !== reference || first.parentNode === null) {
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

/**
 * One `@event` slot: the listener the element keeps, with the author's handler swapped behind it.
 *
 * A row's `@click` closes over its item, so it is a FRESH function on every reconcile — comparing
 * identities meant a removeEventListener plus an addEventListener per row per update, and a
 * thousand-row list re-attached a thousand listeners to change one. Nothing outside can observe
 * which function is registered: the listener sits on the same element, so `event.currentTarget` is
 * unchanged. A record rather than a closure, and `handleEvent` rather than a dispatch function,
 * because the DOM's own object-listener protocol removes the second allocation a per-row event slot
 * would otherwise pay.
 */
class EventSlot implements EventListenerObject {
    private handler: EventListener | null = null
    private listening = false

    constructor(
        private readonly element: Element,
        private readonly name: string,
    ) {}

    handleEvent(event: Event): void {
        if (this.handler !== null) this.handler.call(this.element, event)
    }

    write(value: unknown): void {
        this.handler = (value ?? null) as EventListener | null
        // Never detached. A slot that goes null and back is the only case it would serve, and the
        // null check above answers it for nothing — the listener dies with the node.
        if (this.handler === null || this.listening) return
        this.listening = true
        this.element.addEventListener(this.name, this)
    }
}

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
     *
     * Null until a `&ref` binder asks for it, the same way `slotEffects` is: a row is instantiated
     * per row of a list and almost no template has a `&ref` at all, so the eager array was one
     * allocation per row that nothing could ever read.
     */
    private partDisposers: (() => void)[] | null = null
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

        // Walk straight to each slot down its recorded path — see `prepare.ts` for why not a
        // `TreeWalker`, which is where the path is recorded and the measurement lives.
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
                const wanted = (node as Text).data
                if (wanted === '') continue
                const live = cursor.node
                if (live === null || live.nodeType !== 3) {
                    mismatch(`expected the static text ${JSON.stringify(wanted)}, found ${describe(live)}`)
                }
                // …unless the PARSER merged it with the text that follows. Two adjacent rows of a list
                // are two templates and one text node: a row ending in a newline and the next one
                // beginning with the indentation of its own first line arrive from the server as one
                // run of characters, and the browser has no reason to keep them apart. Splitting it
                // here restores the invariant `ListPart.adopt` relies on — a row consumes exactly the
                // nodes it describes and hands the cursor to the next — and costs nothing on any
                // template whose text nodes already stand alone.
                const data = (live as Text).data
                if (data.length > wanted.length && data.startsWith(wanted))
                    (live as Text).splitText(wanted.length)
                cursor.node = live.nextSibling
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
        // `nodeType` read ONCE per node rather than once in each of the two probes. This walks every
        // node the server wrote inside the slot — every row of an adopted thousand-row list — and a
        // row's own nodes are elements, which both probes would have loaded the type of only to bail.
        // The marker test is the same two steps `isOpen` makes, in the order that pays: a comment is
        // rare among the claimed nodes, and `CLOSE_FORM` only runs on one. `isClose` went with this
        // — the walk was its only caller.
        for (let node = (open as ChildNode).nextSibling; node !== null; node = node.nextSibling) {
            if (node.nodeType === 8) {
                const data = (node as Comment).data
                if (data === SLOT_OPEN) depth++
                else if (CLOSE_FORM.test(data) && --depth === 0) {
                    close = node as Comment
                    break
                }
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
            const slot = new EventSlot(element, kind.name)
            return (value) => slot.write(value)
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
            if (this.partDisposers === null) this.partDisposers = []
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
        // The length test cannot fail today — every caller with a non-null `lastValues` has already
        // matched `strings` by identity, and a template's slot count is fixed by its strings. It
        // stays because it is what makes the indexed read below safe without that argument, which is
        // two call sites away rather than here.
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

        // One effect per thunk slot, kept for the life of the slot and RE-RUN rather than rebuilt: the
        // body reads `lastValues[slot]`, assigned just above, so a new thunk is picked up without a
        // new node or a new closure. Building one per update would instead leave one live effect per
        // update, each closing over superseded values and each still writing to the same binder.
        // `slotEffects` is null — not an empty array — until a slot is actually a thunk, so a row of
        // static text allocates nothing here on any patch.
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
                    // Pushed, not `new Array(n).fill(null)`: `fill` closes the holes but leaves the
                    // array holey, and this one is read at `effects[i]` for every thunked slot of
                    // every row on every update, for the life of the instance.
                    effects = []
                    for (let slot = 0; slot < values.length; slot++) effects.push(null)
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
        if (partDisposers !== null) {
            for (let i = 0; i < partDisposers.length; i++) (partDisposers[i] as () => void)()
            partDisposers.length = 0
        }
        const children = this.children
        for (let i = 0; i < children.length; i++) (children[i] as ChildPart).dispose()
    }
}

function instantiate(result: TemplateResult): Instance {
    return new Instance(result, null)
}
