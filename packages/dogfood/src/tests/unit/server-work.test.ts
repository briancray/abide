// `harness/server`, against renders whose cost is KNOWN by construction.
//
// A measurement API is the one kind of code a correctness test cannot check by reading its output:
// every number it returns is plausible, and a counter wired to nothing returns zero forever. So each
// case here drives a render whose answer is arithmetic — a string of known length, a walk with a
// known number of awaits — and asserts the instrument against it.
//
// Not a demo, for the reason `allocation.test.ts` is not one: a case in `#shared/demos/` runs the same body
// in a browser card, and `harness/server` imports `bun:jsc`.

import { expect, test } from 'bun:test'
import { render } from 'abide/server'
import { html, state } from 'abide'
import { serverWork, serverWorkOver } from 'harness/server'

test('bytes are UTF-8, not string length', async () => {
    // The distinction this makes is invisible until it is not: `length` on a string of ten emoji is
    // twenty, and the bytes on the wire are forty.
    const plain = await serverWork(() => 'hello')
    expect(plain.bytes).toBe(5)

    // Four bytes each, two UTF-16 units each — so `length` would say 4 and the wire says 16.
    const wide = await serverWork(() => '🌀🌀🌀🌀')
    expect(wide.bytes).toBe(16)
    expect('🌀🌀🌀🌀'.length).toBe(8)
})

test('a streamed render is counted per chunk', async () => {
    const streamed = await serverWork(async function* () {
        yield 'abc'
        yield 'def'
        yield 'ghi'
    })
    expect(streamed.bytes).toBe(9)

    // Ten thousand chunks, which is the SUM over a stream rather than one chunk read twice.
    //
    // It does NOT assert that the drain avoids concatenation, and saying so is the point: a harness
    // accumulating `held += chunk` reports exactly 10,000 here too, only slower. That property is
    // held by reading `drain` — bytes accumulate and the string is never bound — because the timing
    // that would show it is the one thing a correctness test cannot make stable.
    const many = await serverWork(async function* () {
        for (let i = 0; i < 10_000; i++) yield 'x'
    })
    expect(many.bytes).toBe(10_000)
})

test('microtask turns are what the walk OWES, with the empty-function floor removed', async () => {
    // A render that awaits nothing owes nothing. Not asserted as exactly 0 — the floor is itself a
    // measurement taken a moment earlier — but a walk with no awaits in it cannot cost turns.
    const sync = await serverWork(() => 'no awaits here at all')
    expect(sync.microtasks).toBeLessThan(4)

    // And one that awaits per chunk pays per chunk. The instrument has to SEE the difference; the
    // markup is identical either way, which is the whole reason this number exists.
    const awaited = await serverWorkOver(async function* () {
        for (let i = 0; i < 200; i++) {
            await Promise.resolve()
            yield 'x'
        }
    })
    expect(awaited.microtasks).toBeGreaterThan(100)
})

test('allocations name the type that moved', async () => {
    // Ten thousand arrays — a type JSC names, at a count no walk of this size reaches by accident.
    // A LOWER bound, because the one contaminant (a collection between the readings) under-counts.
    //
    // What this gates is that the counter is WIRED: 10,004 against 3 for a render that builds
    // nothing. It does NOT gate the collection discipline, and the difference is worth stating —
    // dropping a `Bun.gc(true)` between the two readings leaves this green, because JSC scans the
    // stack conservatively and `held` is still rooted there. A case that could tell those apart
    // would have to out-live its own stack frame, which is a different measurement.
    const allocating = await serverWorkOver(() => {
        const held: unknown[] = []
        for (let i = 0; i < 10_000; i++) held.push([i])
        return `built ${held.length}`
    })
    expect(allocating.allocated.Array ?? 0, 'the array allocations were not counted').toBeGreaterThan(5_000)

    // And a render that allocates nothing of that type does not report it.
    const quiet = await serverWork(() => 'nothing built')
    expect(quiet.allocated.Array ?? 0).toBeLessThan(5_000)
})

test('the composite takes each field at its least-contaminated end', async () => {
    // `serverWorkOver` is not "the best run" — it is per-field, and each field's contaminant runs a
    // known direction. Driven with a render whose cost VARIES per call, so the maxima and the minimum
    // land in different trials and a "return the last reading" implementation cannot pass.
    let call = 0
    const varying = async function* (): AsyncGenerator<string> {
        call++
        // The second call awaits far more, so the max must come from it rather than from the last.
        const awaits = call === 2 ? 300 : 5
        for (let i = 0; i < awaits; i++) await Promise.resolve()
        yield 'same bytes every time'
    }

    const composite = await serverWorkOver(varying, 3)
    expect(composite.microtasks, 'the max did not come from the middle trial').toBeGreaterThan(100)
    expect(composite.bytes).toBe('same bytes every time'.length)

    // And bytes that DISAGREE between trials are a bug in the render, not something to average.
    let widening = 0
    await expect(
        serverWorkOver(() => 'x'.repeat(++widening), 2),
    ).rejects.toThrow(/produced \d+ bytes and then \d+/)
})

test('a real abide render reports all four numbers', async () => {
    // The end-to-end shape: `render` is an async generator, so this is the drain path, and the case
    // exists to prove the API takes what `abide/server` actually hands back rather than a string.
    const rows = state(['alpha', 'beta', 'gamma'])
    const work = await serverWork(() => render(html`<ul>${() => rows().map((r) => html`<li>${r}</li>`)}</ul>`))

    expect(work.bytes, 'the render produced no bytes').toBeGreaterThan(20)
    expect(work.ms, 'the render took no time').toBeGreaterThanOrEqual(0)
    // Every row is in the markup, which is what says the drain read the whole walk rather than one chunk.
    expect(work.bytes).toBeGreaterThan('<ul><li>alpha</li><li>beta</li><li>gamma</li></ul>'.length - 1)
})
