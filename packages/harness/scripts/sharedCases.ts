// THREE COSTS, PRICED IN BOTH ENGINES: a canonical-key level, a combinator's report, and a keyed
// reach's parameter defaults.
// The canonical-key case runs the spellings it chose between beside the one shipped, and it and
// the validateJson case carry SHARE rows pricing the layer against the whole op somebody waits on. JSC with
// `bun packages/harness/scripts/benchShared.ts`, V8 with `bunx playwright test
// --project=harness packages/harness/e2e/shared.spec.ts`.
import { jsonSchema, reactive, validateJson } from '@abide/abide'
import { putOwn } from '../../abide/src/shared/putOwn.ts'
import { canonicalKey } from '../../abide/src/shared/reactive/canonicalKey.ts'

// Defeats dead-code elimination without allocating: every arm writes here.
let sink: unknown

export type SharedCase = {
    name: string
    arms: Record<string, () => void>
}

// ---- canonicalKey: three spellings of one level ----

function canonicalNull(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) {
        const out: unknown[] = []
        for (let index = 0; index < value.length; index += 1)
            out.push(canonicalNull(value[index]))
        return out
    }
    const source = value as Record<string, unknown>
    const keys = Object.keys(source).sort()
    const out = Object.create(null) as Record<string, unknown>
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index] as string
        const member = source[key]
        if (member === undefined) continue
        out[key] = canonicalNull(member)
    }
    return out
}

function canonicalLiteral(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) {
        const out: unknown[] = []
        for (let index = 0; index < value.length; index += 1)
            out.push(canonicalLiteral(value[index]))
        return out
    }
    const source = value as Record<string, unknown>
    const keys = Object.keys(source).sort()
    const out: Record<string, unknown> = {}
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index] as string
        const member = source[key]
        if (member === undefined) continue
        putOwn(out, key, canonicalLiteral(member))
    }
    return out
}

function canonicalString(value: unknown): string {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value)
    if (Array.isArray(value)) {
        let out = '['
        for (let index = 0; index < value.length; index += 1)
            out += (index === 0 ? '' : ',') + canonicalString(value[index])
        return `${out}]`
    }
    const source = value as Record<string, unknown>
    const keys = Object.keys(source).sort()
    let out = '{'
    let first = true
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index] as string
        const member = source[key]
        if (member === undefined) continue
        out += `${first ? '' : ','}${JSON.stringify(key)}:${canonicalString(member)}`
        first = false
    }
    return `${out}}`
}

function keyCase(name: string, args: Record<string, unknown>): SharedCase {
    const expected = canonicalKey(args)
    for (const made of [
        JSON.stringify(canonicalNull(args)),
        JSON.stringify(canonicalLiteral(args)),
        canonicalString(args),
    ])
        if (made !== expected)
            throw new Error(`${name}: an arm keys ${made}, not ${expected}`)
    const keyed = reactive((held: Record<string, unknown>) => held)
    keyed(args)
    return {
        name,
        arms: {
            'null prototype': (): void => {
                sink = JSON.stringify(canonicalNull(args))
            },
            'literal + putOwn': (): void => {
                sink = JSON.stringify(canonicalLiteral(args))
            },
            'string directly': (): void => {
                sink = canonicalString(args)
            },
            'SHARE: canonicalKey as shipped': (): void => {
                sink = canonicalKey(args)
            },
            'SHARE: whole standing reach': (): void => {
                sink = keyed(args)
            },
        },
    }
}

// ---- parameter defaults: what 11.29 adds to a standing reach, and to building a keyed value ----

// THE STANDING REACH, with and without a default to apply: a body with none pays a `null` test, one
// whose caller wrote every member pays a walk that allocates nothing, and one whose caller left a
// member out pays a copy of its args.
function defaultsReachCase(): SharedCase {
    const plain = reactive((held: { page?: number }) => held.page)
    const defaulted = reactive(({ page = 1 }: { page?: number }) => page)
    const written = { page: 1 }
    const leftOut = {}
    plain(written)
    defaulted(written)
    return {
        name: 'keyed reach — parameter defaults',
        arms: {
            'no defaults, standing reach': (): void => {
                sink = plain(written)
            },
            'defaults, member written': (): void => {
                sink = defaulted(written)
            },
            'defaults, member left out': (): void => {
                sink = defaulted(leftOut)
            },
        },
    }
}

// CONSTRUCTION reads a body's text once per function — a fresh closure per build, as a component's
// keyed value is, so here the read is paid every time rather than remembered. Apart from the reach
// arms, whose floor the garbage these make would otherwise raise.
function defaultsBuildCase(): SharedCase {
    return {
        name: 'keyed build — parameter defaults',
        arms: {
            'body with no default': (): void => {
                sink = reactive((held: { page?: number }) => held.page)
            },
            'body with a default': (): void => {
                sink = reactive(({ page = 1 }: { page?: number }) => page)
            },
        },
    }
}

// ---- validateJson: a combinator's report, against the gated write it sits in ----

// A MISMATCH FLAG REPLACED A SCRATCH RECORD per combinator branch per value. The record's arm was a
// hand-synced copy of the module that had drifted from it, so it left with its last reading — one
// JSC run, 2026-10-08, flag / record: anyOf with the first branch failing 0.80x (A/A floor 24%),
// oneOf over three object shapes 0.86x (floor 2.7%), `not` passing 0.91x (floor 16%). Only the
// oneOf row clears its floor.
function validateCase(
    name: string,
    schema: Parameters<typeof validateJson>[0],
    value: unknown,
): SharedCase {
    const gated = reactive<unknown>(value, { schema: jsonSchema(schema) })
    return {
        name,
        arms: {
            'validateJson as shipped': (): void => {
                sink = validateJson(schema, value)
            },
            'SHARE: whole gated write': (): void => {
                gated.set(value)
            },
        },
    }
}

/** Every shared case: two canonicalKey shapes and three validateJson schemas. */
export function sharedCases(): SharedCase[] {
    return [
        keyCase('canonicalKey — one flat level', { id: 42 }),
        keyCase('canonicalKey — two object levels', {
            page: 3,
            id: 42,
            filter: { tags: ['a', 'b'], q: 'abc' },
        }),
        validateCase(
            'validateJson — anyOf, first branch fails',
            { anyOf: [{ type: 'string' }, { type: 'number' }] },
            5,
        ),
        validateCase(
            'validateJson — oneOf over three object shapes',
            {
                type: 'array',
                items: {
                    oneOf: [
                        {
                            type: 'object',
                            required: ['kind'],
                            properties: { kind: { const: 'a' } },
                        },
                        {
                            type: 'object',
                            required: ['kind'],
                            properties: { kind: { const: 'b' } },
                        },
                        {
                            type: 'object',
                            required: ['kind'],
                            properties: { kind: { const: 'c' } },
                        },
                    ],
                },
            },
            [{ kind: 'b' }, { kind: 'c' }, { kind: 'a' }, { kind: 'b' }],
        ),
        validateCase(
            'validateJson — not, passing',
            { type: 'string', not: { const: '' } },
            'hello',
        ),
        defaultsReachCase(),
        defaultsBuildCase(),
    ]
}

/**
 * The last value any arm wrote.
 *
 * Read so the sink is live: an arm whose result nothing can observe is one an engine may drop.
 */
export function sinkValue(): unknown {
    return sink
}
