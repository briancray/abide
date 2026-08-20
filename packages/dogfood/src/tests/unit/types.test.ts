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
// This is the same argument the harness makes about work: a correctness test cannot guard a
// contract about HOW something is done, so the contract is asserted directly.
//
// Three of these fixtures exist because they FOUND something. `shadowing` compiled clean before the
// desugar learned what a type position is — an annotation naming a state registered it as a binding,
// and every read after it silently stopped desugaring with nothing for `tsc` to say. `props` could
// not compile at all: the props type was inlined into the function body and named from its signature.
// `narrowing` is the pair that proves a branch type is real rather than `any`.

import { expect, test } from 'bun:test'
import { emitFor, remap } from 'abide/compiler/check'
import { TYPES } from '#tests/PATHS.ts'

const HERE = `${TYPES}/invalid/`
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
 * `source` — the position is the `.abide` line the author wrote.
 * `import` — the statement was HOISTED to the top of the module, so it has no line here to map to,
 *   and `remap` says so with `[generated]`.
 *
 * This table used to split `template` from `script`, and every `script` row asserted a line the
 * author had not written: a template expression was marked where it was copied and a `<script>` body
 * was not marked at all. That is gone — a body carries one segment per LINE, which is what its
 * transforms preserve — so the rows that documented the limit now assert the line instead. The one
 * that cannot is `moved.abide`, whose error is ON an import: an import really does move to the top,
 * so a position for it in the body would be a line the statement no longer occupies.
 */
const EXPECTED: {
    fixture: string
    line: number
    code: string
    message: RegExp
    where: 'source' | 'import'
}[] = [
    // A template read has the LOADED type, so a typo in one is caught. If the read had been widened
    // to `any` — or to `unknown` — this line would compile.
    {
        fixture: 'narrowing.abide',
        line: 9,
        code: 'TS2339',
        message: /'nmae' does not exist/,
        where: 'source',
    },
    // …and the same member access in a `<script>` is possibly-undefined, because setup runs once and
    // a read there peeks. The pair is the proof, and it is the one that says where the split falls:
    // one position has a real type, the other still has to handle the absence.
    {
        fixture: 'unnarrowed.abide',
        line: 13,
        code: 'TS2532',
        message: /possibly 'undefined'/,
        where: 'source',
    },
    // An rpc whose args have a REQUIRED field still demands one. The positive half — an endpoint that
    // requires nothing being callable with nothing — compiles by construction and so proves nothing on
    // its own; this is the line that fails if `Selecting` starts saying `[args?: Args]` for every call.
    {
        fixture: 'args.abide',
        line: 9,
        code: 'TS2554',
        message: /Expected 1-2 arguments, but got 0/,
        where: 'source',
    },
    // A write desugars to `set`, and keeps the state's type doing it.
    {
        fixture: 'write.abide',
        line: 7,
        code: 'TS2345',
        message: /'string' is not assignable/,
        where: 'source',
    },
    // An IMPORTED type is resolved across the module boundary the compiler's own scanner cannot see
    // across — by the checker, exactly as in any `.ts` file.
    {
        fixture: 'imported.abide',
        line: 8,
        code: 'TS2339',
        message: /'nmae' does not exist/,
        where: 'source',
    },
    // A generic keeps its argument through a state.
    {
        fixture: 'generics.abide',
        line: 7,
        code: 'TS2322',
        message: /'Paged<Book>' is not assignable/,
        where: 'source',
    },
    // A prop the component never declared. This is what the type argument to `props()` buys, and what
    // a component that never calls it — children and nothing else — cannot be told.
    {
        fixture: 'props.abide',
        line: 10,
        code: 'TS2339',
        message: /'missing' does not exist/,
        where: 'source',
    },
    // …and the half the binding spelling adds: a template can only reach a name something BOUND, so a
    // prop nobody destructured is not a silent `undefined`, it is a name that does not exist.
    {
        fixture: 'props.abide',
        line: 16,
        code: 'TS2304',
        message: /Cannot find name 'unbound'/,
        where: 'source',
    },
    // A prop CALL SITE, which is the only place a `Given` regression can show: the component's own
    // file compiles either way. The optional prop is the one that broke — `State<T | undefined> |
    // undefined` extends neither arm of `Given`'s conditional, so the plain-value arm was dropped and
    // a literal stopped being passable at all — and the positive half of that is `valid/calls.abide`.
    // This is the half that says the arm came back as the DECLARED type rather than as anything.
    // …and what it pins beyond the type is the LINE, which used to be the generated one. A prop
    // expression is now marked like an element attribute is, so the diagnostic lands on the markup
    // the author wrote rather than two lines above it.
    //
    // The COLUMN is still not the author's, and that is the shape worth saying: tsc anchors a
    // property mismatch at the property NAME, and a prop's name is the emitter's own text — only the
    // `{3}` beside it came from the file. So the anchor maps through the nearest mark before it,
    // which is a sibling prop's value on the same generated line. Right line, wrong column, against
    // the previous answer of no position at all — which the live lane DROPS, so an editor showed
    // nothing here.
    {
        fixture: 'optional.abide',
        line: 17,
        code: 'TS2322',
        message: /'number' is not assignable/,
        where: 'source',
    },
    // The regression that has no other guard: an annotation naming a state must not bind it, so the
    // initialiser beside it is still a READ. Before the fix this file compiled clean.
    {
        fixture: 'shadowing.abide',
        line: 5,
        code: 'TS2322',
        // `number | undefined`, not `number`: the read a `<script module>` gets is `peek()`, and that
        // is the honest type on EVERY state now — `types/valid/narrowing.abide` is the gate on it.
        // What this fixture catches is unchanged: a VALUE where the annotation says a state.
        message: /'number \| undefined' is not assignable/,
        where: 'source',
    },
    // A name that MOVED to `abide/runtime` says so. `keyed` reads like authoring vocabulary and is
    // not — `by` on a `{#for}` is the spelling, and `keyed(...)` is what the emitter writes for it —
    // so importing it from `abide` is a mistake, and this is the half of the split that a change to
    // `shared/index.ts` alone could undo. The emitted file also carries a duplicate binding, because
    // the header imports the same name from `abide/runtime`; that noise sits on a file already being
    // rejected, and suppressing it would cost the cross-module dedupe the split exists to avoid.
    {
        fixture: 'moved.abide',
        line: 2,
        where: 'import',
        // TS2305 and not TS2724: the "did you mean" form needs a near-match still on the module, and
        // the `Keyed` TYPE moved to `abide/runtime` alongside the value it describes. So the message
        // is the plain one — which is the honest report, since there is nothing on `abide` to mean.
        code: 'TS2305',
        message: /no exported member 'keyed'/,
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
        where === 'source' ? `line ${line} of the .abide` : `line ${line} (a hoisted import, still generated)`
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
        expect((matched as Reported).mapped).toBe(where === 'source')
    })
}
