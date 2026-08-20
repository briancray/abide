// Every public name has a page, every SPELLING has a page, every page has a rung, and every rung is a
// real file.
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
import { BINDABLE, BRANCHES } from 'abide/compiler'
import type { Example } from 'harness'
import * as serverDoor from 'abide/server'
import { CALLABLES, SPECIFIERS } from '#shared/demos/CALLABLES.ts'
import { LADDERS, type LadderName } from '#shared/demos/LADDERS.ts'
import { SPELLINGS, type SpellingName } from '#shared/demos/SPELLINGS.ts'
import { CALLABLE_ORDER, SPELLING_ORDER, TOPIC_ORDER, TOPICS } from '#shared/demos/TOPICS.ts'

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

/**
 * The names on an authored door that the COMPILER writes rather than an author.
 *
 * `html` is the whole list. It is on `abide` and not `abide/runtime` so that the import `emit.ts`
 * writes merges with an author's own — a deliberate placement, and the reason this cannot be expressed
 * by walking one door fewer the way `abide/ui` is. It had a `/docs` page while the escape hatch was
 * spelled `html(…)` and the page was really about the hatch; the hatch is `raw` now, and what is left
 * is the tag every `.abide` file compiles to, which no page, server or site in this app types.
 *
 * Asserted in BOTH directions below, so this is a record of a decision rather than a hole: a name here
 * that stops being exported fails, and a name here that reappears on `/docs` fails too.
 */
const EMITTED = new Set(['html'])

test('the docs list IS the public surface — nothing exported is missing, nothing listed is invented', () => {
    const listed = new Set<string>(CALLABLE_ORDER)

    const undocumented: string[] = []
    for (const name of EXPORTED.keys()) if (!listed.has(name) && !EMITTED.has(name)) undocumented.push(name)
    expect(undocumented.sort(), 'exported by abide and absent from /docs').toEqual([])

    const invented: string[] = []
    for (const name of listed) if (!EXPORTED.has(name)) invented.push(name)
    expect(invented.sort(), '/docs lists a name nothing exports').toEqual([])

    const stale = [...EMITTED].filter((name) => !EXPORTED.has(name))
    expect(stale.sort(), 'excused from /docs and no longer exported at all').toEqual([])

    const both = [...EMITTED].filter((name) => listed.has(name))
    expect(both.sort(), 'excused from /docs and listed on it anyway').toEqual([])
})

test('every callable says the specifier it is really on', () => {
    const wrong: string[] = []
    for (const name of CALLABLE_ORDER) {
        const actual = EXPORTED.get(name)
        if (CALLABLES[name].from !== actual)
            wrong.push(`${name}: says ${CALLABLES[name].from}, is on ${actual}`)
    }
    expect(wrong, 'a page would tell a reader to import from the wrong place').toEqual([])
})

test('the index is the whole list, once each', () => {
    // `CALLABLE_ORDER` is the flatten of `TOPICS`, so this is the partition read from one side: a name
    // in no topic makes the order short, and a name in two makes it long. The topic-side reading — WHICH
    // name is missing, and which is doubled — is the test below, which is the one that prints the names.
    expect(CALLABLE_ORDER.length, 'the order and the record are different sizes').toBe(
        Object.keys(CALLABLES).length,
    )
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
        for (const ladder of declared)
            if (!actual.has(ladder)) spurious.push(`${name}: no rungs in ${ladder}`)
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

// ─── THE SECOND AXIS ────────────────────────────────────────────────────────────────────────────────
//
// `/docs/syntax` is keyed by how something is TYPED rather than by a name imported, and the checks
// below are the same four the callable list gets — the list is the whole surface, the order is the
// list, every page has a rung, and `ladders` says where those rungs are. What differs is the standard
// on the left: `Object.keys(abide)` is what decides a callable, and for a spelling it is the
// COMPILER'S OWN TABLES, because they are what decides whether a file compiles at all.
//
// Only half of it is a closed set. Five blocks and five bind targets are enumerable and are compared
// in both directions; `class:x`, `style:p`, a spread and an `on<event>` take any name there is, so the
// strongest honest gate for those is that the page exists and has a rung — which is the test after.

/**
 * The bind targets, which is `BINDABLE` plus the one it deliberately leaves out.
 *
 * `element` has no row in that table because it is a NODE REF: there is no property to read and no
 * event to write back from, so it is legal on any element and the table's question does not apply to
 * it. It is a spelling an author types either way, so it is added here rather than left as the one
 * target with no page — which is the same reason `EMITTED` exists on the other axis.
 */
const BIND_TARGETS = [...Object.keys(BINDABLE), 'element']

/** `bind-checked` → `checked`. The slug is a path and the name is what a file says; the target is in both. */
const targetOf = (name: string): string => name.slice('bind:'.length)

test('the syntax list IS the compiler’s closed sets — in both directions', () => {
    const blocks: string[] = SPELLING_ORDER.filter((slug) => SPELLINGS[slug].gate === 'block')
    // Sorted rather than compared as sets: a list of five is small enough that the failure should print
    // the two lists side by side, which is what makes a sixth block obvious.
    expect([...blocks].sort(), 'the blocks with a page are not the blocks the parser has').toEqual(
        Object.keys(BRANCHES).sort(),
    )

    // ONE PAGE PER TARGET, because the target is what a reader arrives with. It was one page for all
    // five, titled `bind:value`, and that page then claimed to be about a spelling four of its rungs
    // do not write — the same mistake as keying `/docs` by capability. Compared as a set for the same
    // reason the blocks are: a sixth target is red until it has a page.
    const binds = SPELLING_ORDER.filter((slug) => SPELLINGS[slug].gate === 'bind')
    expect(
        binds.map((slug) => targetOf(SPELLINGS[slug].name)).sort(),
        'the bind pages are not the table',
    ).toEqual([...BIND_TARGETS].sort())

    // And each page's rungs WRITE the target it is named after. Having a rung is not enough here: the
    // pages are one edit away from all pointing at the same one, and every one of them would still be
    // green on a count.
    const missing: string[] = []
    for (const slug of binds) {
        const target = targetOf(SPELLINGS[slug].name)
        const shown = RUNGS.some(
            ({ rung }) => rung.spells?.includes(slug) && rung.source.text.includes(`bind:${target}`),
        )
        if (!shown) missing.push(slug)
    }
    expect(missing.sort(), 'a bind page whose rungs never write its own target').toEqual([])
})

test('the syntax index is the whole list, once each', () => {
    expect(SPELLING_ORDER.length, 'the order and the record are different sizes').toBe(
        Object.keys(SPELLINGS).length,
    )
    expect(new Set(SPELLING_ORDER).size, 'a spelling is in the order twice').toBe(SPELLING_ORDER.length)
    const stray = SPELLING_ORDER.filter((slug) => !Object.hasOwn(SPELLINGS, slug))
    expect(stray, 'the order names something the record does not have').toEqual([])
})

test('every spelling has at least one rung, and it is where the list says', () => {
    const empty: string[] = []
    const missing: string[] = []
    const spurious: string[] = []
    for (const slug of SPELLING_ORDER) {
        const declared = new Set<string>(SPELLINGS[slug].ladders)
        const actual = new Set<string>()
        let found = 0
        for (const { ladder, rung } of RUNGS) {
            if (!rung.spells?.includes(slug)) continue
            actual.add(ladder)
            if (declared.has(ladder)) found++
        }
        if (found === 0) empty.push(slug)
        for (const ladder of actual) if (!declared.has(ladder)) missing.push(`${slug}: rungs in ${ladder}`)
        for (const ladder of declared)
            if (!actual.has(ladder)) spurious.push(`${slug}: no rungs in ${ladder}`)
    }
    expect(empty, 'a spelling with no rung — its page would be blank').toEqual([])
    expect(missing.sort(), 'a rung is in a ladder the spelling does not list').toEqual([])
    expect(spurious.sort(), 'a spelling lists a ladder with nothing of its own in it').toEqual([])
})

test('every rung spells something the language has', () => {
    // What `#ui/lib/Reference.abide` relies on to print a claim as `{#for}` rather than as its slug: it
    // looks the slug up unchecked, because a slug that is not one of these fails here first.
    const bogus: string[] = []
    for (const { ladder, at, rung } of RUNGS) {
        for (const slug of rung.spells ?? []) {
            if (!Object.hasOwn(SPELLINGS, slug as SpellingName))
                bogus.push(`${ladder} rung ${at + 1}: "${slug}"`)
        }
    }
    expect(bogus.sort(), 'a rung says it demonstrates a spelling with no page').toEqual([])
})

// ─── THE GROUPING ───────────────────────────────────────────────────────────────────────────────────
//
// `TOPICS.ts` is not a third VOCABULARY — it is a grouping over the two above, and the checks reflect
// that: it owns no rungs, so it is never asked whether one exists. What it owes is that it covers the
// two lists EXACTLY, which is what lets the sidebar and the index be drawn from it instead of from a
// hand-written array of sections beside a file-based route tree.
//
// The both-directions habit matters more here than anywhere else in this file, because the failure it
// catches is the invisible one: a new export lands, its page exists and works, and it appears in no
// section — a page reachable only by typing its address. Nothing about the app looks broken.

test('every callable and every spelling is in exactly ONE topic', () => {
    const callableIn = new Map<string, string[]>()
    const spellingIn = new Map<string, string[]>()
    for (const name of TOPIC_ORDER) {
        for (const callable of TOPICS[name].callables) {
            const held = callableIn.get(callable) ?? []
            held.push(name)
            callableIn.set(callable, held)
        }
        for (const slug of TOPICS[name].spells) {
            const held = spellingIn.get(slug) ?? []
            held.push(name)
            spellingIn.set(slug, held)
        }
    }

    // Missing: the failure that leaves a page reachable only by typing its address.
    const unshelved = Object.keys(CALLABLES).filter((name) => !callableIn.has(name))
    expect(unshelved.sort(), 'a callable is in no topic — its page is in no section of the index').toEqual([])
    const unspelt = Object.keys(SPELLINGS).filter((slug) => !spellingIn.has(slug))
    expect(unspelt.sort(), 'a spelling is in no topic').toEqual([])

    // Doubled: the failure that puts one name in two sections and makes every count disagree.
    const twice: string[] = []
    for (const [name, topics] of callableIn)
        if (topics.length > 1) twice.push(`${name}: ${topics.join(', ')}`)
    for (const [slug, topics] of spellingIn)
        if (topics.length > 1) twice.push(`${slug}: ${topics.join(', ')}`)
    expect(twice.sort(), 'a name is on two shelves, so the sidebar lists it twice').toEqual([])

    // Invented: what a rename leaves behind.
    const strayCallables = [...callableIn.keys()].filter((name) => !Object.hasOwn(CALLABLES, name))
    expect(strayCallables.sort(), 'a topic names a callable the list does not have').toEqual([])
    const straySpellings = [...spellingIn.keys()].filter((slug) => !Object.hasOwn(SPELLINGS, slug))
    expect(straySpellings.sort(), 'a topic names a spelling the list does not have').toEqual([])
})

test('a topic has at least two members, because one is a name wearing a heading', () => {
    // The same rule a ladder is held to further down, for the same reason: a section of one is a
    // heading a reader has to read to find out it was not worth having. Two is where a grouping starts
    // saying something — that these belong TOGETHER.
    const thin: string[] = []
    for (const name of TOPIC_ORDER) {
        const members = TOPICS[name].callables.length + TOPICS[name].spells.length
        if (members < 2) thin.push(`${name}: ${members}`)
    }
    expect(thin, 'a topic with fewer than two members').toEqual([])
})

test('every page says what is easy to get wrong, and every topic says what its names are to each other', () => {
    // The prose gate, and it is a REQUIRED-FIELD check rather than a quality one — which is the most a
    // test can do here. What it stops is the shape the docs app this was taken from is in: its
    // equivalent is an optional per-route map, so a page with no tip and a page nobody has written a
    // tip for are the same page, and no reading of it says which.
    const silent: string[] = []
    for (const name of CALLABLE_ORDER) if (CALLABLES[name].pitfall.trim() === '') silent.push(name)
    for (const slug of SPELLING_ORDER) if (SPELLINGS[slug].pitfall.trim() === '') silent.push(slug)
    expect(silent.sort(), 'a public name with nothing said about getting it wrong').toEqual([])

    const unled = TOPIC_ORDER.filter((name) => TOPICS[name].lead.trim() === '')
    expect(unled, 'a topic with no lead — its section is a heading over a grid').toEqual([])
})

/**
 * The ladders holding rungs that claim NEITHER a name nor a spelling, and are therefore on no page.
 *
 * Both are about `abide/ui`: `mount` and `hydrate` are called by `abide build`'s GENERATED client entry
 * and by nothing in either app's pages, server or site, and they are not template syntax either. The
 * rungs still compile, still run and are still priced — they simply document a mechanism rather than
 * anything a reader could look up.
 *
 * `template` was a third entry here for as long as `/docs` had one axis, and it is the reason the
 * second one exists: thirty of its rungs are about a spelling rather than about a name, so under a
 * list keyed by callable they were silent by construction and a future one could go silent unnoticed.
 * Keyed by both, no rung in the repo is excused except these two.
 *
 * Asserted in BOTH directions, which is what makes it a record of a decision rather than a place to put
 * failures: a ladder that quietly stops claiming fails, and so does one listed here that has started.
 */
const UNCLAIMED: LadderName[] = ['client', 'hydrate']

test('claiming nothing is a decision, not a way to disappear', () => {
    const silent = new Set<string>()
    for (const { ladder, rung } of RUNGS) {
        if (rung.of.length === 0 && (rung.spells?.length ?? 0) === 0) silent.add(ladder)
    }

    const unexpected = [...silent].filter((ladder) => !UNCLAIMED.includes(ladder as LadderName))
    expect(
        unexpected.sort(),
        'a rung claims neither a name nor a spelling, and its ladder is not excused',
    ).toEqual([])

    const stale = UNCLAIMED.filter((ladder) => !silent.has(ladder))
    expect(
        stale.sort(),
        'a ladder is listed as claiming nothing but every rung on it claims something',
    ).toEqual([])
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
        // import resolved to nothing rather than that somebody wrote an empty example. There is no
        // assertion on the LABEL beside it: it is `basename` of a path that resolved, so it can only
        // be empty if the path was, which the line above already catches — and an assert that cannot
        // fail reads as coverage the pane's title does not have.
        expect(rung.source.text.length, `${where}: the source is empty`).toBeGreaterThan(40)
        // A compiled `.abide` default export, or absent. Anything else renders as `[object Object]`
        // on the reference page rather than failing.
        if (rung.view !== undefined) {
            expect(typeof rung.view, `${where}: the view is not callable`).toBe('function')
        }
    }
})

test('every rung a reader can reach RENDERS — the source is not the example', () => {
    // What `/docs` and `/docs/syntax` put on a page is every rung claiming a name or a spelling, and
    // `#ui/lib/Reference.abide` mounts each one beside its source. Half the ladder used to have no view at
    // all — an endpoint and a lifecycle hook have nothing to render BY THEMSELVES — and the answer was
    // a page telling a reader to imagine the result. A rung that crosses the seam is two files now, so
    // "nothing to render" is not one of the shapes a documented rung comes in.
    const blank: string[] = []
    for (const { ladder, at, rung } of RUNGS) {
        const onAPage = rung.of.length > 0 || (rung.spells?.length ?? 0) > 0
        if (!onAPage) continue
        if (rung.view === undefined) blank.push(`${ladder} rung ${at + 1}: ${rung.adds}`)
    }
    expect(blank.sort(), 'a rung is on a page with nothing to show').toEqual([])
})

test('a rung that crosses the seam shows BOTH files', () => {
    // `client` is the SECOND file — usually the browser half of a rung whose `source` is a server
    // module, and on `template` rung 36 the parent that owns the child's state. The page labels the two
    // panes with the FILENAMES the loader reported, so the labels cannot drift; what can still go wrong
    // is the pair itself. Two ways, neither caught anywhere else: a half that resolved to nothing, and a
    // half that is the same text as the other — one file shown twice, claiming a second file exists.
    const wrong: string[] = []
    for (const { ladder, at, rung } of RUNGS) {
        if (rung.client === undefined) continue
        const where = `${ladder} rung ${at + 1}`
        if (rung.client.text.length < 40) wrong.push(`${where}: the second file is empty`)
        if (rung.client.text === rung.source.text) wrong.push(`${where}: both panes are the same file`)
        if (rung.client.label === rung.source.label) wrong.push(`${where}: both panes carry one name`)
        // A second file is what the preview was compiled from, so a rung carrying one and rendering
        // nothing is a pane with no reason to be there.
        if (rung.view === undefined) wrong.push(`${where}: two files and nothing to show`)
    }
    expect(wrong.sort(), 'a two-pane rung that is not two files').toEqual([])
})

test('a rung introduces ONE thing — no two rungs are the same file, or the same claim', () => {
    // Two failures this rules out. A copy-paste, where one file is shown twice and a reader compares it
    // with itself; and a duplicated `adds`, which means the ladder claims to introduce something twice
    // and therefore introduced it in neither place clearly.
    const files = new Map<string, string>()
    const labels = new Map<string, string>()
    for (const { ladder, rung } of RUNGS) {
        const owner = files.get(rung.source.text)
        expect(owner, `${ladder} shows the same file as ${owner}`).toBeUndefined()
        files.set(rung.source.text, ladder)

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
        const now = words(rung.source.text)
        if (at > 0) {
            let shared = 0
            for (const word of now) if (before.has(word)) shared++
            expect(shared, `${ladder} rung ${at + 1} shares nothing with rung ${at}`).toBeGreaterThan(1)
        }
        before = now
    }
})
