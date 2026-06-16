import { describe, expect, test } from 'bun:test'
import { parseArgs } from '../src/lib/server/rpc/parseArgs.ts'

/*
When a POST/PUT/PATCH carries both a JSON body and a query string, the typed
body wins on collision — a URL param supplies a default but can't silently
shadow a validated body field.
*/
describe('parseArgs body-vs-query precedence', () => {
    test('the body overrides a same-named query param', async () => {
        const request = new Request('https://test.local/rpc/x?a=fromQuery&b=onlyQuery', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ a: 'fromBody', c: 'onlyBody' }),
        })
        const args = (await parseArgs('POST', request)) as Record<string, unknown>
        expect(args.a).toBe('fromBody')
        expect(args.b).toBe('onlyQuery')
        expect(args.c).toBe('onlyBody')
    })

    test('query still supplies args when the body omits the key', async () => {
        const request = new Request('https://test.local/rpc/x?page=2', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ filter: 'open' }),
        })
        const args = (await parseArgs('POST', request)) as Record<string, unknown>
        expect(args).toEqual({ page: '2', filter: 'open' })
    })
})
