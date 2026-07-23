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

import type { JSONSchema } from '../../shared/internal/jsonSchema.ts'
import { coerceStringToType, singleType } from '../../shared/internal/jsonSchema.ts'
import { jsonSchemaOf } from '../../shared/internal/shapeToSchema.ts'
import type { StandardSchemaV1 } from '../../shared/StandardSchema.ts'

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
            coerced.push(coerceStringToType(value, type))
        }
        // A field that was purely File(s) contributes nothing here — the `files` schema governs it.
        if (coerced.length === 0) continue
        // Repeated keys promote to an array (FormData.getAll semantics); a single value stays scalar.
        out[name] = coerced.length === 1 ? coerced[0] : coerced
    }
    return out
}
