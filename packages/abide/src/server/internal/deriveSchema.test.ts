import { beforeAll, describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import type { JSONSchema } from '../../shared/internal/jsonSchema.ts'
import { deriveOne, deriveSchemas } from './deriveSchema.ts'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/handlers.ts', import.meta.url))
const DEFAULT_FIXTURE = fileURLToPath(new URL('./__fixtures__/defaultRpc.ts', import.meta.url))
const OUTPUTS_FIXTURE = fileURLToPath(new URL('./__fixtures__/outputs.ts', import.meta.url))
const DEFAULTS_FIXTURE = fileURLToPath(
    new URL('./__fixtures__/destructuringDefaults.ts', import.meta.url),
)

describe('deriveSchema', () => {
    test('derives input/output for a wrapped async handler with mixed field shapes', async () => {
        const { input, output, warnings } = await deriveOne(FIXTURE, 'create')

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

    test('derives from a direct (unwrapped) arrow function', async () => {
        const { input, output, warnings } = await deriveOne(FIXTURE, 'echo')
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

    test('handles number-literal unions, tuples, and nullable fields', async () => {
        const { input } = await deriveOne(FIXTURE, 'configure')
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

    test('warns (does not throw) when the export is not callable', async () => {
        const { input, output, warnings } = await deriveOne(FIXTURE, 'notAFunction')
        expect(input).toBeUndefined()
        expect(output).toBeUndefined()
        expect(warnings.some((w) => w.includes('not callable'))).toBe(true)
    })

    test('warns when the export does not exist', async () => {
        const { warnings } = await deriveOne(FIXTURE, 'doesNotExist')
        expect(warnings.some((w) => w.includes('not found'))).toBe(true)
    })

    test('option 5: derives the input schema from destructuring defaults (no annotation)', async () => {
        const { input, warnings } = await deriveOne(FIXTURE, 'defaulted')
        expect(warnings).toEqual([])
        if (input === undefined) throw new Error('expected input schema to be derived')
        expect(input.type).toBe('object')
        const props = input.properties
        if (props === undefined) throw new Error('expected input properties')
        // The default itself now rides along — see the `destructuring defaults` block below for why.
        expect(props.message).toEqual({ type: 'string', default: 'hello' })
        expect(props.count).toEqual({ type: 'number', default: 0 })
        // `boolean` is modeled as the `false | true` union → enum of both literals.
        expect(props.flag).toEqual({ enum: [false, true], default: false })
        // Every field has a default → all optional → no `required`.
        expect(input.required).toBeUndefined()
    })

    test('option 5: warns (loud) on a param field that is `any` (no default, no annotation)', async () => {
        const { input, warnings } = await deriveOne(FIXTURE, 'partlyUntyped')
        // The untyped field is called out by path...
        expect(warnings.some((w) => w.includes('`any`') && w.includes('"id"'))).toBe(true)
        // ...while the defaulted sibling still derives cleanly.
        const props = input?.properties
        if (props === undefined) throw new Error('expected input properties')
        expect(props.count).toEqual({ type: 'number', default: 0 })
        expect(props.id).toEqual({})
    })

    test('a zero-arg handler yields no input and no `any` warning', async () => {
        const { input, warnings } = await deriveOne(FIXTURE, 'zeroArg')
        expect(input).toBeUndefined()
        expect(warnings).toEqual([])
    })

    test('unwraps `export default GET(...)` to the handler arg (not the Rpc parameter tuple)', async () => {
        const { input, output, warnings } = await deriveOne(DEFAULT_FIXTURE, 'default')
        // The single arg object — NOT an array/tuple (the pre-fix bug read the Rpc callable's params).
        expect(input).toEqual({
            type: 'object',
            properties: { key: { type: 'string', default: 'alpha' } },
        })
        expect(output).toEqual({
            type: 'object',
            properties: { key: { type: 'string' }, runs: { type: 'number' } },
            required: ['key', 'runs'],
        })
        expect(warnings).toEqual([])
    })
})

describe('deriveSchema — §11.4 output-wrapper unwrapping', () => {
    test('json(T) output sees through to T', async () => {
        const { output, warnings } = await deriveOne(OUTPUTS_FIXTURE, 'jsonReturn')
        expect(output).toEqual({
            type: 'object',
            properties: { id: { type: 'number' }, name: { type: 'string' } },
            required: ['id', 'name'],
        })
        expect(warnings).toEqual([]) // no Response-shape leakage, no brand-property warnings
    })

    test('jsonl(C) output is the element/chunk schema', async () => {
        const { output, warnings } = await deriveOne(OUTPUTS_FIXTURE, 'streamReturn')
        expect(output).toEqual({
            type: 'object',
            properties: { seq: { type: 'number' }, kind: { type: 'string' } },
            required: ['seq', 'kind'],
        })
        expect(warnings).toEqual([])
    })

    test('a value|error union drops the error member and keeps the payload', async () => {
        const { output } = await deriveOne(OUTPUTS_FIXTURE, 'valueOrError')
        expect(output).toEqual({
            type: 'object',
            properties: { value: { type: 'number' } },
            required: ['value'],
        })
    })

    test('a redirect-only handler contributes no output schema', async () => {
        const { output, warnings } = await deriveOne(OUTPUTS_FIXTURE, 'redirectOnly')
        expect(output).toBeUndefined()
        expect(warnings).toEqual([])
    })
})

describe('deriveSchemas (batch)', () => {
    test('derives many exports in one session, keyed by the caller key', async () => {
        const map = await deriveSchemas([
            { key: 'echo', filePath: FIXTURE, exportName: 'echo' },
            { key: 'counter', filePath: DEFAULT_FIXTURE, exportName: 'default' },
            { key: 'zero', filePath: FIXTURE, exportName: 'zeroArg' },
        ])
        expect(map.echo?.input).toEqual({
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
        })
        expect(map.counter?.input).toEqual({
            type: 'object',
            properties: { key: { type: 'string', default: 'alpha' } },
        })
        // A zero-arg handler contributes an entry with no input schema (not an error).
        expect(map.zero?.input).toBeUndefined()
    })

    test('an empty entry list derives nothing without spawning a session', async () => {
        expect(await deriveSchemas([])).toEqual({})
    })
})

describe('destructuring defaults', () => {
    // The type cannot carry these: `message = 'hello'` widens to `string`, and all the inferred type
    // records is that the property became OPTIONAL. The value lives in the AST and was being dropped,
    // so every surface that describes an rpc said "optional" and none could say what omitting it
    // gives you.
    // Derived ONCE for the whole block — each call is a real tsgo session, so per-test derivation
    // would spawn five.
    let properties: Record<string, JSONSchema>
    beforeAll(async () => {
        const { input } = await deriveOne(DEFAULTS_FIXTURE, 'withDefaults')
        const props = input?.properties
        if (props === undefined) throw new Error('expected input properties')
        properties = props
    })

    test('a string, number and boolean default reach the schema', async () => {
        const props = properties
        expect(props.message?.default).toBe('hello')
        expect(props.limit?.default).toBe(10)
        expect(props.loud?.default).toBe(true)
    })

    test('a `false` default survives — it is a value, not an absence', async () => {
        // The obvious bug: a falsy default dropped by a truthiness check, so `--quiet` would claim no
        // default while defaulting to false.
        expect(properties.quiet?.default).toBe(false)
    })

    test('a field with no default declares none', async () => {
        expect(properties.plain?.default).toBeUndefined()
        expect(properties.plain).toEqual({ type: 'string' })
    })

    test('a NON-literal default is declined rather than invented', async () => {
        // `= Date.now()` has no value at derivation time. Emitting one would be worse than silence.
        expect(properties.stamped?.default).toBeUndefined()
    })

    test('the type is still derived alongside the default', async () => {
        expect(properties.message?.type).toBe('string')
        expect(properties.limit?.type).toBe('number')
    })
})
