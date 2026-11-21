// THE DOCS AGAINST THE REGISTRY, AND AGAINST THEIR OWN RULES (RULEBOOK 40): every REGISTRY section
// one export's or one construct's page, every page in the one order, and the words held to what
// docs/BRAND.md asks of a heading, a label and a code sample. The pages are read three ways —
// `SITE.ts` for what a page carries, its `index.abide` for what it writes, and the markdown the
// built app serves for what a reader reads (`docsPages.ts`).

import { beforeAll, expect, test } from 'bun:test'

import { cellsOf } from '../src/lib/cellsOf.ts'
import { registryRows } from '../src/lib/registryRows.ts'
import {
    discriminating,
    membersOf,
    shortSignature,
} from '../src/lib/shortSignature.ts'
import { SITE } from '../src/lib/SITE.ts'
import { isFramed } from '../src/lib/sitePages.ts'
import { BUILTIN_TYPES } from './BUILTIN_TYPES.ts'
import { declaredExports, scopeOf } from './declaredExports.ts'
import { docsPages, DOGFOOD, renderedMarkdown, written } from './docsPages.ts'

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

// A KEY IS NOT A TYPE: a component's render prop is a TitleCase member (`Option?: (props) => …`),
// read here by the `:` after it. THE REVERT: drop the lookahead, and `Tabs`' `Tab` is named.
test('every type a signature names is declared somewhere', async () => {
    const declared = declaredTypes()
    const dangling: string[] = []
    for (const { name, signature } of capabilities) {
        for (const match of withoutLiterals(signature ?? '').matchAll(
            /\b([A-Z][A-Za-z0-9]*)\b(?!\??:)/g,
        )) {
            const type = match[1] ?? ''
            if (!BUILTIN_TYPES.has(type) && !declared.has(type))
                dangling.push(`${name}: ${type}`)
        }
    }
    expect([...new Set(dangling)]).toEqual([])
})

// 40.5 — EVERY REGISTRY SECTION IS ONE PAGE'S: a section no page carries is rows no reader can look
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

// A page's Tests are QUOTED at their file's width: what is held to the column is what it writes.
test('no code sample is wider than the column it renders in', async () => {
    const wide: string[] = []
    for (const [route, body] of await renderedMarkdown()) {
        let fenced = false
        for (const line of written(body).split('\n')) {
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
    const scope = entry === undefined ? 'abide' : scopeOf(entry)
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

// 40.6 — EVERY REGISTRY ROW IS ON EXACTLY ONE PAGE, read off the markdown each page serves: a row on
// none is a name a reader cannot look up, and a row on two is a second copy. A row is its cells save
// the clauses, which a page lists as its Rules (40.11). A row carrying a signature is read where it is
// whole, in the page's Types (40.32), its short form above the Examples being the same row again.
// THE REVERT: drop `<Registry />` from `Doc`, and every row is named.
test('every registry row is on exactly one page', async () => {
    const key = (cells: string[]): string =>
        cells.join(' | ').replace(/\s+/g, ' ')
    const written = new Map<string, number>()
    for (const row of registryRows(registry)) {
        const cells = key(row.cells.slice(0, -1))
        written.set(cells, (written.get(cells) ?? 0) + 1)
    }
    const found = new Map<string, string[]>()
    for (const [route, body] of await renderedMarkdown()) {
        let typed = false
        let shortened = false
        for (const line of body.split('\n')) {
            if (line === '## Types') typed = true
            if (!line.startsWith('| ') || line.startsWith('| ---')) continue
            if (cellsOf(line)[0] === 'Name') {
                shortened = !typed && cellsOf(line).includes('Signature')
                continue
            }
            const cells = key(cellsOf(line))
            if (!shortened && written.has(cells))
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

/** A page's `##` headings, in the order its markdown writes them. */
function partsOf(body: string): string[] {
    const parts: string[] = []
    for (const line of body.split('\n'))
        if (line.startsWith('## ')) parts.push(line.slice(3).trim())
    return parts
}

// 40.3 — EVERY FUNCTION AND CONSTANT AN ENTRY EXPORTS HEADS A SECTION OF ITS OWN, so it is the subject
// of a page rather than a row on another's: every name a section's heading spells before its `—`.
// A type, and a class an app reads and never constructs — a row whose signature is `class …` or an
// `Error & …` — is documented on the page of what hands it back. THE REVERT: move `flushSync`'s row
// under `## \`watch\``, and `flushSync` is named.
test('every function and constant a public entry exports heads a registry section', async () => {
    const headed = new Set<string>()
    const read = new Set<string>()
    for (const row of registryRows(registry)) {
        const [names = '', entry] = row.section.split(' — ')
        const scope =
            entry === undefined || !entry.includes('@abide/')
                ? 'abide'
                : scopeOf(entry.replaceAll('`', ''))
        for (const [, name] of names.matchAll(/`([^`]+)`/g))
            headed.add(`${scope}\0${name}`)
        if (/^`(class |Error & )/.test(row.cells[1] ?? ''))
            read.add(
                `${scope}\0${/^`([^`]+)`/.exec(row.cells[0] ?? '')?.[1] ?? ''}`,
            )
    }
    const unheaded: string[] = []
    for (const { entry, scope, name, typeOnly } of await declaredExports())
        if (
            !typeOnly &&
            !headed.has(`${scope}\0${name}`) &&
            !read.has(`${scope}\0${name}`)
        )
            unheaded.push(`${entry}: ${name}`)
    expect(unheaded).toEqual([])
})

// 40.8 — A PAGE DOCUMENTING AN EXPORT IS TITLED WITH ITS NAME: a reader looking `keyLabel` up scans
// the rail and the index for `keyLabel`. THE REVERT: title `/reactive/watch` "Watching values".
test('a page documenting an export is titled with its name', () => {
    const mistitled: string[] = []
    for (const group of SITE)
        for (const page of group.pages) {
            const name = /^`[^`]+`/.exec(page.registry)?.[0]
            if (name !== undefined && !page.title.startsWith(name))
                mistitled.push(`${page.route}: ${page.title}`)
        }
    expect(mistitled).toEqual([])
})

// 40.9 — EVERY PAGE IN THE ONE ORDER, read off its markdown: a reader who has found Tests on one
// page finds it in the same place on the next. THE REVERT: render `<SeeAlso>` after `<Tests>` in
// `Doc`, and every page with both is named.
const ORDER = ['Syntax', 'Examples', 'Types', 'See also', 'Tests', 'Rules']

test('every page renders its parts in the one order', async () => {
    const disordered: string[] = []
    for (const [route, body] of await renderedMarkdown()) {
        if (route === '/') continue
        const fixed: string[] = []
        for (const part of partsOf(body))
            if (ORDER.includes(part)) fixed.push(part)
        let last = -1
        for (const part of fixed) {
            const at = ORDER.indexOf(part)
            if (at <= last) disordered.push(`${route}: ${fixed.join(', ')}`)
            last = at
        }
    }
    expect([...new Set(disordered)]).toEqual([])
})

// 40.32 — A SIGNATURE IS SHORT ABOVE THE EXAMPLES AND WHOLE IN TYPES, read off the markdown against
// REGISTRY: a reader scanning the Syntax sees the names, and the full type is one part further down.
// THE REVERT: hand `<Registry>` its `types` on both instances in `Doc`, and every page whose
// signature shortens is named for showing it in full above its Examples.
test('a signature is short above the examples and whole in Types', async () => {
    const full = new Map<string, Set<string>>()
    // Each signature's short form as its page shows it: an overload's keeps the type telling it apart.
    const overloads = new Map<string, string[]>()
    const rows = registryRows(registry)
    for (const row of rows) {
        const at = row.header.indexOf('Signature')
        const signature = row.cells[at]
        if (at < 0 || signature === undefined) continue
        const signatures = full.get(row.section) ?? new Set<string>()
        signatures.add(signature)
        full.set(row.section, signatures)
        const name = `${row.section}|${row.subsection ?? ''}|${row.cells[0]}`
        overloads.set(name, [...(overloads.get(name) ?? []), signature])
    }
    const short = new Map<string, string>()
    for (const signatures of overloads.values())
        for (const signature of signatures)
            short.set(
                signature,
                shortSignature(signature, discriminating(signatures)),
            )
    const registryOf = new Map<string, string>()
    for (const group of SITE)
        for (const page of group.pages)
            registryOf.set(page.route, page.registry)
    const wrong: string[] = []
    for (const [route, body] of await renderedMarkdown()) {
        const signatures = full.get(registryOf.get(route) ?? '')
        if (signatures === undefined) continue
        const above = body.split('\n## Examples\n')[0] ?? ''
        const types = body.split('\n## Types\n')[1]?.split('\n## ')[0] ?? ''
        for (const signature of signatures) {
            const written = signature.replaceAll('|', '\\|')
            if (!types.includes(written))
                wrong.push(`${route}: not in Types: ${signature}`)
            if (short.get(signature) !== signature && above.includes(written))
                wrong.push(`${route}: in full above Examples: ${signature}`)
        }
    }
    expect(wrong).toEqual([])
})

// 40.32 — AN OVERLOAD READS AS ITSELF: rows of one name in one table are its overloads, and a short
// form by parameter names alone reads the same for every one of them — `GET`'s nine all read
// `(handler, options?) => Rpc<…>`. So the parameter whose type tells them apart keeps it. Read off
// each page's tables above its Examples, as a reader sees them. THE REVERT: pass no `typed` to
// `shortSignature` in `Registry.abide`'s `cellsShown`, and `/transports/get` is named.
test('no two overloads of a name read the same in a short form', async () => {
    const same: string[] = []
    for (const [route, body] of await renderedMarkdown()) {
        const above = body.split('\n## Examples\n')[0] ?? ''
        for (const table of above.split(/\n(?!\|)/)) {
            const seen = new Set<string>()
            for (const line of table.split('\n')) {
                const cells = line.split(' | ')
                if (!line.startsWith('| `') || cells.length < 3) continue
                const shown = `${cells[0]} | ${cells[1]}`
                if (seen.has(shown)) same.push(`${route}: ${shown}`)
                seen.add(shown)
            }
        }
    }
    expect([...new Set(same)]).toEqual([])
})

// 40.32 — THE SYNTAX IS WHAT IS CALLED: a type directly under the section — a capitalized name the
// page does not document — is in Types alone, so the Syntax a reader scans is the page's name and what
// they call. Read off each page's first part, with types named here rather than by `inSyntax`, which
// is what is under test. THE REVERT: return `true` from `inSyntax`, and every page declaring a type
// is named.
test('the syntax shows what is called, a type being in Types alone', async () => {
    const typesOf = new Map<string, string[]>()
    for (const row of registryRows(registry)) {
        const name = row.cells[0] ?? ''
        const declared = /^`([A-Z][a-z]\w*)`$/.exec(name)?.[1]
        if (!row.header.includes('Signature') || row.subsection !== undefined)
            continue
        if (declared === undefined || row.section.includes(`\`${declared}\``))
            continue
        typesOf.set(row.section, [...(typesOf.get(row.section) ?? []), name])
    }
    const registryOf = new Map<string, string>()
    for (const group of SITE)
        for (const page of group.pages)
            registryOf.set(page.route, page.registry)
    const wrong: string[] = []
    for (const [route, body] of await renderedMarkdown()) {
        const syntax = body.split('\n## Syntax\n')[1]?.split('\n## ')[0] ?? ''
        for (const name of typesOf.get(registryOf.get(route) ?? '') ?? [])
            if (syntax.includes(`\n| ${name} |`))
                wrong.push(`${route}: ${name}`)
    }
    expect(wrong).toEqual([])
})

// 40.33 — AN OBJECT A CALL TAKES IS SPELLED OUT UNDER ITS SYNTAX, a row per member, so a reader of
// `(options) => DialogParts` sees what `options` holds without leaving the Syntax. Read off the
// markdown above the Examples, with the expected members named here. THE REVERT: drop the
// `{#for option of optioned.get(table) ?? []}` block from `Registry.abide`, and both pages are named.
test("an object a page's call takes is spelled out beneath its syntax", async () => {
    const expected: [string, string, string[]][] = [
        [
            '/helpers/dialog',
            '`options?: DialogOptions`',
            ['`open?`', '`modal?`', '`dismissible?`', '`onclose?`'],
        ],
        ['/helpers/tree', '`options: TreeOptions`', ['`children`', '`key?`']],
        // An intersection: `Omit<PopoverOptions, 'side'> & { side?; delay? }`, a row of another section.
        [
            '/components/tooltip',
            '`options?: TooltipOptions`',
            ['`margin?`', '`side?`', '`delay?`'],
        ],
    ]
    const pages = await renderedMarkdown()
    const wrong: string[] = []
    for (const [route, heading, members] of expected) {
        const above = pages.get(route)?.split('\n## Examples\n')[0] ?? ''
        const part = above.split(`\n### ${heading}\n`)[1] ?? ''
        for (const member of members)
            if (!part.includes(`\n| ${member} | `))
                wrong.push(`${route}: ${heading} ${member}`)
    }
    expect(wrong).toEqual([])
})

// 40.12 — EVERY PAGE SHOWS ITS SUBJECT IN USE: an Examples part with at least one example under a
// heading of its own. THE REVERT: empty `/reactive/watch`'s slot, and it is named.
test('every page carries at least one example', async () => {
    const bare: string[] = []
    for (const [route, body] of await renderedMarkdown()) {
        if (route === '/') continue
        const examples =
            body.split('\n## Examples\n')[1]?.split('\n## ')[0] ?? ''
        if (!/^### /m.test(examples) || !/^```/m.test(examples))
            bare.push(route)
    }
    expect(bare).toEqual([])
})

// 40.11 — A PAGE'S RULES ARE EVERY CLAUSE ITS ROWS CITE, read off the markdown against REGISTRY: a
// clause a row cites and the page leaves out is a rule its reader is never shown.
// THE REVERT: list only the first clause of each row in `clausesOf`, and pages are named.
test("a page's rules are every clause its rows cite", async () => {
    const cited = new Map<string, Set<string>>()
    for (const row of registryRows(registry)) {
        const ids = cited.get(row.section) ?? new Set<string>()
        for (const id of (row.cells.at(-1) ?? '').split(','))
            if (/^\d+\.\d+$/.test(id.trim())) ids.add(id.trim())
        cited.set(row.section, ids)
    }
    const registryOf = new Map<string, string>()
    for (const group of SITE)
        for (const page of group.pages)
            registryOf.set(page.route, page.registry)
    const wrong: string[] = []
    for (const [route, body] of await renderedMarkdown()) {
        const section = registryOf.get(route)
        if (section === undefined) continue
        const rules = body.split('\n## Rules\n')[1] ?? ''
        const listed = new Set<string>()
        for (const [, id] of rules.matchAll(/^- \[(\d+\.\d+)\]/gm))
            listed.add(id as string)
        const expected = [...(cited.get(section) ?? [])].sort()
        if ([...listed].sort().join() !== expected.join())
            wrong.push(
                `${route}: ${[...listed].length} listed, ${expected.length} cited`,
            )
    }
    expect(wrong).toEqual([])
})

// 40.33 — AN INTERSECTION'S MEMBERS ARE ONE PER NAME, and rows spelling each other resolve to none rather
// than recursing without end. THE REVERT: key the merge by the name with its `?`, and `side` is listed
// twice; drop the visited set, and the second case overflows the stack.
test('an intersection lists a member once, and rows spelling each other resolve to nothing', () => {
    const rows = new Map([
        ['A', "`{ side?: Side; align?: 'start' }`"],
        ['B', '`C & { b: number }`'],
        ['C', '`B & { c: number }`'],
    ])
    const spelledAs = (name: string) => rows.get(name)
    expect(membersOf("`Omit<A, 'align'> & { side: Side }`", spelledAs)).toEqual(
        [{ name: 'side', type: 'Side' }],
    )
    expect(membersOf('`A & { side: Side }`', spelledAs)).toEqual([
        { name: 'align?', type: "'start'" },
        { name: 'side', type: 'Side' },
    ])
    expect(membersOf('`B`', spelledAs)).toBeUndefined()
})
