/**
 * `own` with every property of each part laid over it in order, an accessor kept an accessor: what
 * a parts function writes beside the parts of another it is built on. A spread would read each
 * accessor once, and 49.9 asks what a part reads that changes to stay one.
 */
export function withPart<Own extends object, Part extends object>(
    own: Own,
    part: Part,
): Own & Part
export function withPart<
    Own extends object,
    First extends object,
    Second extends object,
>(own: Own, first: First, second: Second): Own & First & Second
export function withPart<
    Own extends object,
    First extends object,
    Second extends object,
    Third extends object,
>(
    own: Own,
    first: First,
    second: Second,
    third: Third,
): Own & First & Second & Third
export function withPart(own: object, ...parts: object[]): object {
    for (const part of parts)
        Object.defineProperties(own, Object.getOwnPropertyDescriptors(part))
    return own
}
