// THE THREE ARMS OF `Schema<T>`, discriminated at the call site.
//
// `schema.parse(incoming)` matches NONE of them and was the sketch this replaced: a
// plain function has no `.parse`, a `JsonSchema` is a `JsonValue` and has no `.parse`,
// and a StandardSchemaV1 validates through `~standard.validate`. The type is
// `((value: unknown) => T) | StandardSchemaV1<T> | JsonSchema` and the discrimination
// is by SHAPE, in that order — a function first, then the branded member, then a
// document.
//
// 4.5 — a `schema` refuses by THROWING, and the throw is caught and converted rather
// than allowed to escape the write. That is the whole reason this hands back a
// `Failed` instead of rethrowing.

import { validationError } from './refusals.ts'

export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue }

// A JSON Schema document, the native form. It is a `JsonValue` rather than a shape of
// its own, which is what makes the third arm of `Schema<T>` indistinguishable from a
// plain object at the type level and discriminated by shape at the call site.
export type JsonSchema = JsonValue

export type StandardSchemaV1<T> = {
    '~standard': {
        validate: (value: unknown) =>
            | { value: T; issues?: undefined }
            | {
                  issues: readonly {
                      message: string
                      path?: readonly unknown[]
                  }[]
              }
    }
}

export type Schema<T> =
    | ((value: unknown) => T)
    | StandardSchemaV1<T>
    | JsonSchema

type StandardResult = {
    value?: unknown
    issues?: readonly { message: string; path?: readonly unknown[] }[]
}

function messageOf(thrown: unknown): string {
    if (thrown instanceof Error) return thrown.message
    return String(thrown)
}

// 19.5 — what the plain-function form threw becomes the `''` entry of `Issues<T>`,
// and REGISTRY's `Issues<T>` row is a CONDITIONAL: keyed by path on a composite and a
// bare list on a primitive. There is no `''` key on the list arm, so the shape is
// decided from the value rather than from a `T` no runtime holds. A record with a
// single `''` key handed back for `Issues<number>` reads correctly and does not
// typecheck against the row that declared it.
function wholeValue(value: unknown, message: string): unknown {
    if (value !== null && typeof value === 'object') return { '': [message] }
    return [message]
}

function fromStandardIssues(
    issues: readonly { message: string; path?: readonly unknown[] }[],
): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const issue of issues) {
        const at = (issue.path ?? [])
            .map((segment) =>
                typeof segment === 'object' && segment !== null
                    ? String((segment as { key?: unknown }).key)
                    : String(segment),
            )
            .join('.')
        const held = out[at]
        if (held === undefined) out[at] = [issue.message]
        else held.push(issue.message)
    }
    return out
}

export function validate(schema: unknown, value: unknown): unknown {
    if (typeof schema === 'function') {
        try {
            return (schema as (value: unknown) => unknown)(value)
        } catch (thrown) {
            return validationError(
                wholeValue(value, messageOf(thrown)) as never,
            )
        }
    }
    const standard = (
        schema as { '~standard'?: { validate?: (value: unknown) => unknown } }
    )?.['~standard']
    if (standard !== undefined && typeof standard.validate === 'function') {
        let result: unknown
        try {
            result = standard.validate(value)
        } catch (thrown) {
            return validationError(
                wholeValue(value, messageOf(thrown)) as never,
            )
        }
        // 4.3 has the schema run FIRST, on the settled value, which is a synchronous
        // position — an async standard schema has no place to be awaited that is not
        // after the production it gates. It refuses rather than being silently
        // awaited into a second, later write.
        if (typeof (result as { then?: unknown })?.then === 'function')
            return validationError(
                wholeValue(
                    value,
                    'An asynchronous `schema` cannot gate a write.',
                ) as never,
            )
        const settled = result as StandardResult
        if (settled.issues !== undefined)
            return validationError(fromStandardIssues(settled.issues) as never)
        return settled.value
    }
    // The `JsonSchema` arm. REGISTRY names `validateJson` as the native validator and
    // 19.9 governs the coercion in front of it; both are group 19's and neither has
    // landed, so the arm REFUSES rather than passing the value through unchecked — a
    // gate that silently admits everything is the one failure mode a gate has.
    return validationError(
        wholeValue(
            value,
            'A JSON Schema `schema` needs `validateJson`, which has not landed. Declare the schema as a function or a Standard Schema.',
        ) as never,
    )
}
