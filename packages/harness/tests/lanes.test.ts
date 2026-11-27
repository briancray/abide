import { expect, test } from 'bun:test'

test('the DOM preload ran', () => {
    expect(typeof document).toBe('object')
    expect(document.createElement('div').nodeName).toBe('DIV')
})

// THREE LANES AND THE ENTRIES THAT ARE NOT LANES, read off the `exports` map rather than listed — a
// list beside the map is a second copy, and the one this replaced named seven of ten. A lane is a
// DEPENDENCY partition — `measure` needs nothing, `engine` needs CDP, `server` needs `bun:jsc` — and
// that is one reason the harness is a package. `report` depends on nothing at all, `gate` on
// `bun:test`, `rows` on nothing and `runner` on bun, so none is a fourth question. `preload`
// registers a DOM as it loads, which this process has. `abide/preload` is left out: it builds the
// app it is preloaded into, and this package is none.
test('every entry the exports map names resolves', async () => {
    const manifest = (await Bun.file(
        new URL('../package.json', import.meta.url),
    ).json()) as { exports: Record<string, string> }
    const unresolved: string[] = []
    for (const entry of Object.keys(manifest.exports)) {
        if (entry === './package.json' || entry === './abide/preload') continue
        try {
            await import(`@abide/harness${entry.slice(1)}`)
        } catch {
            unresolved.push(entry)
        }
    }
    expect(unresolved).toEqual([])
})

// 43.15 — NO COUNTER OF CALLS: `bun:test`'s `spyOn` is one already, with its own restore, and a second
// spelling here would be a rename with a worse one. THE REVERT: export a `calls` from any entry; it
// is named here.
test('no entry the harness ships exports a counter of calls — 43.15', async () => {
    const manifest = (await Bun.file(
        new URL('../package.json', import.meta.url),
    ).json()) as { exports: Record<string, string> }
    const counters: string[] = []
    for (const entry of Object.keys(manifest.exports)) {
        if (entry === './package.json' || entry === './abide/preload') continue
        const module = (await import(
            `@abide/harness${entry.slice(1)}`
        )) as Record<string, unknown>
        for (const name of Object.keys(module))
            if (/^calls?$|^countCalls$|^callCount$/i.test(name))
                counters.push(`${entry}: ${name}`)
    }
    expect(counters).toEqual([])
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

/**
 * Every file the import graph from `entry` reaches where `stop` holds — recorded, and not followed —
 * and, where `unresolved` is given, each specifier that resolves to nothing.
 */
async function stopsInGraphOf(
    entry: string,
    stop: (file: string) => boolean,
    unresolved?: (specifier: string) => void,
): Promise<string[]> {
    const seen = new Set<string>()
    const found: string[] = []
    const queue = [entry]
    while (queue.length > 0) {
        const file = queue.pop() as string
        if (seen.has(file)) continue
        seen.add(file)
        if (stop(file)) {
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
                unresolved?.(imported.path)
            }
        }
    }
    return found
}

const subjectsInGraphOf = (entry: string): Promise<string[]> =>
    stopsInGraphOf(entry, (file) => SUBJECTS.test(file))

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
    // A bare specifier that does not resolve from here is a typecheck problem, and it is also not a
    // dependency this leaf can be said to have taken on: it counts as outside.
    const unresolved: string[] = []
    const outside = await stopsInGraphOf(
        entry,
        (file) => !file.startsWith(root),
        (specifier) => unresolved.push(specifier),
    )
    expect([...outside, ...unresolved]).toEqual([])
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
