/*
Resolves after the current macrotask boundary, by which point the microtask
queue has fully drained — pending effect re-runs, async-iterator frames,
and the dispatcher's `void handle…(…)` work have all flushed. Lets a test read
state that settles asynchronously without guessing a fixed delay.
*/
export function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}
