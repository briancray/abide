// Every capability has a reference example, and every example is a real file.
//
// One structural test rather than twenty weak cases. A mountable example gets a real assertion inside
// its own suite — "the documented example runs" — which mounts it and checks what it renders. The
// server-side ones have nothing to mount, so what guards THEM is this file plus `bun run typecheck`:
// every `.ts` under this package is in the root program, so an example that stops compiling, or goes
// stale against a renamed export, is a red gate rather than a page nobody opened.
//
// What this catches that a typecheck cannot: an example that was never wired up. `example` is optional
// on `Suite` — it has to be, because the kit is used by two apps — so a capability with no reference is
// a silent gap exactly where a reader is looking, and this is the only place that gap is visible.

import { expect, test } from 'bun:test'
import { allSuites } from '../demos/index.ts'
import { ORDER } from '../demos/SUITES.ts'

const SUITES = await allSuites()

// `overview` is the hub's own suite — the index of the others, not a capability. It has no example
// because there is nothing to be an example OF, which is a fact about the page rather than a gap.
const NO_EXAMPLE = new Set(['overview'])

test('every capability has a ladder', () => {
    const missing: string[] = []
    for (const suite of SUITES) {
        if (NO_EXAMPLE.has(suite.name)) continue
        if (suite.examples === undefined) missing.push(suite.name)
    }
    expect(missing).toEqual([])
    // Counted as well as checked, so a suite quietly dropped from `ORDER` cannot make this pass by
    // shrinking the list it walks.
    expect(SUITES.length).toBe(ORDER.length)
})

test('every rung says what it adds, and carries the text of a real file', () => {
    for (const suite of SUITES) {
        for (const [at, rung] of (suite.examples ?? []).entries()) {
            const where = `${suite.name} rung ${at + 1}`
            // The label is the whole reason the ladder is a ladder: an unlabelled rung is a second
            // example sitting beside the first, which is the thing this replaced.
            expect(rung.adds.length, `${where}: says nothing about what it adds`).toBeGreaterThan(8)
            // The text comes through `?source`, which the loader inlines — so an empty string means the
            // import resolved to nothing rather than that somebody wrote an empty example.
            expect(rung.source.length, `${where}: the source is empty`).toBeGreaterThan(40)
            // A compiled `.abide` default export, or absent. Anything else renders as `[object Object]`
            // on the reference page rather than failing.
            if (rung.view !== undefined) {
                expect(typeof rung.view, `${where}: the view is not callable`).toBe('function')
            }
        }
    }
})

test('a rung introduces ONE thing — no two rungs are the same file, or the same claim', () => {
    // Two failures this rules out. A copy-paste, where one file is shown twice and a reader compares it
    // with itself; and a duplicated `adds`, which means the ladder claims to introduce something twice
    // and therefore introduced it in neither place clearly.
    const files = new Map<string, string>()
    for (const suite of SUITES) {
        const labels = new Set<string>()
        for (const rung of suite.examples ?? []) {
            const owner = files.get(rung.source)
            expect(owner, `${suite.name} shows the same file as ${owner}`).toBeUndefined()
            files.set(rung.source, suite.name)

            expect(labels.has(rung.adds), `${suite.name}: two rungs both add "${rung.adds}"`).toBe(false)
            labels.add(rung.adds)
        }
    }
})

/**
 * The tokens every rung shares by being an abide file at all.
 *
 * The stoplist is what makes the check below able to FAIL. Without it, `import`, `from`, `abide`,
 * `export` and `const` are four or five matches between any two files in the repo, so a rung pointed at
 * an unrelated capability passed — a gate that cannot fail is worse than no gate, because it reads as
 * one. Verified by pointing a rung at another suite's file and watching this go red.
 */
const AMBIENT = new Set(
    (
        'import from export const let async await function return type interface abide void this ' +
        'string number boolean unknown Promise script module new setTimeout settle'
    ).split(' '),
)

test('a ladder GROWS: every rung after the first is about the same thing as the one before it', () => {
    // The weakest honest check on "laddered" a machine can make: a rung that shares no DOMAIN identifier
    // with the rung above it is not a step, it is a new example — which is the shape the ladder exists to
    // replace. Whether the step is the right SIZE is a judgement, and this does not pretend to make it.
    const words = (source: string): Set<string> => {
        const found = new Set<string>()
        for (const word of source.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []) {
            if (!AMBIENT.has(word)) found.add(word)
        }
        return found
    }

    for (const suite of SUITES) {
        const ladder = suite.examples ?? []
        for (let at = 1; at < ladder.length; at++) {
            const before = words((ladder[at - 1] as { source: string }).source)
            const now = words((ladder[at] as { source: string }).source)
            let shared = 0
            for (const word of now) if (before.has(word)) shared++
            expect(shared, `${suite.name} rung ${at + 1} shares nothing with rung ${at}`).toBeGreaterThan(1)
        }
    }
})
