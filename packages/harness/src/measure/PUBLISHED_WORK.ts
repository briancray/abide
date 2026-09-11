// THE WIRE BETWEEN ABIDE AND THIS LANE, and it is a wire rather than an import on
// purpose: `harness/measure` may have no abide in its graph at all (44.1), and abide's
// published `files` cannot carry a devDependency's types. So the two halves cannot
// share a declaration, and what keeps them honest is a shape check at the read rather
// than the type system. See docs/DECISIONS.md D113.
//
// A leaf — no imports of its own — because the name crosses a seam and both sides read
// it (CLAUDE.md, "seams and imports"). It is also injected into the browser page as
// part of the measure bundle, so anything it reached for would be paid for there.

export const PUBLISHED_WORK_KEY = '__ABIDE_WORK__'

// Every field `measure()` reads off the published record. A record missing one of them
// is a throw naming it, per 44.24 — the same reason an unpatched DOM mutator throws
// rather than reporting 0.
export const PUBLISHED_WORK_FIELDS = [
    'wakes',
    'bindingRuns',
    'descents',
] as const

export type PublishedWork = Record<
    (typeof PUBLISHED_WORK_FIELDS)[number],
    number
>
