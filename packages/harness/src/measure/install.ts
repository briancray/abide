// THE PATCH SET, and the four rules that make it mean the same thing in both
// substrates. The list is enumerated from the DOM INTERFACES rather than from the
// mutators this repo happens to use, and the rules are worth more than the list.
//
// *Patch the interface that OWNS the member.* `textContent` is defined on `Node`, and
// happy-dom ALSO defines own descriptors for it on `Element` and `CharacterData`. So
// a declaration naming only `Node` counts an element's write in a browser and misses
// it under happy-dom, where the subclass shadows; naming only the subclass does the
// reverse. The declaration names every interface the member can be reached through,
// and the installer shadows where the named interface does not own it — so one write
// crosses exactly one patched member in both places.
//
// *Installed once, armed per case.* Removing a patch around a case body cannot be
// done in the browser arm at all — `addInitScript` runs at document-start and has no
// removal hook — and re-patching per case invalidates the inline caches on those
// members once per case, for the process. So the prototype shape is fixed for the
// process lifetime and `arm()`/`disarm()` swap the live record for a discard.
//
// *An unpatched mutator is a THROW, not a zero.* A reconcile written with
// `node.normalize()` against a patch set that only knows `removeChild` would report
// `elementsMoved: 0` and turn every RENDERER gate green. The list below is what is
// COUNTED; the refused list is everything else that mutates, and it fails loudly.
//
// *Count the OUTERMOST patched call only.* happy-dom implements the aggregate members
// in JavaScript on top of the primitives this patches; Chromium implements them in
// C++ where no JS-visible call happens. Measured: `textContent = ''` on a node with
// two children reports 2 `removeChild` calls under happy-dom and 0 under Chromium. So
// the outermost armed call tallies and the nested ones tally nothing.

import type { Work } from './Work.ts'

type Role =
    | 'insertArgs'
    | 'insertFirstArg'
    | 'insertSecondArg'
    | 'removeArgs'
    | 'removeReceiver'
    | 'replaceChild'
    | 'replaceReceiver'
    | 'replaceChildren'
    | 'clone'
    | 'create'
    | 'attribute'
    | 'classWrite'
    | 'styleWrite'
    | 'styleObject'
    | 'textContent'
    | 'html'
    | 'data'
    | 'listener'
    | 'refused'

// Every interface a declared member can be REACHED through, not only the one the
// specification hangs it off. `patchSet()` reports this list back and the
// both-substrates gate compares the two.
const DECLARED: [interfaceName: string, member: string, role: Role][] = [
    ['Node', 'insertBefore', 'insertFirstArg'],
    ['Node', 'appendChild', 'insertArgs'],
    ['Node', 'removeChild', 'removeArgs'],
    ['Node', 'replaceChild', 'replaceChild'],
    ['Node', 'cloneNode', 'clone'],
    ['Node', 'textContent', 'textContent'],
    ['Element', 'textContent', 'textContent'],
    ['CharacterData', 'textContent', 'textContent'],
    ['Element', 'remove', 'removeReceiver'],
    ['Element', 'before', 'insertArgs'],
    ['Element', 'after', 'insertArgs'],
    ['Element', 'replaceWith', 'replaceReceiver'],
    ['CharacterData', 'remove', 'removeReceiver'],
    ['CharacterData', 'before', 'insertArgs'],
    ['CharacterData', 'after', 'insertArgs'],
    ['CharacterData', 'replaceWith', 'replaceReceiver'],
    ['Element', 'append', 'insertArgs'],
    ['Element', 'prepend', 'insertArgs'],
    ['Element', 'replaceChildren', 'replaceChildren'],
    ['Document', 'append', 'insertArgs'],
    ['Document', 'prepend', 'insertArgs'],
    ['Document', 'replaceChildren', 'replaceChildren'],
    ['Element', 'setAttribute', 'attribute'],
    ['Element', 'removeAttribute', 'attribute'],
    ['Element', 'toggleAttribute', 'attribute'],
    ['Element', 'className', 'attribute'],
    ['Element', 'insertAdjacentElement', 'insertSecondArg'],
    ['Element', 'insertAdjacentHTML', 'html'],
    ['Element', 'innerHTML', 'html'],
    // happy-dom gives `HTMLTemplateElement` its OWN `innerHTML`, which shadows the one
    // above — so a `template.innerHTML` write reaches no patched member, the
    // outermost-only guard never engages, and the parse's internal `createElementNS`
    // surfaces as the `refused` throw instead. The compiled arm makes every row from a
    // template, so that is the whole arm. Chromium has no own descriptor here and the
    // installer shadows, which is how the two lists stay identical.
    ['HTMLTemplateElement', 'innerHTML', 'html'],
    ['Element', 'outerHTML', 'html'],
    ['CharacterData', 'data', 'data'],
    ['Document', 'createElement', 'create'],
    ['Document', 'createTextNode', 'create'],
    ['Document', 'createComment', 'create'],
    ['Document', 'importNode', 'create'],
    ['EventTarget', 'addEventListener', 'listener'],
    // COUNTED RATHER THAN REFUSED, and they moved for a reason worth recording: the
    // live panel runs this patch set in a reader's browser over 69 hand-written arms,
    // and a refused member there is a throw on somebody's docs page. One arm of the
    // 69 reaches them — `markup-class-style`, whose whole subject is class and style —
    // so the answer is a counter rather than an escape hatch.
    ['DOMTokenList', 'add', 'classWrite'],
    ['DOMTokenList', 'remove', 'classWrite'],
    ['DOMTokenList', 'toggle', 'classWrite'],
    ['DOMTokenList', 'replace', 'classWrite'],
    // THE ONE MEMBER INTERCEPTED ON READ, and it is here because `style.paddingLeft =
    // x` never reaches `setProperty`: it is an own accessor on `CSSStyleDeclaration`
    // per CSS property, hundreds of them, and enumerating those at install would make
    // the patch set a different list in each substrate — which 44.5 forbids and is the
    // one thing the byte-identical gate exists to catch. So the getter hands back a
    // counting proxy while armed and the real declaration otherwise, and every write
    // is counted without naming a single property. `HTMLElement.style` resolves at the
    // same depth with stable identity in happy-dom, chromium and webkit alike.
    ['HTMLElement', 'style', 'styleObject'],
    ['CSSStyleDeclaration', 'setProperty', 'styleWrite'],
    ['CSSStyleDeclaration', 'removeProperty', 'styleWrite'],
    ['CSSStyleDeclaration', 'cssText', 'styleWrite'],
    // Everything below MUTATES and is not counted, so it is a loud failure rather
    // than a silent zero. A member arriving here is the moment somebody decides
    // whether it earns a counter.
    ['Node', 'normalize', 'refused'],
    ['Node', 'nodeValue', 'refused'],
    ['Element', 'insertAdjacentText', 'refused'],
    ['Element', 'setAttributeNS', 'refused'],
    ['Element', 'removeAttributeNS', 'refused'],
    ['Element', 'setAttributeNode', 'refused'],
    ['Element', 'removeAttributeNode', 'refused'],
    ['Element', 'id', 'refused'],
    ['CharacterData', 'appendData', 'refused'],
    ['CharacterData', 'insertData', 'refused'],
    ['CharacterData', 'deleteData', 'refused'],
    ['CharacterData', 'replaceData', 'refused'],
    ['Text', 'splitText', 'refused'],
    ['Document', 'write', 'refused'],
    ['Document', 'createElementNS', 'refused'],
]

export function blankWork(): Work {
    // Fixed shape at construction — every field initialized, `undefined` included —
    // because this object is read on every counted call.
    return {
        elementsMoved: 0,
        markersMoved: 0,
        textMoved: 0,
        nodesCreated: 0,
        attributesSet: 0,
        classWrites: 0,
        styleWrites: 0,
        dataWrites: 0,
        redundantDataWrites: 0,
        listenersBound: 0,
        // NOT 0 — this lane does not count these three and `null` says so. 44.23, and
        // the reason is on the fields in `Work.ts`.
        bindingRuns: null,
        wakes: null,
        descents: null,
    }
}

const DISCARD = blankWork()
let live: Work = DISCARD
let depth = 0
let armed = false
let installed: string[] = []

export function arm(record: Work): void {
    if (armed)
        throw new Error(
            'measure() is already armed. Counting passes do not nest: the inner record would take the outer one’s calls.',
        )
    armed = true
    live = record
}

export function disarm(): void {
    armed = false
    live = DISCARD
    styleProxies = new WeakMap()
}

export function isArmed(): boolean {
    return armed
}

// The installed list, by interface and member. The both-substrates gate is asserted
// on THIS rather than on a count, because a count is what goes quietly to zero.
export function patchSet(): string[] {
    return installed.slice()
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const COMMENT_NODE = 8
const DOCUMENT_FRAGMENT_NODE = 11

function tallyNode(node: unknown): void {
    if (typeof node === 'string') {
        // A string handed to `append` becomes a text node the call created.
        live.nodesCreated += 1
        live.textMoved += 1
        return
    }
    const kind = (node as Node | null)?.nodeType
    if (kind === ELEMENT_NODE) live.elementsMoved += 1
    else if (kind === TEXT_NODE) live.textMoved += 1
    else if (kind === COMMENT_NODE) live.markersMoved += 1
    else if (kind === DOCUMENT_FRAGMENT_NODE)
        for (const child of (node as DocumentFragment).childNodes)
            tallyNode(child)
}

function tallyChildren(parent: unknown): void {
    const children = (parent as Node | null)?.childNodes
    if (!children) return
    for (const child of children) tallyNode(child)
}

// A subtree the call brought into existence, counted whole and INCLUDING its root:
// `innerHTML` creates every node under it, where an insert only MOVES the one node it
// was handed.
function tallyCreatedSubtree(node: unknown): void {
    live.nodesCreated += 1
    const children = (node as Node | null)?.childNodes
    if (!children) return
    for (const child of children) tallyCreatedSubtree(child)
}

// WHICH CONTAINER AN `html` WRITE LANDS IN, and which of its children were already
// there. The created nodes are the ones that were NOT — rooted at the container
// wholesale, every pre-existing sibling of an `insertAdjacentHTML` reads as created,
// which measured 7 created and 6 moved for a one-element insert beside five siblings.
// The set is also what lets `outerHTML` report anything at all: the receiver is
// detached by the time the write returns, so the replacement is only reachable through
// the parent it landed in.
const BESIDE_THE_RECEIVER = new Set(['beforebegin', 'afterend'])
let htmlContainer: Node | null = null
const htmlChildrenBefore = new Set<Node>()

function containerForHtml(
    receiver: unknown,
    member: string,
    position: unknown,
) {
    const element = receiver as Element
    // A `<template>`'s `innerHTML` writes into its `content` fragment rather than into
    // the element's own children, and the compiled arm makes every row from one.
    if (member === 'innerHTML')
        return (
            ((element as HTMLTemplateElement).content as Node | undefined) ??
            element
        )
    if (member === 'outerHTML') return element.parentNode
    return BESIDE_THE_RECEIVER.has(String(position).toLowerCase())
        ? element.parentNode
        : element
}

function isCharacterData(node: unknown): boolean {
    const kind = (node as Node | null)?.nodeType
    return kind === TEXT_NODE || kind === COMMENT_NODE
}

function tallyBefore(
    role: Role,
    receiver: unknown,
    args: unknown[],
    member: string,
): void {
    switch (role) {
        case 'insertArgs':
            for (const argument of args) tallyNode(argument)
            return
        case 'insertFirstArg':
            // `insertBefore(node, reference)` moves one node; the reference is where,
            // not what. Counting both is how a two-row swap reported 4 moves.
            tallyNode(args[0])
            return
        case 'insertSecondArg':
            tallyNode(args[1])
            return
        case 'removeArgs':
            for (const argument of args) tallyNode(argument)
            return
        case 'removeReceiver':
            tallyNode(receiver)
            return
        case 'replaceChild':
            tallyNode(args[0])
            tallyNode(args[1])
            return
        case 'replaceReceiver':
            tallyNode(receiver)
            for (const argument of args) tallyNode(argument)
            return
        case 'replaceChildren':
            tallyChildren(receiver)
            for (const argument of args) tallyNode(argument)
            return
        case 'clone':
        case 'create':
            live.nodesCreated += 1
            return
        case 'attribute':
            live.attributesSet += 1
            return
        case 'classWrite':
            live.classWrites += 1
            return
        case 'styleWrite':
            live.styleWrites += 1
            return
        case 'styleObject':
            // Counted by the proxy the getter hands back, not here.
            return
        case 'data': {
            live.dataWrites += 1
            if ((receiver as CharacterData).data === String(args[0]))
                live.redundantDataWrites += 1
            return
        }
        case 'textContent': {
            // On a text node or a comment this IS a data write, and counting it as a
            // subtree replacement would report a creation that never happened.
            if (isCharacterData(receiver)) {
                live.dataWrites += 1
                if ((receiver as CharacterData).data === String(args[0]))
                    live.redundantDataWrites += 1
                return
            }
            tallyChildren(receiver)
            if (args[0] !== '' && args[0] !== null && args[0] !== undefined) {
                live.nodesCreated += 1
                live.textMoved += 1
            }
            return
        }
        case 'html': {
            const container = containerForHtml(receiver, member, args[0])
            htmlContainer = container
            htmlChildrenBefore.clear()
            if (container)
                for (const child of container.childNodes)
                    htmlChildrenBefore.add(child)
            // What the write REMOVES is a move: `innerHTML` drops the receiver's
            // children, `outerHTML` drops the receiver itself, `insertAdjacentHTML`
            // drops nothing.
            if (member === 'innerHTML') tallyChildren(container)
            else if (member === 'outerHTML') tallyNode(receiver)
            return
        }
        case 'listener':
            live.listenersBound += 1
            return
        case 'refused':
            throw new Error(
                `${member}() is a DOM mutation harness/measure does not count. A count it does not take reads 0 forever, and every gate over it is green forever — give it a counter or keep it out of the path.`,
            )
    }
}

function tallyAfter(role: Role): void {
    if (role !== 'html') return
    const container = htmlContainer
    htmlContainer = null
    if (container)
        for (const child of container.childNodes) {
            if (htmlChildrenBefore.has(child)) continue
            // Every node the parse produced is created, and the top of each one is
            // also inserted — the same pair `createElement` + `appendChild` reports.
            tallyNode(child)
            tallyCreatedSubtree(child)
        }
    htmlChildrenBefore.clear()
}

// Per armed case, so a proxy never outlives the record it counts into and `el.style`
// keeps one identity for the length of a case body.
let styleProxies = new WeakMap<object, object>()

function countingStyle(declaration: object): object {
    const held = styleProxies.get(declaration)
    if (held) return held
    const proxy = new Proxy(declaration, {
        get(target, key) {
            const value = Reflect.get(target, key)
            // A native CSSOM method rejects a Proxy as its `this` — "Illegal
            // invocation" in chromium — so it comes back bound to the real
            // declaration. `setProperty` is patched on the prototype and counts
            // itself, so binding does not lose it.
            return typeof value === 'function' ? value.bind(target) : value
        },
        set(target, key, value) {
            // The trap TAKES the depth rather than only reading it. happy-dom
            // implements a property write over its own `setProperty`, which is
            // patched — measured, one `style.paddingLeft =` counted twice, and it
            // counted once in chromium where the property is native. That is the
            // textContent divergence again, one layer down.
            if (depth > 0 || !armed)
                return Reflect.set(target, key, value, target)
            depth = 1
            try {
                live.styleWrites += 1
                return Reflect.set(target, key, value, target)
            } finally {
                depth = 0
            }
        },
    })
    styleProxies.set(declaration, proxy)
    return proxy
}

type AnyFunction = (this: unknown, ...args: unknown[]) => unknown

function counting(
    role: Role,
    member: string,
    original: AnyFunction,
): AnyFunction {
    return function (this: unknown, ...args: unknown[]): unknown {
        // Nested inside an already-counted call: the outermost one has already said
        // what this op did.
        if (depth > 0) return original.apply(this, args)
        if (!armed) return original.apply(this, args)
        depth = 1
        try {
            tallyBefore(role, this, args, member)
            const answer = original.apply(this, args)
            tallyAfter(role)
            return answer
        } finally {
            depth = 0
        }
    }
}

function prototypeNamed(
    instance: object,
    interfaceName: string,
): object | null {
    let proto: object | null = Object.getPrototypeOf(instance)
    while (proto) {
        if (
            (proto as { constructor?: { name?: string } }).constructor?.name ===
            interfaceName
        )
            return proto
        proto = Object.getPrototypeOf(proto)
    }
    return null
}

function descriptorFrom(
    proto: object,
    member: string,
): PropertyDescriptor | undefined {
    let walk: object | null = proto
    while (walk) {
        const found = Object.getOwnPropertyDescriptor(walk, member)
        if (found) return found
        walk = Object.getPrototypeOf(walk)
    }
    return undefined
}

export function install(): void {
    if (installed.length > 0) return
    if (typeof document === 'undefined')
        throw new Error(
            'harness/measure needs a DOM at install time. Under bun that is the preload; in a browser it is `addInitScript`.',
        )

    const element = document.createElement('div')
    const text = document.createTextNode('')
    const instances: Record<string, object> = {
        Node: element,
        Element: element,
        HTMLElement: element,
        EventTarget: element,
        CharacterData: text,
        Text: text,
        Document: document,
        DOMTokenList: element.classList,
        CSSStyleDeclaration: element.style,
        HTMLTemplateElement: document.createElement('template'),
    }

    const taken: string[] = []
    for (const [interfaceName, member, role] of DECLARED) {
        const instance = instances[interfaceName]
        if (!instance)
            throw new Error(
                `harness/measure declares ${interfaceName}.${member} and has no instance to resolve ${interfaceName} from.`,
            )
        const proto = prototypeNamed(instance, interfaceName)
        if (!proto)
            throw new Error(
                `harness/measure declares ${interfaceName}.${member} and this substrate has no prototype named ${interfaceName}.`,
            )
        const descriptor = descriptorFrom(proto, member)
        if (!descriptor)
            throw new Error(
                `harness/measure declares ${interfaceName}.${member} and this substrate does not have it. The patch set has to be the same list in both substrates.`,
            )
        if (role === 'styleObject') {
            const original = descriptor.get as () => object
            Object.defineProperty(proto, member, {
                ...descriptor,
                get(this: object): object {
                    const declaration = original.call(this)
                    return armed ? countingStyle(declaration) : declaration
                },
            })
        } else if (descriptor.set) {
            Object.defineProperty(proto, member, {
                ...descriptor,
                set: counting(role, member, descriptor.set as AnyFunction),
            })
        } else if (typeof descriptor.value === 'function') {
            Object.defineProperty(proto, member, {
                ...descriptor,
                value: counting(role, member, descriptor.value as AnyFunction),
            })
        } else {
            throw new Error(
                `harness/measure declares ${interfaceName}.${member}, which is neither a setter nor a method here.`,
            )
        }
        taken.push(`${interfaceName}.${member}`)
    }
    installed = taken
}
