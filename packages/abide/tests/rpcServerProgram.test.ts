import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
    createRpcServerProgram,
    type RpcServerProgram,
} from '../src/lib/shared/createRpcServerProgram.ts'
import { detectRpcMethod } from '../src/lib/shared/detectRpcMethod.ts'
import { prepareRpcModule } from '../src/lib/shared/prepareRpcModule.ts'
import { rpcServerForRoot } from '../src/lib/shared/rpcServerForRoot.ts'

/* ADR-0025 D2: the rpc/socket build transforms resolve meaning through a warm server
   `ts.Program` (streaming from the handler's return type, method from the export helper's
   symbol, `outbox` from the opts property's literal type) instead of scanning source text. The
   fixtures live inside the repo so `@abide/abide/server/*` resolves through the workspace
   symlink and the checker sees the real helper types. Each query fails open to its
   char-scan/regex counterpart. */
const STREAM_CWD = resolve(import.meta.dir, 'support/fixtures/rpcStreaming')
const STREAM_RPC_DIR = resolve(STREAM_CWD, 'src/server/rpc')
const streamModule = (name: string) => resolve(STREAM_RPC_DIR, `${name}.ts`)

const SERVER_CWD = resolve(import.meta.dir, 'support/fixtures/rpcServer')
const SERVER_RPC_DIR = resolve(SERVER_CWD, 'src/server/rpc')
const serverModule = (name: string) => resolve(SERVER_RPC_DIR, `${name}.ts`)

describe('rpc streaming detection through the warm server program (ADR-0025)', () => {
    const program = createRpcServerProgram(STREAM_CWD, STREAM_RPC_DIR)

    test('a wrapper-returned stream is detected streaming (the char-scan blind spot)', () => {
        /* `main` (the char-scan): the handler body is `() => makeStream()` — no literal
           `jsonl(`/`sse(`, so it MISCLASSIFIES the endpoint non-streaming. */
        const wrapSource = readFileSync(streamModule('wrapFeed'), 'utf8')
        expect(prepareRpcModule(wrapSource, '@abide/abide')?.streaming).toBe(false)

        /* This change (the return-type query): resolves `makeStream()` → `jsonl(…)` →
           `TypedResponse<AsyncIterable<…>>`, so the endpoint is seen streaming. */
        expect(program.streamingForModule(streamModule('wrapFeed'))).toBe(true)
    })

    test('a direct jsonl() handler is streaming under both detectors', () => {
        const directSource = readFileSync(streamModule('directFeed'), 'utf8')
        expect(prepareRpcModule(directSource, '@abide/abide')?.streaming).toBe(true)
        expect(program.streamingForModule(streamModule('directFeed'))).toBe(true)
    })

    test('a plain json() handler is not streaming (a resolvable non-stream yields false, not undefined)', () => {
        expect(program.streamingForModule(streamModule('plainData'))).toBe(false)
    })

    test('an unknown module path fails open to undefined (caller falls back to the scan)', () => {
        expect(program.streamingForModule(resolve(STREAM_RPC_DIR, 'missing.ts'))).toBeUndefined()
    })

    test('the per-root cache builds one program and reuses it', () => {
        const cache = new Map<string, RpcServerProgram | undefined>()
        const first = rpcServerForRoot(cache, STREAM_CWD, STREAM_RPC_DIR)
        const second = rpcServerForRoot(cache, STREAM_CWD, STREAM_RPC_DIR)
        expect(first).toBeDefined()
        expect(second).toBe(first)
        expect(cache.size).toBe(1)
        expect(first?.streamingForModule(streamModule('wrapFeed'))).toBe(true)
    })
})

describe('rpc method resolution through the warm server program (ADR-0025)', () => {
    const program = createRpcServerProgram(SERVER_CWD, SERVER_RPC_DIR)

    test('an aliased helper resolves to its origin method where the regex misses it', () => {
        /* `import { GET as read }` → `export const aliasMethod = read(...)`: the `RPC_EXPORT`
           regex, keyed on a literal `GET(`/`POST(`, reads no method. */
        const aliasSource = readFileSync(serverModule('aliasMethod'), 'utf8')
        expect(detectRpcMethod(aliasSource)).toBeUndefined()

        /* The symbol query follows the alias back to the `GET` helper. */
        expect(program.methodForModule(serverModule('aliasMethod'))).toBe('GET')
    })

    test('a plainly-imported helper still resolves (POST)', () => {
        expect(program.methodForModule(serverModule('importedOutbox'))).toBe('POST')
    })

    test('an unknown module path fails open to undefined', () => {
        expect(program.methodForModule(resolve(SERVER_RPC_DIR, 'missing.ts'))).toBeUndefined()
    })
})

describe('rpc outbox resolution through the warm server program (ADR-0025)', () => {
    const program = createRpcServerProgram(SERVER_CWD, SERVER_RPC_DIR)

    test('an imported-const outbox resolves to its literal where the regex would reject it', () => {
        /* `{ outbox: OUTBOX_ENABLED }` — not an inline literal, so the scan (`detectDurable`)
           throws "must be a literal". The property-type query resolves `OUTBOX_ENABLED` to `true`. */
        const source = readFileSync(serverModule('importedOutbox'), 'utf8')
        expect(() => prepareRpcModule(source, '@abide/abide')).toThrow(/must be a literal/)

        expect(program.outboxForModule(serverModule('importedOutbox'))).toBe(true)

        /* WITH the program's verdict threaded as the durable override, the imported-const rpc is
           correctly emitted durable — lifting the "inline literal" restriction to "statically
           known". */
        expect(prepareRpcModule(source, '@abide/abide', undefined, true)?.durable).toBe(true)
    })

    test('a call with no opts arg resolves outbox false (not undefined)', () => {
        /* aliasMethod has a single handler argument — a resolvable non-durable rpc. */
        expect(program.outboxForModule(serverModule('aliasMethod'))).toBe(false)
    })

    test('an unknown module path fails open to undefined', () => {
        expect(program.outboxForModule(resolve(SERVER_RPC_DIR, 'missing.ts'))).toBeUndefined()
    })
})

describe('rpc input coercion plan through the warm server program (ADR-0028)', () => {
    const program = createRpcServerProgram(SERVER_CWD, SERVER_RPC_DIR)

    test('numeric/boolean fields are planned; string and unknown fields are left out', () => {
        /* The Args bag is `{ id: number; active: boolean; name: string; tags: number[]; page?: number }`.
           Only the numeric/boolean fields (scalar, array element, and optional) are planned; `name`
           (a string) is never coerced. */
        expect(program.inputCoercionForModule(serverModule('coerceArgs'))).toEqual({
            id: 'number',
            active: 'boolean',
            tags: 'number',
            page: 'number',
        })
    })

    test('an unknown module path fails open to undefined (no plan stamped)', () => {
        expect(
            program.inputCoercionForModule(resolve(SERVER_RPC_DIR, 'missing.ts')),
        ).toBeUndefined()
    })

    test('the plan is stamped into the server rewrite as a `coerce` opt', () => {
        const source = readFileSync(serverModule('coerceArgs'), 'utf8')
        const plan = program.inputCoercionForModule(serverModule('coerceArgs'))
        const rewritten = prepareRpcModule(
            source,
            '@abide/abide',
            undefined,
            undefined,
            plan,
        )?.rewriteForServer('/rpc/coerceArgs')
        expect(rewritten).toContain('coerce: {')
        expect(rewritten).toContain('"active":"boolean"')
        /* No author opts, so the injected object is the whole second argument. */
        expect(rewritten).toContain('__abideDefineRpc__("GET", "/rpc/coerceArgs", ')
    })

    test('no plan leaves the server rewrite free of a coerce opt (fail-open)', () => {
        const source = readFileSync(serverModule('coerceArgs'), 'utf8')
        const rewritten = prepareRpcModule(source, '@abide/abide')?.rewriteForServer(
            '/rpc/coerceArgs',
        )
        expect(rewritten).not.toContain('coerce:')
    })
})

describe('rpc return-body resolution through the warm server program (ADR-0030)', () => {
    const program = createRpcServerProgram(STREAM_CWD, STREAM_RPC_DIR)

    test('a plain json() handler resolves its success-body type, non-streaming', () => {
        /* `plainData` is `GET(() => json({ ok: true }))` — the handler return's `TypedResponse`
           body is `{ ok: boolean }`, so the descriptor is that type, not streaming. */
        const body = program.returnBodyForModule(streamModule('plainData'))
        expect(body?.streaming).toBe(false)
        expect(body?.type).toContain('ok')
        expect(body?.type).toContain('boolean')
    })

    test('a jsonl() handler resolves its per-FRAME type and is marked streaming', () => {
        /* `directFeed` streams `{ n: number }` frames; the descriptor exposes the frame type (the
           AsyncIterable element), not the iterable itself. */
        const body = program.returnBodyForModule(streamModule('directFeed'))
        expect(body?.streaming).toBe(true)
        expect(body?.type).toContain('n')
        expect(body?.type).toContain('number')
        expect(body?.type).not.toContain('AsyncIterable')
    })

    test('an unknown module path fails open to undefined (caller defers to schemas.output)', () => {
        expect(program.returnBodyForModule(resolve(STREAM_RPC_DIR, 'missing.ts'))).toBeUndefined()
    })
})

describe('rpc return-body JSON Schema projection through the warm server program (ADR-0030 D2)', () => {
    const program = createRpcServerProgram(STREAM_CWD, STREAM_RPC_DIR)

    test('a plain json() handler projects its success body to an object schema', () => {
        /* `plainData` is `GET(() => json({ ok: true }))` — the body `{ ok: boolean }` projects to an
           object schema with `ok` required, feeding the OpenAPI 200 / MCP outputSchema when no
           `schemas.output` is declared. */
        expect(program.returnBodySchemaForModule(streamModule('plainData'))).toEqual({
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
        })
    })

    test('a jsonl() handler projects its per-FRAME body (not the iterable)', () => {
        /* `directFeed` streams `{ n: number }` frames — the projected schema describes one streamed
           item, mirroring returnBodyForModule's per-frame semantics. */
        expect(program.returnBodySchemaForModule(streamModule('directFeed'))).toEqual({
            type: 'object',
            properties: { n: { type: 'number' } },
            required: ['n'],
        })
    })

    test('an unknown module path fails open to undefined (caller defers to schemas.output)', () => {
        expect(
            program.returnBodySchemaForModule(resolve(STREAM_RPC_DIR, 'missing.ts')),
        ).toBeUndefined()
    })
})

describe('rpc typed-error branch schemas through the warm server program (ADR-0030)', () => {
    const program = createRpcServerProgram(STREAM_CWD, STREAM_RPC_DIR)

    test('each typed-error branch projects a status-keyed data schema; shared status combines under anyOf', () => {
        /* `typedErrors` returns `json({ ok })` plus four `error.typed(...)` branches: notFound(404,
           {id}), conflict(409, {existingId}), gone(404, {movedTo}), rateLimited(429, nullary). The two
           404 branches carry distinct data schemas, so they combine under `anyOf`. */
        const schemas = program.errorSchemasForModule(streamModule('typedErrors'))
        expect(schemas?.[409]).toEqual({
            type: 'object',
            properties: { existingId: { type: 'number' } },
            required: ['existingId'],
        })
        /* A nullary error (no data schema) still surfaces its status, with a bare permissive schema. */
        expect(schemas?.[429]).toEqual({})
        const shared = schemas?.[404] as { anyOf: unknown[] }
        expect(shared.anyOf).toHaveLength(2)
        expect(shared.anyOf).toContainEqual({
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
        })
        expect(shared.anyOf).toContainEqual({
            type: 'object',
            properties: { movedTo: { type: 'string' } },
            required: ['movedTo'],
        })
    })

    test('a handler with no typed errors resolves undefined (no error responses stamped)', () => {
        /* `plainData` is `GET(() => json({ ok: true }))` — no `error.typed(...)` branch, so the query
           yields undefined and the surface omits error responses. */
        expect(program.errorSchemasForModule(streamModule('plainData'))).toBeUndefined()
    })

    test('an unknown module path fails open to undefined', () => {
        expect(program.errorSchemasForModule(resolve(STREAM_RPC_DIR, 'missing.ts'))).toBeUndefined()
    })

    test('the error-schema map is stamped into the server rewrite as an `errorJsonSchemas` opt', () => {
        const source = readFileSync(streamModule('typedErrors'), 'utf8')
        const schemas = program.errorSchemasForModule(streamModule('typedErrors'))
        const rewritten = prepareRpcModule(
            source,
            '@abide/abide',
            undefined,
            undefined,
            undefined,
            undefined,
            schemas,
        )?.rewriteForServer('/rpc/typedErrors')
        expect(rewritten).toContain('errorJsonSchemas: {')
        expect(rewritten).toContain('"409"')
        expect(rewritten).toContain('"anyOf"')
    })
})

describe('rpc structured wire-kind plan through the warm server program (ADR-0029)', () => {
    const program = createRpcServerProgram(SERVER_CWD, SERVER_RPC_DIR)

    test('Date/Set/Map/bigint fields classify by type identity; strings are left out', () => {
        /* The Args bag is `{ when: Date; ids: Set<string>; counts: Map<string, number>; big: bigint;
           name: string }`. Date/Set/Map resolve by symbol identity, bigint by type flag; `name`
           (a string) is never in the plan. */
        expect(program.inputCoercionForModule(serverModule('wireCodec'))).toEqual({
            when: 'date',
            ids: 'set',
            counts: 'map',
            big: 'bigint',
        })
    })

    test('the structured plan is stamped into the server rewrite as a `coerce` opt', () => {
        const source = readFileSync(serverModule('wireCodec'), 'utf8')
        const plan = program.inputCoercionForModule(serverModule('wireCodec'))
        const rewritten = prepareRpcModule(
            source,
            '@abide/abide',
            undefined,
            undefined,
            plan,
        )?.rewriteForServer('/rpc/wireCodec')
        expect(rewritten).toContain('coerce: {')
        expect(rewritten).toContain('"when":"date"')
        expect(rewritten).toContain('"ids":"set"')
        expect(rewritten).toContain('"counts":"map"')
        expect(rewritten).toContain('"big":"bigint"')
    })
})

/* Fail-open: with NO warm program (the override arguments absent), prepareRpcModule produces
   byte-identical output to today — streaming/durable verdicts come from the char-scan and the
   emitted client/server rewrites are unchanged. */
describe('prepareRpcModule fail-open without a warm program (ADR-0025 D3)', () => {
    const streamMod =
        `import { GET } from '@abide/abide/server/GET'\n` +
        `import { jsonl } from '@abide/abide/server/jsonl'\n` +
        `export const feed = GET((a) => jsonl(source()))`
    const plainMod =
        `import { GET } from '@abide/abide/server/GET'\n` +
        `export const getRates = GET((a) => ({ ok: true }))`

    test('streaming client rewrite matches the scan-only result', () => {
        const withoutProgram = prepareRpcModule(streamMod, '@abide/abide')?.rewriteForClient(
            '/rpc/feed',
        )
        expect(withoutProgram).toContain(
            '__abideRemoteProxy__("GET", "/rpc/feed", { streaming: true })',
        )
    })

    test('a plain handler stays non-streaming and its rewrite is unchanged', () => {
        const prepared = prepareRpcModule(plainMod, '@abide/abide')
        expect(prepared?.streaming).toBe(false)
        expect(prepared?.rewriteForClient('/rpc/rates')).toContain(
            '__abideRemoteProxy__("GET", "/rpc/rates")',
        )
    })

    test('an explicit false streaming override forces non-streaming even when the scan would see jsonl(', () => {
        /* The override is authoritative: a resolved `false` skips the scan entirely. */
        expect(prepareRpcModule(streamMod, '@abide/abide', false)?.streaming).toBe(false)
        /* undefined override defers to the scan → streaming. */
        expect(prepareRpcModule(streamMod, '@abide/abide', undefined)?.streaming).toBe(true)
    })

    test('a durable override skips the scan but still enforces the mutating-method invariant', () => {
        const getMod = `import { GET } from '@abide/abide/server/GET'\nexport const search = GET(async (a) => a)`
        expect(() => prepareRpcModule(getMod, '@abide/abide', undefined, true)).toThrow(
            /only valid on mutating RPCs/,
        )
        const postMod = `import { POST } from '@abide/abide/server/POST'\nexport const save = POST(async (a) => a)`
        /* No inline outbox, but the override says durable — resolved as durable without the scan. */
        expect(prepareRpcModule(postMod, '@abide/abide', undefined, true)?.durable).toBe(true)
    })
})
