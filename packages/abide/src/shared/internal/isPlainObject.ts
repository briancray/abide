// Is this a NON-ARRAY object? The schema walkers' notion of "a record to recurse into" — used by
// `jsonSchema` (validation) and `shapeToSchema` (output trimming), which walk the same values and so
// must agree about which of them are objects.
//
// Deliberately NOT the strictest possible test: a class instance IS a record here, because a handler
// returning one has still returned a shape whose declared fields must be validated and trimmed, and
// refusing to descend would let an undeclared field ride out on any value that wasn't an object
// literal. `slotIndex.ts` keeps its own prototype-checking version for the opposite reason — a
// selector is matched STRUCTURALLY there, so a class instance must be compared whole rather than
// field-by-field. Two questions that sound alike and are not, which is why this file says so.
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
