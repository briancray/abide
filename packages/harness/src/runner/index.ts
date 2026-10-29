// RUNNERS. A row runner is a subprocess writing one JSON row per line, so a page or a terminal
// reading it never shares the process a suite or a bench runs in — its clock, its heap, its event
// loop. `@abide/harness/rows` is the contract the rows keep; this is what writes them.
// `runBenches` runs an app's benches in its own process, and `harness-bench` is it as a command.
//
// Not a lane: it depends on bun and on whichever test runner a suite names, and it measures
// nothing itself.

export { rowsCommand } from './rowsCommand.ts'
export { runBenches } from './runBenches.ts'
export { type TestSuite, testRows } from './testRows.ts'
