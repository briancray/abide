// THE DOCS AGAINST THE REGISTRY, AND AGAINST THEIR OWN RULES (RULEBOOK 40): every capability claimed
// by one written page, every example card on exactly one teaching page, and the words held to what
// docs/BRAND.md asks of a heading, a label and a code sample. The pages are read three ways —
// `SITE.ts` for what a page claims, its `index.abide` for what it embeds, and the markdown the built
// app serves for what a reader reads (`docsPages.ts`).

import { expect, test } from 'bun:test'
import { dirname } from 'node:path' // bun exposes no path helpers of its own
import { SITE } from '../src/lib/SITE.ts'
import { DOCUMENTS, sidebarGroupsOf } from '../src/lib/siteSections.ts'
import { BUILTIN_TYPES } from './BUILTIN_TYPES.ts'
import {
    allCards,
    cardsOf,
    DOGFOOD,
    docsPages,
    pageFileOf,
    renderedMarkdown,
} from './docsPages.ts'

const REGISTRY = new URL('../../../docs/REGISTRY.md', import.meta.url)

type RegistryRow = {
    name: string
    signature: string | undefined
    section: string
}

function cells(line: string): string[] {
    const out: string[] = []
    // A cell ends at the first UNESCAPED pipe — a type signature carries `\|`.
    let start = 1
    for (let at = 1; at <= line.length; at += 1) {
        if (at < line.length && !(line[at] === '|' && line[at - 1] !== '\\'))
            continue
        out.push(line.slice(start, at).trim().replaceAll('\\|', '|'))
        start = at + 1
    }
    return out
}

// Every name in the FIRST column of a REGISTRY table is a capability or a variant an app
// author can reach. This reads REGISTRY.md rather than a copied list, so a capability
// added there fails the tests below until a page claims it.
//
// Only a `Name | (Type) Signature | …` table carries a SIGNATURE. The others — file
// conventions, CLI commands, generated headers — put prose in the second cell, and
// reading that as a signature is what would make one capability restated in two tables
// look like two capabilities that disagree.
async function registryRows(): Promise<RegistryRow[]> {
    const rows: RegistryRow[] = []
    let section = ''
    let signed = false
    for (const line of (await Bun.file(REGISTRY).text()).split('\n')) {
        // The QUALIFIER is the nearest `##`, trimmed to its first code span:
        // "## `memo` — the loaded value" is `memo`.
        if (line.startsWith('## ')) {
            const heading = line.slice(3).trim()
            section = /`([^`]+)`/.exec(heading)?.[1] ?? heading
            continue
        }
        if (line.startsWith('# ')) section = line.slice(2).trim()
        // A header row, never the `| --- |` separator under it — which would reset this
        // to false before the table's own rows are read.
        if (
            line.startsWith('| ') &&
            !line.startsWith('| `') &&
            !line.startsWith('| ---')
        ) {
            signed = /^(Type )?Signature$/.test(cells(line)[1] ?? '')
            continue
        }
        if (!line.startsWith('| `')) continue
        const row = cells(line)
        if (row[0] === undefined) continue
        rows.push({
            name: row[0],
            signature: signed ? (row[1] ?? '') : undefined,
            section,
        })
    }
    return rows
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

async function specSections(): Promise<
    Map<string, Map<string, string | undefined>>
> {
    const sections = new Map<string, Map<string, string | undefined>>()
    for (const { name, signature, section } of await registryRows()) {
        const seen = sections.get(name) ?? new Map<string, string | undefined>()
        if (!seen.has(section) || signature !== undefined)
            seen.set(section, signature)
        sections.set(name, seen)
    }
    return sections
}

async function specCapabilities(): Promise<string[]> {
    const keys = new Set<string>()
    for (const [name, seen] of await specSections()) {
        if (seen.size < 2 || RESTATED.has(name)) keys.add(name)
        else for (const section of seen.keys()) keys.add(`${section} › ${name}`)
    }
    return [...keys]
}

// A restatement that stopped matching is not a restatement. `onConfig` was written down
// twice with two different options bags, and both read as authoritative — the drift is
// invisible unless the two are compared, which nothing did.
test('a restated capability is restated identically', async () => {
    const drifted: string[] = []
    for (const [name, seen] of await specSections()) {
        if (!RESTATED.has(name)) continue
        const signatures = [...seen.values()].filter((one) => one !== undefined)
        if (new Set(signatures).size > 1) drifted.push(name)
    }
    expect(drifted).toEqual([])
})

// THIS GATE USED TO PASS ON AN EMPTY FILE: a stub — title and intent decided, prose not written —
// satisfied it exactly as a written page did. 40.2 asks for a name documented against real `.abide`
// and `.ts` files, and a list of names in `SITE` is not that. So a stub's claims do not count, and
// the uncovered set is a RATCHET: written down here, asserted exactly, shrinking only.
const UNWRITTEN: string[] = []

test('every registry capability is covered by a guide that is written', async () => {
    const covered = new Set<string>()
    for (const page of await docsPages()) {
        if (page.stub) continue
        for (const name of page.covers ?? []) covered.add(name)
    }
    const uncovered = (await specCapabilities())
        .filter((name) => !covered.has(name))
        .sort()
    expect(uncovered).toEqual([...UNWRITTEN].sort())
})

// The stub half of the same join: a stub still CLAIMS its names, so nothing falls between the two.
test('every unwritten capability is claimed by some stub', async () => {
    const claimed = new Set<string>()
    for (const page of await docsPages()) {
        if (!page.stub) continue
        for (const name of page.covers ?? []) claimed.add(name)
    }
    expect(UNWRITTEN.filter((name) => !claimed.has(name))).toEqual([])
})

test('nothing claims to cover a capability the registry does not have', async () => {
    const capabilities = new Set(await specCapabilities())
    const unknown: string[] = []
    for (const page of await docsPages())
        for (const name of page.covers ?? [])
            if (!capabilities.has(name)) unknown.push(`${page.route}: ${name}`)
    expect(unknown).toEqual([])
})

// A page nobody can reach is a page nobody reads, and a `SITE` entry with no page renders nothing.
test('every docs page is in SITE, and every SITE entry has its page', async () => {
    const listed = new Set<string>()
    for (const page of await docsPages()) listed.add(page.file)
    // A document is listed by the reference tab instead.
    for (const document of DOCUMENTS.pages)
        listed.add(pageFileOf(document.route))
    const orphans: string[] = []
    for (const path of new Bun.Glob('src/**/index.abide').scanSync({
        cwd: DOGFOOD,
    }))
        if (
            !listed.has(path) &&
            // An instrument is a page with no siblings to list it beside.
            sidebarGroupsOf(
                path.slice('src'.length, -'/index.abide'.length) || '/',
            ).length !== 0
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

// 40.34 — A CARD RENDERS A COMPONENT FROM THE `lib` BESIDE ITS PAGE, so the example a reader finds
// beside a page is the one that page teaches, and a `.abide` directly beside it would be a page of
// its own (23.21).
// THE REVERT: import `ContactCard` from another page's `lib`, and `package-component` is named.
test('every card renders a component in the lib beside its page', async () => {
    const strays: string[] = []
    for (const card of await allCards()) {
        const lib = `${dirname(pageFileOf(card.route))}/lib/`
        if (!card.component.startsWith(lib))
            strays.push(`${card.id}: ${card.component}`)
    }
    expect(strays).toEqual([])
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

// 40.20 — ONE TEACHING PAGE PER EXAMPLE. A component taught from two pages is code one of those
// readers was never shown running. `covers` is the discriminant (40.11): an overview carries a
// section's opening example and teaches no name in it.
test('an example component is taught by exactly one page', async () => {
    const pagesFor = new Map<string, string[]>()
    for (const page of await docsPages()) {
        if (!page.covers?.length) continue
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

// 40.21, 40.22 — A PAGE'S EXAMPLES ARE DRAWN FROM ONE APP THE BRAND NAMES, declared once on its
// `SITE` entry. A page with a card and no app is a page whose examples answer to nothing.
test('every page with an example declares the app it is drawn from', async () => {
    const undeclared: string[] = []
    for (const page of await docsPages())
        if (cardsOf(page).length > 0 && page.app === undefined)
            undeclared.push(page.route)
    expect(undeclared).toEqual([])
})

// 40.17, 40.37, 40.38 — A TEACHING PAGE RUNS WHAT IT TEACHES, or its `SITE` entry says why nothing can: a
// command run in a terminal, or a deployment's setting. An overview routes and a reference page
// enumerates (40.11), so neither is held to it. A `cardless` page that grew a card is a stale mark.
// THE REVERT: drop the card from `/pages/add-a-page`, and the page is named.
test('every teaching page embeds an example, or is marked cardless', async () => {
    const overviews = new Set<string>()
    for (const group of SITE) overviews.add(group.pages[0]?.route ?? '')
    const missing: string[] = []
    const stale: string[] = []
    for (const page of await docsPages()) {
        if (overviews.has(page.route) || page.route.startsWith('/reference'))
            continue
        const cards = cardsOf(page).length
        if (cards === 0 && page.cardless === undefined && !page.stub)
            missing.push(page.route)
        if (cards > 0 && page.cardless !== undefined) stale.push(page.route)
    }
    expect({ missing, stale }).toEqual({ missing: [], stale: [] })
})

// 40.27 — a card follows its heading with nothing between them. A paragraph there is a fourth voice
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

// BRAND, "Documentation structure": the main overview shows one section per area, each through that
// area's own lead (`<Lead of="…"/>`), so the words have one home. A section added to `SITE` and not
// to the overview is what makes the home page stop being a map, and the drift is silent.
test('every section shows its opening on the main overview', async () => {
    const home = (await docsPages()).find((page) => page.route === '/')
    const shown = new Set<string>()
    for (const [, route] of home?.source.matchAll(/<Lead of="([^"]+)"/g) ?? [])
        shown.add(route as string)
    const missing: string[] = []
    for (const group of SITE) {
        const first = group.pages[0]?.route ?? ''
        if (first !== '/' && !shown.has(first))
            missing.push(`${group.section} (${first})`)
    }
    expect(missing).toEqual([])
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

async function declaredTypes(): Promise<Set<string>> {
    const declared = new Set<string>()
    for (const line of (await Bun.file(REGISTRY).text()).split('\n')) {
        const heading = /^#{1,4}\s+`?([A-Za-z_$][\w$]*)/.exec(line)
        if (heading?.[1]) declared.add(heading[1])
        // A fenced `type X = …`, which is where the adoption unwrap is spelled out.
        const alias = /^type\s+([A-Za-z_$][\w$]*)/.exec(line)
        if (alias?.[1]) declared.add(alias[1])
    }
    for (const { name, signature } of await registryRows()) {
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
    const declared = await declaredTypes()
    const dangling: string[] = []
    for (const { name, signature } of await registryRows()) {
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

// A capability claimed by two pages is a capability neither page owns.
test('each capability is claimed by exactly one page', async () => {
    const claims = new Map<string, string[]>()
    for (const page of await docsPages())
        for (const name of page.covers ?? [])
            claims.set(name, [...(claims.get(name) ?? []), page.route])
    const shared: string[] = []
    for (const [name, routes] of claims)
        if (routes.length > 1) shared.push(`${name}: ${routes.join(', ')}`)
    expect(shared).toEqual([])
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

// 40.11 — an overview or a reference page declares no `covers`: a claim from the wrong page is
// invisible to every coverage gate above, which any claim satisfies.
test('no overview or reference page declares covers', async () => {
    const offenders: string[] = []
    for (const group of SITE)
        for (const [index, page] of group.pages.entries())
            if (
                (index === 0 || page.route.startsWith('/reference')) &&
                (page.covers?.length ?? 0) > 0
            )
                offenders.push(page.route)
    expect(offenders).toEqual([])
})

// docs/BRAND.md: a link standing in for a page is read as that page's label, so a RENAME has two
// halves and only one is in the page renamed. A link to an overview is labeled with the SECTION; a
// CODE label names an API and the link is where to read about it.
test('a link is labeled with the nav of the page it points at', async () => {
    const pages = await docsPages()
    const navOf = new Map<string, string>()
    const sectionOf = new Map<string, string>()
    for (const group of SITE)
        for (const [index, page] of group.pages.entries()) {
            navOf.set(page.route, page.nav)
            if (index === 0) sectionOf.set(page.route, group.section)
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
            if (label !== nav && label !== sectionOf.get(linked))
                stale.push(
                    `${route}: "${label}" -> ${linked}, whose nav is "${nav}"`,
                )
        }
    expect(pages.length).toBeGreaterThan(0)
    expect(stale).toEqual([])
})

// A sample renders in `main`'s column, and past the formatter's line width it is a thing to scroll
// rather than a thing to read. THE WIDTH IS READ FROM THE FORMATTER rather than restated, so the two
// cannot disagree; biome formats no `.abide`, so this is what holds an example's own file to it.
const COLUMN: number = (
    await Bun.file(new URL('../../../biome.json', import.meta.url)).json()
).formatter.lineWidth

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

// 40.29: a comment in an example's own source fits on one line, and a longer reason goes in the copy
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

// A REFERENCE PAGE THAT ENUMERATES ITS SECTION EXCEPT FOR ONE NAME reads as complete — a reader who
// does not find `s.peek` concludes there is no such thing. The UNION of the pages claiming a section
// is what is checked: `Reactive` and `reactive` split one registry section between two pages.
test('every name a reference page enumerates is on one of the pages that claim it', async () => {
    const registry = await Bun.file(REGISTRY).text()
    const bySection = new Map<string, string[]>()
    let section = ''
    for (const line of registry.split('\n')) {
        if (line.startsWith('## ')) {
            const heading = line.slice(3).trim()
            section = /`([^`]+)`/.exec(heading)?.[1] ?? heading
            continue
        }
        if (line.startsWith('# ')) section = line.slice(2).trim()
        if (!line.startsWith('| `')) continue
        const name = /`([^`]+)`/.exec(line)?.[1] ?? ''
        if (name)
            bySection.set(section, [...(bySection.get(section) ?? []), name])
    }
    const bodies = await renderedMarkdown()
    const claimed = new Map<string, string[]>()
    for (const page of await docsPages())
        for (const name of page.enumerates ?? [])
            claimed.set(name, [
                ...(claimed.get(name) ?? []),
                bodies.get(page.route) ?? '',
            ])
    const absent: string[] = []
    for (const [name, texts] of claimed) {
        const names = bySection.get(name)
        if (!names) {
            absent.push(`no REGISTRY section named ${name}`)
            continue
        }
        for (const row of names)
            if (!texts.some((text) => text.includes(`\`${row}\``)))
                absent.push(`${name}: ${row}`)
    }
    expect(absent).toEqual([])
})

// A REFERENCE PAGE THAT RESTATES A SIGNATURE IS A SECOND COPY OF IT, and a reader writes code
// against the copy. An OVERLOAD has two signatures in one section, so a restatement matches ONE.
test('every signature a reference page restates matches REGISTRY', async () => {
    const bySection = new Map<string, Map<string, string[]>>()
    for (const { name, signature, section } of await registryRows()) {
        if (signature === undefined || signature === '') continue
        const names = bySection.get(section) ?? new Map<string, string[]>()
        names.set(name, [...(names.get(name) ?? []), signature])
        bySection.set(section, names)
    }
    const bodies = await renderedMarkdown()
    const drifted: string[] = []
    for (const page of await docsPages())
        for (const section of page.enumerates ?? []) {
            const names = bySection.get(section)
            if (!names) continue
            for (const line of (bodies.get(page.route) ?? '').split('\n')) {
                if (!line.startsWith('| `')) continue
                const row = cells(line)
                const name = row[0] ?? ''
                const signature = row[1] ?? ''
                const declared = names.get(name)
                if (declared === undefined || signature === '') continue
                if (declared.includes(signature)) continue
                drifted.push(
                    `${page.route}: ${name}\n  page:     ${signature}\n  REGISTRY: ${declared.join('\n            ')}`,
                )
            }
        }
    expect(drifted).toEqual([])
})
