// Lane 3 of 3, and entry 3 of 5 — bytes, microtask turns and allocations, on bun.
// The lane that prices what ships and what the server spends getting it there.
//
// `harness/report` is a FOURTH entry and is not a fourth lane: a lane is a DEPENDENCY
// partition, and the leaf depends on nothing.
//
// There is no `calls()` here. `bun:test` already ships one —
// `spyOn(checker, 'check').mock.calls.length` is the compiler's wave gate exactly,
// with `mockRestore` for the teardown — and a second spelling would be a rename with
// a worse restore story.

export { allocated } from './allocated.ts'
export { bytes } from './bytes.ts'
export { closures } from './closures.ts'
export { retained } from './retained.ts'
export { ticks } from './ticks.ts'
