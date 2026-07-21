import { describe, expect, test } from 'bun:test'
import { withJsonSchema } from './withJsonSchema.ts'

describe('withJsonSchema', () => {
    const schema = {
        type: 'object' as const,
        properties: { name: { type: 'string' as const }, age: { type: 'number' as const } },
        required: ['name'],
    }

    test('exposes the original JSON Schema via toJSONSchema()', () => {
        const wrapped = withJsonSchema(schema)
        expect(wrapped.toJSONSchema()).toBe(schema)
    })

    test('validates as a Standard Schema (accepts valid, reports issues on invalid)', () => {
        const wrapped = withJsonSchema(schema)
        const ok = wrapped['~standard'].validate({ name: 'Ada', age: 36 })
        expect('issues' in (ok as object)).toBe(false)

        const bad = wrapped['~standard'].validate({ age: 36 }) as { issues?: unknown[] }
        expect(Array.isArray(bad.issues)).toBe(true)
        expect((bad.issues ?? []).length).toBeGreaterThan(0)
    })
})
