import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import type { ShadowProgram } from '../src/lib/ui/compile/createShadowProgram.ts'
import { seedTypeClassifierForRoot } from '../src/lib/ui/compile/seedTypeClassifierForRoot.ts'
import type { SeedTypeClassifier } from '../src/lib/ui/compile/types/SeedTypeClassifier.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { settle } from './support/settle.ts'

/* Builds the REAL type-directed seed classifier (ADR-0023) over a component written to a
   throwaway on-disk project — the same warm-shadow wiring the interpolation suite uses, so a
   `computed(seed)` routes on the seed's checker type. Exercises `seedTypeClassifierForRoot`
   itself (not a hand-rolled copy) so the test tracks the shipped resolver. */
function makeSeedClassifier(source: string): SeedTypeClassifier {
    const dir = mkdtempSync(join(tmpdir(), 'abide-typedcell-'))
    writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                strict: true,
                module: 'esnext',
                moduleResolution: 'bundler',
                target: 'esnext',
                lib: ['esnext', 'dom'],
            },
        }),
    )
    const abidePath = join(dir, 'Component.abide')
    writeFileSync(abidePath, source)
    const cache = new Map<string, ShadowProgram | undefined>()
    const classifier = seedTypeClassifierForRoot(cache, dir, abidePath)
    if (classifier === undefined) {
        throw new Error('expected a seed classifier for the fixture project')
    }
    return classifier
}

/* Compiles a component's client body with the seed classifier resolved against that same
   source — the type-directed cell path. */
function compileTyped(source: string): string {
    const seedClassify = makeSeedClassifier(source)
    return compileComponent(source, false, undefined, undefined, undefined, seedClassify)
}

describe('type-directed cell classification (ADR-0023) — computed seed routing', () => {
    /* The headline correctness fix (gap #1): a stream produced by a MEMBER ACCESS is not a
       call/identifier, so the `isBareCallComputed` shape heuristic misses it and routes it to
       the lazy `derive` slot that never auto-tracks. Type-direction resolves `obj.stream` to
       an async iterable and routes it to the eager `trackedComputed` stream cell. */
    test('a member-access stream seed routes to trackedComputed / $$readCell (fails on the shape heuristic)', () => {
        const source = `<script>
import { state } from '@abide/abide/ui/state'
const obj = { stream: (async function* () { yield 'x' })() as AsyncIterable<string> }
const frames = state.computed(obj.stream)
</script>
<p>{frames}</p>
`
        const typed = compileTyped(source)
        expect(typed).toContain('const frames = $$scope().trackedComputed(() => obj.stream)')
        expect(typed).toContain('$$readCell(frames)')
        expect(typed).not.toContain('frames()')

        /* Today's behavior (no classifier — the `main` shape heuristic): `obj.stream` is not a
           bare call/identifier, so it falls to the lazy derive and NEVER auto-tracks. */
        const shapeHeuristic = compileComponent(source)
        expect(shapeHeuristic).toContain('$$scope().derive("frames", () => obj.stream)')
        expect(shapeHeuristic).toContain('frames()')
        expect(shapeHeuristic).not.toContain('trackedComputed')
    })

    /* The same gap via a CONDITIONAL seed (also not a call/identifier). */
    test('a conditional stream seed routes to trackedComputed / $$readCell (fails on the shape heuristic)', () => {
        const source = `<script>
import { state } from '@abide/abide/ui/state'
const cond = true
const streamA = (async function* () { yield 'a' })() as AsyncIterable<string>
const streamB = (async function* () { yield 'b' })() as AsyncIterable<string>
const frames = state.computed(cond ? streamA : streamB)
</script>
<p>{frames}</p>
`
        const typed = compileTyped(source)
        expect(typed).toContain(
            'const frames = $$scope().trackedComputed(() => cond ? streamA : streamB)',
        )
        expect(typed).toContain('$$readCell(frames)')

        const shapeHeuristic = compileComponent(source)
        expect(shapeHeuristic).not.toContain('trackedComputed')
        expect(shapeHeuristic).toContain('$$scope().derive("frames"')
    })

    /* The perf refinement (gap #2): a provably-SYNC bare call skips `trackedComputed`'s runtime
       probe and routes straight to the lazy `derive` slot — where today's heuristic pays the
       probe for every bare call. */
    test('a provably-sync bare call routes to the lazy derive (skips the trackedComputed probe)', () => {
        const source = `<script>
import { state } from '@abide/abide/ui/state'
function add(x: number, y: number): number { return x + y }
const total = state.computed(add(1, 2))
</script>
<p>{total}</p>
`
        const typed = compileTyped(source)
        expect(typed).toContain('const total = $$scope().derive("total", () => add(1, 2))')
        expect(typed).toContain('total()')
        expect(typed).not.toContain('trackedComputed')
        expect(typed).not.toContain('$$readCell(total)')

        /* Today's heuristic pays the probe: a bare call → trackedComputed regardless of type. */
        const shapeHeuristic = compileComponent(source)
        expect(shapeHeuristic).toContain('$$scope().trackedComputed(() => add(1, 2))')
    })

    /* ADR-0019 D1 table: a bare PROMISE seed (no `await` marker) is held opaque on the lazy
       `derive` slot under type-direction. This is the routing SHIFT the brief calls out — today
       a bare-call promise lands in `trackedComputed`/`cellReadNames` via the syntax heuristic. */
    test('a bare promise seed is held opaque on the lazy derive (routing shift from the heuristic)', () => {
        const source = `<script>
import { state } from '@abide/abide/ui/state'
async function load(): Promise<number> { return 1 }
const v = state.computed(load())
</script>
<p>{v}</p>
`
        const typed = compileTyped(source)
        expect(typed).toContain('const v = $$scope().derive("v", () => load())')
        expect(typed).toContain('v()')
        expect(typed).not.toContain('trackedComputed')
        expect(typed).not.toContain('$$readCell(v)')

        /* Fail-open (no classifier) reproduces today's routing: a bare call → trackedComputed. */
        const shapeHeuristic = compileComponent(source)
        expect(shapeHeuristic).toContain('$$scope().trackedComputed(() => load())')
        expect(shapeHeuristic).toContain('$$readCell(v)')
    })

    /* Fail-open: no warm program (classifier absent) reproduces the `isBareCallComputed`
       routing byte-for-byte — the strict-refinement guarantee. */
    test('fail-open: absent classifier reproduces today’s isBareCallComputed routing byte-for-byte', () => {
        const source = `<script>
import { state } from '@abide/abide/ui/state'
const frames = state.computed(getStream())
</script>
<p>{frames}</p>
`
        /* A bare call with no classifier → the eager trackedComputed (today's behavior). */
        const plain = compileComponent(source)
        expect(plain).toContain('const frames = $$scope().trackedComputed(() => getStream())')
        expect(plain).toContain('$$readCell(frames)')
        /* Passing an explicit `undefined` seed classifier is identical — same bytes. */
        const explicitAbsent = compileComponent(
            source,
            false,
            undefined,
            undefined,
            undefined,
            undefined,
        )
        expect(explicitAbsent).toBe(plain)
    })

    /* The `await`-marker path (`isAsyncComputed`) stays syntactic and untouched, even with a seed
       classifier present: it is decided first and routes to the eager `computed` async cell. */
    test('the await-marker computed is unchanged with a classifier present', () => {
        const source = `<script>
import { state } from '@abide/abide/ui/state'
const v = state.computed(await Promise.resolve(1))
</script>
<p>{v}</p>
`
        const typed = compileTyped(source)
        expect(typed).toContain(
            'const v = $$scope().trackedComputed(async () => await Promise.resolve(1), false)',
        )
        expect(typed).toContain('$$readCellBlocking(v)')
        expect(typed).not.toContain('v()')
    })

    /* The name-collection pass and the lowering must make the identical routing decision — a
       divergence lands the binding in the wrong read-name bucket and its reference lowers to the
       wrong read form. A member-access stream that both agree is eager reads via `$$readCell`
       with no stray `frames()` derive reader, and SSR (which keys its await-barrier off
       `cellReadNames`) emits the settle barrier — proving both dispatch sites agreed. */
    test('client and SSR agree on the bucket for a member-access stream seed', () => {
        const source = `<script>
import { state } from '@abide/abide/ui/state'
const obj = { stream: (async function* () { yield 'x' })() as AsyncIterable<string> }
const frames = state.computed(obj.stream)
</script>
<p>{frames}</p>
`
        const seedClassify = makeSeedClassifier(source)
        const client = compileComponent(
            source,
            false,
            undefined,
            undefined,
            undefined,
            seedClassify,
        )
        const ssr = compileSSR(source, false, undefined, undefined, undefined, seedClassify)
        expect(client).toContain('$$readCell(frames)')
        expect(client).not.toContain('frames()')
        /* The SSR await-barrier fires only when the component declares a cell (cellReadNames),
           so its presence proves the SSR name-collection also bucketed `frames` as a cell. */
        expect(ssr).toContain('await $$settleAsyncCells()')
        expect(ssr).toContain('$$readCell(frames)')
    })
})

describe('type-directed cell classification (ADR-0023) — stream cell mount', () => {
    beforeAll(() => {
        installMiniDom()
    })

    /* Drive a real compile + mount: a member-access stream seed auto-tracks and the latest frame
       reaches the DOM after settle. The shape-directed `main` routes `obj.stream` to a lazy
       derive that reads it once and never tracks, so it never shows `last`. */
    test('a member-access stream computed renders its latest frame after settle', async () => {
        /* The seed is `obj.stream` (member access) — the exact shape the `isBareCallComputed`
           heuristic misses. Type-direction routes it to the eager tracked cell that drains the
           generator, so the DOM shows the latest frame; `main` would leave it a lazy derive. */
        const cellSource = `<script>
import { state } from '@abide/abide/ui/state'
const obj = { stream: (async function* () { yield 'first'; yield 'last' })() }
const frames = state.computed(obj.stream)
</script>
<p>{frames}</p>
`
        const seedClassify = makeSeedClassifier(cellSource)
        const body = compileComponent(
            cellSource,
            false,
            undefined,
            undefined,
            undefined,
            seedClassify,
        )
        /* Sanity: the compiled body must be the eager tracked cell, not a lazy derive. */
        expect(body).toContain('trackedComputed')
        const host = document.createElement('div')
        new Function('host', body)(host)
        await settle()
        expect(host.textContent).toContain('last')
    })
})
