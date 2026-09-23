// THE TWO FORMS A SHAPE MAY BE DECLARED IN, and one place that runs them. RULEBOOK 4.3
// puts a schema first on every way in, so this is reached from a write, a publish, a body's
// production (11.47) and an adoption (11.48) alike — one statement of what "the schema
// refused" means, rather than four that drift apart.
//
// 19.3 IS WHAT MAKES THE FORMS ONE THING: a `Schema` returns what it ACCEPTS. Not a
// boolean, not a report — the value, so the pipeline downstream of it (4.4, `transform`)
// receives something already checked and already typed. A form that could only answer
// yes/no would leave the value untyped on the other side.
//
// 19.7 IS THE OTHER HALF: coercion belongs to the pipeline and is never asked of a schema.
// Together they are what lets 19.4 be enforced at all — see `runSchema`.

import { note } from './note.ts'
import { isThenable } from './reactive/isThenable.ts'
import { untracked } from './reactive/tracking.ts'

// The Standard Schema contract, declared here rather than depended on: it is an interface
// a library implements, so an import would put a package in this seam's graph to gain a
// shape that is fifteen lines. CLAUDE.md prices an import edge by the module it lands on,
// and this one lands on every page.
// NOT EXPORTED. `StandardSchemaV1` is the name a library implements and the one an app
// annotates with; this is the shape of what its `validate` answers, and exporting it would
// put a second name on the barrel that nothing resolves through — public surface by
// accident rather than by decision.
type StandardResult<Output> =
    | { readonly value: Output; readonly issues?: undefined }
    | {
          readonly issues: readonly {
              readonly message: string
              readonly path?: readonly (
                  | PropertyKey
                  | { readonly key: PropertyKey }
              )[]
          }[]
      }

export type StandardSchemaV1<Output = unknown> = {
    readonly '~standard': {
        readonly version: 1
        readonly vendor: string
        readonly validate: (
            value: unknown,
        ) => StandardResult<Output> | PromiseLike<StandardResult<Output>>
    }
}

// A JSON Schema document is the Standard form once `jsonSchema` wraps it — see that module for
// why the document does not stand here on its own.
export type Schema<T> = ((value: unknown) => T) | StandardSchemaV1<T>

// ISSUES RATHER THAN A REFUSAL, and that is what keeps this module out of a cycle: a
// `validationError` is built by `refuse`, `refuse` runs a schema (15.11), and the two
// importing each other is an edge a bundler has to break. What a schema knows is WHAT WAS
// WRONG AND WHERE; turning that into a named refusal at 422 (15.8) is the caller's, and
// the caller is the one place that knows whether this was a write, a publish or a body.
export type Checked = { value: unknown; issues: Found | null }

function accepted(value: unknown): Checked {
    return { value, issues: null }
}

// KEYED BY PATH, and the type is written out rather than reached for as `Issues<unknown>`:
// `Issues<T>` answers `string[]` where `T` is not an object, and `unknown` is not, so that
// spelling types the record as a list and every cast around it as a mistake.
export type Found = Record<string, string[]>

function refusedAs(found: Found): Checked {
    return { value: undefined, issues: found }
}

// 19.5: the plain-function form throws what it refuses, and the throw becomes the `''`
// entry — the key for "about the value itself", which is all a bare throw can say.
function fromThrow(thrown: unknown): Checked {
    const said =
        thrown instanceof Error
            ? thrown.message
            : typeof thrown === 'string'
              ? thrown
              : 'was refused'
    // EVERY THROW BECOMES THE `''` ENTRY, a `Failed` included — 19.5 says so without
    // carving one out, and the carve-out was worth trying and dropping: a schema that
    // throws a named refusal reads as though the name should survive, but then a `schema`
    // and a `transform` refuse in two different shapes and 4.4's pipeline has two kinds of
    // stop in it. A `transform` is where a named refusal belongs (4.6).
    return refusedAs({ '': [said] })
}

// 19.6's `''` key, from a Standard Schema issue's path.
function pathOf(
    path: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined,
): string {
    if (path === undefined || path.length === 0) return ''
    const parts: string[] = []
    for (const step of path) {
        const key =
            step !== null && typeof step === 'object' && 'key' in step
                ? step.key
                : step
        parts.push(String(key))
    }
    return parts.join('.')
}

// 4.7 — A SCHEMA RUNS UNTRACKED, and the clearing is HERE because running one is what the clause
// is about. Held in the two callers `Reactive.ts` owns, `refuse.typed`'s gate and `Keyed`'s
// argument gate ran tracked: a refusal built inside an effect subscribed that effect to whatever
// its schema read, and the read was spliced into the body's cursor-ordered `sources` besides.
export function runSchema(schema: unknown, value: unknown): Checked {
    return untracked(runSchemaTracked, schema, value)
}

function runSchemaTracked(schema: unknown, value: unknown): Checked {
    if (typeof schema === 'function') {
        let returned: unknown
        try {
            returned = (schema as (value: unknown) => unknown)(value)
        } catch (thrown) {
            return fromThrow(thrown)
        }
        // 19.4: A PREDICATE IS NOT A `Schema`, and this is where it is caught rather than
        // in the type — `Schema<boolean>` and a predicate are the same function type, so
        // no annotation can separate them. What separates them at runtime is 19.3 plus
        // 19.7: a schema returns what it ACCEPTS and never coerces, so a function handed a
        // non-boolean and answering a boolean has answered a QUESTION about the value
        // rather than returning it. A real `Schema<boolean>` only ever sees booleans.
        if (typeof returned === 'boolean' && typeof value !== 'boolean')
            throw new Error(
                'A predicate is not a Schema: it answered true/false where the value was expected. A Schema returns what it accepts (RULEBOOK 19.3) and throws what it refuses (19.5).',
            )
        return accepted(returned)
    }

    if (schema !== null && typeof schema === 'object') {
        const standard = (schema as Partial<StandardSchemaV1>)['~standard']
        if (standard !== undefined) return runStandard(standard, value)
    }

    // 19.15: A BARE DOCUMENT IS REFUSED, never accepted. Accepting would be a declared constraint
    // that silently does not apply — `validateJson`'s own header calls that the one failure a
    // validation layer must not have — and the sentence reaches the author the way every other
    // bad schema does, on the `''` entry.
    return fromThrow(
        new Error(
            'A JSON Schema document is not a Schema on its own: wrap it as `jsonSchema(document)`, which brings the validator that reads it (RULEBOOK 19.15).',
        ),
    )
}

function runStandard(
    standard: StandardSchemaV1['~standard'],
    value: unknown,
): Checked {
    let result: StandardResult<unknown> | PromiseLike<StandardResult<unknown>>
    try {
        result = standard.validate(value)
    } catch (thrown) {
        return fromThrow(thrown)
    }
    // 19.13: AN ASYNC SCHEMA IS REFUSED, and this is a decision rather than a gap. The
    // machinery to await one exists and is not the obstacle — `absorb` already turns a
    // write into a load (4.2), captures a `generation` and resumes the pipeline when the
    // promise settles, so a second suspension point here would reuse it.
    //
    // WHAT IT WOULD COST IS THE MEANING OF A SYNCHRONOUS WRITE. `s.set(5); s()` answers 5
    // today; behind an async gate it answers the value it held, because nothing has landed
    // — and it would answer that way because of a GATE rather than because the app passed a
    // load. `busy` moves with it: a settled write flips `loading` for a microtask, so a
    // `{#if s.busy()}` spinner flickers on every keystroke of a bound input. Making a write
    // asynchronous is the app's to ask for by passing a promise, not a schema's to impose.
    // The `try` above covers the CALL, not what came back: an adapter answering `undefined` or
    // `null` threw a TypeError off the `.then` probe, out of `runSchema` and into whatever called
    // `s.set` — the one thing every other arm here turns into a refusal instead.
    if (result === null || typeof result !== 'object')
        return fromThrow(
            new Error(
                `The schema from "${standard.vendor}" answered ${result === null ? 'null' : typeof result}. A Standard Schema must answer a result object.`,
            ),
        )
    if (isThenable(result))
        throw new Error(
            `The schema from "${standard.vendor}" answered asynchronously. A Schema must be synchronous (RULEBOOK 19.13): validate what is already settled, or make the write a load by passing a promise.`,
        )
    const settled = result as StandardResult<unknown>
    if (settled.issues === undefined) return accepted(settled.value)
    // A path is built from the offending KEY, which for a record schema is the caller's — `note`
    // is why `constructor` and `__proto__` land as members rather than as the prototype's.
    const found: Found = {}
    for (const issue of settled.issues)
        note(found, pathOf(issue.path), issue.message)
    return refusedAs(found)
}
