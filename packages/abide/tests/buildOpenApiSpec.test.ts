import { beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { buildOpenApiSpec } from '../src/lib/server/runtime/buildOpenApiSpec.ts'
import { testSchema } from './standardSchema.ts'

type Operation = {
    parameters?: Array<{ name: string; in: string; required: boolean; schema?: unknown }>
    requestBody?: { content: Record<string, { schema: unknown }> }
    responses: Record<
        string,
        { description?: string; content?: Record<string, { schema: unknown }> }
    >
}

describe('buildOpenApiSpec happy path', () => {
    let paths: Record<string, Record<string, Operation>>

    beforeAll(() => {
        defineRpc('GET', '/rpc/oa-get', ({ id }: { id: string }) => json({ id }), {
            schemas: {
                input: testSchema({
                    type: 'object',
                    properties: { id: { type: 'string' } },
                    required: ['id'],
                }),
                output: testSchema({ type: 'object', properties: { id: { type: 'string' } } }),
            },
        })
        defineRpc('POST', '/rpc/oa-make', ({ name }: { name: string }) => json({ name }), {
            schemas: {
                input: testSchema({ type: 'object', properties: { name: { type: 'string' } } }),
            },
        })
        // upload rpc → text fields plus generic binary parts
        defineRpc('POST', '/rpc/oa-upload', () => json({ ok: true }), {
            schemas: {
                input: testSchema({
                    type: 'object',
                    properties: { title: { type: 'string' } },
                    required: ['title'],
                }),
                files: testSchema(),
            },
        })
        const spec = buildOpenApiSpec({ title: 'app', version: '1.0.0' })
        paths = spec.paths as Record<string, Record<string, Operation>>
    })

    test('is an OpenAPI 3.1 document with the app info', () => {
        const spec = buildOpenApiSpec({ title: 'app', version: '2.0.0' })
        expect(spec.openapi).toBe('3.1.0')
        expect(spec.info).toEqual({ title: 'app', version: '2.0.0' })
    })

    test('GET args become query parameters; output drives the 200 schema', () => {
        const operation = paths['/rpc/oa-get'].get
        expect(operation.parameters).toContainEqual({
            name: 'id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
        })
        expect(operation.responses['200'].content?.['application/json'].schema).toEqual({
            type: 'object',
            properties: { id: { type: 'string' } },
        })
    })

    test('POST args become a JSON request body', () => {
        const operation = paths['/rpc/oa-make'].post
        expect(operation.requestBody?.content['application/json'].schema).toMatchObject({
            type: 'object',
            properties: { name: { type: 'string' } },
        })
        // a non-upload POST has no multipart body
        expect(operation.requestBody?.content['multipart/form-data']).toBeUndefined()
    })

    test('an upload rpc emits a multipart body with text fields + generic binary parts', () => {
        const schema = paths['/rpc/oa-upload'].post.requestBody?.content['multipart/form-data']
            .schema as Record<string, unknown>
        expect(schema).toMatchObject({
            type: 'object',
            properties: { title: { type: 'string' } },
            additionalProperties: { type: 'string', format: 'binary' },
        })
        expect(schema.required).toEqual(expect.arrayContaining(['title']))
        // filesSchema never reached the JSON body
        expect(
            paths['/rpc/oa-upload'].post.requestBody?.content['application/json'],
        ).toBeUndefined()
    })
})

/* ADR-0030 D2: the handler return type, projected to JSON Schema at build time and stamped as
   `outputJsonSchema`, drives the 200 body when no `schemas.output` VALIDATOR is declared; a declared
   `schemas.output` still overrides it. */
describe('buildOpenApiSpec — build-projected output schema (ADR-0030 D2)', () => {
    const PROJECTED = {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
    }

    test('the projected outputJsonSchema drives the 200 body when no schemas.output', () => {
        defineRpc('GET', '/rpc/oa-projected', () => json({ ok: true }), {
            outputJsonSchema: PROJECTED,
        })
        const paths = buildOpenApiSpec({ title: 'app', version: '1.0.0' }).paths as Record<
            string,
            Record<string, Operation>
        >
        expect(
            paths['/rpc/oa-projected'].get.responses['200'].content?.['application/json'].schema,
        ).toEqual(PROJECTED)
    })

    test('a declared schemas.output overrides the projected schema', () => {
        defineRpc('GET', '/rpc/oa-override', () => json({ ok: true }), {
            schemas: {
                output: testSchema({
                    type: 'object',
                    properties: { validated: { type: 'string' } },
                }),
            },
            outputJsonSchema: PROJECTED,
        })
        const paths = buildOpenApiSpec({ title: 'app', version: '1.0.0' }).paths as Record<
            string,
            Record<string, Operation>
        >
        expect(
            paths['/rpc/oa-override'].get.responses['200'].content?.['application/json'].schema,
        ).toEqual({ type: 'object', properties: { validated: { type: 'string' } } })
    })
})

/* ADR-0030 input side: the handler's input parameter type, projected to JSON Schema at build time and
   stamped as `inputJsonSchema`, drives the parameters/request body when no `schemas.input` VALIDATOR is
   declared; a declared `schemas.input` still overrides it. */
describe('buildOpenApiSpec — build-projected input schema (ADR-0030 input side)', () => {
    const PROJECTED = {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
    }

    test('the projected inputJsonSchema drives GET query parameters when no schemas.input', () => {
        defineRpc('GET', '/rpc/oa-in-projected', ({ id }: { id: string }) => json({ id }), {
            inputJsonSchema: PROJECTED,
        })
        const paths = buildOpenApiSpec({ title: 'app', version: '1.0.0' }).paths as Record<
            string,
            Record<string, Operation>
        >
        expect(paths['/rpc/oa-in-projected'].get.parameters).toContainEqual({
            name: 'id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
        })
    })

    test('the projected inputJsonSchema drives a POST JSON request body when no schemas.input', () => {
        defineRpc('POST', '/rpc/oa-in-body', ({ id }: { id: string }) => json({ id }), {
            inputJsonSchema: PROJECTED,
        })
        const paths = buildOpenApiSpec({ title: 'app', version: '1.0.0' }).paths as Record<
            string,
            Record<string, Operation>
        >
        expect(
            paths['/rpc/oa-in-body'].post.requestBody?.content['application/json'].schema,
        ).toEqual(PROJECTED)
    })

    test('a declared schemas.input overrides the projected input schema', () => {
        defineRpc('POST', '/rpc/oa-in-override', ({ name }: { name: string }) => json({ name }), {
            schemas: {
                input: testSchema({ type: 'object', properties: { name: { type: 'string' } } }),
            },
            inputJsonSchema: PROJECTED,
        })
        const paths = buildOpenApiSpec({ title: 'app', version: '1.0.0' }).paths as Record<
            string,
            Record<string, Operation>
        >
        expect(
            paths['/rpc/oa-in-override'].post.requestBody?.content['application/json'].schema,
        ).toMatchObject({ type: 'object', properties: { name: { type: 'string' } } })
    })
})

/* ADR-0030: the handler's typed-error branches, baked as a status-keyed `errorJsonSchemas` map, add
   one `responses[status]` entry each — documenting each error's status + data payload alongside the
   200, all from the one handler return type. */
describe('buildOpenApiSpec — typed error responses (ADR-0030)', () => {
    const OUTPUT = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
    const NOT_FOUND = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    const MOVED = {
        type: 'object',
        properties: { movedTo: { type: 'string' } },
        required: ['movedTo'],
    }
    const CONFLICT = {
        type: 'object',
        properties: { existingId: { type: 'number' } },
        required: ['existingId'],
    }

    function specFor(url: string, opts: Parameters<typeof defineRpc>[3]): Operation {
        defineRpc('GET', url, () => json({ ok: true }), opts)
        const paths = buildOpenApiSpec({ title: 'app', version: '1.0.0' }).paths as Record<
            string,
            Record<string, Operation>
        >
        return paths[url].get
    }

    test('each typed error surfaces as a responses[status] entry; the 200 is preserved', () => {
        const operation = specFor('/rpc/oa-errors', {
            outputJsonSchema: OUTPUT,
            errorJsonSchemas: { 404: { anyOf: [NOT_FOUND, MOVED] }, 409: CONFLICT, 429: {} },
        })
        // The success 200 survives the merge, still carrying the projected output body.
        expect(operation.responses['200'].content?.['application/json'].schema).toEqual(OUTPUT)
        // A data-bearing error surfaces its status reason phrase + the projected data schema.
        expect(operation.responses['404']).toEqual({
            description: 'Not Found',
            content: { 'application/json': { schema: { anyOf: [NOT_FOUND, MOVED] } } },
        })
        expect(operation.responses['409'].content?.['application/json'].schema).toEqual(CONFLICT)
        // A nullary error (bare `{}`) surfaces the status with no content schema.
        expect(operation.responses['429']).toEqual({ description: 'Too Many Requests' })
    })

    test('an error status never clobbers an existing response (the 200 wins a collision)', () => {
        const operation = specFor('/rpc/oa-err-collide', {
            errorJsonSchemas: { 200: NOT_FOUND },
        })
        // The success 200 is left untouched even when a (degenerate) error map names status 200.
        expect(operation.responses['200'].description).toBe('OK')
        expect(operation.responses['200'].content).toBeUndefined()
    })

    test('no errorJsonSchemas leaves the responses at just the 200 (fail-open)', () => {
        const operation = specFor('/rpc/oa-no-errors', {})
        expect(Object.keys(operation.responses)).toEqual(['200'])
    })
})
