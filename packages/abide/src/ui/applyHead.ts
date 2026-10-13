// 39.6 — ON A CLIENT NAVIGATION THE INCOMING PAGE'S KEYED CONTRIBUTIONS REPLACE THE OUTGOING
// PAGE'S BY KEY. The outgoing page's were written by a server on the first load and by this
// function on every one after, so they are found the same way either time: by their key, read off
// the document. Nothing is added to the head to mark ownership — a marker would be a fact about
// the framework in a document an author writes, and the key is already what decides.
//
// 39.5 — A CONTRIBUTION WITH NO KEY APPENDS. It cannot replace anything, because there is nothing
// it could be said to be the same as, and dropping it instead would lose the one kind of
// contribution a page makes several of.

import { headKeyOf } from '#shared/headKeyOf.ts'
import { MOUNTING_LEVEL } from './MOUNTING_LEVEL.ts'
import { markupNodes } from './parseMarkup.ts'
import { isEmptyRegion, type Region } from './regions.ts'
import type { Scope } from './Scope.ts'

export function applyHead(markup: string): void {
    const head = document.head
    if (markup === '') return
    const incoming = markupNodes(head, markup)
    const standingByKey = standingKeys(head)
    for (const node of incoming) {
        if (node.nodeType !== 1) {
            head.appendChild(node)
            continue
        }
        const element = node as Element
        const key = headKey(element)
        if (key === undefined) {
            head.appendChild(element)
            continue
        }
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
}

/**
 * Puts back, or removes, what the leaving levels keyed and the arriving ones do not.
 *
 * 39.14 — THE NEXT-OUTER CONTRIBUTOR'S VALUE, OR NONE. `leaving` and `arriving` are the heads of
 * the levels a navigation stopped and mounted; `outer` is every contributor standing above them,
 * outermost first — the shell's keyed entries, then each kept layout's — so the LAST entry for a
 * key in it is the one the server would paint there (39.4). What the arriving levels key they have
 * already written (39.6), so only the keys they are silent on are touched.
 *
 * THE COMMON NAVIGATION ENDS AT THE FIRST RETURN: two pages that both key a `<title>` withdraw
 * nothing, and `outer` is neither built nor parsed.
 */
export function withdrawHead(
    leaving: string,
    arriving: string,
    outer: () => string,
): void {
    if (leaving === '') return
    const head = document.head
    const withdrawn = keyedIn(head, leaving)
    for (const key of keyedIn(head, arriving).keys()) withdrawn.delete(key)
    if (withdrawn.size === 0) return
    const restored = keyedIn(head, outer())
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

/** The keyed elements `markup` parses to, by key, the last holding each (39.4). */
function keyedIn(head: HTMLHeadElement, markup: string): Map<string, Element> {
    const keyed = new Map<string, Element>()
    if (markup === '') return keyed
    for (const node of markupNodes(head, markup))
        if (node.nodeType === 1) {
            const key = headKey(node as Element)
            if (key !== undefined) keyed.set(key, node as Element)
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

/**
 * Keeps a level's head written from `markup` for as long as `scope` lives.
 *
 * 39.13 — A HEAD THAT READS A VALUE FOLLOWS IT for as long as its level is mounted, which is the
 * scope's life. The first run only subscribes: the head it would write is already there, written
 * by the server or applied by the level's mount ahead of its fill (39.6).
 */
export function liveHead(scope: Scope, markup: () => string): void {
    let subscribing = true
    scope.watch(() => {
        const text = markup()
        if (subscribing) subscribing = false
        else applyHead(text)
    })
}

/**
 * A component's `<head>`, added to the page or layout the router is mounting it under (39.1).
 *
 * Joined to that level's head, so it is withdrawn as the level's is when it leaves (39.14), and
 * deeper than the level's own, so it wins by key (39.4). Applied where the component builds its own
 * markup, once the level is mounted (`MOUNTING_LEVEL.unapplied`); a region the server painted
 * already carries the head the server wrote. Nothing where no level is mounting — a row grown after
 * the fact titles nothing.
 *
 * A LIST, NOT A CLOSURE PER CONTRIBUTION: a `{#for}` of components with a `<head>` contributes once a
 * row, and a chain of them is read through as deep a stack.
 */
export function contributeHead(region: Region, head: () => string): void {
    const level = MOUNTING_LEVEL.current
    if (level === undefined) return
    let contributed = level.contributed
    if (contributed === undefined) {
        const own = level.head
        const joined: (() => string)[] = []
        contributed = joined
        level.contributed = joined
        level.head = () => {
            let markup = own?.() ?? ''
            for (const one of joined) markup += one()
            return markup
        }
    }
    contributed.push(head)
    if (isEmptyRegion(region)) MOUNTING_LEVEL.unapplied += head()
}
