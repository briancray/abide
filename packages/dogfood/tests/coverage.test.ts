import { expect, test } from 'bun:test'
import { readPages } from '../scripts/buildDocs.ts'
import { NAV } from '../scripts/NAV.ts'
import { EXAMPLE, LEAD, SNIPPET } from '../scripts/renderMarkdown.ts'
import { BUILTIN_TYPES } from './BUILTIN_TYPES.ts'

const SPEC = new URL('../../../docs/SPEC.md', import.meta.url)
const CONTENT_DIR = new URL('../content/', import.meta.url)

type SpecRow = { name: string; signature: string | undefined; section: string }

function cells(line: string): string[] {
    const out: string[] = []
    // A cell ends at the first UNESCAPED pipe — a type signature carries `\|`.
    let start = 1
    for (let at = 1; at <= line.length; at += 1) {
        if (at < line.length && !(line[at] === '|' && line[at - 1] !== '\\')) continue
        out.push(line.slice(start, at).trim().replaceAll('\\|', '|'))
        start = at + 1
    }
    return out
}

// Every name in the FIRST column of a SPEC table is a capability or a variant an app
// author can reach. This reads the SPEC rather than a copied list, so a capability
// added there fails the tests below until a page claims it.
//
// Only a `Name | (Type) Signature | …` table carries a SIGNATURE. The others — file
// conventions, CLI commands, generated headers — put prose in the second cell, and
// reading that as a signature is what would make one capability restated in two tables
// look like two capabilities that disagree.
async function specRows(): Promise<SpecRow[]> {
    const rows: SpecRow[] = []
    let section = ''
    let signed = false
    for (const line of (await Bun.file(SPEC).text()).split('\n')) {
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
        if (line.startsWith('| ') && !line.startsWith('| `') && !line.startsWith('| ---')) {
            signed = /^(Type )?Signature$/.test(cells(line)[1] ?? '')
            continue
        }
        if (!line.startsWith('| `')) continue
        const row = cells(line)
        if (row[0] === undefined) continue
        rows.push({ name: row[0], signature: signed ? (row[1] ?? '') : undefined, section })
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
    '`onConfig`', '`onHealth`',
    '`abide openapi [--out <file>] [--url <origin>]`', '`abide mcp [--url <origin>]`',
    '`src/ui/pages/**/page.abide`', '`src/ui/pages/**/error.abide`',
])

async function specSections(): Promise<Map<string, Map<string, string | undefined>>> {
    const sections = new Map<string, Map<string, string | undefined>>()
    for (const { name, signature, section } of await specRows()) {
        const seen = sections.get(name) ?? new Map<string, string | undefined>()
        if (!seen.has(section) || signature !== undefined) seen.set(section, signature)
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

test('every SPEC capability is covered by a guide', async () => {
    const pages = await readPages()
    const covered = new Set<string>()
    for (const page of pages) for (const name of page.covers) covered.add(name)

    const uncovered = (await specCapabilities()).filter((name) => !covered.has(name))
    expect(uncovered).toEqual([])
})

test('nothing claims to cover a capability the SPEC does not have', async () => {
    const capabilities = new Set(await specCapabilities())
    const unknown: string[] = []
    for (const page of await readPages()) {
        for (const name of page.covers)
            if (!capabilities.has(name)) unknown.push(`${page.slug}: ${name}`)
    }
    expect(unknown).toEqual([])
})

test('every content page is reachable from the nav', async () => {
    const listed = new Set<string>()
    for (const group of NAV) for (const slug of group.pages) listed.add(slug)

    const orphans: string[] = []
    for (const path of new Bun.Glob('**/*.md').scanSync({ cwd: CONTENT_DIR.pathname })) {
        const slug = path.slice(0, -'.md'.length)
        if (!listed.has(slug)) orphans.push(slug)
    }
    expect(orphans).toEqual([])
})

const EXAMPLES_DIR = new URL('../examples/', import.meta.url)

// An example is real files, so a page can reference one that does not exist and a
// directory can rot with nothing embedding it. Both are silent without this.
// A page EMBEDS an example either way it reaches one: `{% example %}` shows the whole
// directory as panels, `{% snippet %}` shows one slice of one of its files. Both make the
// page's code that directory's code, which is the property every check below is about.
function embeddedExamples(body: string): string[] {
    const names: string[] = []
    for (const match of body.matchAll(new RegExp(EXAMPLE.source, 'gm'))) names.push(match[1] ?? '')
    for (const match of body.matchAll(new RegExp(SNIPPET.source, 'gm'))) names.push(match[1] ?? '')
    return names
}

test('every embedded example exists, and every example is embedded', async () => {
    const embedded = new Set<string>()
    for (const path of new Bun.Glob('**/*.md').scanSync({ cwd: CONTENT_DIR.pathname })) {
        const source = await Bun.file(new URL(path, CONTENT_DIR)).text()
        for (const name of embeddedExamples(source)) embedded.add(name)
    }

    const onDisk = new Set<string>()
    for (const path of new Bun.Glob('*/example.json').scanSync({ cwd: EXAMPLES_DIR.pathname })) {
        onDisk.add(path.slice(0, path.indexOf('/')))
    }

    expect([...embedded].filter((name) => !onDisk.has(name))).toEqual([])
    expect([...onDisk].filter((name) => !embedded.has(name))).toEqual([])
})

// Every path an example's manifest names has to resolve, or a panel renders empty.
test('every file an example manifest names is on disk', async () => {
    const missing: string[] = []
    for (const path of new Bun.Glob('*/example.json').scanSync({ cwd: EXAMPLES_DIR.pathname })) {
        const name = path.slice(0, path.indexOf('/'))
        const manifest = await Bun.file(new URL(path, EXAMPLES_DIR)).json()
        // `tests` is results rather than paths now, so it is not a file group.
        for (const folder of ['files', 'compiled', 'vanilla'] as const) {
            for (const entry of (manifest[folder] ?? []) as string[]) {
                const file = Bun.file(new URL(`${name}/${folder}/${entry}`, EXAMPLES_DIR))
                if (!(await file.exists())) missing.push(`${name}/${folder}/${entry}`)
            }
        }
        for (const state of manifest.states as { file: string }[]) {
            const file = Bun.file(new URL(`${name}/${state.file}`, EXAMPLES_DIR))
            if (!(await file.exists())) missing.push(`${name}/${state.file}`)
        }
    }
    expect(missing).toEqual([])
})

// A heading of the form `Subject: `a`, `b`, `c`` is a GLOSSARY LABEL — BRAND names
// "Probes: `pending`, `refreshing`, `done`" as the shape a reader scans for. What makes
// it worth having is also what makes it dangerous: it reads as the whole set. The probes
// heading named four and the table under it listed six, so `streaming()` and `error()`
// were in the docs and absent from the one line a reader checks. Compared against the
// table rather than against a list here, because the table is what the section teaches.
const ENUMERATING = /^#{2,4}\s+[^:`]+:\s+((?:`[^`]+`)(?:,\s*`[^`]+`)+)\s*$/
const CELL = /^\|\s*`([^`]+)`/

// `pending` in a heading and `pending()` in a cell are one name.
function bare(name: string): string {
    return name.replace(/^s\./, '').replace(/\(\)$/, '')
}

test('a heading that enumerates names everything its table lists', async () => {
    const partial: string[] = []
    for (const page of await readPages()) {
        const lines = page.body.split('\n')
        for (let at = 0; at < lines.length; at += 1) {
            const named = ENUMERATING.exec(lines[at] ?? '')
            if (!named?.[1]) continue
            const heading = named[1].split(',').map((one) => bare(one.trim().slice(1, -1)))

            const listed: string[] = []
            for (let scan = at + 1; scan < lines.length; scan += 1) {
                const line = lines[scan] ?? ''
                if (line.startsWith('#')) break
                // The FIRST table only: a section may follow one with another about
                // something else, and reading both would compare against a union.
                if (listed.length > 0 && !line.startsWith('|')) break
                const cell = CELL.exec(line)
                if (cell?.[1]) listed.push(bare(cell[1]))
            }
            if (listed.length === 0) continue
            if (heading.join() !== listed.join())
                partial.push(`${page.slug}: "${heading.join(', ')}" vs table ${listed.join(', ')}`)
        }
    }
    expect(partial).toEqual([])
})

// docs/BRAND.md, Voice: "A heading carries its own subject." A reader arriving from the
// on-this-page list or a search result has no previous section, so a bare pronoun in a
// heading refers to nothing. Written after "Declare it" and "Call it" shipped — a check
// that only looked for a LEADING pronoun had passed over both.
const BARE_PRONOUN = /(^(it|they|this|these|those|its|their)\b|\b(it|them|this|these|those|one)$)/i

test('no heading leans on a pronoun for its subject', async () => {
    const offenders: string[] = []
    for (const page of await readPages()) {
        for (const line of page.body.split('\n')) {
            const heading = /^#{2,4}\s+(.*?)\s*$/.exec(line)
            if (heading?.[1] && BARE_PRONOUN.test(heading[1]))
                offenders.push(`${page.slug}: ${heading[1]}`)
        }
    }
    expect(offenders).toEqual([])
})

// A `.abide` file is where a state is read and written BY NAME — `count += 1`, not
// `count.set(count() + 1)`. Both spellings compile and that is deliberate, but a guide
// showing the explicit one teaches back the ceremony the file exists to remove. Where the
// explicit spelling is the SUBJECT rather than the example, it goes in a `ts` fence or an
// inline span, which is honest twice over: a `.ts` file is exactly where an author writes
// it, and nothing here has to grow an opt-out marker to say so.

// `route` and `principal` are NAMESPACES, not states (SPEC, "Reading and writing by name"),
// so `principal.set(…)` is the namespace's own method and never an unsugared write.
const NAMESPACES = new Set(['route', 'principal'])

// Every `.abide` source the docs SHIP: each `abide` fence, plus the example files on disk.
async function abideSources(): Promise<{ where: string; code: string }[]> {
    const sources: { where: string; code: string }[] = []
    for (const path of new Bun.Glob('**/*.md').scanSync({ cwd: CONTENT_DIR.pathname })) {
        const text = await Bun.file(new URL(path, CONTENT_DIR)).text()
        let ordinal = 0
        for (const match of text.matchAll(/```abide[^\n]*\n([\s\S]*?)```/g)) {
            ordinal += 1
            sources.push({ where: `${path} block ${ordinal}`, code: match[1] ?? '' })
        }
    }
    for (const path of new Bun.Glob('**/*.abide').scanSync({ cwd: EXAMPLES_DIR.pathname })) {
        sources.push({ where: path, code: await Bun.file(new URL(path, EXAMPLES_DIR)).text() })
    }
    return sources
}

// Which names in a source are states, from what the source itself says: a `state`/`memo`
// binding, a `Reactive<…>` prop, a `bind:` target, or an explicit write. A zero-argument
// call on anything else is an ordinary function — `cookies()` is one — and reading every
// `foo()` as an unsugared state read is how this gate would start failing on code it has
// no business judging. The cost is a read staying invisible where nothing else in the
// snippet names the state; the WRITE is caught unconditionally, and it is the common one.
function stateNames(code: string): Set<string> {
    const names = new Set<string>()
    for (const match of code.matchAll(
        /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:state|memo)\b/g,
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
        // A MEMBER call is a `Reactive` probe — `invoice.pending()` — so only a bare name.
        for (const match of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\.set\(/g)) {
            const name = match[1] ?? ''
            if (!NAMESPACES.has(name))
                offenders.push(`${where}: ${name}.set(v) — write \`${name} = v\``)
        }
        for (const match of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\(\)/g)) {
            const name = match[1] ?? ''
            if (states.has(name)) offenders.push(`${where}: ${name}() — read \`${name}\``)
        }
    }
    expect(offenders).toEqual([])
})

// The front matter states where a page's examples live on disk; the body embeds them by
// name. Two spellings of one fact, so they are gated equal — a page that grows an example
// and not the header reads, to an agent, as a page with no files behind it.
const EXAMPLES_PREFIX = 'packages/dogfood/examples/'
const REPO = new URL('../../../', import.meta.url)

test('front matter names exactly the example directories the page embeds', async () => {
    const wrong: string[] = []
    for (const page of await readPages()) {
        const embedded: string[] = []
        for (const name of embeddedExamples(page.body))
            embedded.push(`${EXAMPLES_PREFIX}${name}`)
        if (page.examples.join() !== [...new Set(embedded)].join())
            wrong.push(
                `${page.slug}: front matter ${page.examples.join()}, body ${embedded.join()}`,
            )
    }
    expect(wrong).toEqual([])
})

// ONE EXAMPLE PER PAGE. A page's opening example is the full coverage for that page, and
// every snippet under it is a feature OF that example — so a reader who has watched the
// thing at the top run has already seen where every line below it comes from. A second
// example on one page breaks exactly that: the snippet is real, and real somewhere the
// reader has not been. The repair is to widen the page's own example with another file,
// which costs a tab rather than a page.
test('a page embeds at most one example', async () => {
    const several: string[] = []
    for (const page of await readPages()) {
        const names = new Set(embeddedExamples(page.body))
        if (names.size > 1) several.push(`${page.slug}: ${[...names].join(', ')}`)
    }
    expect(several).toEqual([])
})

test('every example directory the front matter names is on disk', async () => {
    const missing: string[] = []
    for (const page of await readPages()) {
        for (const path of page.examples) {
            const manifest = Bun.file(new URL(`${path}/example.json`, REPO))
            if (!(await manifest.exists())) missing.push(`${page.slug}: ${path}`)
        }
    }
    expect(missing).toEqual([])
})

// BRAND, "Documentation structure": the main overview shows one section per area, each
// through that area's own `{% lead %}`, so the words have one home. A section added to NAV
// and not to the overview is what makes the home page stop being a map, and the drift is
// SILENT — both files stay valid alone. Written after Reference had gone eight sections
// without an opening. The exception is derived rather than listed: the section whose first
// page IS the overview has no separate opening to pull.
test('every nav section shows its opening on the main overview', async () => {
    const overview = await Bun.file(new URL('index.md', CONTENT_DIR)).text()
    const shown = new Set<string>()
    for (const match of overview.matchAll(new RegExp(LEAD.source, 'gm'))) shown.add(match[1] ?? '')

    const missing: string[] = []
    for (const group of NAV) {
        const first = group.pages[0] ?? ''
        if (first !== 'index' && !shown.has(first)) missing.push(`${group.section} (${first})`)
    }
    expect(missing).toEqual([])
})

// A type signature names other types, and every one has to be declared somewhere or the
// SPEC carries a name a reader cannot look up. `WireError` was used twice and declared
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
    for (const line of (await Bun.file(SPEC).text()).split('\n')) {
        const heading = /^#{1,4}\s+`?([A-Za-z_$][\w$]*)/.exec(line)
        if (heading?.[1]) declared.add(heading[1])
        // A fenced `type X = …`, which is where the adoption unwrap is spelled out.
        const alias = /^type\s+([A-Za-z_$][\w$]*)/.exec(line)
        if (alias?.[1]) declared.add(alias[1])
    }
    for (const { name, signature } of await specRows()) {
        const own = /^`?([A-Za-z_$][\w$]*)/.exec(name)?.[1]
        if (own) declared.add(own)
        // The LEADING `<…>` only, matched to its own closing angle — a default can
        // nest one (`Stored = AdoptedValue<Computed>`). Every other `<…>` is an
        // ARGUMENT list, and reading `Reactive<Params>` as DECLARING `Params` is how
        // this test would stop testing.
        for (const part of binder(signature ?? '').split(','))
            declared.add((/^\s*([A-Z][A-Za-z0-9]*)\b/.exec(part)?.[1]) ?? '')
        // A MAPPED TYPE binds its key where it uses it — `[K in RequiredNames<P>]` is the
        // same declaration a leading `<…>` makes, in the other syntax. `ParamsOf<P>` is
        // three of them, and without this the key reads as a type nothing declares.
        for (const match of (signature ?? '').matchAll(/\[\s*([A-Z][A-Za-z0-9]*)\s+in\b/g))
            declared.add(match[1] ?? '')
    }
    return declared
}

test('every type a signature names is declared somewhere', async () => {
    const declared = await declaredTypes()
    const dangling: string[] = []
    for (const { name, signature } of await specRows()) {
        for (const match of withoutLiterals(signature ?? '').matchAll(/\b([A-Z][A-Za-z0-9]*)\b/g)) {
            const type = match[1] ?? ''
            if (!BUILTIN_TYPES.has(type) && !declared.has(type)) dangling.push(`${name}: ${type}`)
        }
    }
    expect([...new Set(dangling)]).toEqual([])
})

// A capability claimed by two pages is a capability neither page owns. `transform` was
// claimed by the streaming guide for the stream join and by the form guide for the write
// refusal — two jobs, one claim, and the coverage test satisfied by either.
test('each capability is claimed by exactly one page', async () => {
    const claims = new Map<string, string[]>()
    for (const page of await readPages())
        for (const name of page.covers) claims.set(name, [...(claims.get(name) ?? []), page.slug])
    const shared = [...claims]
        .filter(([, pages]) => pages.length > 1)
        .map(([name, pages]) => `${name}: ${pages.join(', ')}`)
    expect(shared).toEqual([])
})

// docs/BRAND.md, Documentation structure: "A label stands alone." A nav label is read
// with no sentence around it, so a fragment refers to nothing — "By name" and "On change"
// wait for a noun the reader does not have.
//
// The SHAPE is a preposition and a single word, never a leading preposition alone: "On
// value change" is the repair BRAND names, so a check that banned the preposition would
// have failed the label it recommends. Narrow on purpose — "stands alone" is not
// checkable, and a fragment built another way is still a review question.
const BARE_PREPOSITIONAL = /^(on|by|in|with|for|from|at|to|of|about|after|before)\s+\S+$/i

test('no nav label begins with a preposition', async () => {
    const offenders: string[] = []
    for (const page of await readPages())
        if (BARE_PREPOSITIONAL.test(page.nav)) offenders.push(`${page.slug}: ${page.nav}`)
    expect(offenders).toEqual([])
})

// docs/SPEC.md, Documentation: an overview ROUTES and a reference page ENUMERATES, so
// neither covers. `machines/index` had grown four entries the section's topic pages
// should have owned, and nothing said so — the coverage tests above are satisfied by a
// claim from any page, which is exactly what makes the WRONG page's claim invisible.
test('no overview or reference page declares covers', async () => {
    const offenders: string[] = []
    for (const page of await readPages()) {
        const routes = page.slug.endsWith('/index') || page.slug.startsWith('reference/')
        if (routes && page.covers.length > 0) offenders.push(page.slug)
    }
    expect(offenders).toEqual([])
})

// docs/BRAND.md, Documentation structure: a nav label is what a reader scans a sidebar
// for, and a link standing in for a page is read as that label. So a RENAME has two
// halves and only one of them is in the file being renamed — "Rooms & sockets" survived
// in nine links after the page became "Sockets", and "On value change" in two.
//
// A link to a section OVERVIEW is labelled with the SECTION name, that being what a
// reader is sent to; a CODE label names an API and the link is where to read about it.
test('a link is labelled with the nav of the page it points at', async () => {
    const pages = await readPages()
    const navOf = new Map(pages.map((page) => [page.slug, page.nav]))
    const sectionOf = new Map(pages.map((page) => [page.slug, page.section]))

    const stale: string[] = []
    for (const page of pages) {
        const from = page.slug.slice(0, page.slug.lastIndexOf('/') + 1)
        for (const [, label, target] of page.body.matchAll(/\[([^\]]+)\]\(([^)]+)\.md\)/g)) {
            const slug = new URL(`${target}`, `abide:/${from}`).pathname.slice(1)
            const nav = navOf.get(slug)
            if (nav === undefined || label === undefined || label.startsWith('`')) continue
            const overview = slug.endsWith('/index') ? sectionOf.get(slug) : undefined
            if (label !== nav && label !== overview)
                stale.push(`${page.slug}: "${label}" -> ${slug}, whose nav is "${nav}"`)
        }
    }
    expect(stale).toEqual([])
})

// A fence renders in `main`'s 44rem column at `font: 400 13px/1.6 var(--mono)` — about 76
// characters before `pre`'s own `overflow-x:auto` takes over. Past that the sample is a
// thing to scroll rather than a thing to read, and the ONE line that overflows is usually
// the line the section is about: 50 of 545 did, worst at 107. Nothing else checks this —
// biome's `files.includes` is `**/*.{json,ts,js}`, so a fence is formatted by nobody, and
// the example FILES are here for the same reason: they render in the same column.
const COLUMN = 76

function overlongLines(source: string, fencedOnly: boolean): number[] {
    const over: number[] = []
    let fenced = !fencedOnly
    const lines = source.split('\n')
    for (let at = 0; at < lines.length; at += 1) {
        const line = lines[at] ?? ''
        if (fencedOnly && line.startsWith('```')) {
            fenced = !fenced
            continue
        }
        if (fenced && line.length > COLUMN) over.push(at + 1)
    }
    return over
}

test('no code sample is wider than the column it renders in', async () => {
    const wide: string[] = []
    for (const path of new Bun.Glob('**/*.md').scanSync({ cwd: CONTENT_DIR.pathname })) {
        const source = await Bun.file(new URL(path, CONTENT_DIR)).text()
        for (const line of overlongLines(source, true)) wide.push(`content/${path}:${line}`)
    }
    // An example's own files, which the panel renders at the same width.
    for (const path of new Bun.Glob('*/{files,compiled}/**/*').scanSync({
        cwd: EXAMPLES_DIR.pathname,
        onlyFiles: true,
    })) {
        const source = await Bun.file(new URL(path, EXAMPLES_DIR)).text()
        for (const line of overlongLines(source, false)) wide.push(`examples/${path}:${line}`)
    }
    expect(wide).toEqual([])
})

// docs/BRAND.md, Visual identity: the code-block spine is the one device to keep, and an
// uncaptioned fence renders without it — 46 of 87 did. The caption is a file path or one
// of the four side words; a fence with NO LANGUAGE is exempt, being a shell transcript or
// a directory tree rather than source, with no side to name.
test('every source fence carries a caption', async () => {
    const bare: string[] = []
    for (const page of await readPages()) {
        let fenced = false
        for (const line of page.body.split('\n')) {
            if (!line.startsWith('```')) continue
            if (fenced) {
                fenced = false
                continue
            }
            fenced = true
            if (line.trim() !== '```' && !/^```\S+\s+\S/.test(line))
                bare.push(`${page.slug}: ${line.trim()}`)
        }
    }
    expect(bare).toEqual([])
})
