// Registry + OpenAPI 3.1 generation (machine-surfaces.md MS1/MS4). Exercises buildRegistry and
// buildOpenApi directly, then end-to-end through the live `/openapi.json` route.

import { expect, test } from 'bun:test'
import type { JSONSchema } from '../shared/internal/jsonSchema.ts'
import { createTestApp, type TestAppConfig } from '../test/createTestApp.ts'
import { GET } from './GET.ts'
import { buildOpenApi } from './internal/openapi.ts'
import { buildRegistry } from './internal/registry.ts'
import { POST } from './POST.ts'
import { socket } from './socket.ts'

const searchInput: JSONSchema = {
    type: 'object',
    properties: { q: { type: 'string' } },
    required: ['q'],
}

const searchOutput: JSONSchema = {
    type: 'object',
    properties: { hits: { type: 'array', items: { type: 'string' } } },
}

function fixtureConfig(): TestAppConfig {
    return {
        routes: {
            search: GET(async (args: { q: string }) => ({ hits: [args.q] }), {
                schemas: { input: searchInput, output: searchOutput },
                doc: 'Search the index',
            }),
            create: POST(async (args: { title: string }) => ({ id: 1, title: args.title }), {
                schemas: {
                    input: {
                        type: 'object',
                        properties: { title: { type: 'string' } },
                        required: ['title'],
                    },
                },
            }),
            secret: GET(async () => ({ ok: true }), { clients: { browser: false } }),
        },
        sockets: {
            ticks: socket<number>({ clientPublish: true }),
        },
    }
}

test('buildRegistry captures rpcs, schemas, clients, and sockets', () => {
    const registry = buildRegistry(fixtureConfig())

    const search = registry.rpcs.find((entry) => entry.name === 'search')
    if (!search) throw new Error('expected a search rpc in the registry')
    expect(search.method).toBe('GET')
    expect(search.read).toBe(true)
    expect(search.inputSchema).toEqual(searchInput)
    expect(search.outputSchema).toEqual(searchOutput)
    expect(search.doc).toBe('Search the index')

    const create = registry.rpcs.find((entry) => entry.name === 'create')
    if (!create) throw new Error('expected a create rpc in the registry')
    expect(create.method).toBe('POST')
    expect(create.read).toBe(false)
    expect(create.inputSchema).toBeDefined()
    expect(create.outputSchema).toBeUndefined()

    const secret = registry.rpcs.find((entry) => entry.name === 'secret')
    if (!secret) throw new Error('expected a secret rpc in the registry')
    expect(secret.clients.browser).toBe(false)

    const ticks = registry.sockets.find((entry) => entry.name === 'ticks')
    if (!ticks) throw new Error('expected a ticks socket in the registry')
    expect(ticks.clientPublish).toBe(true)
})

test('buildRegistry leaves inputSchema undefined for a Standard Schema', () => {
    const standardSchema = {
        '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) },
    }
    const registry = buildRegistry({
        routes: {
            thing: GET(async () => ({}), { schemas: { input: standardSchema as never } }),
        },
    })
    const thing = registry.rpcs.find((entry) => entry.name === 'thing')
    if (!thing) throw new Error('expected a thing rpc in the registry')
    expect(thing.inputSchema).toBeUndefined()
})

test('buildOpenApi emits a 3.1 document with GET query param and POST requestBody', () => {
    const doc = buildOpenApi(buildRegistry(fixtureConfig()))

    expect(doc.openapi).toBe('3.1.0')
    const info = doc.info as Record<string, unknown>
    expect(info.title).toBe('abide app')

    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>

    const searchPath = paths['/rpc/search']
    if (!searchPath) throw new Error('expected a /rpc/search path')
    const searchGet = searchPath.get
    if (!searchGet) throw new Error('expected a GET on /rpc/search')
    const parameters = searchGet.parameters as Array<Record<string, unknown>>
    const firstParameter = parameters[0]
    if (!firstParameter) throw new Error('expected a query parameter on /rpc/search')
    expect(firstParameter.name).toBe('args')
    expect(firstParameter.in).toBe('query')
    expect(firstParameter.required).toBe(true)
    expect((searchGet.responses as Record<string, unknown>)['422']).toBeDefined()
    expect(searchGet.summary).toBe('Search the index')

    const createPath = paths['/rpc/create']
    if (!createPath) throw new Error('expected a /rpc/create path')
    const createPost = createPath.post
    if (!createPost) throw new Error('expected a POST on /rpc/create')
    expect(createPost.requestBody).toBeDefined()
    expect((createPost.responses as Record<string, unknown>)['200']).toBeDefined()

    // browser:false RPC is omitted entirely.
    expect(paths['/rpc/secret']).toBeUndefined()

    const components = doc.components as Record<string, Record<string, unknown>>
    const schemas = components.schemas
    if (!schemas) throw new Error('expected components.schemas')
    expect(schemas.ValidationError).toBeDefined()
    const securitySchemes = components.securitySchemes
    if (!securitySchemes) throw new Error('expected components.securitySchemes')
    expect(securitySchemes.bearerAuth).toBeDefined()
})

test('GET /openapi.json serves the generated document', async () => {
    const app = createTestApp(fixtureConfig())
    try {
        const response = await app.fetch('/openapi.json')
        expect(response.status).toBe(200)
        // biome-ignore lint/suspicious/noExplicitAny: parsed JSON doc is dynamically indexed by these assertions
        const doc = (await response.json()) as Record<string, any>

        expect(doc.openapi).toBe('3.1.0')
        const searchGet = doc.paths['/rpc/search'].get
        expect(searchGet).toBeDefined()
        // The args object is carried in a single `args` query param whose schema types the q field.
        expect(searchGet.parameters[0].name).toBe('args')
        expect(searchGet.parameters[0].schema.properties.q).toBeDefined()
        expect(doc.paths['/rpc/create'].post.requestBody).toBeDefined()
        expect(doc.paths['/rpc/create'].post.responses['422']).toBeDefined()
        expect(doc.paths['/rpc/secret']).toBeUndefined()
    } finally {
        await app.stop()
    }
})
