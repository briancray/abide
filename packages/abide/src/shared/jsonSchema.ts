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
 */
export function jsonSchema<T>(document: JsonValue): StandardSchemaV1<T> {
    return {
        '~standard': {
            version: 1,
            vendor: 'abide',
            validate(value: unknown) {
                const found = validateJson(document, value) as
                    | Record<string, string[]>
                    | string[]
                    | null
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
    } as StandardSchemaV1<T>
}
