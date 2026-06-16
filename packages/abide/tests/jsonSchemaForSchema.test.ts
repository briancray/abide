import { describe, expect, test } from 'bun:test'
import { jsonSchemaForSchema } from '../src/lib/shared/jsonSchemaForSchema.ts'
import type { StandardSchemaV1 } from '../src/lib/shared/types/StandardSchemaV1.ts'

// A Standard Schema carrying an arbitrary JSON Schema projection (the shape Zod 4 / withJsonSchema expose).
function schemaWith(project: () => Record<string, unknown>): StandardSchemaV1 {
    return Object.assign(
        {
            '~standard': {
                version: 1 as const,
                vendor: 'test',
                validate: (value: unknown) => ({ value }),
            },
        },
        { toJSONSchema: project },
    )
}

const OPAQUE = { type: 'object', additionalProperties: true }

describe('jsonSchemaForSchema', () => {
    test('returns opaque object for an absent schema', () => {
        expect(jsonSchemaForSchema(undefined)).toEqual(OPAQUE)
    })

    test('returns opaque object when no projection method exists', () => {
        const schema: StandardSchemaV1 = {
            '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) },
        }
        expect(jsonSchemaForSchema(schema)).toEqual(OPAQUE)
    })

    test('projects via toJSONSchema when present', () => {
        const schema = schemaWith(() => ({ type: 'string' }))
        expect(jsonSchemaForSchema(schema)).toEqual({ type: 'string' })
    })

    /* A projection that throws — e.g. Zod 4 hitting z.custom() — must degrade to
    the opaque fallback, not escape, so one un-serializable schema can't take down
    the whole tools/list its caller builds. */
    test('degrades to opaque object when the projection throws', () => {
        const schema = schemaWith(() => {
            throw new Error('cannot render z.custom() to JSON Schema')
        })
        expect(jsonSchemaForSchema(schema)).toEqual(OPAQUE)
    })

    test('returns a fresh object callers can mutate without aliasing', () => {
        const first = jsonSchemaForSchema(undefined)
        first.description = 'mutated'
        expect(jsonSchemaForSchema(undefined)).toEqual(OPAQUE)
    })
})
