// Registry + OpenAPI 3.1 generation (machine-surfaces.md MS1/MS4). Exercises buildRegistry and
// buildOpenApi directly, then end-to-end through the live `/openapi.json` route.

import { expect, test } from 'bun:test'
import type { JSONSchema } from '../shared/internal/jsonSchema.ts'
import type { StandardSchemaV1 } from '../shared/StandardSchema.ts'
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
    const standardSchema: StandardSchemaV1<{ id: string }, { id: string }> = {
        '~standard': {
            version: 1,
            vendor: 'test',
            validate: (value: unknown) => ({ value: value as { id: string } }),
        },
    }
    const registry = buildRegistry({
        routes: {
            thing: GET(({ id }) => ({ id }), { schemas: { input: standardSchema } }),
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

    const searchPath = paths['/__abide/rpc/search']
    if (!searchPath) throw new Error('expected a /rpc/search path')
    const searchGet = searchPath.get
    if (!searchGet) throw new Error('expected a GET on /rpc/search')
    const parameters = searchGet.parameters as Array<Record<string, unknown>>
    // The input schema enumerates its fields → one flat query param PER field (the public affordance).
    const qParameter = parameters.find((parameter) => parameter.name === 'q')
    if (!qParameter) throw new Error('expected a `q` query parameter on /rpc/search')
    expect(qParameter.in).toBe('query')
    expect(qParameter.required).toBe(true)
    expect((qParameter.schema as Record<string, unknown>).type).toBe('string')
    // No opaque `__abide_args` blob param when the fields are known.
    expect(parameters.some((parameter) => parameter.name === '__abide_args')).toBe(false)
    expect((searchGet.responses as Record<string, unknown>)['422']).toBeDefined()
    expect(searchGet.summary).toBe('Search the index')

    const createPath = paths['/__abide/rpc/create']
    if (!createPath) throw new Error('expected a /rpc/create path')
    const createPost = createPath.post
    if (!createPost) throw new Error('expected a POST on /rpc/create')
    expect(createPost.requestBody).toBeDefined()
    expect((createPost.responses as Record<string, unknown>)['200']).toBeDefined()

    // browser:false RPC is omitted entirely.
    expect(paths['/__abide/rpc/secret']).toBeUndefined()

    const components = doc.components as Record<string, Record<string, unknown>>
    const schemas = components.schemas
    if (!schemas) throw new Error('expected components.schemas')
    expect(schemas.ValidationError).toBeDefined()
    const securitySchemes = components.securitySchemes
    if (!securitySchemes) throw new Error('expected components.securitySchemes')
    expect(securitySchemes.bearerAuth).toBeDefined()
})

test('a read whose schema is not field-enumerable falls back to the __abide_args blob param', () => {
    // No schema (a bare zero/loose-arg read) → the fields are unknown, so the spec advertises the
    // canonical JSON-blob parameter instead of per-field flat params.
    const doc = buildOpenApi(
        buildRegistry({
            routes: {
                loose: GET(async (args: { anything?: unknown }) => ({ echoed: args.anything })),
            },
        }),
    )
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>
    const looseGet = paths['/__abide/rpc/loose']?.get
    if (!looseGet) throw new Error('expected a GET on /rpc/loose')
    const parameters = looseGet.parameters as Array<Record<string, unknown>>
    expect(parameters).toHaveLength(1)
    expect(parameters[0]?.name).toBe('__abide_args')
    expect(parameters[0]?.in).toBe('query')
})

test('GET /openapi.json serves the generated document', async () => {
    const app = await createTestApp(fixtureConfig())
    try {
        const response = await app.fetch('/openapi.json')
        expect(response.status).toBe(200)
        // biome-ignore lint/suspicious/noExplicitAny: parsed JSON doc is dynamically indexed by these assertions
        const doc = (await response.json()) as Record<string, any>

        expect(doc.openapi).toBe('3.1.0')
        const searchGet = doc.paths['/__abide/rpc/search'].get
        expect(searchGet).toBeDefined()
        // Reads advertise one flat query param per input field — here the typed `q` field.
        const qParam = searchGet.parameters.find(
            (parameter: { name: string }) => parameter.name === 'q',
        )
        expect(qParam).toBeDefined()
        expect(qParam.schema.type).toBe('string')
        expect(doc.paths['/__abide/rpc/create'].post.requestBody).toBeDefined()
        expect(doc.paths['/__abide/rpc/create'].post.responses['422']).toBeDefined()
        expect(doc.paths['/__abide/rpc/secret']).toBeUndefined()
    } finally {
        await app.stop()
    }
})
