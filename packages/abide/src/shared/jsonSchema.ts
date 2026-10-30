import type { JsonValue } from './JsonValue.ts'
import type { StandardSchemaV1 } from './Schema.ts'
import { validateJson } from './validateJson.ts'

/**
 * A JSON Schema document as a Standard Schema, carrying its own validator.
 *
 * A document is data and something has to read it, so the edge to `validateJson` is made HERE, by
 * the call that declares one — a page that never calls this never carries the validator (19.13),
 * with no slot to fill and nothing for the compiler to spot. A bare document handed as a `Schema`
 * is refused (19.14).
 *
 * A STANDARD SCHEMA, because that is the form that already reports WHERE: each issue's path is
 * `validateJson`'s own, split at the dots `runSchema` joins it back at. And the document is
 * exposed where a Standard Schema exposes its JSON Schema, so 20.11's one probe publishes it with
 * no case of its own.
 *
 * 19.23 — WITH NO TYPE ARGUMENT IT IS `Untyped`, whose `validate` answers `any`: assignable to every
 * slot, and a source the checker draws NO candidate from. A document says nothing the checker can
 * read, so the value's type has to come from what the schema gates. Typed `StandardSchemaV1<never>`
 * instead, `never` was a candidate nested inside the schema, and a candidate that is not top level
 * stops a literal widening: `reactive(0, { schema })` was `Reactive<0>`. Typed
 * `StandardSchemaV1<any>`, `any` was a candidate and every gated value became `any`.
 */
export function jsonSchema<T = Untyped>(
    document: JsonValue,
): [T] extends [Untyped] ? UntypedSchema : StandardSchemaV1<T> {
    return {
        '~standard': {
            version: 1,
            vendor: 'abide',
            validate(value: unknown) {
                const found = validateJson(document, value) as
                    Record<string, string[]> | string[] | null
                if (found === null) return { value: value as T }
                const issues: { message: string; path: string[] }[] = []
                // A value that is not an object came back as the bare list, every issue on `''`.
                if (Array.isArray(found)) {
                    for (const message of found)
                        issues.push({ message, path: [] })
                    return { issues }
                }
                for (const path in found)
                    for (const message of found[path] as string[])
                        issues.push({
                            message,
                            path: path === '' ? [] : path.split('.'),
                        })
                return { issues }
            },
            jsonSchema: {
                input: () => document,
                output: () => document,
            },
        },
    } as [T] extends [Untyped] ? UntypedSchema : StandardSchemaV1<T>
}

declare const UNTYPED: unique symbol

/** The type argument a bare `jsonSchema` takes: no output was named. */
type Untyped = typeof UNTYPED

/** A Standard Schema whose output is whatever the slot it gates says (19.23). */
type UntypedSchema = {
    readonly '~standard': {
        readonly version: 1
        readonly vendor: string
        readonly validate: (value: unknown) => any
    }
}
