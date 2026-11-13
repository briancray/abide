// THE DOCS AGAINST THE REGISTRY, AND AGAINST THEIR OWN RULES (RULEBOOK 40): every REGISTRY section
// carried by one primitive's page, every example card on exactly one page, and the words held to what
// docs/BRAND.md asks of a heading, a label and a code sample. The pages are read three ways —
// `SITE.ts` for what a page carries, its `index.abide` for what it embeds, and the markdown the built
// app serves for what a reader reads (`docsPages.ts`).

import { beforeAll, expect, test } from 'bun:test'

import { cellsOf } from '../src/lib/cellsOf.ts'
import { registryRows } from '../src/lib/registryRows.ts'
import { SITE } from '../src/lib/SITE.ts'
import { isFramed } from '../src/lib/sitePages.ts'
import { BUILTIN_TYPES } from './BUILTIN_TYPES.ts'
import { declaredExports } from './declaredExports.ts'
import {
    allCards,
    cardsOf,
    docsPages,
    DOGFOOD,
    renderedMarkdown,
} from './docsPages.ts'

// EVERY PAGE, LOADED ONCE AHEAD OF THE TESTS: under the parallel gate the first test to ask would pay
// for the whole load against the other suites, inside its own five seconds.
beforeAll(() => renderedMarkdown(), 60_000)

const registry = await Bun.file(
    new URL('../../../docs/REGISTRY.md', import.meta.url),
).text()

// Every name in the FIRST column of a REGISTRY table is a capability or a variant an app
// author can reach. This reads REGISTRY.md rather than a copied list, so a capability
// added there fails the tests below until a page claims it.
//
// Only a `Name | (Type) Signature | …` table carries a SIGNATURE. The others — file
// conventions, CLI commands, generated headers — put prose in the second cell, and
// reading that as a signature is what would make one capability restated in two tables
// look like two capabilities that disagree. A capability is qualified by its `##` section.
const capabilities: {
    name: string
    signature: string | undefined
    section: string
}[] = []
for (const row of registryRows(registry)) {
    const name = row.cells[0]
    if (name === undefined || !name.startsWith('`')) continue
    const signed = /^(Type )?Signature$/.test(row.header[1] ?? '')
    capabilities.push({
        name,
        signature: signed ? (row.cells[1] ?? '') : undefined,
        section: row.section,
    })
}

// A name in two sections is TWO CAPABILITIES by default — `Args` is a memo key, a room
// and a set of URL parameters; `tail` retains values in one section and messages in
// another. Both spell `number`, so the signature cannot tell a variant from a
// restatement and the DEFAULT has to be the safe direction: qualify, and make somebody
// decide. `covers: Args` satisfying all four is what let three of them go unwritten.
//
// The exceptions are listed, because they are the short half: one capability written
// down in two tables, where a qualified claim would be two claims for one thing.
const RESTATED = new Set([
    '`onConfig`',
    '`onHealth`',
    '`abide openapi [--url <origin>]`',
    '`abide mcp [--url <origin>]`',
    // The reactive primitives carry `Produced` as one of the four type parameters, and `Rpc`
    // carries it again as what a handler yields. One name, one meaning, written where each is read.
    '`Produced`',
])

function specSections(): Map<string, Map<string, string | undefined>> {
    const sections = new Map<string, Map<string, string | undefined>>()
    for (const { name, signature, section } of capabilities) {
        const seen = sections.get(name) ?? new Map<string, string | undefined>()
        if (!seen.has(section) || signature !== undefined)
            seen.set(section, signature)
        sections.set(name, seen)
    }
    return sections
}

// A restatement that stopped matching is not a restatement. `onConfig` was written down
// twice with two different options bags, and both read as authoritative — the drift is
// invisible unless the two are compared, which nothing did.
test('a restated capability is restated identically', async () => {
    const drifted: string[] = []
    for (const [name, seen] of specSections()) {
        if (!RESTATED.has(name)) continue
        const signatures = [...seen.values()].filter((one) => one !== undefined)
        if (new Set(signatures).size > 1) drifted.push(name)
    }
    expect(drifted).toEqual([])
})

// A page nobody can reach is a page nobody reads, and a `SITE` entry with no page renders nothing.
test('every docs page is in SITE, and every SITE entry has its page', async () => {
    const listed = new Set<string>()
    for (const page of await docsPages()) listed.add(page.file)
    const orphans: string[] = []
    for (const path of new Bun.Glob('src/**/index.abide').scanSync({
        cwd: DOGFOOD,
    }))
        if (
            !listed.has(path) &&
            // The rulebook is a document, and a page of the CRM is that app's.
            !isFramed(
                path.slice('src'.length, -'/index.abide'.length) || '/',
            ) &&
            path !== 'src/rulebook/index.abide'
        )
            orphans.push(path)
    const missing: string[] = []
    for (const page of await docsPages())
        if (!(await Bun.file(`${DOGFOOD}${page.file}`).exists()))
            missing.push(page.file)
    expect({ orphans, missing }).toEqual({ orphans: [], missing: [] })
})

// An example is real files, so a card can name one that is gone and a panel renders empty.
test('every file a card renders or shows is on disk', async () => {
    const missing: string[] = []
    for (const card of await allCards()) {
        if (!(await Bun.file(`${DOGFOOD}${card.component}`).exists()))
            missing.push(
                `${card.id}: renders ${card.component || '(no import)'}`,
            )
        for (const [shown, path] of card.files)
            if (path === '' || !(await Bun.file(`${DOGFOOD}${path}`).exists()))
                missing.push(`${card.id}: shows ${shown}`)
    }
    expect(missing).toEqual([])
})

// 40.32 — A CARD RENDERS A COMPONENT FROM A `lib` OF THE CRM, so what a reader runs on the page is a
// file of the app they download, and a `.abide` outside a `lib` would be a page of its own (23.21).
// THE REVERT: drop a card's `app`, and it is named.
test('every card renders a component in a lib of the CRM', async () => {
    const strays: string[] = []
    for (const card of await allCards())
        if (
            card.app === undefined ||
            !card.component.startsWith(`examples/${card.app}/src/`) ||
            !card.component.includes('/lib/')
        )
            strays.push(`${card.id}: ${card.component}`)
    expect(strays).toEqual([])
})

// 40.3 — A CARD SHOWS ITS TEST: the file of its app that exercises what it renders, so the claim the
// card makes is one the app reruns. THE REVERT: drop a test tab from a card, and it is named.
test('every card shows a test of the CRM', async () => {
    const untested: string[] = []
    for (const card of await allCards()) {
        let shown = false
        for (const path of card.files.keys())
            if (/\.(test|e2e)\.ts$/.test(path)) shown = true
        if (!shown) untested.push(card.id)
    }
    expect(untested).toEqual([])
})

// 40.4 — A CARD SHOWS THE FILE IT RENDERS: the component is what the example IS, and a card whose
// tabs leave it out shows code that is not what runs above them.
test('every card shows the component it renders', async () => {
    const hidden: string[] = []
    for (const card of await allCards())
        if (![...card.files.values()].includes(card.component))
            hidden.push(`${card.id}: ${card.component}`)
    expect(hidden).toEqual([])
})

// An id names one example: it is the card's anchor and what its hand-written arm is paired by.
test('every card has an id no other card has', async () => {
    const seen = new Map<string, string>()
    const repeated: string[] = []
    for (const card of await allCards()) {
        if (card.id === '') repeated.push(`${card.route}: a card with no id`)
        const first = seen.get(card.id)
        if (first !== undefined)
            repeated.push(`${card.id}: ${first} and ${card.route}`)
        seen.set(card.id, card.route)
    }
    expect(repeated).toEqual([])
})

// 40.19 — ONE PAGE PER EXAMPLE. A component taught from two pages is code one of those readers was
// never shown running.
test('an example component is taught by exactly one page', async () => {
    const pagesFor = new Map<string, string[]>()
    for (const page of await docsPages()) {
        for (const card of cardsOf(page))
            pagesFor.set(card.component, [
                ...(pagesFor.get(card.component) ?? []),
                page.route,
            ])
    }
    const shared: string[] = []
    for (const [component, routes] of pagesFor)
        if (new Set(routes).size > 1)
            shared.push(`${component}: ${[...new Set(routes)].join(', ')}`)
    expect(shared).toEqual([])
})

// 40.17 — A PAGE RUNS WHAT IT TEACHES. The pages with no card yet are a RATCHET: written down here,
// asserted exactly, shrinking only — a page that gains a card leaves the list, and one that loses its
// last card is named. The home page routes rather than teaches. THE REVERT: drop every card from
// `/reactive/reactive`, and it is named.
const CARDLESS: string[] = await Bun.file(
    new URL('./CARDLESS.json', import.meta.url),
).json()

test('every page embeds an example, or is on the ratchet of pages with none yet', async () => {
    const cardless: string[] = []
    for (const page of await docsPages())
        if (page.route !== '/' && cardsOf(page).length === 0)
            cardless.push(page.route)
    expect(cardless).toEqual(CARDLESS)
})

// 40.26 — a card follows its heading with nothing between them. A paragraph there is a fourth voice
// restating the heading, the title or the summary, and belongs after the card.
test('an example follows its heading directly', async () => {
    const separated: string[] = []
    for (const page of await docsPages()) {
        const lines = page.source.split('\n')
        for (let at = 0; at < lines.length; at += 1) {
            if (!(lines[at] ?? '').trim().startsWith('<Example')) continue
            let previous = at - 1
            while (previous >= 0 && (lines[previous] ?? '').trim() === '')
                previous -= 1
            if (!(lines[previous] ?? '').trim().startsWith('<Section'))
                separated.push(`${page.route}:${at + 1}`)
        }
    }
    expect(separated).toEqual([])
})

// A heading of the form `Subject: `a`, `b`, `c`` is a GLOSSARY LABEL, and it reads as the whole set —
// so it is compared against the table under it, which is what the section teaches.
const ENUMERATING = /^#{2,4}\s+[^:`]+:\s+((?:`[^`]+`)(?:,\s*`[^`]+`)+)\s*$/
const CELL = /^\|\s*`([^`]+)`/

// `pending` in a heading and `pending()` in a cell are one name.
function bare(name: string): string {
    return name.replace(/^s\./, '').replace(/\(\)$/, '')
}

test('a heading that enumerates names everything its table lists', async () => {
    const partial: string[] = []
    for (const [route, body] of await renderedMarkdown()) {
        const lines = body.split('\n')
        for (let at = 0; at < lines.length; at += 1) {
            const named = ENUMERATING.exec(lines[at] ?? '')
            if (!named?.[1]) continue
            const heading = named[1]
                .split(',')
                .map((one) => bare(one.trim().slice(1, -1)))
            const listed: string[] = []
            for (let scan = at + 1; scan < lines.length; scan += 1) {
                const line = lines[scan] ?? ''
                if (line.startsWith('#')) break
                if (listed.length > 0 && !line.startsWith('|')) break
                const cell = CELL.exec(line)
                if (cell?.[1]) listed.push(bare(cell[1]))
            }
            if (listed.length === 0) continue
            if (heading.join() !== listed.join())
                partial.push(
                    `${route}: "${heading.join(', ')}" vs table ${listed.join(', ')}`,
                )
        }
    }
    expect(partial).toEqual([])
})

// docs/BRAND.md, Voice: "A heading carries its own subject." A reader arriving from the rail or a
// search result has no previous section, so a bare pronoun in a heading refers to nothing.
const BARE_PRONOUN =
    /(^(it|they|this|these|those|its|their)\b|\b(it|them|this|these|those|one)$)/i

test('no heading leans on a pronoun for its subject', async () => {
    const offenders: string[] = []
    for (const [route, body] of await renderedMarkdown())
        for (const line of body.split('\n')) {
            const heading = /^#{2,4}\s+(.*?)\s*$/.exec(line)
            if (heading?.[1] && BARE_PRONOUN.test(heading[1]))
                offenders.push(`${route}: ${heading[1]}`)
        }
    expect(offenders).toEqual([])
})

// A `.abide` file is where a state is read and written BY NAME — `count += 1`, not
// `count.set(count() + 1)`. A guide showing the explicit one teaches back the ceremony the file
// exists to remove; where the explicit spelling IS the subject, it goes in a `ts` fence.
// `route` and `principal` are NAMESPACES, not states (RULEBOOK 31.1, 23.1).
const NAMESPACES = new Set(['route', 'principal'])

// Every `.abide` source the docs SHIP: each `abide` fence a page writes, and every `.abide` a card
// shows — which the markdown carries as a fence too, so one read covers both.
async function abideSources(): Promise<{ where: string; code: string }[]> {
    const sources: { where: string; code: string }[] = []
    for (const [route, body] of await renderedMarkdown()) {
        let ordinal = 0
        for (const match of body.matchAll(/```abide[^\n]*\n([\s\S]*?)```/g)) {
            ordinal += 1
            sources.push({
                where: `${route} block ${ordinal}`,
                code: match[1] ?? '',
            })
        }
    }
    return sources
}

// Which names in a source are reactive values, from what the source itself says.
function stateNames(code: string): Set<string> {
    const names = new Set<string>()
    for (const match of code.matchAll(
        /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*reactive\b/g,
    ))
        names.add(match[1] ?? '')
    for (const match of code.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*Reactive</g))
        names.add(match[1] ?? '')
    for (const match of code.matchAll(/bind:[\w-]+=\{([A-Za-z_$][\w$]*)\}/g))
        names.add(match[1] ?? '')
    for (const match of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\.set\(/g))
        names.add(match[1] ?? '')
    for (const namespace of NAMESPACES) names.delete(namespace)
    return names
}

test('an abide snippet reads and writes state by name, not through the explicit forms', async () => {
    const offenders: string[] = []
    for (const { where, code } of await abideSources()) {
        const states = stateNames(code)
        for (const match of code.matchAll(
            /(?<![.\w$])([A-Za-z_$][\w$]*)\.set\(/g,
        )) {
            const name = match[1] ?? ''
            if (!NAMESPACES.has(name))
                offenders.push(
                    `${where}: ${name}.set(v) — write \`${name} = v\``,
                )
        }
        for (const match of code.matchAll(
            /(?<![.\w$])([A-Za-z_$][\w$]*)\(\)/g,
        )) {
            const name = match[1] ?? ''
            if (states.has(name))
                offenders.push(`${where}: ${name}() — read \`${name}\``)
        }
    }
    expect([...new Set(offenders)]).toEqual([])
})

// A type signature names other types, and every one has to be declared somewhere or the
// REGISTRY carries a name a reader cannot look up. `WireError` was used twice and declared
// nowhere, and nothing in the document pointed at it.
//
// Three things count as a declaration: a first-column cell, a HEADING (an options bag is
// a `### ChannelOptions` section rather than a row), and a TYPE PARAMETER bound anywhere
// in the document — `Failures` and `Data` are spelled in one signature's binder and used
// in the next row's, which is the shape a per-row scan reads as dangling.
//
// A STRING LITERAL is not a name to look up. `Failed<'NotFound', …>` spells the key
// `isError` narrows BY, not a type declared elsewhere, and the scan matched inside the
// quotes. Blanking the span rather than exempting the word keeps the check exact: a type
// is only ever referenced unquoted, so nothing this caught before stops being caught.
function withoutLiterals(signature: string): string {
    return signature.replaceAll(/'[^']*'/g, "''")
}

function binder(signature: string): string {
    if (!signature.startsWith('`<')) return ''
    let depth = 0
    for (let at = 1; at < signature.length; at += 1) {
        if (signature[at] === '<') depth += 1
        else if (signature[at] === '>') {
            depth -= 1
            if (depth === 0) return signature.slice(2, at)
        }
    }
    return ''
}

function declaredTypes(): Set<string> {
    const declared = new Set<string>()
    for (const line of registry.split('\n')) {
        const heading = /^#{1,4}\s+`?([A-Za-z_$][\w$]*)/.exec(line)
        if (heading?.[1]) declared.add(heading[1])
        // A fenced `type X = …`, which is where the adoption unwrap is spelled out.
        const alias = /^type\s+([A-Za-z_$][\w$]*)/.exec(line)
        if (alias?.[1]) declared.add(alias[1])
    }
    for (const { name, signature } of capabilities) {
        const own = /^`?([A-Za-z_$][\w$]*)/.exec(name)?.[1]
        if (own) declared.add(own)
        // The LEADING `<…>` only, matched to its own closing angle — a default can
        // nest one (`Stored = AdoptedValue<Computed>`). Every other `<…>` is an
        // ARGUMENT list, and reading `Reactive<Params>` as DECLARING `Params` is how
        // this test would stop testing.
        for (const part of binder(signature ?? '').split(','))
            declared.add(/^\s*([A-Z][A-Za-z0-9]*)\b/.exec(part)?.[1] ?? '')
        // A GENERIC TYPE spelled as its own name over its parameters — `Keyed<Stored, Args, …>` —
        // declares them as a leading `<…>` would. Read as one, or a parameter no other row
        // happened to name reads as a type nothing declares.
        if (own !== undefined && signature?.startsWith(`\`${own}<`))
            for (const part of binder(
                `\`${signature.slice(own.length + 1)}`,
            ).split(','))
                declared.add(/^\s*([A-Z][A-Za-z0-9]*)\b/.exec(part)?.[1] ?? '')
        // AND ITS BODY A GENERIC SIGNATURE — `Middleware<Answer, Extra> = <Given, Result>(…)` —
        // binds a second list, the call's, where the alias's ends.
        const body = (signature ?? '').indexOf('> = <')
        if (own !== undefined && body !== -1)
            for (const part of binder(`\`${signature?.slice(body + 4)}`).split(
                ',',
            ))
                declared.add(/^\s*([A-Z][A-Za-z0-9]*)\b/.exec(part)?.[1] ?? '')
        // A MAPPED TYPE binds its key where it uses it — `[K in RequiredNames<P>]` is the
        // same declaration a leading `<…>` makes, in the other syntax. `ParamsOf<P>` is
        // three of them, and without this the key reads as a type nothing declares.
        for (const match of (signature ?? '').matchAll(
            /\[\s*([A-Z][A-Za-z0-9]*)\s+in\b/g,
        ))
            declared.add(match[1] ?? '')
    }
    return declared
}

test('every type a signature names is declared somewhere', async () => {
    const declared = declaredTypes()
    const dangling: string[] = []
    for (const { name, signature } of capabilities) {
        for (const match of withoutLiterals(signature ?? '').matchAll(
            /\b([A-Z][A-Za-z0-9]*)\b/g,
        )) {
            const type = match[1] ?? ''
            if (!BUILTIN_TYPES.has(type) && !declared.has(type))
                dangling.push(`${name}: ${type}`)
        }
    }
    expect([...new Set(dangling)]).toEqual([])
})

// 40.43 — EVERY REGISTRY SECTION IS ONE PAGE'S: a section no page carries is rows no reader can look
// up, and a section two pages name is a second copy. THE REVERT: point `/reactive/watch`'s `registry`
// at `reactive`'s section, and both are named.
test('every registry section is carried by exactly one page', async () => {
    const carriedBy = new Map<string, string[]>()
    for (const group of SITE)
        for (const page of group.pages)
            carriedBy.set(page.registry, [
                ...(carriedBy.get(page.registry) ?? []),
                page.route,
            ])
    const sections = new Set<string>()
    for (const row of registryRows(registry)) sections.add(row.section)
    const wrong: string[] = []
    for (const section of sections) {
        const routes = carriedBy.get(section) ?? []
        if (routes.length !== 1)
            wrong.push(`${section}: ${routes.join(', ') || 'no page'}`)
    }
    for (const [section, routes] of carriedBy)
        if (!sections.has(section))
            wrong.push(`${section}: no such section, on ${routes.join(', ')}`)
    expect(wrong).toEqual([])
})

// docs/BRAND.md, Documentation structure: "A label stands alone." A nav label is read with no
// sentence around it, so a preposition and a single word waits for a noun the reader does not have.
const BARE_PREPOSITIONAL =
    /^(on|by|in|with|for|from|at|to|of|about|after|before)\s+\S+$/i

test('no nav label begins with a preposition', async () => {
    const offenders: string[] = []
    for (const page of await docsPages())
        if (BARE_PREPOSITIONAL.test(page.nav))
            offenders.push(`${page.route}: ${page.nav}`)
    expect(offenders).toEqual([])
})

// docs/BRAND.md: a link standing in for a page is read as that page's label, so a RENAME has two
// halves and only one is in the page renamed. A CODE label names an API and the link is where to read
// about it.
test('a link is labeled with the nav of the page it points at', async () => {
    const pages = await docsPages()
    const navOf = new Map<string, string>()
    const titleOf = new Map<string, string>()
    for (const group of SITE)
        for (const page of group.pages) {
            navOf.set(page.route, page.nav)
            titleOf.set(page.route, page.title)
        }
    const stale: string[] = []
    for (const [route, body] of await renderedMarkdown())
        for (const [, label, target] of body.matchAll(
            /\[([^\]]+)\]\(([^)#]+)\.md(?:#[^)]*)?\)/g,
        )) {
            const linked = target === '/index' ? '/' : (target as string)
            const nav = navOf.get(linked)
            if (
                nav === undefined ||
                label === undefined ||
                label.startsWith('`')
            )
                continue
            if (label !== nav && label !== titleOf.get(linked))
                stale.push(
                    `${route}: "${label}" -> ${linked}, whose nav is "${nav}"`,
                )
        }
    expect(pages.length).toBeGreaterThan(0)
    expect(stale).toEqual([])
})

// A sample renders in `main`'s column, and past the formatter's line width it is a thing to scroll
// rather than a thing to read. THE WIDTH IS READ FROM THE FORMATTER rather than restated, so the two
// cannot disagree; `abide format` wraps no markup, so this is what holds an example's own file to it.
const COLUMN: number = (
    Bun.TOML.parse(
        await Bun.file(new URL('../../../bunfig.toml', import.meta.url)).text(),
    ) as { fmt: { printWidth: number } }
).fmt.printWidth

test('no code sample is wider than the column it renders in', async () => {
    const wide: string[] = []
    for (const [route, body] of await renderedMarkdown()) {
        let fenced = false
        for (const line of body.split('\n')) {
            if (line.startsWith('```')) {
                fenced = !fenced
                continue
            }
            if (fenced && line.length > COLUMN)
                wide.push(`${route}: ${line.slice(0, 60)}…`)
        }
    }
    expect([...new Set(wide)]).toEqual([])
})

// 40.28: a comment in an example's own source fits on one line, and a longer reason goes in the copy
// after the card. A run of `//` lines, or a `/*` that does not close on its own line, is two or more.
function multilineComments(source: string): number[] {
    const opened: number[] = []
    const lines = source.split('\n')
    let previousWasLineComment = false
    for (let at = 0; at < lines.length; at += 1) {
        const line = (lines[at] ?? '').trim()
        const lineComment = line.startsWith('//')
        if (lineComment && previousWasLineComment) opened.push(at)
        else if (line.startsWith('/*') && !line.includes('*/'))
            opened.push(at + 1)
        previousWasLineComment = lineComment
    }
    return opened
}

test("no comment in an example's own source runs past one line", async () => {
    const long: string[] = []
    const shown = new Set<string>()
    for (const card of await allCards())
        for (const path of card.files.values()) shown.add(path)
    for (const path of shown) {
        if (path === '') continue
        const source = await Bun.file(`${DOGFOOD}${path}`).text()
        for (const line of multilineComments(source))
            long.push(`${path}:${line}`)
    }
    expect(long).toEqual([])
})

// docs/BRAND.md, Visual identity: the code-block spine is the one device to keep, and an uncaptioned
// fence renders without it. A fence with NO LANGUAGE is exempt — a shell transcript or a directory
// tree, with no side to name.
test('every source fence carries a caption', async () => {
    const bare: string[] = []
    for (const [route, body] of await renderedMarkdown()) {
        let fenced = false
        for (const line of body.split('\n')) {
            if (!line.startsWith('```')) continue
            if (fenced) {
                fenced = false
                continue
            }
            fenced = true
            if (line.trim() !== '```' && !/^```\S+\s+\S/.test(line))
                bare.push(`${route}: ${line.trim()}`)
        }
    }
    expect(bare).toEqual([])
})

// Every export REGISTRY writes, as `scope\0name`. Read by a scan of its own — a `Name` cell spelling
// the export or a member of it, or a `###` heading naming it — rather than by the placement the
// pages are generated with, so a slip in that is caught rather than agreed with.
// A section whose heading names an `@abide/harness/…` entry holds that entry's names; every other, abide's.
const named = new Set<string>()
for (const row of registryRows(registry)) {
    const entry = /`(@abide\/[^`]+)`/.exec(row.section)?.[1]
    const scope = entry ?? 'abide'
    const options = /`([^`]+)`/.exec(row.subsection ?? '')?.[1]
    if (options) named.add(`${scope}\0${options}`)
    if (row.header[0] !== 'Name') continue
    for (const [, span] of (row.cells[0] ?? '').matchAll(/`([^`]+)`/g))
        named.add(`${scope}\0${/^[\w$]+/.exec(span as string)?.[0] ?? ''}`)
}

// EVERY NAME A PUBLIC ENTRY EXPORTS IS ONE REGISTRY WRITES. A name with no row is one
// an author is offered and told nothing about — what compiled `.abide` output calls belongs on the
// runtimes it imports from (`packages/abide/src/shared/SPECIFIERS.ts`), not on what an app imports.
// The two left are types an author can write and no row names yet: a RATCHET, shrinking only.
// THE REVERT: re-export `escapeText` from `packages/abide/src/shared/index.ts`, and it is named.
const UNREGISTERED = [
    '@abide/abide: Identity',
    '@abide/abide: StandardSchemaV1',
]

test('every export of a public entry is a name the registry writes', async () => {
    const unnamed: string[] = []
    for (const { entry, scope, name } of await declaredExports())
        if (!named.has(`${scope}\0${name}`)) unnamed.push(`${entry}: ${name}`)
    expect(unnamed).toEqual(UNREGISTERED)
})

// 40.43 — EVERY REGISTRY ROW IS ON EXACTLY ONE PAGE, read off the markdown each page serves: a row on
// none is a name a reader cannot look up, and a row on two is a second copy. A row is its cells save
// the clauses, which a page writes as links. THE REVERT: drop `<Registry />` from a page, and its rows
// are named.
test('every registry row is on exactly one page', async () => {
    const key = (cells: string[]): string =>
        cells.slice(0, -1).join(' | ').replace(/\s+/g, ' ')
    const written = new Map<string, number>()
    for (const row of registryRows(registry))
        written.set(key(row.cells), (written.get(key(row.cells)) ?? 0) + 1)
    const found = new Map<string, string[]>()
    for (const [route, body] of await renderedMarkdown()) {
        for (const line of body.split('\n'))
            if (line.startsWith('| ') && !line.startsWith('| ---')) {
                const cells = key(cellsOf(line))
                if (written.has(cells))
                    found.set(cells, [...(found.get(cells) ?? []), route])
            }
    }
    const misplaced: string[] = []
    for (const [cells, count] of written) {
        const routes = found.get(cells) ?? []
        if (new Set(routes).size !== 1 || routes.length !== count)
            misplaced.push(
                `${cells.slice(0, 70)}: ${routes.join(', ') || 'no page'}`,
            )
    }
    expect(misplaced).toEqual([])
})
