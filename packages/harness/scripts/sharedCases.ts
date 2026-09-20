// TWO ALLOCATIONS, PRICED IN BOTH ENGINES: a canonical-key level and a combinator's scratch report.
// Each case runs the shape before the change beside the shape shipped — the revert arm, kept as a
// copy — plus SHARE rows pricing the layer against the whole op somebody waits on. JSC with
// `bun packages/harness/scripts/benchShared.ts`, V8 with `bunx playwright test
// --project=harness packages/harness/e2e/shared.spec.ts`.
import { jsonSchema, reactive } from 'abide'
import { putOwn } from '../../abide/src/shared/putOwn.ts'
import { canonicalKey } from '../../abide/src/shared/reactive/canonicalKey.ts'
import { validateJson } from '../../abide/src/shared/validateJson.ts'
import { validateJsonScratch } from './validateJsonScratch.ts'

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

// ---- validateJson: a scratch record per branch against a mismatch flag ----

function validateCase(
    name: string,
    schema: Parameters<typeof validateJson>[0],
    value: unknown,
): SharedCase {
    const current = JSON.stringify(validateJsonScratch(schema, value))
    const candidate = JSON.stringify(validateJson(schema, value))
    if (current !== candidate)
        throw new Error(`${name}: ${current} against ${candidate}`)
    const gated = reactive<unknown>(value, { schema: jsonSchema(schema) })
    return {
        name,
        arms: {
            'scratch record (before)': (): void => {
                sink = validateJsonScratch(schema, value)
            },
            'mismatch flag (shipped)': (): void => {
                sink = validateJson(schema, value)
            },
            'SHARE: whole gated write': (): void => {
                gated.set(value)
            },
        },
    }
}

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
    ]
}

// Read so the sink is live: an arm whose result nothing can observe is one an engine may drop.
export function sinkValue(): unknown {
    return sink
}
