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

// THREE LANES AND TWO ENTRIES THAT ARE NOT LANES. A lane is a DEPENDENCY partition —
// `measure` needs nothing, `engine` needs CDP, `server` needs `bun:jsc` — and that is
// the whole reason the harness is a package. `report` depends on nothing at all and
// `gate` depends on `bun:test`, so neither is a fourth question; they are named here
// so the next reader counting entries does not go looking for one. See D101.
test('the two entries that are not lanes resolve too', async () => {
    await expect(import('harness/report')).resolves.toBeDefined()
    await expect(import('harness/gate')).resolves.toBeDefined()
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

// THE LEAF IS JUSTIFIED BY ONE PROPERTY and this is it: every lane needs the record,
// the clock, the batcher and `ratio()`, in BOTH substrates, and they ship into the
// browser injectable. An import edge is priced by the module it lands on, so one
// `Bun.Glob` parked here — a LOC counter was in the first draft — would make the leaf
// bun-only and drag a glob into the module the injectable is built from.
//
// Asserted on the resolved graph rather than on the source text, for the same reason
// the abide walk above is: an edge one module deep never appears in the entry's own
// bytes.
test('the report leaf reaches nothing outside itself', async () => {
    const entry = new URL('../src/report/index.ts', import.meta.url).pathname
    const root = entry.slice(0, entry.lastIndexOf('/') + 1)
    const seen = new Set<string>()
    const outside: string[] = []
    const queue = [entry]
    while (queue.length > 0) {
        const file = queue.pop() as string
        if (seen.has(file)) continue
        seen.add(file)
        if (!file.startsWith(root)) {
            outside.push(file)
            continue
        }
        const directory = file.slice(0, file.lastIndexOf('/'))
        for (const imported of IMPORT_SCANNER.scanImports(
            await Bun.file(file).text(),
        )) {
            try {
                queue.push(Bun.resolveSync(imported.path, directory))
            } catch {
                // A bare specifier that does not resolve from here is a typecheck
                // problem, and it is also not a dependency this leaf can be said to
                // have taken on.
                outside.push(imported.path)
            }
        }
    }
    expect(outside).toEqual([])
})

// The measure lane's browser arm is the SAME BYTES, so the injectable has to build
// with a browser target and no bun in it — a `bun:jsc` or a `node:` specifier in the
// graph would not fail the walk above and would fail at document-start, where an
// error is not reported as a test failure but as a counter that reads undefined.
test('the measure lane builds for the browser', async () => {
    const built = await Bun.build({
        entrypoints: [
            new URL('../src/measure/injectable.ts', import.meta.url).pathname,
        ],
        target: 'browser',
        format: 'iife',
    })
    expect(built.logs.filter((log) => log.level === 'error')).toEqual([])
    expect(built.success).toBe(true)
    const output = await (
        built.outputs[0] as { text(): Promise<string> }
    ).text()
    expect(output).not.toContain('bun:jsc')
    expect(output).not.toContain('require("node:')
    expect(output).toContain('__HARNESS_MEASURE__')
})
