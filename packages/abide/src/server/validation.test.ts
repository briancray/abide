// M8a validation — server-side input validation via Standard Schema, dev-only output checks, and
// the ValidationErrorData typed-error shape. Uses a hand-rolled Standard Schema validator (no npm
// dependency) so the test proves any conforming library plugs in.

import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { type StandardSchemaV1, validateStandard } from '../shared/StandardSchema.ts'
import { toValidationErrorData } from '../shared/ValidationErrorData.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { GET } from './GET.ts'
import { deriveOne } from './internal/deriveSchema.ts'
import { validationError } from './internal/validationError.ts'
import { POST } from './POST.ts'

// A tiny conforming validator: requires `{ id: number }`, emitting an issue per bad/missing field.
const idNumberSchema: StandardSchemaV1<{ id: number }, { id: number }> = {
    '~standard': {
        version: 1,
        vendor: 'test',
        validate(value: unknown): StandardSchemaV1.Result<{ id: number }> {
            if (typeof value !== 'object' || value === null) {
                return { issues: [{ message: 'expected an object', path: [] }] }
            }
            const id = (value as Record<string, unknown>).id
            if (typeof id !== 'number') {
                return { issues: [{ message: 'id must be a number', path: ['id'] }] }
            }
            return { value: { id } }
        },
    },
}

// A schema whose validate mismatches any string output (drives the dev output-drift path).
const outputMustBeNumberSchema: StandardSchemaV1<number, number> = {
    '~standard': {
        version: 1,
        vendor: 'test',
        validate(value: unknown): StandardSchemaV1.Result<number> {
            if (typeof value !== 'number')
                return { issues: [{ message: 'output must be a number', path: [] }] }
            return { value }
        },
    },
}

describe('validateStandard + ValidationErrorData (unit)', () => {
    test('validateStandard returns ok:true with the parsed value on success', async () => {
        const result = await validateStandard(idNumberSchema, { id: 7 })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.value).toEqual({ id: 7 })
    })

    test('validateStandard returns ok:false with issues on failure', async () => {
        const result = await validateStandard(idNumberSchema, { id: 'nope' })
        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.issues.length).toBe(1)
            expect(result.issues[0]?.message).toBe('id must be a number')
        }
    })

    test('validateStandard awaits an async validate', async () => {
        const asyncSchema: StandardSchemaV1<string, string> = {
            '~standard': {
                version: 1,
                vendor: 'test',
                async validate(value: unknown): Promise<StandardSchemaV1.Result<string>> {
                    await Promise.resolve()
                    if (typeof value !== 'string') return { issues: [{ message: 'not a string' }] }
                    return { value }
                },
            },
        }
        expect((await validateStandard(asyncSchema, 'hi')).ok).toBe(true)
        expect((await validateStandard(asyncSchema, 1)).ok).toBe(false)
    })

    test('toValidationErrorData flattens issues and records first message per top-level field', async () => {
        const data = toValidationErrorData([
            { message: 'id must be a number', path: ['id'] },
            { message: 'id also bad', path: ['id'] },
            { message: 'name required', path: ['name'] },
        ])
        expect(data.fields).toEqual({ id: 'id must be a number', name: 'name required' })
        expect(data.issues.length).toBe(3)
        expect(data.issues[0]).toEqual({ message: 'id must be a number', path: ['id'] })
    })

    // The 422 must be the SAME wire shape as every other typed error, because the browser proxy has
    // one decoder and it reads the kind off `name`. This asserted `kind` while the proxy read `name`,
    // so `fn.isError(e, 'ValidationError')` was false client-side and no value test could see it.
    test('validationError builds a 422 carrying the typed-error name on the wire', async () => {
        const response = validationError([{ message: 'id must be a number', path: ['id'] }])
        expect(response.status).toBe(422)
        const body = (await response.json()) as {
            status: number
            statusText: string
            name: string
            __typedError: string
            data: { fields: Record<string, string> }
        }
        expect(body.status).toBe(422)
        expect(body.statusText).toBe('Unprocessable Content')
        expect(body.name).toBe('ValidationError')
        expect(body.__typedError).toBe('ValidationError')
        expect(body.data.fields.id).toBe('id must be a number')
    })
})

describe('RPC input validation (integration)', () => {
    test('valid GET args run the handler and return 200', async () => {
        let calls = 0
        const app = await createTestApp({
            routes: {
                read: GET(
                    (args: { id: number }) => {
                        calls++
                        return { doubled: args.id * 2 }
                    },
                    { schemas: { input: idNumberSchema } },
                ),
            },
        })
        try {
            const response = await app.fetch(
                `/__abide/rpc/read?__abide_args=${encodeURIComponent(JSON.stringify({ id: 5 }))}`,
            )
            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ doubled: 10 })
            expect(calls).toBe(1)
        } finally {
            await app.stop()
        }
    })

    test('invalid GET args return 422 ValidationError and never call the handler', async () => {
        let calls = 0
        const app = await createTestApp({
            routes: {
                read: GET(
                    (args: { id: number }) => {
                        calls++
                        return { doubled: args.id * 2 }
                    },
                    { schemas: { input: idNumberSchema } },
                ),
            },
        })
        try {
            const response = await app.fetch(
                `/__abide/rpc/read?__abide_args=${encodeURIComponent(JSON.stringify({ id: 'bad' }))}`,
            )
            expect(response.status).toBe(422)
            const body = (await response.json()) as {
                name: string
                data: { fields: Record<string, string> }
            }
            expect(body.name).toBe('ValidationError')
            expect(body.data.fields.id).toBe('id must be a number')
            expect(calls).toBe(0)
        } finally {
            await app.stop()
        }
    })

    test('valid POST args run the handler; invalid args return 422 without calling it', async () => {
        let calls = 0
        const app = await createTestApp({
            routes: {
                write: POST(
                    (args: { id: number }) => {
                        calls++
                        return { ok: args.id }
                    },
                    { schemas: { input: idNumberSchema } },
                ),
            },
        })
        try {
            const ok = await app.fetch(`/__abide/rpc/write`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: 3 }),
            })
            expect(ok.status).toBe(200)
            expect(await ok.json()).toEqual({ ok: 3 })
            expect(calls).toBe(1)

            const bad = await app.fetch(`/__abide/rpc/write`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: null }),
            })
            expect(bad.status).toBe(422)
            const body = (await bad.json()) as {
                name: string
                data: { fields: Record<string, string> }
            }
            expect(body.name).toBe('ValidationError')
            expect(body.data.fields.id).toBe('id must be a number')
            expect(calls).toBe(1)
        } finally {
            await app.stop()
        }
    })
})

describe('RPC input validation with a derived JSON Schema (integration)', () => {
    // Derivation is a BUILD-TIME step: derive the JSON Schema once here (out of the request path), then
    // hand it to the router as `schemas.input`. The router wraps it via `asStandardSchema` and validates
    // through the same path as a native Standard Schema — proving a derived JSON Schema is accepted.
    const FIXTURE = fileURLToPath(new URL('./internal/__fixtures__/handlers.ts', import.meta.url))

    test('a JSON Schema derived from a handler drives 200/422 through the RPC path', async () => {
        const { input } = await deriveOne(FIXTURE, 'echo')
        expect(input).toEqual({
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
        })
        if (input === undefined) throw new Error('expected a derived input schema')

        let calls = 0
        const app = await createTestApp({
            routes: {
                echo: GET(
                    (args: { text: string }) => {
                        calls++
                        return { echoed: args.text }
                    },
                    { schemas: { input } },
                ),
            },
        })
        try {
            // Valid args → handler runs → 200.
            const ok = await app.fetch(
                `/__abide/rpc/echo?__abide_args=${encodeURIComponent(JSON.stringify({ text: 'hi' }))}`,
            )
            expect(ok.status).toBe(200)
            expect(await ok.json()).toEqual({ echoed: 'hi' })
            expect(calls).toBe(1)

            // Wrong type for `text` → 422 ValidationError, handler never runs.
            const badType = await app.fetch(
                `/__abide/rpc/echo?__abide_args=${encodeURIComponent(JSON.stringify({ text: 123 }))}`,
            )
            expect(badType.status).toBe(422)
            const typeBody = (await badType.json()) as {
                name: string
                data: { fields: Record<string, string> }
            }
            expect(typeBody.name).toBe('ValidationError')
            expect(typeBody.data.fields.text).toBeDefined()
            expect(calls).toBe(1)

            // Missing required `text` → 422 ValidationError, handler never runs.
            const missing = await app.fetch(
                `/__abide/rpc/echo?__abide_args=${encodeURIComponent(JSON.stringify({}))}`,
            )
            expect(missing.status).toBe(422)
            const missingBody = (await missing.json()) as {
                name: string
                data: { fields: Record<string, string> }
            }
            expect(missingBody.name).toBe('ValidationError')
            expect(missingBody.data.fields.text).toBeDefined()
            expect(calls).toBe(1)
        } finally {
            await app.stop()
        }
    })
})

describe('RPC output validation (dev-only)', () => {
    test('output-schema mismatch logs a warning but still returns 200 in dev', async () => {
        const previousEnv = Bun.env.NODE_ENV
        Bun.env.NODE_ENV = 'development'
        // The drift warning rides the gated `abide:rpc` log channel (server path → stderr). Enable the
        // channel and tap stderr to observe it.
        const previousDebug = Bun.env.DEBUG
        Bun.env.DEBUG = 'abide:rpc'
        const lines: string[] = []
        const originalWrite = process.stderr.write
        process.stderr.write = ((chunk: string | Uint8Array): boolean => {
            lines.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
            return true
        }) as typeof process.stderr.write
        // Handler returns a string, but the output schema demands a number → contract drift.
        const app = await createTestApp({
            routes: {
                drift: GET((): unknown => 'not a number', {
                    schemas: { output: outputMustBeNumberSchema },
                }),
            },
        })
        try {
            const response = await app.fetch(`/__abide/rpc/drift`)
            expect(response.status).toBe(200)
            expect(await response.json()).toBe('not a number')
            expect(lines.some((line) => line.includes('output schema mismatch'))).toBe(true)
        } finally {
            process.stderr.write = originalWrite
            if (previousDebug === undefined) delete Bun.env.DEBUG
            else Bun.env.DEBUG = previousDebug
            if (previousEnv === undefined) delete Bun.env.NODE_ENV
            else Bun.env.NODE_ENV = previousEnv
            await app.stop()
        }
    })
})

describe('flat query-param reads (the hand-testable form)', () => {
    test('a read with NO runtime schema decodes flat params as strings (?key=beta → beta)', async () => {
        const app = await createTestApp({
            routes: {
                counter: GET(({ key = 'alpha' }: { key?: string }) => ({ key })),
            },
        })
        try {
            const beta = await app.fetch('/__abide/rpc/counter?key=beta')
            expect(beta.status).toBe(200)
            expect(await beta.json()).toEqual({ key: 'beta' })
            // An absent param falls through to the handler's destructuring default.
            const fallback = await app.fetch('/__abide/rpc/counter')
            expect(await fallback.json()).toEqual({ key: 'alpha' })
        } finally {
            await app.stop()
        }
    })

    test('flat params are COERCED to the input schema field types', async () => {
        let seen: unknown
        const app = await createTestApp({
            routes: {
                dbl: GET(
                    (args: { n: number }) => {
                        seen = args.n
                        return { doubled: args.n * 2 }
                    },
                    {
                        schemas: {
                            input: {
                                type: 'object',
                                properties: { n: { type: 'number' } },
                                required: ['n'],
                            },
                        },
                    },
                ),
            },
        })
        try {
            const ok = await app.fetch('/__abide/rpc/dbl?n=5')
            expect(ok.status).toBe(200)
            expect(seen).toBe(5) // coerced to a number, not the raw string "5"
            expect(await ok.json()).toEqual({ doubled: 10 })

            // An uncoercible value stays a string → schema validation, not the decoder, emits the 422.
            const bad = await app.fetch('/__abide/rpc/dbl?n=nope')
            expect(bad.status).toBe(422)
        } finally {
            await app.stop()
        }
    })

    test('the canonical __abide_args blob wins over flat params when both are present', async () => {
        const app = await createTestApp({
            routes: {
                counter: GET(({ key = 'alpha' }: { key?: string }) => ({ key })),
            },
        })
        try {
            const res = await app.fetch(
                `/__abide/rpc/counter?key=beta&__abide_args=${encodeURIComponent(JSON.stringify({ key: 'gamma' }))}`,
            )
            expect(await res.json()).toEqual({ key: 'gamma' })
        } finally {
            await app.stop()
        }
    })

    test('the reserved __abide_from param is never treated as an arg field', async () => {
        const app = await createTestApp({
            routes: {
                echoKeys: GET((args: Record<string, unknown>) => ({ keys: Object.keys(args) })),
            },
        })
        try {
            const res = await app.fetch('/__abide/rpc/echoKeys?key=beta&__abide_from=3')
            expect(await res.json()).toEqual({ keys: ['key'] })
        } finally {
            await app.stop()
        }
    })

    // The flip side of the namespacing, and the reason a stale caller fails SILENTLY: a bare `?args=`
    // is now just an ordinary flat field named "args". The blob is NOT decoded, the handler's real
    // fields fall back to their defaults, and nothing errors. Any hand-built RPC URL must say
    // `__abide_args`.
    test('a bare ?args= is an ordinary arg field, NOT the canonical blob', async () => {
        const app = await createTestApp({
            routes: {
                counter: GET((args: Record<string, unknown>) => ({
                    key: args.key ?? 'alpha',
                    keys: Object.keys(args),
                })),
            },
        })
        try {
            const res = await app.fetch(
                `/__abide/rpc/counter?args=${encodeURIComponent(JSON.stringify({ key: 'gamma' }))}`,
            )
            expect(res.status).toBe(200)
            // The blob was NOT unpacked — `key` never arrived, and "args" landed as a literal field.
            expect(await res.json()).toEqual({
                key: 'alpha',
                keys: ['args'],
            })
        } finally {
            await app.stop()
        }
    })
})
