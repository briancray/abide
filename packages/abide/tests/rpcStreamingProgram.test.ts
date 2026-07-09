import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RpcStreamingProgram } from '../src/lib/shared/createRpcStreamingProgram.ts'
import { createRpcStreamingProgram } from '../src/lib/shared/createRpcStreamingProgram.ts'
import { prepareRpcModule } from '../src/lib/shared/prepareRpcModule.ts'
import { rpcStreamingForRoot } from '../src/lib/shared/rpcStreamingForRoot.ts'

/* ADR-0025 D2: streaming detection resolves through a warm server `ts.Program` (the handler's
   return type is `TypedResponse<AsyncIterable<…>>`) instead of scanning the handler body for a
   literal `jsonl(`/`sse(`. The headline correctness fix is the WRAPPER-INDIRECTION case: a
   handler returning a stream via a helper function — invisible to the char-scan, seen by the
   type query. The fixture lives inside the repo so `@abide/abide/server/*` resolves through the
   workspace symlink and the checker sees `jsonl()`'s real return type. */
const FIXTURE_CWD = resolve(import.meta.dir, 'support/fixtures/rpcStreaming')
const FIXTURE_RPC_DIR = resolve(FIXTURE_CWD, 'src/server/rpc')
const modulePath = (name: string) => resolve(FIXTURE_RPC_DIR, `${name}.ts`)

describe('rpc streaming detection through the warm server program (ADR-0025)', () => {
    const program = createRpcStreamingProgram(FIXTURE_CWD, FIXTURE_RPC_DIR)

    test('a wrapper-returned stream is detected streaming (the char-scan blind spot)', () => {
        /* `main` (the char-scan): the handler body is `() => makeStream()` — no literal
           `jsonl(`/`sse(`, so it MISCLASSIFIES the endpoint non-streaming. */
        const wrapSource = readFileSync(modulePath('wrapFeed'), 'utf8')
        expect(prepareRpcModule(wrapSource, '@abide/abide')?.streaming).toBe(false)

        /* This change (the return-type query): resolves `makeStream()` → `jsonl(…)` →
           `TypedResponse<AsyncIterable<…>>`, so the endpoint is seen streaming. */
        expect(program.streamingForModule(modulePath('wrapFeed'))).toBe(true)
    })

    test('a direct jsonl() handler is streaming under both detectors', () => {
        const directSource = readFileSync(modulePath('directFeed'), 'utf8')
        expect(prepareRpcModule(directSource, '@abide/abide')?.streaming).toBe(true)
        expect(program.streamingForModule(modulePath('directFeed'))).toBe(true)
    })

    test('a plain json() handler is not streaming (a resolvable non-stream yields false, not undefined)', () => {
        expect(program.streamingForModule(modulePath('plainData'))).toBe(false)
    })

    test('an unknown module path fails open to undefined (caller falls back to the scan)', () => {
        expect(program.streamingForModule(resolve(FIXTURE_RPC_DIR, 'missing.ts'))).toBeUndefined()
    })

    test('the per-root cache builds one program and reuses it', () => {
        const cache = new Map<string, RpcStreamingProgram | undefined>()
        const first = rpcStreamingForRoot(cache, FIXTURE_CWD, FIXTURE_RPC_DIR)
        const second = rpcStreamingForRoot(cache, FIXTURE_CWD, FIXTURE_RPC_DIR)
        expect(first).toBeDefined()
        expect(second).toBe(first)
        expect(cache.size).toBe(1)
        expect(first?.streamingForModule(modulePath('wrapFeed'))).toBe(true)
    })
})

/* Fail-open: with NO warm program (the streamingOverride argument absent), prepareRpcModule
   produces byte-identical output to today — the streaming verdict comes from the char-scan and
   the emitted client/server rewrites are unchanged. */
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

    test('an explicit false override forces non-streaming even when the scan would see jsonl(', () => {
        /* The override is authoritative: a resolved `false` skips the scan entirely. */
        expect(prepareRpcModule(streamMod, '@abide/abide', false)?.streaming).toBe(false)
        /* undefined override defers to the scan → streaming. */
        expect(prepareRpcModule(streamMod, '@abide/abide', undefined)?.streaming).toBe(true)
    })
})
