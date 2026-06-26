import { describe, expect, test } from 'bun:test'
import { prepareRpcModule } from '../src/lib/shared/prepareRpcModule.ts'

const mod = (call: string): string =>
    `import { POST } from '@abide/abide/server/POST'\nexport const saveMessage = ${call}`

describe('prepareRpcModule outbox detection', () => {
    test('outbox: true in opts → durable', () => {
        const prepared = prepareRpcModule(
            mod('POST(async (a) => a, { outbox: true })'),
            '@abide/abide',
        )
        expect(prepared?.method).toBe('POST')
        expect(prepared?.durable).toBe(true)
    })

    test('no outbox key → not durable', () => {
        const prepared = prepareRpcModule(
            mod('POST(async (a) => a, { inputSchema })'),
            '@abide/abide',
        )
        expect(prepared?.durable).toBe(false)
    })

    test('outbox: false → not durable', () => {
        const prepared = prepareRpcModule(
            mod('POST(async (a) => a, { outbox: false })'),
            '@abide/abide',
        )
        expect(prepared?.durable).toBe(false)
    })
})
