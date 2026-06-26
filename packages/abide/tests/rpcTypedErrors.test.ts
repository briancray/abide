/* Name-keyed typed errors: a handler returns `error(errors.<name>(data))`, the wire
   carries `{ $abideError, data }` at the declared status, and the client decode parses
   it back onto the thrown HttpError's `.kind` / `.data`. Validation 422 rides the same
   shape with a field-keyed message map. */
import { expect, test } from 'bun:test'
import { error } from '../src/lib/server/error.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { decodeResponse } from '../src/lib/shared/decodeResponse.ts'
import { HttpError } from '../src/lib/shared/HttpError.ts'
import type { ErrorConstructors } from '../src/lib/shared/types/ErrorConstructors.ts'
import type { StandardSchemaV1 } from '../src/lib/shared/types/StandardSchemaV1.ts'

const options = { logRequests: false }
const passthrough: StandardSchemaV1 = {
    '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) },
}
/* Rejects when `email` is missing — the validation a real z.object would do. */
const requireEmail: StandardSchemaV1 = {
    '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => {
            if ((value as { email?: unknown }).email) {
                return { value }
            }
            return { issues: [{ message: 'email is required', path: ['email'] }] }
        },
    },
}

const couponSpec = { invalidCoupon: { status: 400, data: passthrough } } as const

const buy = defineVerb(
    'POST',
    '/rpc/buy',
    (_args, ctx) => {
        const errors = ctx.errors as ErrorConstructors<typeof couponSpec>
        return error(errors.invalidCoupon({ code: 'EXPIRED' }))
    },
    { inputSchema: passthrough, errors: couponSpec },
)

function post(url: string, body: unknown): Request {
    return new Request(`https://test.local${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
}

test('a declared error serializes as { $abideError, data } at its status', async () => {
    const req = post('/rpc/buy', { item: 1 })
    const res = await runWithRequestScope(req, options, () => buy.fetch(req))
    expect(res.status).toBe(400)
    expect(await res.clone().json()).toEqual({
        $abideError: 'invalidCoupon',
        data: { code: 'EXPIRED' },
    })
})

test('the client decode throws HttpError carrying .kind and .data', async () => {
    const req = post('/rpc/buy', { item: 1 })
    const res = await runWithRequestScope(req, options, () => buy.fetch(req))
    try {
        await decodeResponse(res)
        throw new Error('expected decodeResponse to throw')
    } catch (e) {
        expect(e).toBeInstanceOf(HttpError)
        const httpError = e as HttpError
        expect(httpError.status).toBe(400)
        expect(httpError.kind).toBe('invalidCoupon')
        expect(httpError.data).toEqual({ code: 'EXPIRED' })
        // the raw response stays readable (decode reads a clone)
        expect(await httpError.response.json()).toEqual({
            $abideError: 'invalidCoupon',
            data: { code: 'EXPIRED' },
        })
    }
})

const signup = defineVerb('POST', '/rpc/signup', (args) => Response.json(args), {
    inputSchema: requireEmail,
})

test('validation 422 carries issues + a typed field-error map, decoding to kind "validation"', async () => {
    const req = post('/rpc/signup', { name: 'x' })
    const res = await runWithRequestScope(req, options, () => signup.fetch(req))
    expect(res.status).toBe(422)
    expect(await res.clone().json()).toEqual({
        $abideError: 'validation',
        data: {
            issues: [{ message: 'email is required', path: ['email'] }],
            errors: { email: 'email is required' },
        },
    })
    try {
        await decodeResponse(res)
        throw new Error('expected throw')
    } catch (e) {
        const httpError = e as HttpError
        expect(httpError.kind).toBe('validation')
        expect((httpError.data as { errors: Record<string, string> }).errors).toEqual({
            email: 'email is required',
        })
    }
})

test('a plain error(status, text) leaves .kind / .data undefined', async () => {
    const gone = defineVerb('GET', '/rpc/gone', () => error(410, 'gone'))
    const req = new Request('https://test.local/rpc/gone')
    const res = await runWithRequestScope(req, options, () => gone.fetch(req))
    try {
        await decodeResponse(res)
        throw new Error('expected throw')
    } catch (e) {
        const httpError = e as HttpError
        expect(httpError).toBeInstanceOf(HttpError)
        expect(httpError.kind).toBeUndefined()
        expect(httpError.data).toBeUndefined()
    }
})
