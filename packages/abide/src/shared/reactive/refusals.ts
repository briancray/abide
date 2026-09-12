// GROUP 15 — the one spelling for every refusal, and phase 1's own `produce` calls
// into it, which is why it lands before the graph rather than after.
//
// A CYCLE WITH `validate.ts`, and it is the honest shape rather than an accident:
// 15.9 has a schema refusal answered with `validationError`, so the validator reaches
// for this module; 15.12 has `refuse.typed` check its data with a `Schema` at
// construction, so this module reaches for the validator. Both edges are calls rather
// than module-scope reads, and both names are `function` declarations, so neither
// side can observe the other uninitialised. The alternative was a second return shape
// out of `validate` — an object per write, on the path a write walks.

import { warn } from '../warn.ts'
import { type Schema, validate } from './validate.ts'

// 19.7 — dot-joined, depth-limited, widening to `string` past the limit. The limit is
// what stops a recursive type from being unbounded on a self-referential shape.
type Descend = [never, 0, 1, 2, 3]
type Paths<T, Depth extends 0 | 1 | 2 | 3 | 4 = 4> = Depth extends 0
    ? string
    : T extends readonly unknown[]
      ? `${number}` | `${number}.${Paths<T[number], Descend[Depth]>}`
      : T extends object
        ? {
              [Key in keyof T & string]:
                  | Key
                  | `${Key}.${Paths<T[Key], Descend[Depth]>}`
          }[keyof T & string]
        : never

// What was wrong, keyed by where. The `''` entry is the whole-value issue, which is
// where 19.5 puts what a plain-function `Schema` threw.
export type Issues<T = unknown> = T extends object
    ? Partial<Record<Paths<T> | '', string[]>>
    : string[]

// 15.7 — structural, in-process and over a wire alike. `guards.ts` reads it by shape
// for that reason, so nothing here depends on the prototype surviving a round trip.
export type Failed<Name extends string = string, Data = unknown> = Error & {
    name: Name
    status: number
    message: string
    data: Data
}

function build<Name extends string, Data>(
    name: Name,
    status: number,
    message: string,
    data: Data,
): Failed<Name, Data> {
    const failed = new Error(message) as Failed<Name, Data>
    failed.name = name
    failed.status = status
    failed.data = data
    return failed
}

// 15.9 — what a `schema` refusing answers with, at 422.
export function validationError<T = unknown>(
    data?: Issues<T>,
): Failed<'ValidationError', Issues<T>> {
    return build(
        'ValidationError',
        422,
        'Validation failed',
        (data ?? {}) as Issues<T>,
    )
}

// 15.10 caps the refusal names an implementation may declare at what `notFound` and
// `validationError` carry plus the one 17.8 names; `notFound` is `SERVER.md`'s.
export const refuse = {
    typed<Name extends string, Data = undefined>(
        name: Name,
        status = 400,
        message?: string | ((data: Data) => string),
        options?: { schema?: Schema<Data> },
    ): ((data?: Data) => Failed<Name, Data>) & {
        is: (error: unknown) => error is Failed<Name, Data>
    } {
        const factory = (data?: Data): Failed<Name, Data> => {
            // 15.15 — the schema runs before the message function. 15.12 has it run
            // synchronously, here, rather than wherever the refusal is eventually
            // read; 15.16 has a refusal at this point WARN rather than stop the
            // `Failed` being built, which is what keeps 15.5 true.
            if (options?.schema !== undefined) {
                const checked = validate(options.schema, data)
                if (checked instanceof Error)
                    warn(
                        'abide:refuse',
                        `${name} was constructed with data its schema refused.`,
                        (checked as Failed).data,
                    )
            }
            let text = typeof message === 'string' ? message : name
            // 15.13 — a message given as a function runs at construction, on the
            // data. 15.14 — a throw from it is caught, the message falls back to the
            // name, and it warns.
            if (typeof message === 'function') {
                try {
                    text = message(data as Data)
                } catch (thrown) {
                    text = name
                    warn(
                        'abide:refuse',
                        `${name}'s message formatter threw.`,
                        thrown,
                    )
                }
            }
            return build(name, status, text, data as Data)
        }
        return Object.assign(factory, {
            is: (error: unknown): error is Failed<Name, Data> =>
                error !== null &&
                typeof error === 'object' &&
                (error as { name?: unknown }).name === name,
        })
    },
}
