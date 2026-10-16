// THE WIRE BETWEEN A SUBJECT AND THIS LANE, and it is a wire rather than an import on
// purpose: `harness/measure` may have nothing under test in its graph at all (43.1), so
// a subject that counts what a DOM patch cannot see — an effect rerun, a propagation
// walk — puts a record on the global and the lane reads it. The two halves cannot share
// a declaration, so what keeps them honest is a check at the read (`publishedBy`) rather
// than the type system.
//
// A leaf — no imports of its own — because the name crosses a seam and both sides read
// it (CLAUDE.md, "seams and imports"). It is also injected into the browser page as
// part of the measure bundle, so anything it reached for would be paid for there.

/**
 * The global a subject publishes its counters under: one record per source, by the source's name.
 *
 * `globalThis.__HARNESS_WORK__ ??= {}` and then `.mylib = { renders: 0, ... }`, with every field a
 * number the subject increments where the work happens.
 */
export const PUBLISHED_WORK_KEY = '__HARNESS_WORK__'

/** What a subject publishes: one fixed-shape record of numbers per source. */
export type PublishedWork = Record<string, Record<string, number>>
