// THE NATIVE VALIDATOR. It is the form abide generates and reads back (19.8, 20.6), so it
// is the one a library cannot be handed. What it answers is WHERE, keyed by dot-joined
// path (19.6), which is what separates it from the other two forms of `Schema`.

import { expect, test } from 'bun:test'
import type { StandardSchemaV1 } from '#shared'
import { reactive, validateJson } from '#shared'

// THE TYPE ARGUMENT IS NOT DECORATION. `Issues<T>` answers a bare `string[]` where `T` is
// not an object, and `unknown` is not — so `validateJson(…)` with none types its own result
// as a list, and every keyed expectation below it reads as a mistake. `Paths` of this one
// widens to `string` (19.6), which is right here: what is under test is the report's shape,
// not the shape it is a report about.
type Anywhere = Record<string, unknown>

test('a value that satisfies its schema reports nothing', () => {
    const schema = {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string' }, age: { type: 'integer' } },
    }
    expect(
        validateJson<Anywhere>(schema, { email: 'a@b.c', age: 30 }),
    ).toBeNull()
})

// KEYED BY WHERE, and the nesting is the point: a form binds its messages to fields, and a
// report that only said "something is wrong" would leave it with nowhere to put them.
test('issues are keyed by dot-joined path', () => {
    const schema = {
        type: 'object',
        required: ['email', 'address'],
        properties: {
            email: { type: 'string', minLength: 3 },
            address: {
                type: 'object',
                required: ['city'],
                properties: { city: { type: 'string' } },
            },
        },
    }
    expect(validateJson<Anywhere>(schema, { email: 'a', address: {} })).toEqual(
        {
            email: ['must be at least 3 characters'],
            'address.city': ['is required'],
        },
    )
})

// AN ABSENT MEMBER IS `required`'S BUSINESS, NOT ITS SCHEMA'S. Checking a missing optional
// against its type reports every optional member as the wrong type — and the shape of that
// bug is a form that will not submit with nothing to show the user.
test('an absent optional member is not a type error', () => {
    const schema = {
        type: 'object',
        properties: { nickname: { type: 'string' } },
    }
    expect(validateJson<Anywhere>(schema, {})).toBeNull()
})

// PRESENT RATHER THAN TRUTHY. A required member holding `null`, `0` or `''` IS present, and
// a check written as a truthiness test refuses exactly the values an author meant to allow.
test('a required member holding a falsy value is present', () => {
    const schema = {
        type: 'object',
        required: ['count', 'label', 'flag'],
        properties: {
            count: { type: 'integer' },
            label: { type: 'string' },
            flag: { type: 'boolean' },
        },
    }
    expect(
        validateJson<Anywhere>(schema, { count: 0, label: '', flag: false }),
    ).toBeNull()
})

// AN UNKNOWN KEYWORD THROWS, and this is the clause-free decision the file turns on: a
// schema that declares a constraint the validator does not apply is worse than one it
// refuses, because the app reads its own declaration and believes the data was checked.
//
// THE REVERT: skipping the keyword walk in `check` reports `null` — the value accepted
// with `multipleOf` never applied.
test('an unimplemented keyword throws rather than being ignored', () => {
    let threw: unknown
    try {
        validateJson<Anywhere>({ type: 'integer', multipleOf: 3 }, 7)
    } catch (thrown) {
        threw = thrown
    }
    expect((threw as Error | undefined)?.message).toContain('multipleOf')
})

// An annotation says nothing about validity and a generated document is full of them.
test('annotations are read past rather than refused', () => {
    const schema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'An age',
        description: 'in years',
        default: 0,
        type: 'integer',
        minimum: 0,
    }
    expect(validateJson<Anywhere>(schema, 3)).toBeNull()
    expect(validateJson<Anywhere>(schema, -1)).toEqual({
        '': ['must be at least 0'],
    })
})

// AN INTEGER IS A WHOLE NUMBER, which is JSON Schema's own reading — and the case that
// separates them is the one worth asserting, not the one where they agree.
test('integer and number are told apart', () => {
    expect(validateJson<Anywhere>({ type: 'integer' }, 3.5)).toEqual({
        '': ['must be integer, was number'],
    })
    expect(validateJson<Anywhere>({ type: 'number' }, 3.5)).toBeNull()
    expect(validateJson<Anywhere>({ type: 'number' }, 3)).toBeNull()
})

// A BRANCH THAT FAILED LEAVES NOTHING BEHIND. `anyOf` succeeding on its second arm must not
// report the first arm's complaints — walking straight into the shared record would, and
// the user would be told to fix a shape they were not using.
//
// THE REVERT: having `checkCombinators` walk `anyOf` into `found` rather than a scratch
// record reports the string arm's type complaint alongside a value that validated.
test('a combinator arm that failed reports nothing', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'integer' }] }
    expect(validateJson<Anywhere>(schema, 7)).toBeNull()
    expect(validateJson<Anywhere>(schema, 1.5)).toEqual({
        '': ['does not match any of the allowed shapes'],
    })
})

test('an array reports the index that was wrong', () => {
    const schema = { type: 'array', items: { type: 'integer' }, minItems: 2 }
    expect(validateJson<Anywhere>(schema, [1, 'two', 3])).toEqual({
        '1': ['must be integer, was string'],
    })
    expect(validateJson<Anywhere>(schema, [1])).toEqual({
        '': ['must have at least 2 items'],
    })
})

test('additionalProperties false names the member that was not known', () => {
    const schema = {
        type: 'object',
        properties: { known: { type: 'string' } },
        additionalProperties: false,
    }
    expect(validateJson<Anywhere>(schema, { known: 'a', extra: 1 })).toEqual({
        extra: ['is not a known member'],
    })
})

// 19.13, AND IT IS A DECISION RATHER THAN A GAP — which is why the message says so. The
// machinery to await one is already there: `absorb` turns a write into a load, captures a
// `generation` and resumes when the promise settles. What is refused is a GATE making a
// synchronous write asynchronous, because `s.set(5); s()` would stop answering 5 and
// `s.busy()` would flicker on a settled write.
test('an async schema is refused rather than awaited', () => {
    // TYPED AS THE CONTRACT, not cast past it: `validate` may answer a promise by the
    // Standard Schema spec, so this is a schema the TYPE accepts and 19.13 refuses at run
    // time. Casting here would test the cast.
    const asyncSchema: StandardSchemaV1<number> = {
        '~standard': {
            version: 1,
            vendor: 'test',
            validate: (value: unknown) =>
                Promise.resolve({ value: value as number }),
        },
    }
    let threw: unknown
    try {
        reactive<number, number>(1, { schema: asyncSchema })
    } catch (thrown) {
        threw = thrown
    }
    const said = (threw as Error | undefined)?.message ?? ''
    expect(said).toContain('must be synchronous')
    // The message points at both repairs rather than only naming the rule.
    expect(said).toContain('make the write a load')
})
