/*
What a verb error constructor returns: a plain descriptor (NOT a Response), so it
flows through the single `error()` funnel — `return error(errors.invalidCoupon({…}))`.
`error()` reads `status` off it and serializes `{ $error: name, data }` as the body.
*/
export type ErrorDescriptor<Name extends string = string, Data = unknown> = {
    readonly $abideError: Name
    readonly status: number
    readonly data: Data
}
