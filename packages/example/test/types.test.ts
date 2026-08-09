// Does a `.abide` file type-check the way the same TypeScript would?
//
// The POSITIVE half of that question is answered by the repo's own `bun run typecheck`: everything
// under `types/valid` compiles, and each of those files asserts the EXACT type of what it declares
// through `Exact<A, B>` — an identity check rather than an assignability one, because `any` is
// assignable to everything and would otherwise pass silently.
//
// This file is the NEGATIVE half, and it is the half that makes the other one mean anything. A green
// typecheck cannot tell "the types are right" from "the types are gone": if the desugar started
// emitting `any`, or a narrowing collapsed, or a prop stopped being checked, every file in this repo
// would still compile and every test would still pass. So each fixture under `types/invalid` is code
// that MUST be rejected, and the assertion is that the real checker rejects it — with the right code,
// on the right line of the `.abide` file the author actually wrote.
//
// This is the same argument the bench kit makes about work: a correctness test cannot guard a
// contract about HOW something is done, so the contract is asserted directly.
//
// Three of these fixtures exist because they FOUND something. `shadowing` compiled clean before the
// desugar learned what a type position is — an annotation naming a cell registered it as a binding,
// and every read after it silently stopped desugaring with nothing for `tsc` to say. `props` could
// not compile at all: the props type was inlined into the function body and named from its signature.
// `narrowing` is the pair that proves a branch type is real rather than `any`.

import { expect, test } from 'bun:test'
import { emitFor, remap } from 'abide/compiler/check'

const HERE = new URL('../types/invalid/', import.meta.url).pathname
const CONFIG = `${HERE}tsconfig.json`

/** `file(line,col): error TSxxxx: message` — tsc's one-line form, which `--pretty false` gives. */
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/

interface Reported {
    file: string
    line: number
    code: string
    message: string
    /** The position was moved back onto the `.abide`. `remap` marks the ones it could not. */
    mapped: boolean
}

/**
 * What a fixture must be told, and where.
 *
 * `template` — the position is the `.abide` line and column, exactly.
 * `script` — the position is still in the GENERATED module, and `remap` says so with `[generated]`.
 *
 * That split is a real limit rather than a detail: every expression in a template is emitted behind
 * a marker and lifted into the source map, and a `<script>` body is not — its imports are hoisted
 * and merged, so it no longer lines up with the file and there is nothing to map it by. A type error
 * in a `<script>` therefore names a line the author did not write. It is the one part of "reported on
 * the `.abide` line" that is not true, it is asserted here so it cannot quietly become true or
 * quietly get worse, and the day the mapping lands this table is what says which rows to promote.
 */
const EXPECTED: {
    fixture: string
    line: number
    code: string
    message: RegExp
    where: 'template' | 'script'
}[] = [
    // A cell read is `T | undefined` and a narrowed branch is the REAL type, so a typo inside one is
    // caught. If narrowing produced `any` this line would compile.
    {
        fixture: 'narrowing.abide',
        line: 9,
        code: 'TS2339',
        message: /'nmae' does not exist/,
        where: 'template',
    },
    // …and without the narrowing, the same read is possibly-undefined. The pair is the proof: one
    // says the branch has a type, the other says it was not simply widened away.
    {
        fixture: 'unnarrowed.abide',
        line: 9,
        code: 'TS2532',
        message: /possibly 'undefined'/,
        where: 'template',
    },
    // A write desugars to `set`, and keeps the cell's type doing it.
    {
        fixture: 'write.abide',
        line: 7,
        code: 'TS2345',
        message: /'string' is not assignable/,
        where: 'template',
    },
    // An IMPORTED type is resolved across the module boundary the compiler's own scanner cannot see
    // across — by the checker, exactly as in any `.ts` file.
    {
        fixture: 'imported.abide',
        line: 8,
        code: 'TS2339',
        message: /'nmae' does not exist/,
        where: 'template',
    },
    // A generic keeps its argument through a cell.
    {
        fixture: 'generics.abide',
        line: 10,
        code: 'TS2322',
        message: /'Paged<Book>' is not assignable/,
        where: 'script',
    },
    // A prop the component never declared. This is what the type argument to `props()` buys, and what
    // a component that never calls it — children and nothing else — cannot be told.
    {
        fixture: 'props.abide',
        line: 11,
        code: 'TS2339',
        message: /'missing' does not exist/,
        where: 'script',
    },
    // …and the half the binding spelling adds: a template can only reach a name something BOUND, so a
    // prop nobody destructured is not a silent `undefined`, it is a name that does not exist.
    {
        fixture: 'props.abide',
        line: 16,
        code: 'TS2304',
        message: /Cannot find name 'unbound'/,
        where: 'template',
    },
    // The regression that has no other guard: an annotation naming a cell must not bind it, so the
    // initialiser beside it is still a READ. Before the fix this file compiled clean.
    {
        fixture: 'shadowing.abide',
        line: 7,
        code: 'TS2322',
        message: /'number' is not assignable/,
        where: 'script',
    },
]

/** Every `.abide` under `types/invalid`, emitted, then checked through its own config in one run. */
async function reported(): Promise<Reported[]> {
    const found: string[] = []
    for await (const path of new Bun.Glob('*.abide').scan({ cwd: HERE, absolute: true })) found.push(path)
    const emitted = await Promise.all(found.map((path) => emitFor(path)))
    EMITTED = emitted

    const byModule = new Map<string, Awaited<ReturnType<typeof emitFor>>>()
    for (const item of emitted) {
        byModule.set(item.module, item)
        byModule.set(item.module.replace(`${process.cwd()}/`, ''), item)
    }

    const tsc = Bun.spawnSync(['bunx', 'tsc', '-p', CONFIG, '--noEmit', '--pretty', 'false'], {
        cwd: process.cwd(),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const output = `${tsc.stdout.toString()}${tsc.stderr.toString()}`

    const all: Reported[] = []
    for (const line of output.split('\n')) {
        // `remap` is what moves a position in the generated module back onto the `.abide` line, and
        // running the diagnostics through it here is what tests that mapping against REAL tsc output
        // rather than against a synthetic lookup.
        const moved = remap(line, byModule)
        const match = DIAGNOSTIC.exec(moved)
        if (match === null) continue
        const [, file, row, , code, message] = match as unknown as [
            string,
            string,
            string,
            string,
            string,
            string,
        ]
        all.push({ file, line: Number(row), code, message, mapped: !moved.includes('[generated]') })
    }
    return all
}

let EMITTED: Awaited<ReturnType<typeof emitFor>>[] = []
const REPORTED = await reported()

test('every emit writes the declaration a `.abide` specifier resolves through', async () => {
    // The THIRD generated file, and the one `allowArbitraryExtensions` actually looks for: a module
    // beside it is not enough, because tsc resolves `./x.abide` to `x.d.abide.ts`. `emitFor` reports
    // where it put one and nothing read that back, so a stop in writing them would have surfaced as
    // an unresolved import in somebody's app rather than as a failure in abide's own tree.
    expect(EMITTED.length).toBeGreaterThan(0)
    for (const item of EMITTED) {
        expect(item.declaration).toMatch(/\.d\.abide\.ts$/)
        expect(await Bun.file(item.declaration).exists()).toBe(true)
        // It re-exports the module beside it — which is what makes the pair one resolution.
        expect(await Bun.file(item.declaration).text()).toContain(item.module.split('/').pop() as string)
    }
})

test('every invalid fixture is rejected, and nothing else is', () => {
    // A fixture that stopped being wrong is a test that stopped testing. Counting both directions is
    // what catches one that started compiling as much as one that grew a second error.
    const files = new Set(REPORTED.map((one) => one.file.split('/').pop()))
    for (const { fixture } of EXPECTED) expect([...files]).toContain(fixture)
    expect(REPORTED.length).toBeGreaterThanOrEqual(EXPECTED.length)
})

for (const { fixture, line, code, message, where } of EXPECTED) {
    const place =
        where === 'template' ? `line ${line} of the .abide` : `line ${line} (a <script>, still generated)`
    test(`${fixture} is rejected on ${place}`, () => {
        const mine = REPORTED.filter((one) => one.file.endsWith(fixture))
        expect(mine.length).toBeGreaterThan(0)

        const matched = mine.find((one) => one.code === code && message.test(one.message))
        expect(matched, `no ${code} matching ${message} in ${JSON.stringify(mine, null, 1)}`).toBeDefined()

        // The position is the claim `segments` exists for. A template expression belongs on the line
        // the author wrote it on; a `<script>` body has no mapping, and the assertion is that it says
        // so rather than that it is right.
        expect((matched as Reported).file).toMatch(/\.abide$/)
        expect((matched as Reported).line).toBe(line)
        expect((matched as Reported).mapped).toBe(where === 'template')
    })
}
