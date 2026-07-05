import { describe, expect, test } from 'bun:test'
import { rpcErrorRegistry } from '../src/lib/shared/rpcErrorRegistry.ts'

/* The rpc's error memory — last error per call identity (keyForRemoteCall key),
   recorded at the call boundary, cleared on success/invalidate. Orthogonal to the
   cache entry lifecycle (design Fork 1: cache still evicts on error as before). */
describe('rpcErrorRegistry', () => {
    test('records and reads by key', () => {
        const err = new Error('boom')
        rpcErrorRegistry.record('GET /u {"id":1}', err)
        expect(rpcErrorRegistry.read('GET /u {"id":1}')).toBe(err)
    })

    test('clear removes it', () => {
        rpcErrorRegistry.record('GET /u {"id":2}', new Error('x'))
        rpcErrorRegistry.clear('GET /u {"id":2}')
        expect(rpcErrorRegistry.read('GET /u {"id":2}')).toBeUndefined()
    })

    test('readAny returns the most-recent error across keys sharing the prefix', () => {
        rpcErrorRegistry.record('GET /p {"a":1}', new Error('first'))
        const last = new Error('last')
        rpcErrorRegistry.record('GET /p {"a":2}', last)
        expect(rpcErrorRegistry.readAny('GET /p')).toBe(last)
    })

    test('readAny is prefix-scoped — an unrelated rpc does not leak', () => {
        rpcErrorRegistry.record('GET /other {"a":1}', new Error('other'))
        expect(rpcErrorRegistry.readAny('GET /nomatch')).toBeUndefined()
    })
})
