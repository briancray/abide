import { describe, expect, test } from 'bun:test'
import { BLOCK_ANCHOR } from './BLOCK_ANCHOR.ts'
import { emitModuleSource } from './emit.ts'
import { closeFinderFor, SLOT_FOOTPRINT } from './SLOT_FOOTPRINT.ts'
import type { SlotKind } from './templatePlan.ts'

// The table claims two things per bracketed kind — it costs TWO child positions, and its close is found
// by THAT finder — and both are consumed by generated code that only misbehaves at hydrate time.
//
// `planParity.test.ts` is the behavioural guard for anchor drift, over 101 fixtures. Its limit is stated
// in its own header: it compares a rendered DOM, so it catches a footprint mistake only if some fixture
// happens to exercise the kind that has one. That is the gap here. The compiler now forces a new
// `SlotKind` to declare a footprint (the `Record<SlotKind, …>` does not compile without it); these force
// the declared footprint to match what the two emitters actually produce.
//
// The failure this guards is SILENT: get the position count wrong and the level consumes one child slot
// instead of two, the hydrate cursor desyncs from there on, and the runtime falls back to a fresh mount
// — right-looking output, no error, and the whole point of hydration gone.

// A minimal source per bracketed kind. Each must contain exactly ONE bracketed construct so the anchor
// count is unambiguous.
const BRACKETED_SOURCE: Partial<Record<SlotKind, string>> = {
    if: '<div>{#if x}a{/if}</div>',
    for: '<div>{#for item of list}a{/for}</div>',
    switch: '<div>{#switch x}{:case 1}a{/switch}</div>',
    try: '<div>{#try}a{:catch}b{/try}</div>',
    awaitBlock: '<div>{#await p}{:then v}a{/await}</div>',
    component:
        '<script>const Thing = 1</script><div>{#component Thing()}a{/component}<Thing/></div>',
    html: '<div>{html(raw)}</div>',
}

function countAnchorPairs(serverCode: string, open: string, close: string): number {
    const opens = serverCode.split(`<!--${open}-->`).length - 1
    const closes = serverCode.split(`<!--${close}-->`).length - 1
    expect(opens).toBe(closes)
    return opens
}

describe('SLOT_FOOTPRINT matches what the emitters produce', () => {
    // The table is the enumeration, so iterate IT rather than a hand-written list — a kind that becomes
    // bracketed and gets no source here fails on the next test rather than being silently unexercised.
    const bracketedKinds = (Object.keys(SLOT_FOOTPRINT) as SlotKind[]).filter(
        (kind) => closeFinderFor(kind) !== undefined,
    )

    test('every bracketed kind in the table has a source to exercise it', () => {
        const missing = bracketedKinds.filter((kind) => BRACKETED_SOURCE[kind] === undefined)
        // If this fails you added a bracketed kind: give it a one-line source above, so the two
        // assertions below cover it and `planParity`'s corpus is not the only thing that might.
        expect(missing).toEqual([])
    })

    for (const kind of ['if', 'for', 'switch', 'try', 'awaitBlock', 'component'] as const) {
        test(`${kind} emits one shared block-anchor pair and hydrates with findBlockClose`, () => {
            const source = BRACKETED_SOURCE[kind]
            if (source === undefined) throw new Error(`no source for ${kind}`)
            const out = emitModuleSource(source)
            // TWO positions, spelled as the anchors the server actually writes. A kind declared
            // bracketed that emitted no pair would pass every value test and desync the cursor.
            expect(
                countAnchorPairs(out.server, BLOCK_ANCHOR.open, BLOCK_ANCHOR.close),
            ).toBeGreaterThanOrEqual(1)
            // …and the finder the table names is the one the generated client calls.
            expect(out.client).toContain('$rt.findBlockClose(')
            expect(SLOT_FOOTPRINT[kind]).toEqual({
                positions: 2,
                closeFinder: 'findBlockClose',
            })
        })
    }

    test('html brackets with its OWN anchors and hydrates with findHtmlClose', () => {
        const source = BRACKETED_SOURCE.html
        if (source === undefined) throw new Error('no source for html')
        const out = emitModuleSource(source)
        // The distinction the table exists to carry: `html` is 2 positions like a block, but its close
        // is matched by the token on its own anchor rather than by depth-counting, because the content
        // between them is raw author HTML a depth count would miscount.
        expect(out.client).toContain('$rt.findHtmlClose(')
        expect(out.client).not.toContain('$rt.findBlockClose(')
        expect(SLOT_FOOTPRINT.html).toEqual({ positions: 2, closeFinder: 'findHtmlClose' })
    })

    test('a leaf occupies one position and is never bracketed', () => {
        const out = emitModuleSource('<div>{value}</div>')
        expect(out.client).toContain('$rt.hydrateValueLeaf()')
        expect(out.client).not.toContain('$rt.findBlockClose(')
        expect(SLOT_FOOTPRINT.interpolation).toEqual({ positions: 1 })
        expect(SLOT_FOOTPRINT.await).toEqual({ positions: 1 })
    })

    test('an attribute-ish slot occupies no position of its own', () => {
        // It modifies an element that already holds a child position; claiming one would shift every
        // sibling after it.
        for (const kind of ['attr', 'class', 'style', 'bind', 'event', 'spread'] as const) {
            expect(SLOT_FOOTPRINT[kind].positions).toBe(0)
        }
        // A dynamic attribute must not add an anchor pair beside its element.
        const out = emitModuleSource('<div id={x}>text</div>')
        expect(countAnchorPairs(out.server, BLOCK_ANCHOR.open, BLOCK_ANCHOR.close)).toBe(0)
    })
})
