// HOW A REFUSAL IS DECLARED AND HOW ONE IS MADE WITHOUT DECLARING IT. `refuse(status)` is
// the undeclared form (17.4) and `refuse.named(name)` mints a factory for a named one
// (15.3): the bare call is the plain case, and the member is the one that says more.
//
// FOUR NAMES AND NO MORE. 15.9 caps what this framework may declare at `NotFound`,
// `ValidationError`, `Aborted` and the `HttpError` 17.4 names — everything else is the app's,
// through `refuse.named`. A fifth built-in here is a refusal an app cannot have predicted and
// cannot narrow against a name it never wrote. `Aborted` is the one the app asks for itself: it
// comes back only from a call the app handed a signal and then aborted (16.49).

import { FAILURE_STATUS_TEXT } from './FAILURE_STATUS_TEXT.ts'
import { type Failed, failed, isFailed } from './Failed.ts'
import type { Issues } from './Issues.ts'
import type { JsonValue } from './JsonValue.ts'
import { namedLogger } from './log.ts'
import { type Found, runSchema, type Schema } from './Schema.ts'

/** The `abide:refuse` logger (28.9) — 15.13 and 15.15's namespace. */
const REFUSE_LOG = namedLogger('abide:refuse')

/**
 * An undeclared refusal: a status, and a message that defaults to its reason phrase.
 *
 * 17.4, 17.5: a status and nothing else. No data and no options bag for any — an
 * undeclared refusal has no name to narrow on, so data on it could only be read by
 * something that already knew what it was, and something that knew would have declared it.
 * 17.8 — no message is the status's reason phrase.
 */
export function refuse(
    status: number,
    message?: string,
): Failed<'HttpError', undefined> {
    return failed(
        'HttpError',
        status,
        message ?? FAILURE_STATUS_TEXT[status] ?? 'HttpError',
        undefined,
    )
}

/**
 * A declared refusal's factory, with its `.is` narrowing.
 *
 * 15.3: STATUS 400 BY DEFAULT, which is the answer to "the caller sent something this
 * cannot work with" — the case an app declares a refusal for most often. 15.8 is the one
 * exception the framework itself makes, and it says 422 out loud below.
 *
 * THE FACTORY IS THE VALUE, and `.is` hangs off it: the declaration site is the only place
 * that knows the name, so it is the only place that can hand back a narrowing that cannot
 * be spelled wrong. An app comparing `error.name === 'NotFound'` by hand is a string
 * literal nothing checks.
 */
type Declared<Name extends string, Data> = ((
    data?: Data,
) => Failed<Name, Data>) & {
    is: (error: unknown) => error is Failed<Name, Data>
}

/**
 * The two overloads of `refuse.named`: bare, or with a data `schema`.
 *
 * 15.18 — DATA IS DECLARED BY ITS `schema` AND BY NOTHING ELSE, so the name is never written
 * twice. TypeScript has no partial inference: an app that could hand `Data` over as a type
 * argument had to hand `Name` over beside it, spelling `<'TooBig', …>('TooBig')`. Taken off the
 * schema, both are inferred — and a message function is typed by the data it is given.
 */
type Named = {
    <Name extends string>(
        name: Name,
        status?: number,
        message?: string,
    ): Declared<Name, undefined>
    <Name extends string, Data extends JsonValue>(
        name: Name,
        status: number | undefined,
        message: string | ((data: Data) => string) | undefined,
        options: { schema: Schema<Data> },
    ): Declared<Name, Data>
}

refuse.named = named as Named

/**
 * Mints the factory for a named refusal: `refuse.named`'s body.
 *
 * The one body both overloads share, and what the framework's own declarations call with their
 * `Data` spelled out — they are trusted, and a schema run on every 404 would buy nothing.
 */
function named<Name extends string, Data>(
    name: Name,
    status = 400,
    message?: string | ((data: Data) => string),
    options?: { schema?: Schema<Data> },
): Declared<Name, Data> {
    // 15.13 — resolved once, here, rather than on every construction.
    const fallback = FAILURE_STATUS_TEXT[status] ?? name
    const make = (data?: Data): Failed<Name, Data> => {
        // 15.11 AND 15.14: the data is checked at construction, and before the message
        // function — a formatter reading data the schema was about to refuse is a message
        // about a value that never existed. Synchronously, but that is 19.12 rather than
        // anything this call site arranges: no `Schema` may answer any other way.
        //
        // 15.15: A REFUSAL HERE WARNS RATHER THAN STOPPING THE `Failed` BEING BUILT, which
        // is 15.4 holding even against this. The schema is the app checking its own
        // refusal payload; getting that wrong is a bug in the app's error path, and taking
        // the refusal down with it means the caller receives nothing at all — the original
        // failure disappears behind a second one.
        //
        // 15.4 IS UNCONDITIONAL, so the call is wrapped. `runSchema` has two exits — a `Checked`
        // for a bad VALUE and a THROW for a bad SCHEMA (a predicate, 19.3; an async one, 19.12;
        // a `JsonSchema` keyword `validateJson` does not implement) — and only the first was
        // being handled here. The three that throw took the `Failed` with them, which is exactly
        // the harm 15.15 above says it exists to prevent.
        //
        // BOTH EXITS WARN, which is the rest of 15.15. Wrapped and discarded, the call had no
        // observable effect at all: an app whose refusal payload does not match its own schema
        // paid the walk and was told nothing, and neither did a schema this cannot run.
        if (options?.schema !== undefined && data !== undefined)
            try {
                const checked = runSchema(options.schema, data)
                if (checked.issues !== null)
                    REFUSE_LOG.warning(name, checked.issues)
            } catch (thrown) {
                REFUSE_LOG.warning(name, thrown)
            }
        return failed(
            name,
            status,
            messageFor(name, message, fallback, data as Data),
            data as Data,
        )
    }
    // 15.6 is what makes this a name comparison rather than an `instanceof`: the refusal
    // may have been rebuilt from JSON on the other side of a wire.
    make.is = (error: unknown): error is Failed<Name, Data> =>
        isFailed(error) && error.name === name
    return make
}

/**
 * A refusal's message: the given one, what a message function makes of the data, or the fallback.
 *
 * 15.12: A FUNCTION `message` RUNS AT CONSTRUCTION, on the data — not at read, so the
 * string is fixed by the time anything can see it and cannot answer differently twice.
 *
 * 15.13: NO MESSAGE IS THE STATUS'S REASON PHRASE (17.8), or the NAME for a status with none —
 * and so is a message function that threw. A formatter that failed is a bug in the app, and
 * taking the construction down with it would turn a cosmetic fault into a refusal the caller
 * never receives — 15.4 has constructing a `Failed` inert, and a formatter is not an exception.
 *
 * AND WARNED on `abide:refuse`, which is the rest of 15.13.
 */
function messageFor<Data>(
    name: string,
    message: string | ((data: Data) => string) | undefined,
    fallback: string,
    data: Data,
): string {
    if (message === undefined) return fallback
    if (typeof message !== 'function') return message
    try {
        return message(data)
    } catch (thrown) {
        REFUSE_LOG.warning(name, thrown)
        return fallback
    }
}

/**
 * The `NotFound` refusal, at 404.
 *
 * 15.7: the address nothing answers. Both halves — no route matched, and no handler
 * mounted at that address and method — are one refusal, because a caller cannot tell them
 * apart and telling them apart is what an enumeration attack is.
 */
export const notFound = named<'NotFound', { path: string; method: string }>(
    'NotFound',
    404,
)

/**
 * The `Aborted` refusal, at 499.
 *
 * 16.49: a load every caller of which aborted. 499 is the status a server logs for a request its
 * client closed, and the one thing true of this refusal is that nobody is waiting for the answer.
 */
export const aborted = named<'Aborted', undefined>('Aborted', 499)

/**
 * The shared `ValidationError` factory, at 422.
 *
 * 15.8: 422 rather than `refuse.named`'s 400, and the difference is not decoration. A 400
 * is "this request is malformed"; a 422 is "it parsed and the contents are wrong", which
 * is exactly what a schema that ran and refused has found out.
 *
 * THE FACTORY IS BUILT ONCE and the export is a thin generic over it. `Issues<T>` varies
 * per call site and a `Failed`'s `data` does not care which shape it holds, so minting a
 * factory per call would allocate one to throw away and hand back a `.is` that compares
 * the same string the shared one does.
 */
const validation = named<'ValidationError', JsonValue>('ValidationError', 422)

/** A `ValidationError` refusal at 422, carrying the issues it found. */
export function validationError<T>(
    data?: Issues<T>,
): Failed<'ValidationError', Issues<T>> {
    return validation(data as JsonValue) as unknown as Failed<
        'ValidationError',
        Issues<T>
    >
}

/**
 * Args run through their gate: the accepted value, or a thrown `ValidationError`.
 *
 * 11.27, 16.17 — THE `args` GATE, for both places it stands: a keyed entry's run and a rung's
 * `ctx.args()`. Here rather than in `Schema.ts` for that module's own reason — it cannot build the
 * refusal it throws.
 */
export function checkArgs<Args>(gate: Schema<Args>, args: unknown): Args {
    const answer = runSchema(gate, args)
    if (answer.issues !== null) throw validationError<Found>(answer.issues)
    return answer.value as Args
}
