import { expect, test } from 'bun:test'
import { readPages } from '../scripts/buildDocs.ts'
import { NAV } from '../scripts/NAV.ts'
import { EXAMPLE } from '../scripts/renderMarkdown.ts'

const SPEC = new URL('../../../docs/SPEC.md', import.meta.url)
const CONTENT_DIR = new URL('../content/', import.meta.url)

// Every name in the FIRST column of a SPEC table is a capability or a variant an app
// author can reach. The docs' contract is that a problem-oriented guide covers each
// one — this reads the SPEC rather than a copied list, so a capability added there
// fails here until a page claims it.
async function specCapabilities(): Promise<string[]> {
    const names = new Set<string>()
    for (const line of (await Bun.file(SPEC).text()).split('\n')) {
        if (!line.startsWith('| `')) continue
        // The cell ends at the first UNESCAPED pipe — a type signature carries `\\|`.
        let end = 1
        while (end < line.length && !(line[end] === '|' && line[end - 1] !== '\\')) end += 1
        const cell = line.slice(1, end).trim().replaceAll('\\|', '|')
        if (cell !== 'Name') names.add(cell)
    }
    return [...names]
}

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
test('every embedded example exists, and every example is embedded', async () => {
    const embedded = new Set<string>()
    for (const path of new Bun.Glob('**/*.md').scanSync({ cwd: CONTENT_DIR.pathname })) {
        const source = await Bun.file(new URL(path, CONTENT_DIR)).text()
        for (const match of source.matchAll(new RegExp(EXAMPLE.source, 'gm')))
            embedded.add(match[1] ?? '')
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
        for (const match of page.body.matchAll(new RegExp(EXAMPLE.source, 'gm')))
            embedded.push(`${EXAMPLES_PREFIX}${match[1]}`)
        if (page.examples.join() !== [...new Set(embedded)].join())
            wrong.push(
                `${page.slug}: front matter ${page.examples.join()}, body ${embedded.join()}`,
            )
    }
    expect(wrong).toEqual([])
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
