import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import type { JSONSchema } from '../../shared/internal/jsonSchema.ts'
import { deriveSchema } from './deriveSchema.ts'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/handlers.ts', import.meta.url))

describe('deriveSchema', () => {
    test('derives input/output for a wrapped async handler with mixed field shapes', () => {
        const { input, output, warnings } = deriveSchema(FIXTURE, 'create')

        expect(input).toBeDefined()
        if (input === undefined) throw new Error('expected input schema to be derived')
        const inputSchema = input
        expect(inputSchema.type).toBe('object')

        const props = inputSchema.properties
        if (props === undefined) throw new Error('expected input schema to have properties')
        // Primitive field.
        expect(props.id).toEqual({ type: 'number' })
        // Optional field is present but excluded from `required`.
        expect(props.name).toEqual({ type: 'string' })
        // Literal union collapses to an enum.
        const role = props.role
        if (role === undefined) throw new Error('expected a role property')
        expect(role.enum).toBeDefined()
        expect([...(role.enum as string[])].sort()).toEqual(['admin', 'guest', 'user'])
        // Array field.
        expect(props.tags).toEqual({ type: 'array', items: { type: 'string' } })
        // Date -> date-time string.
        expect(props.createdAt).toEqual({ type: 'string', format: 'date-time' })
        // Nested object with its own optional prop.
        const profile = props.profile
        if (profile === undefined) throw new Error('expected a profile property')
        expect(profile.type).toBe('object')
        const profileProps = profile.properties
        if (profileProps === undefined) throw new Error('expected profile properties')
        expect(profileProps.bio).toEqual({ type: 'string' })
        expect(profile.required).toEqual(['bio'])

        // `required` excludes the optional top-level fields (name) and any unrepresentable field.
        const required = inputSchema.required ?? []
        expect(required).toContain('id')
        expect(required).toContain('role')
        expect(required).not.toContain('name')

        // Function-typed field is permissive {} and produces a LOUD warning naming the field.
        expect(props.onEvent).toEqual({})
        const functionWarning = warnings.find((w) => w.includes('onEvent'))
        expect(functionWarning).toBeDefined()
        expect(functionWarning).toContain('function')

        // Promise return type is unwrapped to its settled value.
        expect(output).toBeDefined()
        if (output === undefined) throw new Error('expected output schema to be derived')
        expect(output.type).toBe('object')
        const outputProps = output.properties
        if (outputProps === undefined) throw new Error('expected output properties')
        expect(outputProps.ok).toEqual({ type: 'boolean' })
        expect(outputProps.id).toEqual({ type: 'number' })
        const outputRequired = output.required
        if (outputRequired === undefined) throw new Error('expected output required')
        expect(outputRequired.sort()).toEqual(['id', 'ok'])
    })

    test('derives from a direct (unwrapped) arrow function', () => {
        const { input, output, warnings } = deriveSchema(FIXTURE, 'echo')
        expect(warnings).toEqual([])
        expect(input).toEqual({
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
        })
        expect(output).toEqual({
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
        })
    })

    test('handles number-literal unions, tuples, and nullable fields', () => {
        const { input } = deriveSchema(FIXTURE, 'configure')
        if (input === undefined) throw new Error('expected input schema to be derived')
        const props = input.properties
        if (props === undefined) throw new Error('expected input properties')

        // Number-literal union -> enum of numbers.
        const level = props.level
        if (level === undefined) throw new Error('expected a level property')
        expect((level.enum as number[]).slice().sort()).toEqual([1, 2, 3])

        // Tuple -> array with fixed-length positional prefixItems.
        const pair = props.pair as JSONSchema & { prefixItems?: JSONSchema[] }
        expect(pair.type).toBe('array')
        expect(pair.prefixItems).toEqual([{ type: 'number' }, { type: 'string' }])
        expect(pair.minItems).toBe(2)
        expect(pair.maxItems).toBe(2)

        // `string | null` -> anyOf including a null branch.
        const nickname = props.nickname
        if (nickname === undefined) throw new Error('expected a nickname property')
        expect(nickname.anyOf).toBeDefined()
        const branches = nickname.anyOf
        if (branches === undefined) throw new Error('expected nickname.anyOf')
        expect(branches).toContainEqual({ type: 'null' })
        expect(branches).toContainEqual({ type: 'string' })
    })

    test('warns (does not throw) when the export is not callable', () => {
        const { input, output, warnings } = deriveSchema(FIXTURE, 'notAFunction')
        expect(input).toBeUndefined()
        expect(output).toBeUndefined()
        expect(warnings.some((w) => w.includes('not callable'))).toBe(true)
    })

    test('warns when the export does not exist', () => {
        const { warnings } = deriveSchema(FIXTURE, 'doesNotExist')
        expect(warnings.some((w) => w.includes('not found'))).toBe(true)
    })
})
