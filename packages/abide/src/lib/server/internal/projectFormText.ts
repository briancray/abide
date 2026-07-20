// projectFormText — the multipart TEXT-field projection for `input`-schema validation (TODO #8
// follow-up). A multipart mutation carries its text fields alongside its `File`s in one `FormData`;
// this extracts the NON-File entries into a plain object so the router can validate them against the
// same JSON `input` schema the non-multipart JSON args path uses. A `File` never rides in the JSON
// args object (decision TODO #8), so File entries are excluded here — the `files` schema
// (`validateFiles`) governs them separately.
//
// FormData text values are always strings, so each is coerced to the type its `input` schema property
// declares (mirroring `env.ts`'s string→typed coercion). Coercion is best-effort: an uncoercible
// value is left as the raw string so the schema validation — not this projector — produces the loud
// 422 issue. When the schema is opaque (a native Standard Schema, no field types available) or a
// field's type is undeclared, the raw string passes through unchanged.

import type { JSONSchema, JSONSchemaType } from '../../shared/internal/jsonSchema.ts'
import { jsonSchemaOf } from '../../shared/internal/shapeToSchema.ts'
import type { StandardSchemaV1 } from '../../shared/StandardSchema.ts'

// The non-null member of a `type` union (e.g. `["string","null"]` → "string"), mirroring env.ts.
function singleType(
    type: JSONSchemaType | JSONSchemaType[] | undefined,
): JSONSchemaType | undefined {
    if (Array.isArray(type)) return type.find((candidate) => candidate !== 'null')
    return type
}

// Coerce one raw string to its declared JSON-Schema type. Leaves the raw string when the value can't
// be coerced (validation reports the mismatch) or the type is string/untyped.
function coerceString(raw: string, type: JSONSchemaType | undefined): unknown {
    switch (type) {
        case 'number':
        case 'integer': {
            const parsed = Number(raw)
            if (raw.trim() === '' || !Number.isFinite(parsed)) return raw
            if (type === 'integer' && !Number.isInteger(parsed)) return raw
            return parsed
        }
        case 'boolean': {
            const lowered = raw.trim().toLowerCase()
            if (lowered === 'true') return true
            if (lowered === 'false') return false
            return raw
        }
        case 'object':
        case 'array':
        case 'null': {
            try {
                return JSON.parse(raw)
            } catch {
                return raw
            }
        }
        default:
            return raw // string or untyped — leave as-is.
    }
}

export function projectFormText(
    formData: FormData,
    inputSchema: StandardSchemaV1 | JSONSchema,
): Record<string, unknown> {
    const properties = jsonSchemaOf(inputSchema)?.properties
    const out: Record<string, unknown> = {}
    const seen = new Set<string>()
    for (const name of formData.keys()) {
        if (seen.has(name)) continue // getAll already collapses a repeated key; visit each name once
        seen.add(name)
        const type = singleType(properties?.[name]?.type)
        const coerced: unknown[] = []
        for (const value of formData.getAll(name)) {
            if (value instanceof File) continue // a File never rides in the JSON args object
            coerced.push(coerceString(value, type))
        }
        // A field that was purely File(s) contributes nothing here — the `files` schema governs it.
        if (coerced.length === 0) continue
        // Repeated keys promote to an array (FormData.getAll semantics); a single value stays scalar.
        out[name] = coerced.length === 1 ? coerced[0] : coerced
    }
    return out
}
