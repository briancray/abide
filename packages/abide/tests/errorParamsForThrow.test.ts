import { describe, expect, test } from 'bun:test'
import { errorParamsForThrow } from '../src/lib/shared/errorParamsForThrow.ts'
import { HttpError } from '../src/lib/shared/HttpError.ts'

/*
The boundary prop contract. An HttpError must report its real status and body
verbatim (so a 404 RPC or a 503/504 client timeout renders honestly, not a flat
500); any other throw is a genuine server error.
*/
describe('errorParamsForThrow', () => {
    test('an HttpError reports its real status and response body as the message', async () => {
        const error = new HttpError(
            new Response('order not found', { status: 404, statusText: 'Not Found' }),
        )
        const params = await errorParamsForThrow(error)
        expect(params.status).toBe(404)
        expect(params.message).toBe('order not found')
        expect(params.stack).toBeUndefined()
        /* The body was cloned, not consumed — downstream readers still get it. */
        expect(await error.response.text()).toBe('order not found')
    })

    test('an empty body falls back to the HTTP status summary', async () => {
        const error = new HttpError(
            new Response('', { status: 503, statusText: 'Service Unavailable' }),
        )
        const params = await errorParamsForThrow(error)
        expect(params.status).toBe(503)
        expect(params.message).toBe('HTTP 503 Service Unavailable')
    })

    test('a non-HttpError throw is a genuine 500 with the Error message and stack', async () => {
        const params = await errorParamsForThrow(new Error('boom'))
        expect(params.status).toBe(500)
        expect(params.message).toBe('boom')
        expect(typeof params.stack).toBe('string')
    })

    test('a non-Error throw stringifies with no stack', async () => {
        const params = await errorParamsForThrow('weird')
        expect(params.status).toBe(500)
        expect(params.message).toBe('weird')
        expect(params.stack).toBeUndefined()
    })
})
