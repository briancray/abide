// HOW A REFUSAL IS DECLARED AND HOW ONE IS MADE WITHOUT DECLARING IT. `refuse(status)` is
// the undeclared form (17.4) and `refuse.typed(name)` mints a factory for a named one
// (15.3): the bare call is the plain case, and the member is the one that says more.
//
// THREE NAMES AND NO MORE. 15.9 caps what this framework may declare at `NotFound`,
// `ValidationError` and the `HttpError` 17.4 names — everything else is the app's, through
// `refuse.typed`. A fourth built-in here is a refusal an app cannot have predicted and
// cannot narrow against a name it never wrote.

import { type Failed, failed, isFailed } from './Failed.ts'
import type { Issues } from './Issues.ts'
import type { JsonValue } from './JsonValue.ts'
import { runSchema, type Schema } from './Schema.ts'

// 17.4, 17.5: a status and nothing else. No data and no options bag for any — an
// undeclared refusal has no name to narrow on, so data on it could only be read by
// something that already knew what it was, and something that knew would have declared it.
export function refuse(
    status: number,
    message?: string,
): Failed<'HttpError', undefined> {
    return failed('HttpError', status, message ?? 'HttpError', undefined)
}

// 15.3: STATUS 400 BY DEFAULT, which is the answer to "the caller sent something this
// cannot work with" — the case an app declares a refusal for most often. 15.8 is the one
// exception the framework itself makes, and it says 422 out loud below.
//
// THE FACTORY IS THE VALUE, and `.is` hangs off it: the declaration site is the only place
// that knows the name, so it is the only place that can hand back a narrowing that cannot
// be spelled wrong. An app comparing `error.name === 'NotFound'` by hand is a string
// literal nothing checks.
refuse.typed = function typed<
    Name extends string,
    Data extends JsonValue | undefined = undefined,
>(
    name: Name,
    status = 400,
    message?: string | ((data: Data) => string),
    options?: { schema?: Schema<Data> },
): ((data?: Data) => Failed<Name, Data>) & {
    is: (error: unknown) => error is Failed<Name, Data>
} {
    const make = (data?: Data): Failed<Name, Data> => {
        // 15.11 AND 15.14: the data is checked at construction, and before the message
        // function — a formatter reading data the schema was about to refuse is a message
        // about a value that never existed. Synchronously, but that is 19.13 rather than
        // anything this call site arranges: no `Schema` may answer any other way.
        //
        // 15.15: A REFUSAL HERE WARNS RATHER THAN STOPPING THE `Failed` BEING BUILT, which
        // is 15.4 holding even against this. The schema is the app checking its own
        // refusal payload; getting that wrong is a bug in the app's error path, and taking
        // the refusal down with it means the caller receives nothing at all — the original
        // failure disappears behind a second one. The line on `abide:refuse` waits on
        // `log.named` (section 28); what is built is that construction survives.
        if (options?.schema !== undefined && data !== undefined)
            runSchema(options.schema, data)
        return failed(
            name,
            status,
            messageFor(name, message, data as Data),
            data as Data,
        )
    }
    // 15.6 is what makes this a name comparison rather than an `instanceof`: the refusal
    // may have been rebuilt from JSON on the other side of a wire.
    make.is = (error: unknown): error is Failed<Name, Data> =>
        isFailed(error) && error.name === name
    return make
}

// 15.12: A FUNCTION `message` RUNS AT CONSTRUCTION, on the data — not at read, so the
// string is fixed by the time anything can see it and cannot answer differently twice.
//
// 15.13: A THROW FROM IT IS CAUGHT and the message falls back to the NAME. A formatter
// that failed is a bug in the app, and taking the construction down with it would turn a
// cosmetic fault into a refusal the caller never receives — 15.4 has constructing a
// `Failed` inert, and a formatter is not an exception to that.
//
// THE WARNING 15.13 AND 15.15 ALSO ASK FOR waits on `log`: both name the `abide:refuse`
// namespace, and `log.named` is section 28 and is not written. Swallowing is the half that
// is observable and is gated; the line under the namespace lands with the logger.
function messageFor<Data>(
    name: string,
    message: string | ((data: Data) => string) | undefined,
    data: Data,
): string {
    if (message === undefined) return name
    if (typeof message !== 'function') return message
    try {
        return message(data)
    } catch {
        return name
    }
}

// 15.7: the address nothing answers. Both halves — no route matched, and no handler
// mounted at that address and method — are one refusal, because a caller cannot tell them
// apart and telling them apart is what an enumeration attack is.
export const notFound = refuse.typed<
    'NotFound',
    { path: string; method: string }
>('NotFound', 404)

// 15.8: 422 rather than `refuse.typed`'s 400, and the difference is not decoration. A 400
// is "this request is malformed"; a 422 is "it parsed and the contents are wrong", which
// is exactly what a schema that ran and refused has found out.
//
// THE FACTORY IS BUILT ONCE and the export is a thin generic over it. `Issues<T>` varies
// per call site and a `Failed`'s `data` does not care which shape it holds, so minting a
// factory per call would allocate one to throw away and hand back a `.is` that compares
// the same string the shared one does.
const validation = refuse.typed<'ValidationError', JsonValue>(
    'ValidationError',
    422,
)

export function validationError<T>(
    data?: Issues<T>,
): Failed<'ValidationError', Issues<T>> {
    return validation(data as JsonValue) as unknown as Failed<
        'ValidationError',
        Issues<T>
    >
}
