// The verification mechanism's own verification. `gate()` exists because three tests
// were written after a change and were green on their first run with the bug still
// in place — so the one thing it cannot be is a wrapper that passes whatever it is
// handed.

import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gate } from 'harness/gate'

const GATE = new URL('../src/gate/index.ts', import.meta.url).pathname

function runGateFile(source: string): { ok: boolean; output: string } {
    const directory = mkdtempSync(join(tmpdir(), 'harness-gate-'))
    const file = join(directory, 'fixture.test.ts')
    writeFileSync(file, source)
    const run = Bun.spawnSync({
        cmd: ['bun', 'test', file],
        cwd: new URL('../../../', import.meta.url).pathname,
        env: { ...process.env, HARNESS_VERIFY_GATES: '1' },
        stderr: 'pipe',
        stdout: 'pipe',
    })
    return {
        ok: run.exitCode === 0,
        output: run.stdout.toString() + run.stderr.toString(),
    }
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
test('a gate that still passes with the mechanism out is reported', () => {
    const run = runGateFile(`
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
test('a gate that fails with the wrong number is reported', () => {
    const run = runGateFile(`
import { expect, test } from 'bun:test'
import { gate } from '${GATE}'
let counted = 7
gate('counts three', { revert: () => { counted = 99; return () => { counted = 7 } }, worth: { counted: 4 } }, () => {
    expect(counted).toBe(3)
})`)
    expect(run.ok).toBe(false)
    expect(run.output).toContain('not with the number it is worth')
})

test('a gate with a revert that lands passes both runs', () => {
    const run = runGateFile(`
import { expect, test } from 'bun:test'
import { gate } from '${GATE}'
let counted = 3
gate('counts three', { revert: () => { counted = 4; return () => { counted = 3 } }, worth: { counted: 4 } }, () => {
    expect(counted).toBe(3)
})`)
    expect(run.output).toContain('2 pass')
    expect(run.ok).toBe(true)
})
