import { describe, expect, test } from 'bun:test'
import { env } from '../src/lib/server/env.ts'
import { envSchemaStore } from '../src/lib/server/runtime/envSchemaStore.ts'
import type { StandardSchemaV1 } from '../src/lib/shared/types/StandardSchemaV1.ts'

/*
Schema that reads two keys off the env object: PRESENT must be a string,
returned as `seen`; MISSING is required and reported when absent. Enough to
exercise success, the aggregated failure message, and the sync-only guard
without pulling in a schema library.
*/
function requireKeys(): StandardSchemaV1<unknown, { seen: string }> {
    return {
        '~standard': {
            version: 1,
            vendor: 'belte-test',
            validate: (value) => {
                const record = value as Record<string, string | undefined>
                const issues = (['PRESENT', 'MISSING'] as const)
                    .filter((key) => record[key] === undefined)
                    .map((key) => ({ message: 'required', path: [key] }))
                if (issues.length > 0) {
                    return { issues }
                }
                return { value: { seen: record.PRESENT as string } }
            },
        },
    }
}

describe('env', () => {
    test('returns the parsed config when the schema passes', () => {
        Bun.env.PRESENT = 'a'
        Bun.env.MISSING = 'b'
        expect(env(requireKeys())).toEqual({ seen: 'a' })
        delete Bun.env.PRESENT
        delete Bun.env.MISSING
    })

    test('throws with every missing variable listed at once', () => {
        delete Bun.env.PRESENT
        delete Bun.env.MISSING
        expect(() => env(requireKeys())).toThrow(
            '[belte] invalid environment:\n  PRESENT: required\n  MISSING: required',
        )
    })

    test('throws when the schema validates asynchronously', () => {
        const asyncSchema: StandardSchemaV1 = {
            '~standard': {
                version: 1,
                vendor: 'belte-test',
                validate: async (value) => ({ value }),
            },
        }
        expect(() => env(asyncSchema)).toThrow('must validate synchronously')
    })

    test('registers the schema so the bundle form can project it', () => {
        Bun.env.PRESENT = 'a'
        Bun.env.MISSING = 'b'
        const schema = requireKeys()
        env(schema)
        expect(envSchemaStore.schema).toBe(schema)
        delete Bun.env.PRESENT
        delete Bun.env.MISSING
    })

    test('skipValidation registers without validating (launcher form-projection path)', () => {
        delete Bun.env.PRESENT
        delete Bun.env.MISSING
        const schema = requireKeys()
        envSchemaStore.skipValidation = true
        try {
            // a required key is missing, yet env() must not throw — it only
            // records the schema for the form and returns Bun.env.
            expect(() => env(schema)).not.toThrow()
            expect(envSchemaStore.schema).toBe(schema)
        } finally {
            envSchemaStore.skipValidation = false
        }
    })
})
