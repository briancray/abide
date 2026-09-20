// EVERY `.abide` IN THE EXAMPLES, COMPILED. 69 paired examples written before the compiler
// existed, using surface the rulebook decided and nobody has implemented yet — which makes them
// the honest measure of how much of the design is real, and the only one that cannot be gamed by
// choosing a friendlier fixture.
//
// It is a RATCHET in the shape `coverage.test.ts` already uses: the files that do not compile are
// LISTED. One that starts compiling fails this test and has to be removed from the list, and one
// that stops compiling fails it too. A count alone would let a regression hide behind a fix.

import { expect, test } from 'bun:test'
import {
    emitClient,
    emitComponent,
    parseAbide,
    TypeSession,
} from 'abide/compiler'

const EXAMPLES = new URL('../examples/', import.meta.url)
const TSCONFIG = new URL('../examples/tsconfig.json', import.meta.url).pathname

// The surface these need is decided (REGISTRY) and not built. Each line is a file and the FIRST
// thing in it the compiler does not know — so the list reads as a work queue rather than a tally.
const NOT_YET = new Set<string>([
    // 32.17 — the render-time boundary. Not built.
    'try-region/files/src/ui/components/Total.abide',
    // 32.19 inside a region — the client builds a new row's markup, and a component's markup is
    // in the child's own server module. Refused rather than served with dead rows in it.
    'share-agree/files/src/ui/pages/library/page.abide',
])

const sources = [
    ...new Bun.Glob('*/files/**/*.abide').scanSync({ cwd: EXAMPLES.pathname }),
].sort()

test('every example compiles, and its output parses', async () => {
    expect(sources.length).toBeGreaterThan(50)
    const session = await TypeSession.open(TSCONFIG)
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    const broken: string[] = []

    try {
        for (const relative of sources) {
            const path = new URL(relative, EXAMPLES).pathname
            const text = await Bun.file(path).text()
            try {
                const file = parseAbide(text)
                const names = await session.reads(path, file)
                // BOTH lanes, and both have to PARSE. An emitter can produce a plausible-looking
                // string that is not a program, and only running it through a parser says so —
                // `import { n() }` looked fine in a diff and was not valid in any grammar.
                transpiler.transformSync(emitComponent(file, names))
                const client = emitClient(file, names)
                if (client !== '') transpiler.transformSync(client)
            } catch (thrown) {
                broken.push(
                    `${relative}: ${String(thrown).split('\n')[0]?.slice(0, 120)}`,
                )
            }
        }
    } finally {
        session.close()
    }

    const unexpected = broken.filter(
        (line) => !NOT_YET.has(line.slice(0, line.indexOf(':'))),
    )
    const fixed = [...NOT_YET].filter(
        (name) => !broken.some((line) => line.startsWith(`${name}:`)),
    )

    expect({ unexpected, fixed }).toEqual({ unexpected: [], fixed: [] })
})
