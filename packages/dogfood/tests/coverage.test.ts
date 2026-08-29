import { expect, test } from 'bun:test'
import { readPages } from '../scripts/buildDocs.ts'
import { NAV } from '../scripts/NAV.ts'

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
        for (const match of source.matchAll(/\{%\s*example\s+([\w-]+)\s*%\}/g))
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
