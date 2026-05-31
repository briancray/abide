import { beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
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
        defineVerb('GET', '/rpc/oa-get', ({ id }: { id: string }) => json({ id }), {
            inputSchema: testSchema({
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
            }),
            outputSchema: testSchema({ type: 'object', properties: { id: { type: 'string' } } }),
        })
        defineVerb('POST', '/rpc/oa-make', ({ name }: { name: string }) => json({ name }), {
            inputSchema: testSchema({ type: 'object', properties: { name: { type: 'string' } } }),
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
    })
})
