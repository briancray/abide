// MICROTASK TURNS an op took to settle. A re-queueing probe: it counts the checkpoints
// the engine passed through, which is what "≤1 promise per call" and "microtask ticks
// per row" are asserted against. Budgeting emitted code in three numbers — allocations
// per template node, microtask ticks per row, DOM nodes per list item — this is the
// second of the three.
//
// THE PROBE YIELDS TO THE EVENT LOOP, and it has to. The microtask queue is drained to
// EXHAUSTION before a timer or an I/O completion runs, so a probe that only ever
// re-queues a microtask starves any body that settles on a macrotask: measured, a body
// of `new Promise((resolve) => setTimeout(resolve, 10))` never returned, and the test's
// own 5s timeout never fired either, because the timeout is a timer too. A hung suite
// reports nothing at all — no failed test, no summary — which is the worst failure
// shape there is, so every TURNS_PER_YIELD turns the next probe goes through a
// macrotask instead. A body that settles in microtasks alone never reaches the bound
// and counts exactly what it counted before.
const TURNS_PER_YIELD = 256

export async function ticks(body: () => unknown): Promise<number> {
    let turns = 0
    let settled = false
    const probe = (): void => {
        if (settled) return
        turns += 1
        if (turns % TURNS_PER_YIELD === 0) setTimeout(probe, 0)
        else queueMicrotask(probe)
    }
    const finished = Promise.resolve(body()).then(() => {
        settled = true
    })
    queueMicrotask(probe)
    await finished
    return turns
}
