// THE ONE REFUSAL TYPE, in-process and over a wire alike. RULEBOOK 15.1: a refusal is a
// declared VALUE, not a status code and not a transport concern — so the same object a
// `transform` returns (4.6) is the one a handler answers with (16.42) and the one a client
// narrows on (3.1), with nothing converting between three spellings on the way.
//
// IT IS AN `Error` AND IT IS NEVER THROWN, which is the pairing that takes the most
// explaining. 15.5 makes RETURNING one the refusal and 15.4 makes constructing one inert,
// so the `Error` base is not there to be thrown — it is there for the stack, for
// `console` rendering it as a failure rather than as a bag, and so that a `catch` that
// caught one from somewhere else still finds the shape it expects.

// `Data` IS UNCONSTRAINED, and that is the registry row rather than an oversight here.
// `refuse.typed` is where `JsonValue` binds, because that is the factory whose refusals
// cross a wire — and `Issues<T>` is the case that proves the two must differ: it is
// `Partial<Record<…, string[]>>`, whose members are `string[] | undefined`, so it is a
// perfectly good refusal payload that `JsonValue` does not describe.
export type Failed<Name extends string = string, Data = undefined> = Error & {
    name: Name
    status: number
    message: string
    data: Data
}

// 15.6: STRUCTURAL, and the clause is load-bearing rather than a preference. A `Failed`
// that crossed a wire was rebuilt from JSON by whatever revived it, so it is not
// `instanceof Error` and carries no brand this side put on it — a nominal check would
// answer false for the case the type exists to serve.
//
// THE THREE FIELDS ARE THE TEST, and `data` is not one of them: a refusal declaring no
// data has `undefined` there, and `JSON.stringify` drops an `undefined` member entirely,
// so requiring the key would fail exactly the values that made the trip.
//
// WHAT IT ADMITS is anything carrying a name, a status and a message — an error object
// from some other library that happens to have all three. That is 15.6 working as written
// rather than a hole in it: the clause says what a refusal IS, and something with all
// three is one.
export function isFailed(value: unknown): value is Failed<string, unknown> {
    if (value === null || typeof value !== 'object') return false
    const held = value as {
        name?: unknown
        status?: unknown
        message?: unknown
    }
    return (
        typeof held.name === 'string' &&
        typeof held.status === 'number' &&
        typeof held.message === 'string'
    )
}

// The one place a `Failed` is built, so the four fields are written in one order and
// nothing downstream meets two shapes. 15.4: INERT. Nothing here throws, nothing is
// registered, and no caller is told — a `Failed` nobody returns is an object nobody reads,
// which is what makes 15.10 a compile-time rule rather than a runtime one.
export function failed<Name extends string, Data>(
    name: Name,
    status: number,
    message: string,
    data: Data,
): Failed<Name, Data> {
    const refusal = new Error(message) as Failed<Name, Data>
    refusal.name = name
    refusal.status = status
    refusal.data = data
    return refusal
}
