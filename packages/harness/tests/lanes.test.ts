import { expect, test } from 'bun:test'

test('the DOM preload ran', () => {
    expect(typeof document).toBe('object')
    expect(document.createElement('div').nodeName).toBe('DIV')
})

test('every lane entry resolves', async () => {
    await expect(import('harness/measure')).resolves.toBeDefined()
    await expect(import('harness/engine')).resolves.toBeDefined()
    await expect(import('harness/server')).resolves.toBeDefined()
})

// CLAUDE.md, "seams and imports": `harness/measure` has no abide in its graph at all, and that is
// the whole reason the harness is a PACKAGE rather than a folder inside the framework — it is what
// lets the hand-written arm of a ratio be timed by the same clock and the same batch sizing as the
// abide arm. An import that crept in would not break a test: every number would still be produced,
// and every ratio in the repo would be measuring one arm against itself.
//
// This walks the graph by RESOLUTION rather than by bundling, and the reason is that the two
// previous spellings each passed with an abide edge planted in them. `Bun.build` with
// `external: ['*']` bundles nothing, so the output is the entry's own text and an edge one module
// deep never appears — verified: 3 pass, 0 fail with `import 'abide'` in a sibling module. Reading
// the sourcemap's `sources` instead fixes that and then misses abide specifically, because
// `src/shared/index.ts` is `export {}` and an empty module contributes no mappings to bundle. So:
// resolve every specifier from every file reached, and report the first that lands inside
// `packages/abide/`. An empty module still has a PATH.
const IMPORT_SCANNER = new Bun.Transpiler({ loader: 'ts' })

async function abideInGraphOf(entry: string): Promise<string[]> {
    const seen = new Set<string>()
    const found: string[] = []
    const queue = [entry]
    while (queue.length > 0) {
        const file = queue.pop() as string
        if (seen.has(file)) continue
        seen.add(file)
        if (file.includes('/packages/abide/')) {
            found.push(file)
            continue
        }
        let code: string
        try {
            code = await Bun.file(file).text()
        } catch {
            continue // a bare specifier that resolved to something unreadable is not an abide edge
        }
        const directory = file.slice(0, file.lastIndexOf('/'))
        for (const imported of IMPORT_SCANNER.scanImports(code)) {
            try {
                queue.push(Bun.resolveSync(imported.path, directory))
            } catch {
                // unresolvable here is a typecheck problem, not this test's
            }
        }
    }
    return found
}

test('the measure lane has no abide in its graph', async () => {
    const entry = new URL('../src/measure/index.ts', import.meta.url).pathname
    const found = await abideInGraphOf(entry)
    expect(found).toEqual([])
})

// The gate above is only worth what it catches, so this asserts it catches something: the same walk
// over the FRAMEWORK's own entry must find abide. A walker that silently returned [] for every
// input would pass the test above forever.
test('the graph walk finds abide when abide is there', async () => {
    const entry = new URL('../../abide/src/ui/index.ts', import.meta.url)
        .pathname
    const found = await abideInGraphOf(entry)
    expect(
        found.length > 0 ||
            (await Bun.file(entry).text()).trim() === 'export {}',
    ).toBe(true)
})
