import { describe, expect, test } from 'bun:test'
import { prepareRpcModule } from '../src/lib/shared/prepareRpcModule.ts'

const mod = (call: string): string =>
    `import { POST } from '@abide/abide/server/POST'\nexport const saveMessage = ${call}`

const durableFor = (call: string) =>
    prepareRpcModule(mod(`POST(async (a) => a, ${call})`), '@abide/abide')?.durable

describe('prepareRpcModule outbox detection', () => {
    test('outbox: true → durable', () => {
        const prepared = prepareRpcModule(
            mod('POST(async (a) => a, { outbox: true })'),
            '@abide/abide',
        )
        expect(prepared?.method).toBe('POST')
        expect(prepared?.durable).toBe(true)
    })

    test('no outbox key → not durable', () => {
        expect(durableFor('{ schemas: { input } }')).toBe(false)
    })

    test('outbox: false → not durable', () => {
        expect(durableFor('{ outbox: false }')).toBe(false)
    })

    test('a computed outbox value is a build error, not a silent non-durable proxy', () => {
        expect(() => durableFor('{ outbox: isDurable }')).toThrow(/must be a literal/)
        expect(() => durableFor('{ outbox: cond ? true : false }')).toThrow(/must be a literal/)
    })

    test('outbox: true on a read RPC is a build error', () => {
        expect(() =>
            prepareRpcModule(
                `import { GET } from '@abide/abide/server/GET'\nexport const search = GET(async (a) => a, { outbox: true })`,
                '@abide/abide',
            ),
        ).toThrow(/only valid on mutating RPCs/)
    })

    test('an `outbox:` mention in the handler body does not misfire', () => {
        const call = 'POST(async (a) => ({ outbox: a.flag }), { schemas: { input } })'
        const prepared = prepareRpcModule(mod(call), '@abide/abide')
        expect(prepared?.durable).toBe(false)
    })

    test('a regex literal in opts (with braces/commas) does not confuse arg isolation', () => {
        expect(durableFor('{ pattern: /[{},]/, outbox: true }')).toBe(true)
    })
})
