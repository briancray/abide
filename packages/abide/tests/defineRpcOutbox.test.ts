import { describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'

describe('outbox gating', () => {
    test('rejects a read rpc (GET)', () => {
        expect(() => defineRpc('GET', '/rpc/read', async () => json({}), { outbox: true })).toThrow(
            /only valid on mutating/,
        )
    })

    test('rejects HEAD too', () => {
        expect(() =>
            defineRpc('HEAD', '/rpc/head', async () => json({}), { outbox: true }),
        ).toThrow(/only valid on mutating/)
    })

    test('outbox: false on a read rpc is fine (off switch)', () => {
        expect(() =>
            defineRpc('GET', '/rpc/readNone', async () => json({}), { outbox: false }),
        ).not.toThrow()
    })

    test('accepts a mutating rpc (POST)', () => {
        expect(() =>
            defineRpc('POST', '/rpc/mutate', async () => json({}), { outbox: true }),
        ).not.toThrow()
    })
})
