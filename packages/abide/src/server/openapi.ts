// The OpenAPI door, projected from `endpoints()` and from nothing else.
//
// There is no second derivation in here and there must not be: a declaration's shape is already JSON
// Schema — that is what `#shared/internal/shapes.ts` is about — so an operation is the same three
// facts the catalogue already carries, under OpenAPI's names for them. What this file knows that the
// catalogue does not is the WIRE: which door an rpc arrives through, that a read spends its args as
// one query parameter each, that a `format: 'binary'` member makes the body multipart, and that a
// socket has two HTTP arms rather than a call. All four are facts about `registry.ts`, which is why
// they are written beside it rather than left for every generator downstream to rediscover.
//
// OpenAPI 3.1 rather than 3.0, because 3.1's schema object IS JSON Schema. A 3.0 document would need
// this file to translate every shape on the way out — the exact projection `shapes.ts` inverted the
// whole design to avoid — and would lose `examples`, `const` and a union of types in the process.

import { mountBase } from '#shared/internal/mount.ts'
import { ARGS_PARAM, RPC_PREFIX, SOCKET_PREFIX, TAIL_PARAM, WAIT_PARAM } from '#shared/internal/PATHS.ts'
import type { EndpointShape, JsonSchema } from '#shared/internal/shapes.ts'
// Both, and they are NOT interchangeable: a streaming rpc answers `x-ndjson` and the socket tail
// answers `application/jsonl`, because the two are served by different writers — `respond` and
// `jsonl`. A document that guessed one for both would generate a client that refuses its own server.
import { JSON_TYPE, JSONL_TYPE, NDJSON_TYPE } from '#shared/internal/wire.ts'
import { endpoints } from './catalogue.ts'
import { config } from './config.ts'

/** What an app can say that the declarations cannot. Everything else is derived. */
export interface OpenApiOptions {
    /** Defaults to `APP_NAME`, which is the nearest package.json's `name` unless an operator renamed it. */
    title?: string
    /** Defaults to `APP_VERSION`. This is the API's version, which is the app's until they differ. */
    version?: string
    description?: string
}

/**
 * The document. Deliberately not a full OpenAPI type — this declares the members abide WRITES, and a
 * complete one would be a large second spec to keep in step for no reader.
 */
export interface OpenApiDocument {
    openapi: string
    info: { title: string; version: string; description?: string }
    servers: { url: string }[]
    paths: Record<string, Record<string, unknown>>
    components: { schemas: Record<string, JsonSchema> }
}

/**
 * What every abide refusal looks like, as one component every operation points at.
 *
 * Named once and referenced, rather than inlined per operation: it is the same body from every door —
 * `refuse` and `failed` both write it — so a generated client gets one error type instead of one per
 * call, and a change to the wire's error frame is a change in one place here.
 */
const ERROR_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        error: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                message: { type: 'string' },
                data: {},
            },
            required: ['name', 'message'],
        },
    },
    required: ['error'],
}

const ERROR_REF: JsonSchema = { $ref: '#/components/schemas/AbideError' } as JsonSchema

const ERROR_BODY: Record<string, { schema: JsonSchema }> = { [JSON_TYPE]: { schema: ERROR_REF } }

/** The refusals every door can answer with, so a client generates one error path rather than none. */
const REFUSALS = {
    '400': { description: 'The call could not be decoded.', content: ERROR_BODY },
    '403': { description: 'The caller is not allowed to make this call.', content: ERROR_BODY },
    '404': { description: 'There is no endpoint at this address.', content: ERROR_BODY },
    '422': { description: 'The arguments do not match the declared shape.', content: ERROR_BODY },
    '500': { description: 'The handler failed.', content: ERROR_BODY },
}

/**
 * Whether this shape is one abide spends as one query parameter PER MEMBER.
 *
 * The object case is the whole of it, because that is what `decodeQuery`'s `named` walk reads back:
 * args that are not an object have no name to travel under and go through the `__abide_args` hatch
 * instead. Asked of the PUBLISHED shape rather than of a value, so the document says what the door
 * will do before anybody calls it.
 */
function spendsAsQuery(shape: JsonSchema): boolean {
    return shape.type === 'object' && shape.properties !== undefined
}

/** A read's args, one query parameter each — and the hatch when they are not an object at all. */
function queryFor(input: JsonSchema | undefined): unknown[] {
    if (input === undefined) return []
    if (!spendsAsQuery(input)) {
        return [
            {
                name: ARGS_PARAM,
                in: 'query',
                required: true,
                schema: { type: 'string' },
                description:
                    'The arguments as one JSON value. This endpoint takes args that are not an object, ' +
                    'so there is no name to put them under — see the escape hatch in PATHS.ts.',
            },
        ]
    }
    const required = new Set(input.required ?? [])
    const parameters: unknown[] = []
    for (const name in input.properties) {
        parameters.push({
            name,
            in: 'query',
            required: required.has(name),
            schema: input.properties[name],
        })
    }
    return parameters
}

/**
 * Whether a body carries a FILE, which is what makes it multipart rather than JSON.
 *
 * Shallow, because that is where the encoder looks: `encodeArgs` decides on a file among the args,
 * and a file nested inside a plain object does not survive `JSON.stringify` either way. `binary` is
 * the spelling `shapes.ts` keeps for exactly this — the one entry in the shape language that is not
 * JSON, so that a multipart door is describable in the same document as every other call.
 */
function carriesFile(shape: JsonSchema | undefined): boolean {
    if (shape === undefined) return false
    if (shape.format === 'binary') return true
    for (const name in shape.properties) {
        if (shape.properties[name]?.format === 'binary') return true
    }
    return false
}

function bodyFor(input: JsonSchema | undefined): unknown {
    if (input === undefined) return undefined
    const type = carriesFile(input) ? 'multipart/form-data' : JSON_TYPE
    return { required: true, content: { [type]: { schema: input } } }
}

/**
 * What the answer looks like on the wire.
 *
 * A handler that YIELDS answers as ndjson — one JSON value per line — so the schema published for it
 * is the CHUNK rather than the whole, which is what `output` already holds: a transcript is not one
 * value and neither is the shape of one.
 */
function answerFor(endpoint: EndpointShape): unknown {
    const type = endpoint.streams === true ? NDJSON_TYPE : JSON_TYPE
    const schema = endpoint.output ?? {}
    return {
        '200': {
            description: endpoint.streams === true ? 'One JSON value per line.' : 'The answer.',
            content: { [type]: { schema } },
        },
        ...REFUSALS,
    }
}

function operationFor(endpoint: EndpointShape): Record<string, unknown> {
    const method = (endpoint.method ?? 'GET').toLowerCase()
    const reads = method === 'get'
    const operation: Record<string, unknown> = {
        operationId: endpoint.id,
        tags: ['rpc'],
        responses: answerFor(endpoint),
    }
    if (endpoint.description !== undefined) operation.summary = endpoint.description
    if (reads) {
        operation.parameters = queryFor(endpoint.input)
    } else {
        const body = bodyFor(endpoint.input)
        if (body !== undefined) operation.requestBody = body
    }
    return { [method]: operation }
}

/**
 * A socket's two HTTP arms, which is what a document can describe at all.
 *
 * The websocket itself is named in the tail's description rather than given an operation, because
 * OpenAPI has no upgrade: an operation claiming `101` would be a shape no generated client can use
 * and no server can be checked against. What IS describable is the pair `registry.ts` serves beside
 * it — the ndjson tail and the publish — and those are the arms an agent or a generated client can
 * actually reach, which is the whole reason they exist.
 */
function socketPaths(endpoint: EndpointShape): Record<string, unknown> {
    const room = queryFor(endpoint.room)
    const tail: Record<string, unknown> = {
        operationId: `${endpoint.id}:tail`,
        tags: ['socket'],
        summary: endpoint.description ?? `Tail ${endpoint.id}.`,
        description:
            'The transcript, then every message published after it, as one JSON value per line. ' +
            `Without ${TAIL_PARAM} and ${WAIT_PARAM} the response never ends, which is what a browser holds ` +
            'open; a caller that has to return names both instead — how much is enough, and how long to ' +
            'wait for it. The same address upgrades to a websocket when the request carries an ' +
            '`Upgrade: websocket` header.',
        parameters: [
            ...room,
            {
                name: TAIL_PARAM,
                in: 'query',
                required: false,
                schema: { type: 'integer', minimum: 1 },
                description: 'How many messages to take before the response ends.',
            },
            {
                name: WAIT_PARAM,
                in: 'query',
                required: false,
                schema: { type: 'integer', minimum: 1 },
                description:
                    'ms to wait for the next message before the response ends. Without it a quiet ' +
                    'room never reaches the count above, which reads as a hang rather than an empty answer.',
            },
        ],
        responses: {
            '200': {
                description: 'One message per line.',
                content: { [JSONL_TYPE]: { schema: endpoint.input ?? {} } },
            },
            ...REFUSALS,
        },
    }
    const paths: Record<string, unknown> = { get: tail }
    if (endpoint.clientPublish === true) {
        paths.post = {
            operationId: `${endpoint.id}:publish`,
            tags: ['socket'],
            summary: `Publish one message into ${endpoint.id}.`,
            description:
                'What happens to the message is the socket’s own `clientPublish` to decide, so this ' +
                'answers ACCEPTED rather than published.',
            parameters: room,
            requestBody: { required: true, content: { [JSON_TYPE]: { schema: endpoint.input ?? {} } } },
            responses: {
                '202': {
                    description: 'The message passed every gate and the handler ran.',
                    content: {
                        [JSON_TYPE]: {
                            schema: { type: 'object', properties: { accepted: { type: 'boolean' } } },
                        },
                    },
                },
                '405': { description: 'This socket is a broadcast.', content: ERROR_BODY },
                ...REFUSALS,
            },
        }
    }
    return paths
}

/**
 * Where the paths below are relative TO.
 *
 * `APP_URL` when an operator declared one, because it is the only value that survives TLS
 * termination and a proxy — the same reason `registry.ts`'s origin gate prefers it. Otherwise the
 * MOUNT, which is `''` for the ordinary app at the root of its origin and `/v2` for one behind a
 * sub-path proxy. Written either way rather than left out: an omitted `servers` means `/`, and a
 * mounted app would then publish every address one segment short of where it answers.
 */
function serverFor(): { url: string }[] {
    const declared = config().APP_URL
    if (declared !== null) return [{ url: declared.replace(/\/+$/, '') || '/' }]
    return [{ url: mountBase() || '/' }]
}

/**
 * Every endpoint an app declared, as an OpenAPI 3.1 document.
 *
 * Sorted by address, because `endpoints()` is — two runs of one app produce the same document, and a
 * diff of one is a diff of the API. An endpoint that opted out with `clients: { openapi: false }` is
 * not here; see `Clients`.
 */
export function openapi(options: OpenApiOptions = {}): OpenApiDocument {
    const settings = config()
    const paths: Record<string, Record<string, unknown>> = {}
    for (const endpoint of endpoints()) {
        if (!endpoint.clients.openapi) continue
        if (endpoint.kind === 'rpc') {
            paths[`${RPC_PREFIX}${endpoint.id}`] = operationFor(endpoint)
        } else {
            paths[`${SOCKET_PREFIX}${endpoint.id}`] = socketPaths(endpoint)
        }
    }
    const info: OpenApiDocument['info'] = {
        title: options.title ?? settings.APP_NAME,
        version: options.version ?? settings.APP_VERSION,
    }
    if (options.description !== undefined) info.description = options.description
    return {
        openapi: '3.1.0',
        info,
        servers: serverFor(),
        paths,
        components: { schemas: { AbideError: ERROR_SCHEMA } },
    }
}
