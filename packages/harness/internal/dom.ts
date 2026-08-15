// DOM work counters.
//
// A correctness test cannot guard a performance contract: when the contract is "does less work", the
// wrong implementation still produces the right output. So the claims that are about WORK — nodes
// moved, attributes written, text nodes touched — are measured by counting the DOM calls, not by
// timing them. That makes them assertable, which is why this lives in the harness: a demo that
// says "one text write" can pin it at exactly one.
//
// The patches are installed once and left in place; `measure` brackets a synchronous region, so what
// is attributed to a case is only what that case did.
//
// One honest gap: `innerHTML = …` builds and inserts its nodes inside the parser, where none of
// these methods are called. It gets its own counter, and a case that uses it is not comparable to a
// surgical one on `insert` — it is comparable on TIME.

export interface Counts {
    insert: number
    remove: number
    createElement: number
    /**
     * Text and comment nodes made. Counted separately from elements so that "nothing was created"
     * cannot quietly mean "no ELEMENT was created" — a list row is an element AND a text node, and a
     * claim that prices only the element prices half of what it built.
     */
    createText: number
    createComment: number
    createFragment: number
    /**
     * Nodes produced by `cloneNode`, counted through the returned subtree.
     *
     * This one is load-bearing rather than completeness: abide does not BUILD a template's elements,
     * it clones a prepared one, so `createElement` never fires on its build path at all. Every claim
     * of the form "nothing was created" was passing for that reason and would have gone on passing
     * if a list had started rebuilding every row.
     */
    cloneNode: number
    setAttribute: number
    removeAttribute: number
    /**
     * Listeners attached and detached.
     *
     * A binding that re-attaches on every patch is invisible to every other counter here — the same
     * listener ends up on the same element and the clicks still land — so only counting the calls can
     * see it. A row's `@click` closes over its item and is therefore a FRESH function each reconcile,
     * which is exactly the case that used to churn one pair per row per update.
     */
    addListener: number
    removeListener: number
    textWrite: number
    innerHTML: number
    /**
     * Text nodes split in two, which is how adoption gives each row a disjoint range.
     *
     * It has its own counter because it is the one operation whose COST the substrates disagree
     * about reporting: a browser's `splitText` is native and touches none of the methods patched
     * here, while the emulator implements it in JS over `insertBefore` plus a `data` write. So the
     * same adoption read 9 mutations under `bun test` and 1 in every browser, and the demo asserting
     * 9 was asserting the emulator. Counted at the call, it reads the same on both.
     */
    splitText: number
}

const counts: Counts = {
    insert: 0,
    remove: 0,
    createElement: 0,
    createText: 0,
    createComment: 0,
    createFragment: 0,
    cloneNode: 0,
    setAttribute: 0,
    removeAttribute: 0,
    addListener: 0,
    removeListener: 0,
    textWrite: 0,
    innerHTML: 0,
    splitText: 0,
}

/**
 * The prototype in `instance`'s chain that actually OWNS `key`.
 *
 * Deliberately not the global class: under a DOM emulator `globalThis.Document` is not the class in
 * `document`'s prototype chain, so patching `Document.prototype.createElement` is a silent no-op —
 * the counter stays at zero and every assertion on it passes for the wrong reason. Resolving from a
 * live instance is the only spelling that is true in a browser AND under the emulator.
 */
function ownerOf(instance: object, key: string): object {
    let proto: object | null = Object.getPrototypeOf(instance)
    while (proto !== null) {
        if (Object.hasOwn(proto, key)) return proto
        proto = Object.getPrototypeOf(proto)
    }
    throw new Error(`abide: nothing in the prototype chain owns "${key}"`)
}

/**
 * How deep inside a patched method we already are.
 *
 * The convenience methods are IMPLEMENTED on top of the low-level ones — `append` routes through
 * `appendChild`, `remove` through `removeChild` — and which of them does is an implementation
 * detail of whichever DOM this runs on. Counting both meant one `container.append(anchor)` reported
 * two inserted nodes, so every claim that priced a single placement was silently doubled. Only the
 * OUTERMOST call counts; the work is the same work however many layers deep it is spelled.
 */
let depth = 0

/** Count `n` only if this is the outermost patched call, then run `body` with the guard raised. */
function guarded<T>(n: () => void, body: () => T): T {
    if (depth === 0) n()
    depth++
    try {
        return body()
    } finally {
        depth--
    }
}

/** Every node in a subtree, the fragment or element at its root included. */
function countNodes(root: globalThis.Node): number {
    let total = 1
    for (let child = root.firstChild; child !== null; child = child.nextSibling) total += countNodes(child)
    return total
}

let installed = false

/**
 * Realms already patched, keyed by the PROTOTYPE the patch went onto rather than by the document.
 *
 * Keyed that way because the two substrates disagree about what a frame is, and the disagreement is
 * measured rather than assumed: in chromium a frame is its own realm, so its `Node.prototype` is a
 * different object and has to be patched separately or the counters see nothing it does. Under
 * happy-dom the frame is handed the SAME prototypes as the page. Keyed by document, the emulator
 * would patch that one set twice and bill every operation twice; keyed by prototype, both substrates
 * come out right and neither needs to be asked which one it is.
 */
const PATCHED = new WeakSet<object>()

/**
 * Patch a DOM, if there is one — the ambient one, or a FRAME's when one is handed over.
 *
 * A suite module calls this at import time with no argument, and a suite module is imported on the
 * SERVER too — the cards' titles and notes are server-rendered, so the module runs in a lane with no
 * `document` to patch. That is not an error, it is the server; nothing it does can be counted anyway.
 * `installed` stays false so the browser's copy of the same module still patches for real, and so
 * does the test process once happy-dom has registered.
 *
 * The argument is what lets a case measure a document it does not live in. Counts land in the same
 * one place whichever realm produced them, which is what keeps `measure()` a single window rather
 * than a set of them.
 */
// `into` rather than `target`: a local further down is already called that, and a parameter shadowing
// it makes every reference below the shadow read as this one.
export function install(into?: Document): void {
    const doc: Document | null = into ?? (typeof document === 'undefined' ? null : document)
    if (doc === null) return

    // Sampled BEFORE anything is patched, so building them costs no counts.
    const sampleElement = doc.createElement('div')
    const sampleText = doc.createTextNode('')
    const sampleFragment = doc.createDocumentFragment()

    const node = ownerOf(sampleElement, 'insertBefore') as globalThis.Node
    // One representative check: everything below is patched together, out of the same realm, so a
    // realm that owns this owns the rest.
    if (PATCHED.has(node)) return
    PATCHED.add(node)
    installed = true
    const insertBefore = node.insertBefore
    node.insertBefore = function <T extends globalThis.Node>(child: T, reference: globalThis.Node | null): T {
        const n = child.nodeType === 11 ? child.childNodes.length : 1
        return guarded(
            () => {
                counts.insert += n
            },
            () => insertBefore.call(this, child, reference) as T,
        )
    }
    const appendChild = node.appendChild
    node.appendChild = function <T extends globalThis.Node>(child: T): T {
        const n = child.nodeType === 11 ? child.childNodes.length : 1
        return guarded(
            () => {
                counts.insert += n
            },
            () => appendChild.call(this, child) as T,
        )
    }
    const removeChild = node.removeChild
    node.removeChild = function <T extends globalThis.Node>(child: T): T {
        return guarded(
            () => {
                counts.remove++
            },
            () => removeChild.call(this, child) as T,
        )
    }

    // Counted through the RESULT, because that is the number: a deep clone of a two-node template is
    // two nodes however it is spelled. The walk is proportional to what was cloned and therefore to
    // the work being measured, which is the same constant-factor tax every other patch here levies.
    // Its OWN depth, not the shared one: a deep clone is implemented by cloning each child, so only
    // the outermost call may count — but a clone can also happen inside an `append`, where the
    // shared guard is already raised and would suppress it entirely.
    let cloning = 0
    const cloneNodeOriginal = node.cloneNode
    node.cloneNode = function (deep?: boolean): globalThis.Node {
        cloning++
        try {
            const made = cloneNodeOriginal.call(this, deep)
            if (cloning === 1) counts.cloneNode += countNodes(made)
            return made
        } finally {
            cloning--
        }
    }

    // The convenience methods are patched too, because they may NOT route through the low-level ones
    // and both lanes reach for them: `anchor.before(...)` is how a child part places what it owns,
    // `node.remove()` is how it clears, and a hand-written list uses `append`/`replaceChildren`.
    // Where they do route through, `guarded` keeps the count at one.
    const inserted = (nodes: (globalThis.Node | string)[]): number => {
        let total = 0
        for (const node of nodes) {
            total += typeof node !== 'string' && node.nodeType === 11 ? node.childNodes.length : 1
        }
        return total
    }

    // A Set, because two sample types can resolve to the SAME owning prototype — patching it twice
    // would double every count it carries.
    const childHolders = new Set<object>([ownerOf(sampleElement, 'before'), ownerOf(sampleText, 'before')])
    for (const holder of childHolders) {
        const child = holder as unknown as ChildNode
        const before = child.before
        child.before = function (...nodes: (globalThis.Node | string)[]): void {
            guarded(
                () => {
                    counts.insert += inserted(nodes)
                },
                () => before.apply(this, nodes),
            )
        }
        const after = child.after
        child.after = function (...nodes: (globalThis.Node | string)[]): void {
            guarded(
                () => {
                    counts.insert += inserted(nodes)
                },
                () => after.apply(this, nodes),
            )
        }
        const replaceWith = child.replaceWith
        child.replaceWith = function (...nodes: (globalThis.Node | string)[]): void {
            guarded(
                () => {
                    counts.insert += inserted(nodes)
                    counts.remove++
                },
                () => replaceWith.apply(this, nodes),
            )
        }
        const remove = child.remove
        child.remove = function (): void {
            guarded(
                () => {
                    counts.remove++
                },
                () => remove.call(this),
            )
        }
    }

    const parentHolders = new Set<object>([
        ownerOf(sampleElement, 'append'),
        ownerOf(sampleFragment, 'append'),
    ])
    for (const holder of parentHolders) {
        const parent = holder as unknown as ParentNode
        const append = parent.append
        parent.append = function (...nodes: (globalThis.Node | string)[]): void {
            guarded(
                () => {
                    counts.insert += inserted(nodes)
                },
                () => append.apply(this, nodes),
            )
        }
        const prepend = parent.prepend
        parent.prepend = function (...nodes: (globalThis.Node | string)[]): void {
            guarded(
                () => {
                    counts.insert += inserted(nodes)
                },
                () => prepend.apply(this, nodes),
            )
        }
        const replaceChildren = parent.replaceChildren
        parent.replaceChildren = function (...nodes: (globalThis.Node | string)[]): void {
            const removing = (this as unknown as globalThis.Node).childNodes.length
            guarded(
                () => {
                    counts.remove += removing
                    counts.insert += inserted(nodes)
                },
                () => replaceChildren.apply(this, nodes),
            )
        }
    }

    // Splitting a text node in two: native in a browser, and in the emulator a JS routine over the
    // methods above. Patched so the SPLIT is what gets counted on both, and the guard is what makes
    // the emulator's internals stop being counted a second time.
    countMethod(ownerOf(sampleText, 'splitText'), 'splitText', 'splitText')

    // The node factories, so "DOM nodes per list item" — one of the three numbers this project
    // budgets emitted code in — is a number a case can actually assert.
    //
    // Guarded for the same reason the mutators are, and here it is the emulator it corrects rather
    // than a convenience method: a browser builds `innerHTML`'s nodes and `splitText`'s second half
    // inside the parser, calling none of these, while happy-dom reaches for them. So an unguarded
    // factory reported three text nodes created for one `innerHTML` under `bun test` and none for
    // the same line in a browser.
    countMethod(ownerOf(doc, 'createElement'), 'createElement', 'createElement')
    countMethod(ownerOf(doc, 'createTextNode'), 'createTextNode', 'createText')
    countMethod(ownerOf(doc, 'createComment'), 'createComment', 'createComment')
    countMethod(ownerOf(doc, 'createDocumentFragment'), 'createDocumentFragment', 'createFragment')

    const element = ownerOf(sampleElement, 'setAttribute') as Element
    const setAttribute = element.setAttribute
    element.setAttribute = function (name: string, value: string): void {
        counts.setAttribute++
        setAttribute.call(this, name, value)
    }
    const removeAttribute = element.removeAttribute
    element.removeAttribute = function (name: string): void {
        counts.removeAttribute++
        removeAttribute.call(this, name)
    }

    // Typed against the lib's own overloads, which take a non-null listener — the DOM accepts `null`
    // as a no-op, and forwarding it unchanged is the whole job here.
    const target = ownerOf(sampleElement, 'addEventListener') as EventTarget
    const addEventListener = target.addEventListener
    target.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
    ): void {
        counts.addListener++
        addEventListener.call(this, type, listener, options)
    }
    const removeEventListener = target.removeEventListener
    target.removeEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
    ): void {
        counts.removeListener++
        removeEventListener.call(this, type, listener, options)
    }

    // The three accessors that write text or markup. Counted through their setters, since a write is
    // an assignment rather than a call.
    countSetter(ownerOf(sampleText, 'data'), 'data', 'textWrite')
    countSetter(ownerOf(sampleElement, 'textContent'), 'textContent', 'textWrite')
    countSetter(ownerOf(sampleElement, 'innerHTML'), 'innerHTML', 'innerHTML')
}

/**
 * Patch one method to count ITSELF by one, guarded — `countSetter`'s sibling for the calls rather
 * than the writes, and the shape every node factory wants.
 *
 * The guard is spelled out rather than reaching for `guarded`, because these are the per-node
 * factories: a closure pair per created node is a cost the HAND-WRITTEN arm of every ratio pays and
 * the abide arm — which builds rows by `cloneNode` — does not, so it moves one half of a comparison.
 */
function countMethod(holder: object, key: string, counter: keyof Counts): void {
    const target = holder as Record<string, (...args: unknown[]) => unknown>
    const original = target[key]
    if (original === undefined) return
    target[key] = function (...args: unknown[]): unknown {
        if (depth === 0) counts[counter]++
        depth++
        try {
            return original.apply(this, args)
        } finally {
            depth--
        }
    }
}

function countSetter(holder: object, key: string, counter: keyof Counts): void {
    const descriptor = Object.getOwnPropertyDescriptor(holder, key)
    if (descriptor?.set === undefined) return
    const set = descriptor.set
    Object.defineProperty(holder, key, {
        ...descriptor,
        set(value: string) {
            guarded(
                () => {
                    counts[counter]++
                },
                () => set.call(this, value),
            )
        },
    })
}

/** Four microtask turns — enough for an adoption plus its settle to have run. */
export const tick = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await Promise.resolve()
}

/**
 * The counters, or a failure saying why there are none.
 *
 * `install` is allowed to do nothing where there is no DOM, which means every counter would read
 * zero — and zero is the number these measurements assert. A vacuous pass is worse than a throw.
 */
function armed(): void {
    install()
    if (!installed) throw new Error('abide: DOM work cannot be counted in a lane with no `document`')
}

/** Count the DOM work a synchronous region does. */
export function measure(fn: () => void): Counts {
    armed()
    const before = { ...counts }
    fn()
    return since(before)
}

/**
 * The same, across a microtask drain — which is what a reactive write needs, since effects are
 * batched onto a microtask and it is the EFFECT that touches the DOM. The window is a few microtasks
 * wide, so anything else doing DOM work in that window is attributed here too; a measured region
 * should be one write for that reason.
 *
 * The drain BEFORE the window is what makes that true in a browser. The counters are global, and on
 * the demo page the case's own log is a rendered list: every `is` before this call leaves a row
 * queued, and those rows landed inside the measured flush and were billed to the write. The spread
 * case read three `setAttribute` for one changed name on screen and one under `bun test` — same
 * body, same framework, two answers. Nothing queued before the write is the write's work.
 */
export async function measureFlush(write: () => void): Promise<Counts> {
    armed()
    await tick()
    const before = { ...counts }
    write()
    await tick()
    return since(before)
}

function since(before: Counts): Counts {
    // Copied for its SHAPE — every key is overwritten below, so a new counter needs no second
    // zeroed literal to stay in step with.
    const after: Counts = { ...counts }
    for (const key of Object.keys(after) as (keyof Counts)[]) after[key] = counts[key] - before[key]
    return after
}

const LABELS: Record<keyof Counts, string> = {
    insert: 'nodes inserted',
    remove: 'nodes removed',
    createElement: 'elements created',
    createText: 'text nodes created',
    createComment: 'comments created',
    createFragment: 'fragments created',
    cloneNode: 'nodes cloned',
    setAttribute: 'setAttribute',
    removeAttribute: 'removeAttribute',
    addListener: 'listeners attached',
    removeListener: 'listeners detached',
    textWrite: 'text writes',
    innerHTML: 'innerHTML assignments',
    splitText: 'text nodes split',
}

/**
 * Every node this region made — the "DOM nodes per list item" budget, in one number.
 *
 * A split is in here because it MAKES a node: the second half is a new text node, and no factory
 * was called to get it.
 */
export function nodesMade(counts_: Counts): number {
    return (
        counts_.createElement +
        counts_.createText +
        counts_.createComment +
        counts_.createFragment +
        counts_.cloneNode +
        counts_.splitText
    )
}

// What `total` counts, and deliberately not the node factories: making a node touches nothing a
// reader can see, and "adopting server markup writes NOTHING" is a claim about the DOCUMENT. The
// nodes made are priced by `nodesMade` instead, which is a different question with its own answer.
const MUTATIONS: (keyof Counts)[] = [
    'insert',
    'remove',
    'setAttribute',
    'removeAttribute',
    'addListener',
    'removeListener',
    'textWrite',
    'innerHTML',
    'splitText',
]

/** Only the counters that actually moved, as `label: n` pairs. */
export function nonZero(counts_: Counts): string {
    const parts: string[] = []
    for (const key of Object.keys(LABELS) as (keyof Counts)[]) {
        if (counts_[key] !== 0) parts.push(`${LABELS[key]} ${counts_[key]}`)
    }
    return parts.length === 0 ? 'no DOM work at all' : parts.join(' · ')
}

/** How much this region CHANGED the document. Nodes it merely made are `nodesMade`. */
export function total(counts_: Counts): number {
    let sum = 0
    for (const key of MUTATIONS) sum += counts_[key]
    return sum
}

/**
 * Count the calls one method makes across a region. Narrower than the counters above: this pins ONE
 * method, which is what a claim like "the class attribute was not touched" needs.
 */
export function countCalls<T extends object>(target: T, method: keyof T): { calls: number; restore(): void } {
    const original = target[method] as unknown as (...args: unknown[]) => unknown
    const record = {
        calls: 0,
        restore: (): void => {
            target[method] = original as T[keyof T]
        },
    }
    target[method] = function (this: unknown, ...args: unknown[]) {
        record.calls++
        return original.apply(this, args)
    } as unknown as T[keyof T]
    return record
}
