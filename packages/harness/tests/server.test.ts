// The bun lane's traps, asserted AS traps. Two of them pass silently — a gate on
// `objectTypeCounts.Scope` reads 0 forever, and a total taken in a preloaded process
// moves with happy-dom's own objects — so each is checked by producing the number the
// trap would produce.

import { expect, test } from 'bun:test'
import { inAFreshProcess } from 'harness/gate'
import { bytes, ticks } from 'harness/server'

const SERVER = new URL('../src/server/index.ts', import.meta.url).pathname

// Reverted — let it run — the totals move with happy-dom's own objects, because JSC
// buckets a plain class instance as `Object` and the emulator's implementation
// objects land in the same untyped bucket as the framework's.
test('retained() throws in a process with a DOM', async () => {
    const { GlobalRegistrator } = await import('@happy-dom/global-registrator')
    expect(typeof document).toBe('object')
    expect(GlobalRegistrator).toBeDefined()
    const { retained } = await import('harness/server')
    expect(() => retained(() => ({}))).toThrow(/ran in a process with a DOM/)
})

// THE TRAP, ASSERTED AS A TRAP. `Scope` is never a key, so a gate written against
// `objectTypeCounts.Scope` reads 0 with the mechanism in AND out. The diff is
// returned whole for the same reason a seven-type filter was refused: `Object` is
// where a plain class instance lands, and a filter is a second way to read 0 forever.
test('a class instance is bucketed as Object, and Scope is never a key', () => {
    const run = inAFreshProcess(`
import { retained } from '${SERVER}'
class Rung { constructor(public next) {} }
const diff = retained(() => {
    const out = []
    for (let index = 0; index < 500; index += 1) out.push(new Rung(index))
    return out
})
if ('Scope' in diff) throw new Error('Scope appeared as a key: ' + JSON.stringify(diff))
if (!(diff.Object >= 500)) throw new Error('a class instance did not land in Object: ' + JSON.stringify(diff))
console.log('Object=' + diff.Object)`)
    expect(run.output).toMatch(/Object=\d+/)
    expect(run.ok).toBe(true)
})

// `SERVER.md`'s onion gate is this pair and nothing else, which is why it has a name:
// confirmed under bun 1.4.2, five closures move it by exactly +5/+5 after a `fullGC`.
// Reverted to counting `Function` alone, a closure that captured nothing and one that
// captured its whole enclosing scope report the same number.
test('closures() reports the pair, and five closures move it by five', () => {
    const run = inAFreshProcess(`
import { closures } from '${SERVER}'
const held = []
const pair = closures(() => {
    for (let index = 0; index < 5; index += 1) {
        const captured = { index }
        held.push(() => captured.index)
    }
    return held
})
console.log(JSON.stringify(pair))`)
    expect(run.ok).toBe(true)
    const pair = JSON.parse(run.output.trim()) as Record<string, number>
    expect(pair.Function).toBeGreaterThanOrEqual(5)
    expect(pair.JSLexicalEnvironment).toBeGreaterThanOrEqual(5)
})

// A batch mean can never be compared with an exact integer, and the tag is what makes
// that structural rather than a convention. Reverted — return the record bare — the
// fractional `Object:3.09` reads as a count and gets `toBe(3)`d.
test('allocated() comes back tagged, with its rep count and its growth', () => {
    const run = inAFreshProcess(`
import { allocated } from '${SERVER}'
const answer = allocated(() => new URL('https://example.test/a'), 400)
if (answer.tagged !== 'batch mean') throw new Error('untagged')
if (answer.reps !== 400) throw new Error('rep count not reported: ' + answer.reps)
console.log(JSON.stringify({ tagged: answer.tagged, reps: answer.reps, growth: answer.growth }))`)
    expect(run.ok).toBe(true)
    expect(run.output).toContain('"tagged":"batch mean"')
})

// Reverted — count the awaits instead — a body that settles in one turn and one that
// re-queues per row report the same number.
test('ticks() counts the microtask turns an op took to settle', async () => {
    const immediate = await ticks(() => 1)
    const chained = await ticks(async () => {
        let value = 0
        for (let step = 0; step < 5; step += 1)
            value = await Promise.resolve(step)
        return value
    })
    expect(chained).toBeGreaterThan(immediate)
})

// AND IT TERMINATES ON A BODY THAT SETTLES ON A MACROTASK. The microtask queue is
// drained to exhaustion before a timer runs, so a probe that only re-queues a
// microtask starves the timer the body is waiting on. Reverted — drop the yield —
// this child never exits and `timedOut` comes back true: measured that way first,
// and `bun test`'s own 5s per-test timeout did not fire either, because the timeout
// is a timer too. A hung suite reports nothing at all, which is why the gate has to
// be taken in a child the OS can kill.
test('ticks() terminates on a body that settles on a macrotask', () => {
    const run = inAFreshProcess(
        `
import { ticks } from '${SERVER}'
const turns = await ticks(() => new Promise((resolve) => setTimeout(resolve, 10)))
if (!(turns > 0)) throw new Error('no turns counted: ' + turns)
console.log('turns=' + turns)`,
        undefined,
        5000,
    )
    expect(run.timedOut).toBe(false)
    expect(run.ok).toBe(true)
    expect(run.output).toMatch(/turns=\d+/)
})

test('bytes() measures a payload by its payload and an object by its retention', async () => {
    expect(await bytes(new Response('hello'))).toBe(5)
    expect(await bytes('héllo')).toBe(6)
    expect(await bytes(new Uint8Array(12))).toBe(12)
    expect(await bytes({ a: 1 })).toBeGreaterThan(0)
})
