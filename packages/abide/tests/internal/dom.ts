// DOM work counters.
//
// A correctness test cannot guard a performance contract: when the contract is "does less work", the
// wrong implementation still produces the right output. So the claims that are about WORK — nodes
// moved, attributes written, text nodes touched — are measured by counting the DOM calls, not by
// timing them. That makes them assertable, which is why this lives in the test kit: a demo that
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
    textWrite: number
    innerHTML: number
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
    textWrite: 0,
    innerHTML: 0,
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

export function install(): void {
    if (installed) return
    installed = true

    // Sampled BEFORE anything is patched, so building them costs no counts.
    const sampleElement = document.createElement('div')
    const sampleText = document.createTextNode('')
    const sampleFragment = document.createDocumentFragment()

    const node = ownerOf(sampleElement, 'insertBefore') as globalThis.Node
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

    const documentProto = ownerOf(document, 'createElement') as Document
    const createElement = documentProto.createElement
    documentProto.createElement = function (tag: string, options?: ElementCreationOptions): HTMLElement {
        counts.createElement++
        return createElement.call(this, tag, options) as HTMLElement
    }

    // The other three node factories, so "DOM nodes per list item" — one of the three numbers this
    // project budgets emitted code in — is a number a case can actually assert.
    const textOwner = ownerOf(document, 'createTextNode') as Document
    const createTextNode = textOwner.createTextNode
    textOwner.createTextNode = function (data: string): Text {
        counts.createText++
        return createTextNode.call(this, data)
    }
    const commentOwner = ownerOf(document, 'createComment') as Document
    const createComment = commentOwner.createComment
    commentOwner.createComment = function (data: string): Comment {
        counts.createComment++
        return createComment.call(this, data)
    }
    const fragmentOwner = ownerOf(document, 'createDocumentFragment') as Document
    const createDocumentFragment = fragmentOwner.createDocumentFragment
    fragmentOwner.createDocumentFragment = function (): DocumentFragment {
        counts.createFragment++
        return createDocumentFragment.call(this)
    }

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

    // The three accessors that write text or markup. Counted through their setters, since a write is
    // an assignment rather than a call.
    countSetter(ownerOf(sampleText, 'data'), 'data', 'textWrite')
    countSetter(ownerOf(sampleElement, 'textContent'), 'textContent', 'textWrite')
    countSetter(ownerOf(sampleElement, 'innerHTML'), 'innerHTML', 'innerHTML')
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

/** Count the DOM work a synchronous region does. */
export function measure(fn: () => void): Counts {
    install()
    const before = { ...counts }
    fn()
    return since(before)
}

/**
 * The same, across a microtask drain — which is what a reactive write needs, since effects are
 * batched onto a microtask and it is the EFFECT that touches the DOM. The window is a few microtasks
 * wide, so anything else doing DOM work in that window is attributed here too; a measured region
 * should be one write for that reason.
 */
export async function measureFlush(write: () => void): Promise<Counts> {
    install()
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
    textWrite: 'text writes',
    innerHTML: 'innerHTML assignments',
}

/** Every node this region made — the "DOM nodes per list item" budget, in one number. */
export function nodesMade(counts_: Counts): number {
    return (
        counts_.createElement +
        counts_.createText +
        counts_.createComment +
        counts_.createFragment +
        counts_.cloneNode
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
    'textWrite',
    'innerHTML',
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
