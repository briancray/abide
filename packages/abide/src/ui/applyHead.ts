// 39.6 — ON A CLIENT NAVIGATION THE INCOMING PAGE'S KEYED CONTRIBUTIONS REPLACE THE OUTGOING
// PAGE'S BY KEY. The outgoing page's were written by a server on the first load and by this
// function on every one after, so they are found the same way either time: by their key, read off
// the document. Nothing is added to the head to mark ownership — a marker would be a fact about
// the framework in a document an author writes, and the key is already what decides.
//
// 39.5 — A CONTRIBUTION WITH NO KEY APPENDS. It cannot replace anything ANOTHER contributor wrote,
// because there is nothing it could be said to be the same as, and dropping it instead would lose
// the one kind of contribution a page makes several of. What its OWN contributor wrote last is
// another matter: a head written again puts its keyless nodes where the last ones stood (39.15),
// and a head withdrawn takes them with it (39.16). Found the way a key is — off the document, by
// the markup the contributor last wrote — so a head the server painted is found the same as one
// written here.

import { headKeyOf } from '#shared/headKeyOf.ts'
import { markupNodes } from './parseMarkup.ts'

/**
 * Writes `markup`'s contributions into the document head, a key `below` holds excepted.
 *
 * 39.4 — `below` is the head of every contributor deeper than the one writing, which a head
 * re-applied live (39.13) must not undo: the deepest contributor wins whichever of them moved last.
 *
 * 39.15 — `last` is what the same contributor wrote before, whose keyless nodes this replaces in
 * place, in order, rather than adding beside them. 39.14 — a key `last` held that `markup` does not
 * is withdrawn to `outer`'s value for it, as a leaving contributor's is; a key list that did not
 * move withdraws nothing and never asks `outer`.
 */
export function applyHead(
    markup: string,
    below = '',
    last = '',
    outer: () => string = () => '',
): void {
    const head = document.head
    if (markup === '') return
    const incoming = markupNodes(head, markup)
    const standingByKey = standingKeys(head)
    const deeper = below === '' ? undefined : keyedIn(head, below)
    const replaced: Node[] = []
    const withdrawn = keyedIn(head, last, replaced)
    let next = 0
    for (const node of incoming) {
        const key = node.nodeType === 1 ? headKey(node as Element) : undefined
        if (key === undefined) {
            const standing = replaced[next]
            next += 1
            if (standing === undefined) head.appendChild(node)
            // The same node left standing, as a key's is: a `<style>` put back as itself is not
            // re-parsed into the cascade.
            else if (!standing.isEqualNode(node))
                head.replaceChild(node, standing)
            continue
        }
        const element = node as Element
        withdrawn.delete(key)
        if (deeper?.has(key) === true) continue
        const standing = standingByKey.get(key)
        if (standing === undefined) {
            head.appendChild(element)
            standingByKey.set(key, element)
            continue
        }
        // WHAT THE TWO PAGES SHARE IS NOT TOUCHED. `hydrate` skips `applyHead` outright because
        // re-applying a `<link rel=stylesheet>` refetches it and flashes the document unstyled —
        // and a navigation between two pages carrying the same stylesheet, viewport or icon walks
        // into that same cost per contribution. An identical node is the one case where the
        // cheaper arm is to do nothing at all.
        if (standing.outerHTML === element.outerHTML) continue
        head.replaceChild(element, standing)
        standingByKey.set(key, element)
    }
    for (; next < replaced.length; next += 1)
        (replaced[next] as Node).parentNode?.removeChild(replaced[next] as Node)
    if (withdrawn.size === 0) return
    if (deeper !== undefined)
        for (const key of deeper.keys()) withdrawn.delete(key)
    restoreKeys(head, withdrawn, outer())
}

/**
 * Puts back, or removes, what the leaving levels keyed and the arriving ones do not.
 *
 * 39.14 — THE NEXT-OUTER CONTRIBUTOR'S VALUE, OR NONE. `leaving` is the head of the levels a
 * navigation stopped; `around` answers `outer`, every contributor standing above them, and
 * `arriving`, the heads of the levels it mounted. `outer` runs outermost first — the shell's keyed
 * entries, then each kept layout's — so the LAST entry for a key in it is the one the server would
 * paint there (39.4). A component leaving its region is withdrawn the same way, its level's
 * contributors either side of it standing in for the two (`Level.headsAround`). What the arriving levels key they have
 * already written (39.6), so only the keys they are silent on are touched — and 39.16, the leaving
 * levels' keyless nodes leave with them.
 *
 * THE COMMON NAVIGATION WITHDRAWS NOTHING BY KEY: two pages that both key a `<title>` leave
 * `outer` built but never parsed, and a head keying nothing never asks `around`.
 */
export function withdrawHead(
    leaving: string,
    around: () => [outer: string, arriving: string],
): void {
    if (leaving === '') return
    const head = document.head
    const keyless: Node[] = []
    const withdrawn = keyedIn(head, leaving, keyless)
    for (const node of keyless) node.parentNode?.removeChild(node)
    if (withdrawn.size === 0) return
    const [outer, arriving] = around()
    for (const key of keyedIn(head, arriving).keys()) withdrawn.delete(key)
    restoreKeys(head, withdrawn, outer)
}

/** 39.14 — each of `withdrawn`'s keys back to `outer`'s last value for it, or removed. */
function restoreKeys(
    head: HTMLHeadElement,
    withdrawn: Map<string, Element>,
    outer: string,
): void {
    if (withdrawn.size === 0) return
    const restored = keyedIn(head, outer)
    const standingByKey = standingKeys(head)
    for (const key of withdrawn.keys()) {
        const standing = standingByKey.get(key)
        const next = restored.get(key)
        if (next === undefined) standing?.remove()
        else if (standing === undefined) head.appendChild(next)
        // The same node as `applyHead`'s: a stylesheet put back as itself is not refetched.
        else if (standing.outerHTML !== next.outerHTML)
            head.replaceChild(next, standing)
    }
}

/**
 * The keyed elements `markup` parses to, by key, the last holding each (39.4).
 *
 * Where `standing` is given, each keyless node is matched to the first node standing in the head
 * equal to it and not already matched, and the match pushed there (39.15, 39.16).
 */
function keyedIn(
    head: HTMLHeadElement,
    markup: string,
    standing?: Node[],
): Map<string, Element> {
    const keyed = new Map<string, Element>()
    if (markup === '') return keyed
    for (const node of markupNodes(head, markup)) {
        const key = node.nodeType === 1 ? headKey(node as Element) : undefined
        if (key !== undefined) keyed.set(key, node as Element)
        else if (standing !== undefined)
            for (let at = head.firstChild; at !== null; at = at.nextSibling)
                if (at.isEqualNode(node) && !standing.includes(at)) {
                    standing.push(at)
                    break
                }
    }
    return keyed
}

/**
 * The head's keyed elements by key, the first holding each.
 *
 * KEYED ONCE, NOT ONCE PER CONTRIBUTION. Walking the head per incoming node asked `headKey` — a
 * `toLowerCase` and a fresh closure per call — for every standing element times every arriving
 * one. One pass builds the index and each contribution is then a lookup.
 */
function standingKeys(head: HTMLHeadElement): Map<string, Element> {
    const standingByKey = new Map<string, Element>()
    for (
        let node = head.firstElementChild;
        node !== null;
        node = node.nextElementSibling
    ) {
        const key = headKey(node)
        // 39.12 WITHIN THE STANDING HEAD: the FIRST element holding a key is the one a
        // contribution replaces, which is the node the per-contribution walk returned.
        if (key !== undefined && !standingByKey.has(key))
            standingByKey.set(key, node)
    }
    return standingByKey
}

/**
 * The key a head element replaces by, or `undefined` for one that appends.
 *
 * 39.11 THROUGH THE ONE GRAMMAR (`headKeyOf`), asked with a RESOLVED attribute. The compiler
 * answers the same question for a STATIC one and appends where it cannot (`<meta name={x}>` has a
 * name only the run time knows) — here every attribute is resolved, so a contribution the compiler
 * had to append arrives with a key. That is the same rule reaching further, not a different one.
 */
function headKey(element: Element): string | undefined {
    return headKeyOf(element.tagName.toLowerCase(), (name) =>
        element.getAttribute(name),
    )
}
