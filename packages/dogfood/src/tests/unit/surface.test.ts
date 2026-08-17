// Is the front door still the surface it says it is?
//
// `abide.ts` is CURATED — every line there is a decision that a name belongs on what an app reads —
// and `docs/SPEC.md`'s entry-point table states that curation as a COUNT and an enumeration. Both are
// prose, and a justification that names something is exactly the part that goes stale: the same table
// said "four other entry points" while naming three, and pointed a type's siblings at the module that
// says in capitals they are not there. Nothing was red.
//
// So this asserts the claim rather than the file. Three of the four checks derive everything from the
// tree; the one hand-written list is the RESIDUE — values on the front door that the dogfood app's own
// pages, server and site never type — and it is asserted in BOTH directions. A new unreferenced
// export fails, and so does an entry that has STOPPED being unreferenced. A list that only fails when
// it is too small accumulates forever; one that also fails when it is too large cannot, which is what
// makes it a record of known gaps rather than a place to put failures.
//
// What this does NOT cover, said plainly so nobody trusts it further than it goes: the TYPES. A type
// is not typed by name — `Params` is inferred off `route().params`, and no app annotates with it — so
// its test is reachability from the signature of a value on the same entry point, which needs a tsc
// program walk rather than a grep. The types are counted below and checked nowhere.

import { expect, test } from 'bun:test'
import { compile } from 'abide/compiler'
// The runtime surface, as a module rather than as text: `Object.keys` is what a bundler and an
// importer actually see, so it is the truth the parse below is checked AGAINST rather than a second
// opinion beside it.
import * as frontDoor from 'abide'
import { APP_ROOT as DOGFOOD_ROOT, REPO_ROOT } from '#tests/PATHS.ts'



/**
 * The dogfood app's own APP, which is the standard SPEC names — its pages, what answers them, and what
 * they are made of. Not the demos, the tests or their fixtures: those exercise the framework rather
 * than use it, and counting them would make every export look typed by somebody. Which is also why
 * this is not `src/**` — `#shared/demos` is under the same root and is the half being excluded.
 */
const AUTHORING_LANES = 'src/{ui,server}/**/*.{ts,abide}'

/** The `.abide` half of the same lanes, whose emitted header is authored on the file's behalf. */
const COMPILED_LANES = 'src/ui/{pages,lib}/**/*.abide'

/** Named bindings on one `import { … } from 'abide'`. Built per call — `matchAll` needs `g`. */
function importedFromAbide(source: string): string[] {
    const names: string[] = []
    for (const statement of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]abide['"]/g)) {
        const [, members = ''] = statement
        for (const raw of members.split(',')) {
            const member = raw.trim().replace(/^type\s+/, '')
            // The name abide EXPORTS, which is the left of an `as` on an import.
            const [imported = ''] = member.split(/\s+as\s+/)
            if (imported !== '') names.push(imported.trim())
        }
    }
    return names
}

/**
 * `abide.ts` split the way it is WRITTEN: what is a value and what is only a type.
 *
 * Comments go first because the file is mostly comment, and two of them contain a comma inside the
 * braces of an export statement — which a split on commas otherwise reads as a member name.
 */
function curatedSurface(source: string): { values: Set<string>; types: Set<string> } {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const values = new Set<string>()
    const types = new Set<string>()
    for (const statement of code.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s+from/g)) {
        const [, wholeStatementIsTypes, members = ''] = statement
        for (const raw of members.split(',')) {
            const member = raw.trim()
            if (member === '') continue
            const isType = wholeStatementIsTypes !== undefined || member.startsWith('type ')
            // The EXPORTED name, which is the right of an `as`: `a as b` is `b`.
            const parts = member.replace(/^type\s+/, '').split(/\s+as\s+/)
            const exported = parts[parts.length - 1] ?? ''
            ;(isType ? types : values).add(exported.trim())
        }
    }
    return { values, types }
}

const SPEC = await Bun.file(`${REPO_ROOT}/docs/SPEC.md`).text()
const ENTRY_POINT_ROW = SPEC.split('\n').find((line) => line.startsWith('| `abide` |'))
const CURATED = curatedSurface(await Bun.file(`${REPO_ROOT}/packages/abide/abide.ts`).text())
const EXPORTED_VALUES = new Set(Object.keys(frontDoor))

test('the parse of `abide.ts` agrees with what importing it gives you', () => {
    // Not a claim about the surface — a claim about the three tests under it. A parse that silently
    // missed an export would make every count below agree with itself and with nothing else.
    expect([...CURATED.values].sort()).toEqual([...EXPORTED_VALUES].sort())
})

test('SPEC counts the front door correctly', () => {
    expect(ENTRY_POINT_ROW, 'no `abide` row in SPEC’s entry-point table').toBeDefined()
    const counted = ENTRY_POINT_ROW?.match(/\*\*(\d+) values and (\d+) types\*\*/)
    expect(counted, 'the `abide` row no longer states a count').not.toBeNull()
    expect(Number(counted?.[1]), 'SPEC’s value count').toBe(EXPORTED_VALUES.size)
    expect(Number(counted?.[2]), 'SPEC’s type count').toBe(CURATED.types.size)
})

test('SPEC enumerates every value on the front door', () => {
    // Every identifier the row spells in backticks, `online()` and `route()` included — the row is
    // prose, so it names some of them as calls.
    const named = new Set<string>()
    for (const span of (ENTRY_POINT_ROW ?? '').matchAll(/`([^`]+)`/g)) {
        const [, spelled = ''] = span
        for (const word of spelled.match(/[A-Za-z_$][\w$]*/g) ?? []) named.add(word)
    }
    const unnamed: string[] = []
    for (const value of EXPORTED_VALUES) if (!named.has(value)) unnamed.push(value)
    expect(unnamed, 'on the front door, and SPEC’s enumeration does not mention it').toEqual([])
})

/**
 * What the same row says is NOT on the front door.
 *
 * Hand-written because the claims are prose — "`Route` is here and `RouteEntry` is not", "`scope`,
 * `untrack` and `isolate` are on no entry point at all" — and parsing a negation out of a sentence is
 * how a check starts agreeing with whatever it reads. Each of these is a decision the row justifies,
 * so one of them turning up as an export means the row is now arguing against the file it describes.
 */
const NOT_ON_THE_FRONT_DOOR = ['RouteEntry', 'scope', 'untrack', 'isolate']

test('the names SPEC says are absent are absent', () => {
    const present: string[] = []
    for (const name of NOT_ON_THE_FRONT_DOOR) {
        if (EXPORTED_VALUES.has(name) || CURATED.types.has(name)) present.push(name)
    }
    expect(present, 'SPEC says this is not on `abide`, and it is').toEqual([])
})

/**
 * Front-door values the app itself never types, and why that is allowed to be true today.
 *
 * A gap here is a gap in the DOGFOOD, never machinery to delete — the fix is a page that uses the
 * call, and this is what stops the absence being invisible until somebody greps. The reason is the
 * whole value of the entry: a bare name would let the list absorb a failure instead of recording one.
 */
const UNUSED_BY_THE_APP: Record<string, string> = {
    // The four below are typed by a `/docs` PREVIEW rather than by nothing at all, which is a weaker
    // gap than it was and still a gap: the scan is the `ui` and `server` seams because those are the
    // app being an app, and a rung is the app being a manual. Closing one means a page of this site
    // reaching for the call for its own sake.
    //
    // `log` came OFF this list when the layout moved: `app.ts` is `#server/app.ts` now, inside the
    // seam the scan covers, and it has always written `log` on start. The gap was never real — the
    // one file that closed it sat above every lane this test knew to look in.
    channel:
        '`#server/sockets/feed.ts` declares two sockets and nothing on the site subscribes to either — ' +
        'only `/docs/socket`’s preview does, which is a demonstration rather than a use.',
    health: 'no page of the app’s own shows its account of whether it is working; `/docs/health` asks for it.',
    invalidate: 'nothing the app serves is ever dropped as WRONG — no page mutates what another page read.',
    navigate: 'every link in `#ui/pages/layout.abide` is an `<a href>`; only `/docs/navigate`’s preview moves from code.',
    online: 'no page reacts to connectivity — there is no offline banner to put behind it.',
    raw:
        'nothing this app serves is markup it did not build — the painted `<pre>` and the source panes ' +
        'go through the escape, which is the point of them. The hatch is shown on its ladder rung and ' +
        'used nowhere else, and an app that reached for it to render its own output would be the wrong ' +
        'example to set on a page that exists to be read.',
    refresh: 'no page offers a reload of a read it is already serving.',
    url: '`#ui/pages/layout.abide` builds `/${other}/${name}` with a template literal, which is this call’s whole job.',
}

test('every value on the front door is typed by the app, or is a KNOWN gap', async () => {
    const typed = new Set<string>()
    let scanned = 0
    for await (const file of new Bun.Glob(AUTHORING_LANES).scan(DOGFOOD_ROOT)) {
        scanned++
        for (const name of importedFromAbide(await Bun.file(`${DOGFOOD_ROOT}/${file}`).text())) typed.add(name)
    }
    expect(scanned, 'the app scan matched no files — the glob is wrong, not the app').toBeGreaterThan(20)

    // The second source of authored text: what the compiler writes on the author's behalf. `html` is
    // the one value that arrives this way — a `.abide` file spells the template tag nowhere and the
    // emit imports it always — so a grep over source alone reports it as surface nobody uses.
    for await (const file of new Bun.Glob(COMPILED_LANES).scan(DOGFOOD_ROOT)) {
        const { code } = compile(await Bun.file(`${DOGFOOD_ROOT}/${file}`).text(), { filename: file })
        for (const name of importedFromAbide(code)) typed.add(name)
    }

    const untyped: string[] = []
    for (const value of EXPORTED_VALUES) if (!typed.has(value)) untyped.push(value)

    // Both directions in one comparison. A new name on the left is surface the app does not exercise;
    // a name left on the right is an excuse that has outlived its reason and leaves in the same change
    // as the page that made it false.
    expect(untyped.sort(), 'the app’s unused front-door values').toEqual(Object.keys(UNUSED_BY_THE_APP).sort())
})

test('every acknowledged gap says why', () => {
    for (const [name, reason] of Object.entries(UNUSED_BY_THE_APP)) {
        expect(reason.length, `${name}: acknowledged without a reason`).toBeGreaterThan(40)
    }
})
