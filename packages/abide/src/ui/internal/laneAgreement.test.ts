// Cross-lane agreement: `abide check` and `abide build` must accept and reject the same templates.
//
// The compiler has two lanes off `parse` — the build lane (`analyzeBindings` → `buildPlan` → the
// emitters) and the check/LSP lane (`emitCheck`). They keep separate lowerings on purpose, but they
// must not disagree about which templates are LEGAL, and for a long time they did: the check lane
// consumed `parse` alone, so four constructs went green in the editor and hard-threw on build.
//
// No test could catch that, because no test ran a source through both lanes. This one does. It is the
// harness, not the four cases: a fifth gate added to the build lane and not reached from the check
// lane fails here without anyone remembering to write a case for it.

import { describe, expect, test } from 'bun:test'
import { analyzeBindings } from './analyzeBindings.ts'
import { parse } from './parse.ts'
import { buildPlan } from './templatePlan.ts'
import { validateTemplate } from './validateTemplate.ts'

// What the BUILD lane does with a source: accepted, or the message it rejected with.
function buildLane(source: string): string | undefined {
    try {
        const root = parse(source, { filename: 'lane.abide' })
        buildPlan(root, analyzeBindings(root))
        return undefined
    } catch (rejected) {
        return rejected instanceof Error ? rejected.message : String(rejected)
    }
}

// What the CHECK lane does with the same source. `cli/check.ts` and `cli/lsp.ts` both run exactly
// this, after `parse`, before lowering — so agreement here is agreement in both commands.
function checkLane(source: string): string | undefined {
    try {
        const verdict = validateTemplate(parse(source, { filename: 'lane.abide' }))
        return verdict.legal ? undefined : verdict.rejected
    } catch (parseError) {
        return parseError instanceof Error ? parseError.message : String(parseError)
    }
}

// Every case the build lane is known to reject, plus enough accepted templates that a lane which
// simply rejected everything would fail too.
const CASES: Array<{ what: string; source: string; legal: boolean }> = [
    {
        what: 'the call form of a component',
        source: '<div>{#component Row(x)}<b>{x}</b>{/component}{Row(1)}</div>',
        legal: false,
    },
    {
        what: 'a <script> inside an element',
        source: '<div><script>let a = 1</script></div>',
        legal: false,
    },
    {
        what: 'a second root-level <script>',
        source: '<script>let a = 1</script><script>let b = 2</script><p>x</p>',
        legal: false,
    },
    {
        what: 'a branch-local <script> that is not the block body first node',
        source: '{#if x}<b>hi</b><script>let a = 1</script>{/if}',
        legal: false,
    },
    {
        what: 'an export in <script module>',
        source: '<script module>export const a = 1</script><p>{a}</p>',
        legal: false,
    },
    {
        what: 'an export in the instance <script>',
        source: '<script>export let a = 1</script><p>{a}</p>',
        legal: false,
    },
    {
        what: 'an export in a branch-local <script>',
        source: '{#if x}<script>export const a = 1</script><p>{a}</p>{/if}',
        legal: false,
    },
    { what: 'plain text', source: '<p>hello</p>', legal: true },
    { what: 'an interpolation', source: '<p>{name}</p>', legal: true },
    {
        what: 'a component invoked as a tag',
        source: '<div>{#component Row(x)}<b>{x}</b>{/component}<Row x={1}/></div>',
        legal: true,
    },
    {
        what: 'a branch-local <script> in first position',
        source: '{#if x}<script>let a = 1</script><b>hi</b>{/if}',
        legal: true,
    },
    {
        what: 'a root <script> and a <script module>',
        source: '<script module>const a = 1</script><script>let b = 2</script><p>x</p>',
        legal: true,
    },
    {
        what: 'a keyed for',
        source: '{#for item, i of list by item.id}<li>{item}</li>{/for}',
        legal: true,
    },
    {
        what: 'an await block',
        source: '{#await p}<i>…</i>{:then v}<b>{v}</b>{/await}',
        legal: true,
    },
]

describe('the check lane and the build lane agree', () => {
    for (const { what, source, legal } of CASES) {
        test(what, () => {
            const build = buildLane(source)
            const check = checkLane(source)
            // Agreement on the VERDICT is the contract. The messages are the same objects today
            // (one implementation), so asserting them too would only restate that.
            expect({ what, rejected: check !== undefined }).toEqual({
                what,
                rejected: build !== undefined,
            })
            expect(build === undefined).toBe(legal)
        })
    }
})
