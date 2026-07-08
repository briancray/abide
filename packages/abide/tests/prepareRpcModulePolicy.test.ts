import { describe, expect, test } from 'bun:test'
import { prepareRpcModule } from '../src/lib/shared/prepareRpcModule.ts'

/* ADR-0020: the endpoint's `cache` / `stream` policy must ship to the client. The bundler lifts
   the verbatim source text of the `cache:` / `stream:` property out of the rpc definition and
   splices it into the client proxy stub so `remote.cache` / `remote.stream` govern client cache
   behaviour (staleness/SWR, the refetch clock, tags). These tests pin the extraction and the
   emitted client-stub opts. */

const getMod = (call: string) =>
    `import { GET } from '@abide/abide/server/GET'\nexport const getRates = ${call}`

const streamMod = (call: string) =>
    `import { GET } from '@abide/abide/server/GET'\nimport { jsonl } from '@abide/abide/server/jsonl'\nexport const feed = ${call}`

/* Mirrors abideResolverPlugin's client stub composition so the assertions pin the actual emitted
   opts object, including the `, `-join that guards against a stray `{ , }`. */
function clientStubOpts(prepared: ReturnType<typeof prepareRpcModule>): string {
    const optsFields = [
        prepared?.durable ? 'outbox: true' : undefined,
        prepared?.streaming ? 'streaming: true' : undefined,
        prepared?.cachePolicyText !== undefined ? `cache: ${prepared.cachePolicyText}` : undefined,
        prepared?.streamPolicyText !== undefined
            ? `stream: ${prepared.streamPolicyText}`
            : undefined,
    ].filter((field): field is string => field !== undefined)
    return optsFields.length > 0 ? `, { ${optsFields.join(', ')} }` : ''
}

describe('prepareRpcModule — endpoint cache/stream policy extraction (ADR-0020)', () => {
    test('cache with a literal ttl', () => {
        const prepared = prepareRpcModule(
            getMod('GET((a) => a, { cache: { ttl: 5000 } })'),
            '@abide/abide',
        )
        expect(prepared?.cachePolicyText).toBe('{ ttl: 5000 }')
        expect(prepared?.streamPolicyText).toBeUndefined()
        expect(clientStubOpts(prepared)).toBe(', { cache: { ttl: 5000 } }')
    })

    test('cache with an arrow-function tags (arg-derived group)', () => {
        const prepared = prepareRpcModule(
            getMod("GET((a) => a, { cache: { ttl: 60000, tags: (args) => ['rates:' + args.base] } })"),
            '@abide/abide',
        )
        expect(prepared?.cachePolicyText).toBe(
            "{ ttl: 60000, tags: (args) => ['rates:' + args.base] }",
        )
        expect(clientStubOpts(prepared)).toBe(
            ", { cache: { ttl: 60000, tags: (args) => ['rates:' + args.base] } }",
        )
    })

    test('stream with n', () => {
        const prepared = prepareRpcModule(
            streamMod('GET((a) => jsonl(source()), { stream: { n: 20 } })'),
            '@abide/abide',
        )
        expect(prepared?.streamPolicyText).toBe('{ n: 20 }')
        expect(prepared?.cachePolicyText).toBeUndefined()
        expect(prepared?.streaming).toBe(true)
        /* streaming flag + stream policy both land in the stub opts. */
        expect(clientStubOpts(prepared)).toBe(', { streaming: true, stream: { n: 20 } }')
    })

    test('absent policy → both undefined, no policy in the stub opts', () => {
        const prepared = prepareRpcModule(
            getMod('GET((a) => a, { schemas: { input } })'),
            '@abide/abide',
        )
        expect(prepared?.cachePolicyText).toBeUndefined()
        expect(prepared?.streamPolicyText).toBeUndefined()
        expect(clientStubOpts(prepared)).toBe('')
    })

    test('a bare handler (no opts) → both undefined', () => {
        const prepared = prepareRpcModule(getMod('GET((a) => a)'), '@abide/abide')
        expect(prepared?.cachePolicyText).toBeUndefined()
        expect(prepared?.streamPolicyText).toBeUndefined()
        expect(clientStubOpts(prepared)).toBe('')
    })

    test('a trailing comma after opts does not swallow the policy', () => {
        const prepared = prepareRpcModule(
            getMod('GET((a) => a, { cache: { ttl: 5 } },)'),
            '@abide/abide',
        )
        expect(prepared?.cachePolicyText).toBe('{ ttl: 5 }')
    })

    test('policy alongside schemas / clients — only the cache value is lifted', () => {
        const prepared = prepareRpcModule(
            getMod(
                'GET((a) => a, { schemas: { input, output }, clients: { browser: true }, cache: { ttl: 5, shared: true } })',
            ),
            '@abide/abide',
        )
        expect(prepared?.cachePolicyText).toBe('{ ttl: 5, shared: true }')
        expect(prepared?.streamPolicyText).toBeUndefined()
    })

    test('a nested `cache` key inside schemas does not misfire', () => {
        const prepared = prepareRpcModule(
            getMod('GET((a) => a, { schemas: { input: { cache: 1 } } })'),
            '@abide/abide',
        )
        expect(prepared?.cachePolicyText).toBeUndefined()
    })

    test('a shorthand `cache` (no colon) is not treated as a policy', () => {
        const prepared = prepareRpcModule(getMod('GET((a) => a, { cache })'), '@abide/abide')
        expect(prepared?.cachePolicyText).toBeUndefined()
    })

    test('streaming + cache + stream all combine in the stub opts', () => {
        const prepared = prepareRpcModule(
            streamMod('GET((a) => jsonl(source()), { stream: { n: 3 }, cache: { ttl: 5 } })'),
            '@abide/abide',
        )
        expect(prepared?.streaming).toBe(true)
        expect(prepared?.cachePolicyText).toBe('{ ttl: 5 }')
        expect(prepared?.streamPolicyText).toBe('{ n: 3 }')
        expect(clientStubOpts(prepared)).toBe(
            ', { streaming: true, cache: { ttl: 5 }, stream: { n: 3 } }',
        )
    })

    test('a `cache:` mention inside a string in the opts does not misfire', () => {
        const prepared = prepareRpcModule(
            getMod("GET((a) => a, { timeout: 3, note: 'cache: none' })"),
            '@abide/abide',
        )
        expect(prepared?.cachePolicyText).toBeUndefined()
    })

    test('a durable POST keeps outbox and can also carry cache — both in the stub opts', () => {
        const prepared = prepareRpcModule(
            "import { POST } from '@abide/abide/server/POST'\nexport const save = POST((a) => a, { outbox: true, cache: { ttl: 0 } })",
            '@abide/abide',
        )
        expect(prepared?.durable).toBe(true)
        expect(prepared?.cachePolicyText).toBe('{ ttl: 0 }')
        expect(clientStubOpts(prepared)).toBe(', { outbox: true, cache: { ttl: 0 } }')
    })
})
