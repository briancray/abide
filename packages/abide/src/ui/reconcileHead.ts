// 39.4–39.6, 39.13–39.17 — THE DOCUMENT HEAD HAS ONE WRITER. Every routed level and every component
// with a `<head>` is a contributor, and the head is reconciled from all of them at once, in the
// chain's order — each level's own head, then its components' in the order they mounted — rather
// than patched by each with what it can learn of the others.
//
// A KEY IS WON BY THE LAST CONTRIBUTOR HOLDING IT (39.4), and one nobody holds any more leaves or
// goes back to whoever still does (39.14) because that is what the chain now says. A KEYLESS NODE
// IS ITS CONTRIBUTOR'S, held by reference (39.5, 39.15, 39.16): two contributors writing the same
// `<style>` each own their own, and one leaving takes its own with it — told apart by where they
// stand, never by being equal.
//
// NOTHING IS ADDED TO MARK OWNERSHIP, and nothing a contributor did not write is touched: a node the
// server painted is ADOPTED the first time its contributor is reconciled, matched in chain order.

import { headKeyOf } from '#shared/headKeyOf.ts'

import { markupNodes } from './parseMarkup.ts'

/** One contributor's head, parsed once per text it reads. */
type Parsed = { text: string; keyed: Map<string, Element>; keyless: Node[] }

const parsedBy = new WeakMap<object, Parsed>()
/** The keyless nodes standing in the head for each contributor, in its order. */
const ownedBy = new Map<object, Node[]>()
/**
 * The element standing for each key the chain held at the last reconcile, so one it drops is
 * withdrawn — that element, and never another holding the same key that nothing here wrote.
 */
const keyedNodes = new Map<string, Element>()

/** Whether `who` has been reconciled — adopted or written — since it joined. */
export function reconciled(who: object): boolean {
    return ownedBy.has(who)
}

/**
 * Writes the head the chain contributes: `chain` is every contributor and the head it reads now,
 * outermost first.
 *
 * Only what moved is written. A key standing as it is wanted, and a keyless node equal to the one
 * its contributor wants there, are left standing — a `<link rel=stylesheet>` put back as itself is
 * refetched and flashes the page unstyled, and a `<script>` would run again.
 */
export function reconcileHead(
    chain: readonly (readonly [who: object, text: string])[],
): void {
    const head = document.head
    const present = new Set<object>()
    const wanted = new Map<string, Element>()
    for (const [who, text] of chain) {
        present.add(who)
        for (const [key, element] of parsedOf(head, who, text).keyed)
            wanted.set(key, element)
    }
    const standing = standingKeys(head)
    for (const [key, node] of keyedNodes)
        if (!wanted.has(key)) {
            node.remove()
            keyedNodes.delete(key)
        }
    for (const [key, element] of wanted) {
        let at = standing.get(key)
        if (at === undefined) {
            at = element.cloneNode(true) as Element
            head.appendChild(at)
        } else if (at.outerHTML !== element.outerHTML) {
            const next = element.cloneNode(true) as Element
            head.replaceChild(next, at)
            at = next
        }
        keyedNodes.set(key, at)
    }

    for (const [who, nodes] of ownedBy)
        if (!present.has(who)) {
            for (const node of nodes) node.parentNode?.removeChild(node)
            ownedBy.delete(who)
        }
    const claimed = new Set<Node>()
    for (const nodes of ownedBy.values())
        for (const node of nodes) claimed.add(node)
    let previous: Node | null = null
    for (let at = 0; at < chain.length; at += 1) {
        const who = (chain[at] as readonly [object, string])[0]
        const wants = (parsedBy.get(who) as Parsed).keyless
        const owned = ownedBy.get(who) ?? adopt(head, wants, claimed)
        const next: Node[] = []
        for (let index = 0; index < wants.length; index += 1) {
            const want = wants[index] as Node
            const have = owned[index]
            let node: Node
            if (have?.isEqualNode(want) === true) node = have as Node
            else {
                node = runnable(want.cloneNode(true))
                if (have !== undefined) head.replaceChild(node, have)
                else
                    head.insertBefore(
                        node,
                        previous === null
                            ? firstOwnedAfter(chain, at)
                            : previous.nextSibling,
                    )
            }
            next.push(node)
            previous = node
        }
        for (let index = wants.length; index < owned.length; index += 1)
            (owned[index] as Node).parentNode?.removeChild(owned[index] as Node)
        ownedBy.set(who, next)
    }
}

/** `who`'s head parsed, from the cache while it reads the same text. */
function parsedOf(head: HTMLHeadElement, who: object, text: string): Parsed {
    const cached = parsedBy.get(who)
    if (cached !== undefined && cached.text === text) return cached
    const parsed: Parsed = { text, keyed: new Map(), keyless: [] }
    for (const node of markupNodes(head, text)) {
        const key = node.nodeType === 1 ? headKey(node as Element) : undefined
        if (key === undefined) parsed.keyless.push(node)
        else parsed.keyed.set(key, node as Element)
    }
    parsedBy.set(who, parsed)
    return parsed
}

/**
 * The nodes the server painted for a contributor reconciled for the first time: each one it wants,
 * the first equal node nobody has claimed, in order. Contributors are adopted in the chain's
 * order, which is the order the server painted them in, so an earlier one claims the earlier of
 * two equal nodes.
 */
function adopt(
    head: HTMLHeadElement,
    wants: Node[],
    claimed: Set<Node>,
): Node[] {
    const adopted: Node[] = []
    let from = head.firstChild
    for (const want of wants) {
        let found: Node | null = null
        for (let at = from; at !== null; at = at.nextSibling)
            if (!claimed.has(at) && at.isEqualNode(want)) {
                found = at
                break
            }
        if (found === null) break
        claimed.add(found)
        adopted.push(found)
        from = found.nextSibling
    }
    return adopted
}

/** The first keyless node a contributor after `at` owns, which a new one goes before. */
function firstOwnedAfter(
    chain: readonly (readonly [object, string])[],
    at: number,
): Node | null {
    for (let later = at + 1; later < chain.length; later += 1) {
        const owned = ownedBy.get(
            (chain[later] as readonly [object, string])[0],
        )
        if (owned !== undefined && owned.length > 0) return owned[0] as Node
    }
    return null
}

/**
 * `node`, or — for a `<script>` — the same script made by the document rather than the parser.
 *
 * 39.17 — A PARSED SCRIPT NEVER RUNS. The fragment parser marks every `<script>` it makes "already
 * started", and a clone keeps the mark, so a script it made and then moved into the head is inert
 * where the server's, made by the document's own parser, ran. One made by `createElement` starts
 * clear and runs on insertion. Keyless always (39.11 keys no `<script>`).
 */
function runnable(node: Node): Node {
    if (node.nodeName !== 'SCRIPT') return node
    const parsed = node as HTMLScriptElement
    const script = document.createElement('script')
    const attributes = parsed.attributes
    for (let index = 0; index < attributes.length; index += 1) {
        const attribute = attributes[index] as Attr
        script.setAttribute(attribute.name, attribute.value)
    }
    script.text = parsed.text
    return script
}

/**
 * The head's keyed elements by key, the first holding each — 39.12 within the standing head: the
 * FIRST element holding a key is the one a contribution replaces.
 */
function standingKeys(head: HTMLHeadElement): Map<string, Element> {
    const standingByKey = new Map<string, Element>()
    for (
        let node = head.firstElementChild;
        node !== null;
        node = node.nextElementSibling
    ) {
        const key = headKey(node)
        if (key !== undefined && !standingByKey.has(key))
            standingByKey.set(key, node)
    }
    return standingByKey
}

/**
 * The key a head element replaces by, or `undefined` for one that appends — 39.11 through the one
 * grammar (`headKeyOf`), asked with a resolved attribute.
 */
function headKey(element: Element): string | undefined {
    return headKeyOf(element.tagName.toLowerCase(), (name) =>
        element.getAttribute(name),
    )
}
