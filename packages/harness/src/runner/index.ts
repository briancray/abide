// RUNNERS THAT PRINT ROWS. A runner is a subprocess writing one JSON row per line, so a page or a
// terminal reading it never shares the process a suite or a bench runs in — its clock, its heap,
// its event loop. `@abide/harness/rows` is the contract the rows keep; this is what writes them.
//
// Not a lane: it depends on bun and on whichever test runner a suite names, and it measures
// nothing itself.

export { rowsCommand } from './rowsCommand.ts'
export { type TestSuite, testRows } from './testRows.ts'
