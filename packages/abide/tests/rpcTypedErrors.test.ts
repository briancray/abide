/* Named typed errors: a handler returns an `error.typed(name, status, schema?)` constructor,
   the wire carries `{ $abideError, data }` at the declared status, and the client decode parses
   it back onto the thrown HttpError's `.kind` / `.data`. Validation 422 rides the same
   shape with a field-keyed message map. */
import { expect, test } from 'bun:test'
import { error } from '../src/lib/server/error.ts'
import { POST } from '../src/lib/server/POST.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { decodeResponse } from '../src/lib/shared/decodeResponse.ts'
import { HttpError } from '../src/lib/shared/HttpError.ts'
import { streamResponse } from '../src/lib/shared/streamResponse.ts'
import type { RemoteFunction } from '../src/lib/shared/types/RemoteFunction.ts'
import type { StandardSchemaV1 } from '../src/lib/shared/types/StandardSchemaV1.ts'
import type { ValidationErrorData } from '../src/lib/shared/types/ValidationErrorData.ts'

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

const invalidCoupon = error.typed('invalidCoupon', 400, passthrough)

const buy = defineRpc('POST', '/rpc/buy', () => invalidCoupon({ code: 'EXPIRED' }), {
    schemas: { input: passthrough },
})

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
        /* error() stamps the status's reason phrase, so HttpError.statusText is honest. */
        expect(httpError.statusText).toBe('Bad Request')
        expect(httpError.kind).toBe('invalidCoupon')
        expect(httpError.data).toEqual({ code: 'EXPIRED' })
        // the raw response stays readable (decode reads a clone)
        expect(await httpError.response.json()).toEqual({
            $abideError: 'invalidCoupon',
            data: { code: 'EXPIRED' },
        })
    }
})

const signup = defineRpc('POST', '/rpc/signup', (args) => Response.json(args), {
    schemas: { input: requireEmail },
})

test('validation 422 carries issues + a typed field-error map, decoding to kind "validation"', async () => {
    const req = post('/rpc/signup', { name: 'x' })
    const res = await runWithRequestScope(req, options, () => signup.fetch(req))
    expect(res.status).toBe(422)
    /* routed through error() like every typed error, so the 422 carries its reason phrase */
    expect(res.statusText).toBe('Unprocessable Content')
    expect(await res.clone().json()).toEqual({
        $abideError: 'validation',
        data: {
            issues: [{ message: 'email is required', path: ['email'] }],
            fields: { email: 'email is required' },
        },
    })
    try {
        await decodeResponse(res)
        throw new Error('expected throw')
    } catch (e) {
        const httpError = e as HttpError
        expect(httpError.kind).toBe('validation')
        expect(httpError.statusText).toBe('Unprocessable Content')
        /* consumers narrow the unknown .data with the exported ValidationErrorData */
        expect((httpError.data as ValidationErrorData).fields).toEqual({
            email: 'email is required',
        })
    }
})

/* The streaming decode path (fn.stream / tail) parses a non-2xx typed-error body just
   like the plain path — httpErrorFor runs on the generator's first pull. */
test('streamResponse surfaces a typed error with .kind / .data on first pull', async () => {
    const req = post('/rpc/signup', { name: 'x' })
    const res = await runWithRequestScope(req, options, () => signup.fetch(req))
    const iterator = streamResponse(res)[Symbol.asyncIterator]()
    try {
        await iterator.next()
        throw new Error('expected throw')
    } catch (e) {
        expect(e).toBeInstanceOf(HttpError)
        const httpError = e as HttpError
        expect(httpError.status).toBe(422)
        expect(httpError.kind).toBe('validation')
        expect((httpError.data as ValidationErrorData).fields).toEqual({
            email: 'email is required',
        })
    }
})

test('a plain error(status, text) leaves .kind / .data undefined', async () => {
    const gone = defineRpc('GET', '/rpc/gone', () => error(410, 'gone'))
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

/* rpc.isError branches a caught error by kind: the framework 'validation' overload narrows
   .data even on a rpc with no declared errors, a declared name narrows .kind, and it's false
   for a non-HttpError or a mismatched kind. */
test('rpc.isError narrows by kind, typing validation data and rejecting non-matches', async () => {
    const validationErr = await decodeResponse(
        await runWithRequestScope(post('/rpc/signup', { name: 'x' }), options, () =>
            signup.fetch(post('/rpc/signup', { name: 'x' })),
        ),
    ).catch((e) => e)
    if (signup.isError(validationErr, 'validation')) {
        /* .data is ValidationErrorData here with no cast — the framework overload narrowed it. */
        expect(validationErr.data.fields).toEqual({ email: 'email is required' })
    } else {
        throw new Error('expected validation kind')
    }

    const declaredErr = await decodeResponse(
        await runWithRequestScope(post('/rpc/buy', { item: 1 }), options, () =>
            buy.fetch(post('/rpc/buy', { item: 1 })),
        ),
    ).catch((e) => e)
    expect(buy.isError(declaredErr, 'invalidCoupon')).toBe(true)
    expect(buy.isError(declaredErr, 'validation')).toBe(false)
    expect(buy.isError(new Error('plain'), 'invalidCoupon')).toBe(false)
})

/* Compile-time: a rpc declared with an `errors` spec narrows isError's `.data` to that
   error's own payload (the per-rpc typing the global guard couldn't do). `stockRpc` is a
   type-only declaration; `_narrows` is never invoked, so nothing is dereferenced at runtime. */
const stockSchema = undefined as unknown as StandardSchemaV1<{ sku: string; available: number }>
const stockSpec = { outOfStock: { status: 409, data: stockSchema } } as const
declare const stockRpc: RemoteFunction<{ sku: string }, { ok: true }, typeof stockSpec>
function _narrows(error: unknown): number | undefined {
    if (stockRpc.isError(error, 'outOfStock')) {
        return error.data.available // typed number from the declared error's schema
    }
    if (stockRpc.isError(error, 'validation')) {
        return Object.keys(error.data.fields).length // framework ValidationErrorData
    }
    return undefined
}

test('rpc.isError types declared-error data from the rpc spec', () => {
    /* The guarantee is the compile of `_narrows` above; this just keeps it referenced. */
    expect(typeof _narrows).toBe('function')
})

/* Type-only: `Errors` infers off the constructor the handler RETURNS (no `errors:` opt, no
   cast), flows to the returned fn's `isError`, narrowing both `.kind` and `.data`. The schema
   carries real `~standard` types (like `_narrows` above) so `InferInput` is `{ available }`,
   not `unknown` — a validate-only literal would collapse `.data` back to `unknown`. */
const stockDataSchema = undefined as unknown as StandardSchemaV1<{ available: number }>
function _inferenceCheck(caught: unknown): number | undefined {
    const outOfStock = error.typed('outOfStock', 409, stockDataSchema)
    const sell = POST((_args: { available: number }) => outOfStock({ available: 0 }), {
        schemas: { input: stockDataSchema },
    })
    if (sell.isError(caught, 'outOfStock')) {
        return caught.data.available
    }
    return undefined
}
void _inferenceCheck
