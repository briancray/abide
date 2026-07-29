// THE HYDRATION CURSOR, driven directly.
//
// A three-variable state machine (`hydrating`, `hydrateCursor`, `hydrateForItem`) that 45 places in the
// runtime consult. Until it was its own module, NO test file in the repo imported `runtime.ts`, so
// every behaviour here was reachable only through `emitHydrate.test.ts` — compile a template, emit
// client code, eval it, drive a happy-dom host — which is a test of the emitter, the runtime and the
// cursor at once, and names none of them when it fails.
//
// The signal that the seam was needed: `seededState.ts` takes `isHydrating: () => boolean = () => true`
// as an injected parameter with a default, wired to the real flag by `bootstrap.ts`, for exactly one
// reason — `seededState.test.ts` could not import `runtime.ts`. That constraint is gone.
//
// These assert the cursor against real DOM built by hand, so each case names one rule: what a claim
// consumes, where the cursor lands afterwards, and how the anchor conventions are read.

import { describe, expect, test } from 'bun:test'
import { BLOCK_ANCHOR } from './BLOCK_ANCHOR.ts'
import { HTML_ANCHOR } from './HTML_ANCHOR.ts'
import {
    beginForItem,
    claimRoots,
    claimText,
    consumeForItem,
    endHydration,
    findBlockClose,
    findHtmlClose,
    hydrateNode,
    hydrateSeek,
    hydrateSkip,
    hydrateValueLeaf,
    inCreateMode,
    isHydrating,
    startHydration,
} from './hydrateCursor.ts'

// A container holding the given server-rendered HTML, as the browser would parse it.
function server(html: string): HTMLElement {
    const host = document.createElement('div')
    host.innerHTML = html
    return host
}

const block = (inner: string): string =>
    `<!--${BLOCK_ANCHOR.open}-->${inner}<!--${BLOCK_ANCHOR.close}-->`

describe('hydration mode', () => {
    test('starts false, and `startHydration` seeds the cursor at the container first child', () => {
        endHydration()
        expect(isHydrating()).toBe(false)

        const host = server('<p>a</p><span>b</span>')
        startHydration(host)
        expect(isHydrating()).toBe(true)
        expect((hydrateNode() as Element).tagName).toBe('P')
        endHydration()
    })

    test('`endHydration` clears the flag AND the cursor', () => {
        startHydration(server('<p>a</p>'))
        endHydration()
        expect(isHydrating()).toBe(false)
        expect(hydrateNode()).toBeNull()
    })

    test('an absent or empty container leaves a null cursor rather than throwing', () => {
        startHydration(null)
        expect(isHydrating()).toBe(true)
        expect(hydrateNode()).toBeNull()
        startHydration(server(''))
        expect(hydrateNode()).toBeNull()
        endHydration()
    })
})

describe('the cursor walk', () => {
    test('`hydrateSeek` repositions and `hydrateSkip` advances by sibling count', () => {
        const host = server('<p>a</p><p>b</p><p>c</p>')
        startHydration(host)
        expect((hydrateNode() as Element).textContent).toBe('a')
        hydrateSkip(1)
        expect((hydrateNode() as Element).textContent).toBe('b')
        hydrateSkip(1)
        expect((hydrateNode() as Element).textContent).toBe('c')
        endHydration()
    })

    test('skipping past the end lands on null rather than looping or throwing', () => {
        const host = server('<p>a</p>')
        startHydration(host)
        hydrateSkip(5)
        expect(hydrateNode()).toBeNull()
        endHydration()
    })

    test('`hydrateSeek(null)` is how a level ends', () => {
        startHydration(server('<p>a</p>'))
        hydrateSeek(null)
        expect(hydrateNode()).toBeNull()
        endHydration()
    })
})

describe('anchor conventions', () => {
    test('`findBlockClose` DEPTH-COUNTS, so a nested block does not end the outer one', () => {
        // The block pair carries no escalating suffix — the extent is found by counting depth. A naive
        // "next close anchor" would end the outer block at the INNER close and strand the rest.
        const host = server(block(`<p>a</p>${block('<p>inner</p>')}<p>b</p>`))
        const open = host.firstChild
        const close = findBlockClose(open)
        expect(close).not.toBeNull()
        // The close found must be the LAST child, not the inner one.
        expect(close).toBe(host.lastChild)
    })

    test('`findBlockClose` on an empty block finds the immediately following close', () => {
        const host = server(block(''))
        expect(findBlockClose(host.firstChild)).toBe(host.lastChild)
    })

    test('`findHtmlClose` finds the raw-markup close anchor', () => {
        const host = server(`<!--${HTML_ANCHOR.open}--><b>injected</b><!--${HTML_ANCHOR.close}-->`)
        expect(findHtmlClose(host.firstChild)).toBe(host.lastChild)
    })

    test('`claimRoots` collects `[start .. end)` — start inclusive, end EXCLUSIVE', () => {
        // `end` is the mount fn's anchor (the block CLOSE marker), and it must not be collected: a
        // teardown that removed its own anchor would take the block's position with it.
        const host = server(block('<p>a</p><p>b</p>'))
        const close = findBlockClose(host.firstChild)
        const roots = claimRoots((host.firstChild as Node).nextSibling, close)
        expect(roots).toHaveLength(2)
        expect((roots[0] as Element).textContent).toBe('a')
        expect((roots[1] as Element).textContent).toBe('b')
    })

    test('`claimRoots` over an empty block collects nothing', () => {
        const host = server(block(''))
        expect(claimRoots((host.firstChild as Node).nextSibling, host.lastChild)).toEqual([])
    })

    test('a null `end` collects to the end of the sibling chain — the ROOT level', () => {
        const host = server('<p>a</p><p>b</p>')
        expect(claimRoots(host.firstChild, null)).toHaveLength(2)
    })
})

describe('claimText — splitting the node the parser merged', () => {
    test('a prefix length splits the PREVIOUS sibling at that offset', () => {
        // The argument is the slot's ANCHOR, not the text: with a prefix, the parser merged the static
        // text and the rendered value into the ONE text node BEFORE the anchor, so the claim splits
        // that. Getting the offset wrong makes later reactive updates rewrite the static half too.
        const host = server('ab<!---->')
        const anchor = (host.firstChild as Node).nextSibling
        const claimed = claimText(anchor, 1)
        expect(claimed?.data).toBe('b')
        expect((host.firstChild as Text).data).toBe('a')
    })

    test('a zero prefix claims the anchor position itself when it is text', () => {
        const host = server('value')
        expect(claimText(host.firstChild, 0)?.data).toBe('value')
    })

    test('a prefix with no preceding text node claims nothing', () => {
        // Rather than splitting the wrong node: a mismatch here is caught, not papered over.
        const host = server('<p>a</p><!---->')
        expect(claimText((host.firstChild as Node).nextSibling, 3)).toBeNull()
    })

    test('a prefix at or past the node length claims nothing', () => {
        // `splitText` at the full length yields an EMPTY claimed node, which would then be written
        // over the static text on the first update.
        const host = server('ab<!---->')
        expect(claimText((host.firstChild as Node).nextSibling, 2)).toBeNull()
    })

    test('a non-text node is not claimable as text', () => {
        const host = server('<p>a</p>')
        expect(claimText(host.firstChild, 0)).toBeNull()
    })
})

describe('inCreateMode', () => {
    test('suspends hydration for the callback and RESTORES it after', () => {
        startHydration(server('<p>a</p>'))
        expect(isHydrating()).toBe(true)
        const inside = inCreateMode(() => isHydrating())
        expect(inside).toBe(false)
        expect(isHydrating()).toBe(true)
        endHydration()
    })

    test('restores the PREVIOUS value, not `true` — so nesting outside hydrate stays false', () => {
        // A create-mode block inside another create-mode block must not silently re-enter claiming.
        endHydration()
        expect(isHydrating()).toBe(false)
        inCreateMode(() => {
            inCreateMode(() => undefined)
        })
        expect(isHydrating()).toBe(false)
    })

    test('returns the callback value through', () => {
        expect(inCreateMode(() => 42)).toBe(42)
    })
})

describe('the per-item handshake', () => {
    test('`beginForItem` arms exactly one `consumeForItem`', () => {
        // A two-party protocol across a compile boundary: `forBlock` arms it, the emitted item body
        // consumes it. Arming twice or consuming twice would bound the wrong item's roots.
        beginForItem()
        expect(consumeForItem()).toBe(true)
        expect(consumeForItem()).toBe(false)
    })

    test('unarmed, it consumes false', () => {
        endHydration()
        expect(consumeForItem()).toBe(false)
    })

    test('`endHydration` disarms it', () => {
        beginForItem()
        endHydration()
        expect(consumeForItem()).toBe(false)
    })
})

describe('hydrateValueLeaf', () => {
    test('a value text node is claimed and BOTH it and its anchor are stepped past', () => {
        // The server emits the value followed by its `<!---->` anchor, so consuming a leaf advances two
        // nodes. Advancing one would leave the cursor on the anchor and desync every later sibling.
        const host = server('value<!----><p>next</p>')
        startHydration(host)
        const leaf = hydrateValueLeaf()
        expect((leaf as Text).data).toBe('value')
        expect((hydrateNode() as Element)?.tagName).toBe('P')
        endHydration()
    })

    test('a bare anchor (empty value, or a merged prefix) steps past ONE node', () => {
        const host = server('<!----><p>next</p>')
        startHydration(host)
        hydrateValueLeaf()
        expect((hydrateNode() as Element)?.tagName).toBe('P')
        endHydration()
    })

    test('at the end of the chain the cursor lands on null', () => {
        const host = server('value<!---->')
        startHydration(host)
        hydrateValueLeaf()
        expect(hydrateNode()).toBeNull()
        endHydration()
    })
})
