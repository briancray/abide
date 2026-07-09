import { beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { buildOpenApiSpec } from '../src/lib/server/runtime/buildOpenApiSpec.ts'
import { testSchema } from './standardSchema.ts'

type Operation = {
    parameters?: Array<{ name: string; in: string; required: boolean; schema?: unknown }>
    requestBody?: { content: Record<string, { schema: unknown }> }
    responses: Record<string, { content?: Record<string, { schema: unknown }> }>
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
