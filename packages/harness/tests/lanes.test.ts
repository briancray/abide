import { expect, test } from 'bun:test'

test('the DOM preload ran', () => {
    expect(typeof document).toBe('object')
    expect(document.createElement('div').nodeName).toBe('DIV')
})

test('every lane entry resolves', async () => {
    await expect(import('@abide/harness/measure')).resolves.toBeDefined()
    await expect(import('@abide/harness/engine')).resolves.toBeDefined()
    await expect(import('@abide/harness/server')).resolves.toBeDefined()
})

// THREE LANES AND THE ENTRIES THAT ARE NOT LANES. A lane is a DEPENDENCY partition —
// `measure` needs nothing, `engine` needs CDP, `server` needs `bun:jsc` — and that is
// one reason the harness is a package. `report` depends on nothing at all, `gate` on
// `bun:test`, `rows` on nothing and `runner` on bun, so none is a fourth question; they
// are named here so the next reader counting entries does not go looking for one.
// `preload` is an entry too, and registers a DOM as it loads, which this process has.
test('the entries that are not lanes resolve too', async () => {
    await expect(import('@abide/harness/report')).resolves.toBeDefined()
    await expect(import('@abide/harness/gate')).resolves.toBeDefined()
    await expect(import('@abide/harness/rows')).resolves.toBeDefined()
    await expect(import('@abide/harness/runner')).resolves.toBeDefined()
})

// THE HARNESS MEASURES ANYTHING, so nothing it ships may reach the thing it is measuring here. An
// edge into abide would not break a test: every number would still be produced, and every ratio
// would be measuring one arm against itself — and an edge into the docs app or the bridge is the
// harness learning this repo's subjects, which is what made it unusable outside it.
//
// This walks the graph by RESOLUTION rather than by bundling, and the reason is that the two
// previous spellings each passed with an abide edge planted in them. `Bun.build` with
// `external: ['*']` bundles nothing, so the output is the entry's own text and an edge one module
// deep never appears — verified: 3 pass, 0 fail with `import '@abide/abide'` in a sibling module. Reading
// the sourcemap's `sources` instead fixes that and then misses abide specifically, because
// `src/shared/index.ts` is `export {}` and an empty module contributes no mappings to bundle. So:
// resolve every specifier from every file reached, and report each that lands in a subject
// package. An empty module still has a PATH. A dependency under `node_modules` is not read: one
// that reaches a workspace package resolves through its symlink to the package's real path first.
const IMPORT_SCANNER = new Bun.Transpiler({ loader: 'ts' })
const SUBJECTS = /\/packages\/(?:abide|dogfood|bridge)\//

async function subjectsInGraphOf(entry: string): Promise<string[]> {
    const seen = new Set<string>()
    const found: string[] = []
    const queue = [entry]
    while (queue.length > 0) {
        const file = queue.pop() as string
        if (seen.has(file)) continue
        seen.add(file)
        if (SUBJECTS.test(file)) {
            found.push(file)
            continue
        }
        if (file.includes('/node_modules/')) continue
        let code: string
        try {
            code = await Bun.file(file).text()
        } catch {
            continue // a bare specifier that resolved to something unreadable is not an edge
        }
        const directory = file.slice(0, file.lastIndexOf('/'))
        // A command's shebang (`harness-bench`) is not TypeScript, and the scanner throws on it.
        for (const imported of IMPORT_SCANNER.scanImports(
            code.replace(/^#!.*/, ''),
        )) {
            try {
                queue.push(Bun.resolveSync(imported.path, directory))
            } catch {
                // unresolvable here is a typecheck problem, not this test's
            }
        }
    }
    return found
}

const HARNESS = Bun.fileURLToPath(new URL('../', import.meta.url))

// THE ONE EDGE, NAMED: `@abide/harness/abide` is the built-in adapter for an abide app, and the
// only module allowed to reach abide — every file the walk finds reaching a subject package is in
// `src/abide/`, and none reaches the docs app or the bridge at all. A lane importing the adapter
// would carry abide in with it, so the walk from every other file is what this checks.
test('nothing the harness ships reaches a package it measures, save the abide adapter', async () => {
    const found: string[] = []
    for (const pattern of ['src/**/*.ts', 'scripts/**/*.ts'])
        for (const file of new Bun.Glob(pattern).scanSync({ cwd: HARNESS }))
            for (const subject of await subjectsInGraphOf(`${HARNESS}${file}`))
                if (
                    !file.startsWith('src/abide/') ||
                    !subject.includes('/packages/abide/')
                )
                    found.push(`${file} -> ${subject}`)
    expect(found).toEqual([])
})

// The gate above is only worth what it catches, so this asserts it catches something — and
// catches it by FOLLOWING EDGES, which is the part an entry inside a subject package cannot
// show: it is recorded on the first pop with no import read. So the start is a module that does
// not import abide itself and reaches it one module down, written where nothing ships it.
// Reverted — the walker records the entry and follows nothing — `found` is [] and this fails.
test('the graph walk finds abide when abide is there', async () => {
    const directory = Bun.fileURLToPath(
        new URL('../../../.test-modules/lane-walk/', import.meta.url),
    )
    await Bun.write(`${directory}middle.ts`, "import '@abide/abide'\n")
    await Bun.write(`${directory}entry.ts`, "import './middle.ts'\n")
    const found = await subjectsInGraphOf(`${directory}entry.ts`)
    expect(found.length).toBeGreaterThan(0)
    expect(found[0]).toContain('/packages/abide/')
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
