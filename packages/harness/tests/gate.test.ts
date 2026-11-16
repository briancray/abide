// The verification mechanism's own verification. `gate()` exists because three tests
// were written after a change and were green on their first run with the bug still
// in place — so the one thing it cannot be is a wrapper that passes whatever it is
// handed.

import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { atMost, gate, spawned } from '@abide/harness/gate'

const GATE = new URL('../src/gate/index.ts', import.meta.url).pathname

async function runGateFile(
    source: string,
): Promise<{ ok: boolean; output: string }> {
    const directory = mkdtempSync(join(tmpdir(), 'harness-gate-'))
    const file = join(directory, 'fixture.test.ts')
    writeFileSync(file, source)
    const run = await spawned(['bun', 'test', file], {
        cwd: new URL('../../../', import.meta.url).pathname,
        env: { ...process.env, HARNESS_VERIFY_GATES: '1' },
    })
    return { ok: run.exitCode === 0, output: run.stdout + run.stderr }
}

// A revert with nothing to report is a revert nobody can tell landed, so this is
// refused at registration rather than at run time.
test('a gate stating no worth is refused', () => {
    expect(() =>
        gate('nothing to report', { revert: () => {}, worth: {} }, () => {}),
    ).toThrow(/states no `worth`/)
})

// A BENCHMARK CASE EARNS ITS PLACE BY DISTINGUISHING IMPLEMENTATIONS, and a case
// reporting the same number with the mechanism out distinguishes nothing. Before
// this, a reader had to notice. Reverted — accept a passing reverted run — the
// useless gate below goes green and the suite reports one more passing test.
test('a gate that still passes with the mechanism out is reported', async () => {
    const run = await runGateFile(`
import { expect, test } from 'bun:test'
import { gate } from '${GATE}'
gate('two plus two', { revert: () => {}, worth: { sum: 5 } }, () => {
    expect(2 + 2).toBe(4)
})`)
    expect(run.ok).toBe(false)
    expect(run.output).toContain('passed with the mechanism out')
})

// And the other half: failing is not enough, it has to fail with the number the
// revert is worth. A revert that breaks the case some other way has not been shown
// to reach the mechanism.
test('a gate that fails with the wrong number is reported', async () => {
    const run = await runGateFile(`
import { expect, test } from 'bun:test'
import { gate } from '${GATE}'
let counted = 7
gate('counts three', { revert: () => { counted = 99; return () => { counted = 7 } }, worth: { counted: 4 } }, () => {
    expect(counted).toBe(3)
})`)
    expect(run.ok).toBe(false)
    expect(run.output).toContain('not with the number it is worth')
})

test('a gate with a revert that lands passes both runs', async () => {
    const run = await runGateFile(`
import { expect, test } from 'bun:test'
import { gate } from '${GATE}'
let counted = 3
gate('counts three', { revert: () => { counted = 4; return () => { counted = 3 } }, worth: { counted: 4 } }, () => {
    expect(counted).toBe(3)
})`)
    expect(run.output).toContain('2 pass')
    expect(run.ok).toBe(true)
})

// 43.40 — A CEILING HOLDS AT AND UNDER ITSELF, and fails naming every field over it with what it
// reported, so a `gate`'s `worth` finds its number in the failure. THE REVERT: compare with `>=`
// in `atMost.ts`; the record at its ceiling throws "wakes: 9, over its ceiling of 9".
test('atMost passes at and under a ceiling, and names each field over one — 43.40', () => {
    const work = { wakes: 9, nodesCreated: 3, descents: 30 }
    expect(() => atMost(work, { wakes: 9, nodesCreated: 27 })).not.toThrow()
    expect(() =>
        atMost(work, { wakes: 8, nodesCreated: 2, descents: 30 }),
    ).toThrow(
        'atMost: wakes: 9, over its ceiling of 8; nodesCreated: 3, over its ceiling of 2',
    )
})

// 43.41 — ABSENT IS NOT UNDER: a counter no source published is `null` (43.19), and a ceiling on it
// would pass against a counter nothing increments. THE REVERT: skip a non-number in `atMost.ts`;
// this passes.
test('atMost refuses a ceiling on a field carried as absent — 43.41', () => {
    expect(() =>
        atMost({ wakes: null as number | null }, { wakes: 9 }),
    ).toThrow('wakes has a ceiling of 9 and the record carries it as absent')
})

// 43.42 — THE FAILURE IS THE CALLER'S LINE: bun prints a throw at its stack's first frame, and the
// line a reader needs is the claim, not the helper. THE REVERT: drop `Error.captureStackTrace` from
// `atMost.ts`; the first frame is `atMost.ts`.
test('atMost fails from the line that called it — 43.42', () => {
    let stack = ''
    try {
        atMost({ wakes: 2 }, { wakes: 1 })
    } catch (failure) {
        stack = String((failure as Error).stack)
    }
    const firstFrame = stack.split('\n').find((line) => line.includes(' at '))
    expect(firstFrame).toContain('gate.test.ts')
})
