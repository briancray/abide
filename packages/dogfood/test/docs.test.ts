// Every public name has a page, every page has a rung, and every rung is a real file.
//
// THE DOCS APP DECIDES WHAT AN AUTHOR TYPES — that is the rule `SURFACE-CUT.md` set, and this file is
// where it stopped being prose. `CALLABLES.ts` is the list, checked against the modules themselves
// in BOTH directions: a name exported and not listed fails, and a name listed and not exported fails
// too. A list that only fails when it is too small accumulates forever.
//
// A mountable rung gets a real assertion inside its own suite — "the documented example runs" — which
// mounts it and checks what it renders. The server-side ones have nothing to mount, so what guards THEM
// is this file plus `bun run typecheck`: every `.ts` under this package is in the root program, so a
// rung that stops compiling, or goes stale against a renamed export, is a red gate rather than a page
// nobody opened.

import { expect, test } from 'bun:test'
import * as frontDoor from 'abide'
import type { Example } from 'harness'
import * as serverDoor from 'abide/server'
import { CALLABLE_ORDER, CALLABLES, LADDERS, type LadderName, SPECIFIERS } from '../demos/CALLABLES.ts'

/** Every rung in the repo, with the ladder it is in and its place in it. Loaded once. */
const LADDER_NAMES = Object.keys(LADDERS) as LadderName[]
const RUNGS: { ladder: LadderName; at: number; rung: Example }[] = []
for (const ladder of LADDER_NAMES) {
    const { LADDER } = await LADDERS[ladder]()
    for (const [at, rung] of LADDER.entries()) RUNGS.push({ ladder, at, rung })
}

/**
 * What the two AUTHORED entry points actually export, as MODULES rather than as text.
 *
 * `Object.keys` is what a bundler and an importer see, so it is the truth `CALLABLES.ts` is checked
 * against rather than a second opinion beside it. Types are absent by construction and are not covered
 * here — see the note in `surface.test.ts`.
 *
 * `abide/ui` is deliberately not walked. `mount` and `hydrate` are exported and are reached only by
 * `abide build`'s generated client entry and a bench harness, so including them here would make the
 * check demand docs pages for names no author writes. That exclusion is itself gated below.
 *
 * Walked in `SPECIFIERS` order rather than a list spelled here, so a third public entry point cannot
 * be added to `/docs` and its index while this gate keeps checking two doors and staying green.
 */
const DOORS: Record<(typeof SPECIFIERS)[number], object> = { abide: frontDoor, 'abide/server': serverDoor }
const EXPORTED = new Map<string, string>()
for (const specifier of SPECIFIERS) {
    const module = DOORS[specifier]
    // First writer wins, which makes `abide` canonical for `identity` — it is on both doors, and the
    // isomorphic one is what an app should type.
    for (const name of Object.keys(module)) if (!EXPORTED.has(name)) EXPORTED.set(name, specifier)
}

test('the docs list IS the public surface — nothing exported is missing, nothing listed is invented', () => {
    const listed = new Set<string>(CALLABLE_ORDER)

    const undocumented: string[] = []
    for (const name of EXPORTED.keys()) if (!listed.has(name)) undocumented.push(name)
    expect(undocumented.sort(), 'exported by abide and absent from /docs').toEqual([])

    const invented: string[] = []
    for (const name of listed) if (!EXPORTED.has(name)) invented.push(name)
    expect(invented.sort(), '/docs lists a name nothing exports').toEqual([])
})

test('every callable says the specifier it is really on', () => {
    const wrong: string[] = []
    for (const name of CALLABLE_ORDER) {
        const actual = EXPORTED.get(name)
        if (CALLABLES[name].from !== actual) wrong.push(`${name}: says ${CALLABLES[name].from}, is on ${actual}`)
    }
    expect(wrong, 'a page would tell a reader to import from the wrong place').toEqual([])
})

test('the index is the whole list, once each', () => {
    // `CALLABLE_ORDER` is hand-written so the index reads as an introduction rather than a glossary,
    // which means it can disagree with `CALLABLES` in two ways. Both are caught.
    expect(CALLABLE_ORDER.length, 'the order and the record are different sizes').toBe(Object.keys(CALLABLES).length)
    expect(new Set(CALLABLE_ORDER).size, 'a name is in the order twice').toBe(CALLABLE_ORDER.length)
    const stray = CALLABLE_ORDER.filter((name) => !Object.hasOwn(CALLABLES, name))
    expect(stray, 'the order names something the record does not have').toEqual([])
})

test('every public name has at least one rung, and it is where the list says', async () => {
    // The claim `/docs/<callable>` is only worth reading if it holds. A name whose page would be an
    // empty ladder fails here rather than shipping as a page that looks like an oversight.
    const empty: string[] = []
    for (const name of CALLABLE_ORDER) {
        // A `Set<string>`, because each entry's `ladders` is narrowed to its own literal union and the
        // intersection of all of those is `never` — `includes(ladder)` would not typecheck.
        const declared = new Set<string>(CALLABLES[name].ladders)
        const found = RUNGS.filter(({ ladder, rung }) => declared.has(ladder) && rung.of.includes(name))
        if (found.length === 0) empty.push(name)
    }
    expect(empty, 'a public name with no rung — its page would be blank').toEqual([])
})

test('`ladders` names where the rungs ARE — in both directions', () => {
    // The one hand-written pointer in `CALLABLES.ts`, and therefore the one thing that can go stale. A
    // rung moved to another suite fails the first half; a ladder listed that holds nothing for this name
    // fails the second, which is what stops the lists growing a residue nobody prunes.
    const missing: string[] = []
    const spurious: string[] = []
    for (const name of CALLABLE_ORDER) {
        const declared = new Set<string>(CALLABLES[name].ladders)
        const actual = new Set<string>()
        for (const { ladder, rung } of RUNGS) if (rung.of.includes(name)) actual.add(ladder)

        for (const ladder of actual) if (!declared.has(ladder)) missing.push(`${name}: rungs in ${ladder}`)
        for (const ladder of declared) if (!actual.has(ladder)) spurious.push(`${name}: no rungs in ${ladder}`)
    }
    expect(missing.sort(), 'a rung is in a ladder the callable does not list').toEqual([])
    expect(spurious.sort(), 'a callable lists a ladder with nothing of its own in it').toEqual([])
})

test('every rung claims a name that exists', () => {
    const bogus: string[] = []
    for (const { ladder, at, rung } of RUNGS) {
        for (const name of rung.of) if (!EXPORTED.has(name)) bogus.push(`${ladder} rung ${at + 1}: "${name}"`)
    }
    expect(bogus.sort(), 'a rung says it demonstrates a name nothing exports').toEqual([])
})

/**
 * The ladders whose rungs are about no name an author types, and are therefore on no `/docs` page.
 *
 * Both are about `abide/ui`: `mount` and `hydrate` are called by `abide build`'s GENERATED client entry
 * and by nothing in either app's pages, server or site. The rungs still compile, still run and are
 * still priced — they simply document a mechanism rather than a call.
 *
 * Asserted in BOTH directions, which is what makes it a record of a decision rather than a place to put
 * failures: a ladder that quietly stops claiming its names fails, and so does one listed here that has
 * started claiming them.
 */
const UNCLAIMED: LadderName[] = ['client', 'hydrate']

test('an empty `of` is a decision, not a way to disappear', () => {
    const silent = new Set<string>()
    for (const { ladder, rung } of RUNGS) if (rung.of.length === 0) silent.add(ladder)

    const unexpected = [...silent].filter((ladder) => !UNCLAIMED.includes(ladder as LadderName))
    expect(unexpected.sort(), 'a rung claims no name and its ladder is not one of the known two').toEqual([])

    const stale = UNCLAIMED.filter((ladder) => !silent.has(ladder))
    expect(stale.sort(), 'a ladder is listed as claiming nothing but every rung on it claims something').toEqual([])
})

test('a ladder has at least two rungs, because one rung is an example wearing an array', () => {
    // Lived in `suite()` while a suite carried its own ladder. It is here now for the same reason the
    // rest of this file is: the ladder is read from its own module, and this is what walks them all.
    //
    // The check is per LADDER and not per callable page. Most pages have one rung — forty-five names
    // over seventy-one rungs cannot be two-deep everywhere — and a page with one rung is a legible
    // request for a second, where a LADDER with one rung is an author who stopped after the first.
    //
    // Counted off `RUNGS` rather than re-opening every ladder: a second walk is a second answer to
    // "what are the rungs", and the two can disagree.
    const height = new Map<LadderName, number>()
    for (const { ladder } of RUNGS) height.set(ladder, (height.get(ladder) ?? 0) + 1)
    for (const name of LADDER_NAMES) {
        expect(height.get(name) ?? 0, `${name} has a ladder with one rung`).toBeGreaterThan(1)
    }
})

test('every ladder is reachable, and every rung carries the text of a real file', () => {
    expect(LADDER_NAMES.length, 'the ladder map shrank').toBeGreaterThan(20)
    for (const { ladder, at, rung } of RUNGS) {
        const where = `${ladder} rung ${at + 1}`
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
})

test('a rung introduces ONE thing — no two rungs are the same file, or the same claim', () => {
    // Two failures this rules out. A copy-paste, where one file is shown twice and a reader compares it
    // with itself; and a duplicated `adds`, which means the ladder claims to introduce something twice
    // and therefore introduced it in neither place clearly.
    const files = new Map<string, string>()
    const labels = new Map<string, string>()
    for (const { ladder, rung } of RUNGS) {
        const owner = files.get(rung.source)
        expect(owner, `${ladder} shows the same file as ${owner}`).toBeUndefined()
        files.set(rung.source, ladder)

        const said = labels.get(rung.adds)
        expect(said, `${ladder} and ${said} both add "${rung.adds}"`).toBeUndefined()
        labels.set(rung.adds, ladder)
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
    //
    // Still checked per LADDER rather than per callable page, because the ladder is where the order is
    // authored. A callable page slices rungs out of one, and a slice of a growing sequence is not itself
    // required to grow.
    const words = (source: string): Set<string> => {
        const found = new Set<string>()
        for (const word of source.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []) {
            if (!AMBIENT.has(word)) found.add(word)
        }
        return found
    }

    // Walked over `RUNGS`, which is already every ladder in order — `at > 0` is exactly "has a rung
    // above it in the same ladder", so the previous entry is that rung and neither index needs a cast.
    let before = new Set<string>()
    for (const { ladder, at, rung } of RUNGS) {
        const now = words(rung.source)
        if (at > 0) {
            let shared = 0
            for (const word of now) if (before.has(word)) shared++
            expect(shared, `${ladder} rung ${at + 1} shares nothing with rung ${at}`).toBeGreaterThan(1)
        }
        before = now
    }
})
