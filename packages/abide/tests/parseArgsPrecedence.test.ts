import { describe, expect, test } from 'bun:test'
import { parseArgs } from '../src/lib/server/rpc/parseArgs.ts'
import { encodeRefJson } from '../src/lib/shared/encodeRefJson.ts'
import { REF_JSON_HEADER } from '../src/lib/shared/REF_JSON_HEADER.ts'

/* The abide client stamps this alongside a ref-json body so the server decodes it
   with the matching codec; the manual Requests below mirror that. */
const REF_JSON_HEADERS = { 'content-type': 'application/json', [REF_JSON_HEADER]: '1' }

/*
When a POST/PUT/PATCH carries both a JSON body and a query string, the typed
body wins on collision — a URL param supplies a default but can't silently
shadow a validated body field.
*/
describe('parseArgs body-vs-query precedence', () => {
    test('the body overrides a same-named query param', async () => {
        const request = new Request('https://test.local/rpc/x?a=fromQuery&b=onlyQuery', {
            method: 'POST',
            headers: REF_JSON_HEADERS,
            body: encodeRefJson({ a: 'fromBody', c: 'onlyBody' }),
        })
        const args = (await parseArgs('POST', request)) as Record<string, unknown>
        expect(args.a).toBe('fromBody')
        expect(args.b).toBe('onlyQuery')
        expect(args.c).toBe('onlyBody')
    })

    test('query still supplies args when the body omits the key', async () => {
        const request = new Request('https://test.local/rpc/x?page=2', {
            method: 'POST',
            headers: REF_JSON_HEADERS,
            body: encodeRefJson({ filter: 'open' }),
        })
        const args = (await parseArgs('POST', request)) as Record<string, unknown>
        expect(args).toEqual({ page: '2', filter: 'open' })
    })
})

/*
A non-abide client (curl, an OpenAPI-generated SDK, a webhook) sends ordinary JSON
without the ref-json header — parseArgs reads it with plain JSON.parse, so the
documented HTTP/OpenAPI body contract still works.
*/
describe('parseArgs plain-JSON bodies (no ref-json header)', () => {
    test('a plain-JSON object body is accepted', async () => {
        const request = new Request('https://test.local/rpc/x', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'external' }),
        })
        expect(await parseArgs('POST', request)).toEqual({ name: 'external' })
    })

    test('a plain-JSON 2-element array body (ambiguous with the ref-json envelope) round-trips intact', async () => {
        const request = new Request('https://test.local/rpc/x', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify([1, [2, 3]]),
        })
        // Without the header discriminator this would mis-decode as the ref-json root `1`.
        expect(await parseArgs('POST', request)).toEqual([1, [2, 3]])
    })
})
