// THE NATIVE VALIDATOR. It is the form abide generates and reads back (19.8, 20.6), so it
// is the one a library cannot be handed. What it answers is WHERE, keyed by dot-joined
// path (19.6), which is what `jsonSchema` carries into the Standard form of `Schema`.

import { expect, test } from 'bun:test'
import type { JsonValue, StandardSchemaV1 } from '#shared'
import { jsonSchema, reactive, validateJson } from '#shared'

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
// THE REVERT: having `checkCombinators` walk `anyOf` into `found` rather than trying it as a
// scratch attempt reports the string arm's type complaint alongside a value that validated.
test('a combinator arm that failed reports nothing', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'integer' }] }
    expect(validateJson<Anywhere>(schema, 7)).toBeNull()
    expect(validateJson<Anywhere>(schema, 1.5)).toEqual({
        '': ['does not match any of the allowed shapes'],
    })
})

// A SCRATCH ATTEMPT NESTS, and the inner one must not clear the outer one's failure. The first
// `oneOf` arm fails `required` BEFORE its `anyOf` runs and succeeds; the value matches the second
// arm alone, so it is valid.
//
// THE REVERT: drop the save and restore of `mismatched` in `fails`. The inner success then clears
// the first arm's failure, both arms read as matched, and this reports `matched 2`.
test('a combinator inside a combinator arm keeps that arm failing', () => {
    const schema = {
        oneOf: [
            {
                type: 'object',
                required: ['b'],
                properties: {
                    a: { anyOf: [{ type: 'string' }, { type: 'number' }] },
                },
            },
            { type: 'object', required: ['a'] },
        ],
    }
    expect(validateJson<Anywhere>(schema, { a: 1 })).toBeNull()
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

// A KEY `Object.prototype` ALSO CARRIES is a key JSON can carry, and reading the report with `in`
// or writing it into an object literal reaches the prototype instead of the record. Both halves
// are one bug and both are in the input's hands.
//
// THE REVERT: have `note` assign where it calls `putOwn`, read `found[path]` where it asks
// `Object.hasOwn`, and put `key in declared` back. This test then reports `__proto__: ACCEPTED` —
// `found['__proto__'] = [...]` sets the prototype rather than a key, so the report comes back
// EMPTY and the payload validates — and `toString` throws `standing.push is not a function` out of
// the validator.
test('a member named after an Object.prototype key is checked like any other', () => {
    const closed = {
        type: 'object',
        properties: { a: { type: 'string' } },
        additionalProperties: false,
    }
    const refused: string[] = []
    for (const key of ['__proto__', 'constructor', 'toString', 'valueOf']) {
        const found = validateJson<Anywhere>(
            closed,
            JSON.parse(`{"a":"ok","${key}":"x"}`),
        )
        refused.push(`${key}: ${found?.[key]?.[0] ?? 'ACCEPTED'}`)
    }
    expect(refused).toEqual([
        '__proto__: is not a known member',
        'constructor: is not a known member',
        'toString: is not a known member',
        'valueOf: is not a known member',
    ])

    // The other half: a report KEYED at such a name is written rather than thrown over.
    const map = { type: 'object', additionalProperties: { type: 'number' } }
    expect(
        validateJson<Anywhere>(
            map,
            JSON.parse('{"constructor":"not a number"}'),
        ),
    ).toEqual({ constructor: ['must be number, was string'] })

    // And `required` asks whether the value OWNS the member, not whether it can reach one.
    expect(
        validateJson<Anywhere>({ type: 'object', required: ['toString'] }, {}),
    ).toEqual({ toString: ['is required'] })

    // And the report a slot writer stringifies has a prototype to stringify with — a null one
    // threw `No default value` out of `{result.error().data}`.
    const keyedAtProto = validateJson<Anywhere>(
        closed,
        JSON.parse('{"__proto__":"x"}'),
    )
    expect(String(keyedAtProto)).toBe('[object Object]')
    expect(JSON.stringify(keyedAtProto)).toBe(
        '{"__proto__":["is not a known member"]}',
    )
})

// NaN AND THE INFINITIES ARE NOT JSON VALUES, and each is the value that slips a one-sided bound
// rather than tripping it: `NaN < 0` and `NaN > 100` are both false, and `-Infinity > 100` is
// false too — so `{maximum: 100}` read `-Infinity` as in range. Refused per keyword, NaN was caught
// by a tail check in `checkNumber` and the infinities by nothing at all where no `type` was given.
//
// THE REVERT: delete the non-finite refusal at the head of `check`. This test then reports `null`
// for every non-finite value below — accepted, with no issue, by schemas that each declared a bound.
test('NaN and the infinities are not JSON values, whatever the node declares', () => {
    const refused = (was: string) => ({
        '': [`must be a JSON value, was ${was}`],
    })
    const upper = { maximum: 100 }
    const lower = { minimum: 0 }
    expect(validateJson<Anywhere>(upper, Number.NEGATIVE_INFINITY)).toEqual(
        refused('-Infinity'),
    )
    expect(validateJson<Anywhere>(lower, Number.POSITIVE_INFINITY)).toEqual(
        refused('Infinity'),
    )
    expect(
        validateJson<Anywhere>(
            { exclusiveMaximum: 100 },
            Number.NEGATIVE_INFINITY,
        ),
    ).toEqual(refused('-Infinity'))
    expect(validateJson<Anywhere>(upper, Number.NaN)).toEqual(refused('NaN'))
    expect(
        validateJson<Anywhere>(
            { type: 'number', minimum: 0, maximum: 100 },
            Number.POSITIVE_INFINITY,
        ),
    ).toEqual(refused('Infinity'))
    // Nested, the refusal lands at the member's path and nowhere else.
    expect(
        validateJson<Anywhere>(
            { type: 'object', properties: { age: lower } },
            { age: Number.NaN },
        ),
    ).toEqual({ age: ['must be a JSON value, was NaN'] })
    // What the bounds are FOR still holds.
    expect(validateJson<Anywhere>(upper, 50)).toBeNull()
    expect(validateJson<Anywhere>(upper, 101)).toEqual({
        '': ['must be at most 100'],
    })
})

// `nullable` WIDENS THE TYPE AND NOTHING ELSE. Read as "null is fine here" it skipped every other
// constraint on the node.
//
// THE REVERT: put `if (node.nullable === true && value === null) return` back above the type
// check. This test then reports `null` for both — an enumeration and a `not` that each name the
// one value they are given, both silently unapplied.
test('nullable widens the type check rather than skipping the node', () => {
    expect(
        validateJson<Anywhere>(
            { type: 'string', nullable: true, enum: ['a'] },
            null,
        ),
    ).toEqual({ '': ['must be one of "a"'] })
    expect(
        validateJson<Anywhere>({ nullable: true, not: { type: 'null' } }, null),
    ).toEqual({ '': ['matches a shape that is not allowed'] })
    // What it is FOR still works: null passes a type it widens, and so does a real value.
    expect(
        validateJson<Anywhere>({ type: 'string', nullable: true }, null),
    ).toBeNull()
    expect(
        validateJson<Anywhere>({ type: 'string', nullable: true }, 'a'),
    ).toBeNull()
})

// THE HEADER'S RULE ONE LEVEL DOWN. An unknown keyword throws; a known keyword holding a value
// this cannot READ was skipped by the `typeof node.x === 'number'` guard each check was written
// with — the same silent non-application, reached from the older dialect's spelling of a strict
// bound rather than from a typo.
//
// THE REVERT: go back to `typeof node.exclusiveMinimum === 'number' && value <= …`. This test then
// reports `null` for a value sitting exactly on a bound the schema declared as exclusive.
test('a constraint whose value cannot be read is refused rather than skipped', () => {
    let said = ''
    try {
        validateJson({ minimum: 5, exclusiveMinimum: true }, 5)
    } catch (thrown) {
        said = (thrown as Error).message
    }
    expect(said).toContain('boolean for "exclusiveMinimum"')
    expect(said).toContain('cannot be applied')
    // The spelling abide publishes still works, both ways.
    expect(validateJson<Anywhere>({ exclusiveMinimum: 5 }, 5)).toEqual({
        '': ['must be greater than 5'],
    })
    expect(validateJson<Anywhere>({ exclusiveMinimum: 5 }, 6)).toBeNull()
    // And a pattern that is not a regular expression names the schema rather than arriving as a
    // bare SyntaxError from inside the validator.
    let pattern = ''
    try {
        validateJson({ type: 'string', pattern: '(' }, 'x')
    } catch (thrown) {
        pattern = (thrown as Error).message
    }
    expect(pattern).toContain('cannot read the "pattern"')
})

// `const` AND `enum` COMPARE BY VALUE, and a JSON object's key ORDER is not part of its value.
//
// THE REVERT: compare with `JSON.stringify(a) === JSON.stringify(b)`. This test then reports the
// same object refused for arriving with its members in the other order, accepts one carrying an
// extra `undefined` member the const never named, and throws `cannot serialize cyclic structures`
// out of the validator on the last case.
test('const compares by value, not by serialisation', () => {
    const schema = { const: { a: 1, b: [2, 3] } }
    expect(validateJson<Anywhere>(schema, { a: 1, b: [2, 3] })).toBeNull()
    expect(validateJson<Anywhere>(schema, { b: [2, 3], a: 1 })).toBeNull()
    expect(validateJson<Anywhere>(schema, { a: 1, b: [3, 2] })).not.toBeNull()
    expect(
        validateJson<Anywhere>({ const: { a: 1 } }, { a: 1, b: undefined }),
    ).not.toBeNull()
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    expect(validateJson<Anywhere>({ const: { a: 1 } }, cyclic)).not.toBeNull()
})

// 19.15: A BARE DOCUMENT IS REFUSED, NEVER ACCEPTED. A document is data and needs a validator to
// read it, which `jsonSchema` brings; a gate that shrugged at one handed over bare would be a
// declared constraint silently not applied, which is the failure this file's header refuses for an
// unknown keyword, one rung up.
//
// THE REVERT: return `accepted(value)` in place of the refusal at the end of `runSchema`. This
// reports `stored: 2` and no refusal — a write through a shape nothing read.
//
// `peek` RATHER THAN A READ: 4.3 puts the schema in front of every way in, construction included,
// so the initial value is refused too and a read would throw what `set` handed back (2.2).
// What a gate hands back from `set`; `Failures` is `never` where no refusal is declared.
type Refusal = { name: string; data: Record<string, string[]> } | undefined

test('a bare JSON Schema document refuses, naming the wrapper', () => {
    const gated = reactive(1, { schema: { type: 'number' } as never })
    const refusal = gated.set(2) as Refusal
    expect(`stored: ${gated.peek()}`).toBe('stored: undefined')
    expect(refusal?.name).toBe('ValidationError')
    expect(refusal?.data['']?.[0]).toContain('jsonSchema(document)')
})

// WRAPPED, THE DOCUMENT REPORTS WHERE, the one thing the native form was chosen for: an issue's
// path survives the trip through the Standard form's path array and back.
test('a wrapped document refuses at the path that failed', () => {
    const gated = reactive(
        { age: 1 },
        {
            schema: jsonSchema<{ age: number }>({
                type: 'object',
                properties: { age: { type: 'number', maximum: 100 } },
            }),
        },
    )
    expect(gated.set({ age: 50 })).toBeUndefined()
    const refusal = gated.set({ age: 101 }) as Refusal
    expect(Object.keys(refusal?.data ?? {})).toEqual(['age'])
    expect(gated.peek()).toEqual({ age: 50 })
})

// A keyword spelled `undefined` is the keyword the schema does not carry. The shape check read it
// as a number that was not one and refused every write against the schema on the `''` entry —
// `{type: 'number', minimum: options.min}` is ordinary schema construction.
test('a keyword whose value is undefined constrains nothing', () => {
    // CAST, because `JsonValue` does not hold `undefined` — which is exactly how the value gets
    // here: a schema assembled at run time (`{...base, minimum: options.min}`, a document read
    // back from a store) carries the absent keyword as a present one spelled `undefined`.
    const built = (node: Record<string, unknown>) => node as JsonValue
    expect(
        validateJson(built({ type: 'number', minimum: undefined }), 5),
    ).toBeNull()
    expect(
        validateJson(built({ type: 'string', maxLength: undefined }), 'x'),
    ).toBeNull()
    expect(
        validateJson(built({ type: 'object', required: undefined }), { a: 1 }),
    ).toBeNull()
    expect(
        validateJson(built({ type: 'string', enum: undefined }), 'x'),
    ).toBeNull()
    // The keyword still applies where it has a value.
    expect(validateJson({ type: 'number', minimum: 10 }, 5)).not.toBeNull()
})

// AN UNKNOWN KEYWORD IS UNKNOWN WHATEVER IT HOLDS. The undefined-value skip sat ABOVE the name
// check, so `{minimun: options.min}` with no `min` on the options was accepted silently — a
// declared constraint neither applied nor refused, which is the one failure this module exists to
// prevent. THE REVERT: move `if (node[keyword] === undefined) continue` back above the lookup;
// the first expectation below then reports `null`.
test('a misspelled keyword is refused even when it holds undefined', () => {
    expect(() =>
        validateJson(
            { type: 'number', minimun: undefined } as unknown as JsonValue,
            5,
        ),
    ).toThrow('minimun')
    expect(() =>
        validateJson({ type: 'number', format: 'x' } as JsonValue, 5),
    ).toThrow('format')
    // A KEYWORD THIS DOES IMPLEMENT still does not constrain the value it does not have.
    expect(
        validateJson(
            { type: 'number', minimum: undefined } as unknown as JsonValue,
            5,
        ),
    ).toBeNull()
})
