/**
 * `own` with every property of `part` laid over it, an accessor kept an accessor: what a parts
 * function writes beside the parts of another it is built on. A spread would read each accessor
 * once, and 49.11 asks what a part reads that changes to stay one.
 */
export function withPart<Own extends object, Part extends object>(
    own: Own,
    part: Part,
): Own & Part {
    return Object.defineProperties(
        own,
        Object.getOwnPropertyDescriptors(part),
    ) as Own & Part
}
