import { describe, expect, test } from 'bun:test'
import { prepareRpcModule } from '../src/lib/shared/prepareRpcModule.ts'

/* ADR-0022 D2: the client rpc transform keeps the REAL module, swaps the METHOD( call for a
   remoteProxy( call, and ELIDES the handler argument — leaving the endpoint `opts` (schemas /
   cache / stream) as a LIVE expression in its original scope. So policy is ordinary JavaScript
   that can reference imports and separate modules; the old text-splice of a `cache:` literal into
   a self-contained stub (with its extractObjectProperty tokenizer) is gone. These tests pin the
   emitted client module: handler elided, remoteProxy call, live opts verbatim, streaming injected.
   The symmetric server rewrite is asserted separately (streamingRpc.test.ts). */

const getMod = (call: string) =>
    `import { GET } from '@abide/abide/server/GET'\nexport const getRates = ${call}`

const streamMod = (call: string) =>
    `import { GET } from '@abide/abide/server/GET'\nimport { jsonl } from '@abide/abide/server/jsonl'\nexport const feed = ${call}`

const clientRewrite = (source: string, url = '/rpc/rates') =>
    prepareRpcModule(source, '@abide/abide')?.rewriteForClient(url)

describe('prepareRpcModule — client rpc transform (ADR-0022 D2)', () => {
    test('the field-based policy text extraction is gone', () => {
        const prepared = prepareRpcModule(
            getMod('GET((a) => a, { cache: { ttl: 5000 } })'),
            '@abide/abide',
        )
        expect(prepared).toBeDefined()
        /* No more cachePolicyText/streamPolicyText on the prepared module. */
        expect('cachePolicyText' in (prepared as object)).toBe(false)
        expect('streamPolicyText' in (prepared as object)).toBe(false)
    })

    test('a literal cache policy rides through as a live opts expression, handler elided', () => {
        const out = clientRewrite(getMod('GET((a) => myHandler(a), { cache: { ttl: 5000 } })'))
        expect(out).toContain('__abideRemoteProxy__("GET", "/rpc/rates", { cache: { ttl: 5000 } })')
        /* The handler and its body are gone — no arg name, no call to the handler helper. */
        expect(out).not.toContain('myHandler')
        expect(out).not.toContain('=>')
    })

    test('an IMPORTED policy value survives verbatim (the self-contained constraint is gone)', () => {
        const source =
            `import { ratePolicy } from '../shared/ratePolicy.ts'\n` +
            `import { GET } from '@abide/abide/server/GET'\n` +
            `export const getRates = GET((a) => a, { cache: ratePolicy })`
        const out = clientRewrite(source)
        /* The policy import is kept (referenced by the live opts) and the opts references it. */
        expect(out).toContain(`import { ratePolicy } from '../shared/ratePolicy.ts'`)
        expect(out).toContain('__abideRemoteProxy__("GET", "/rpc/rates", { cache: ratePolicy })')
    })

    test('an imported const inside the policy rides through', () => {
        const source =
            `import { RATE_TTL } from '../shared/ratePolicy.ts'\n` +
            `import { GET } from '@abide/abide/server/GET'\n` +
            `export const getRates = GET((a) => a, { cache: { ttl: RATE_TTL } })`
        const out = clientRewrite(source)
        expect(out).toContain(
            '__abideRemoteProxy__("GET", "/rpc/rates", { cache: { ttl: RATE_TTL } })',
        )
    })

    test('no opts → a bare remoteProxy call', () => {
        const out = clientRewrite(getMod('GET((a) => a)'))
        expect(out).toContain('__abideRemoteProxy__("GET", "/rpc/rates")')
        expect(out).not.toContain('=>')
    })

    test('streaming, no opts → { streaming: true } injected', () => {
        const out = clientRewrite(streamMod('GET((a) => jsonl(readSource()))'), '/rpc/feed')
        expect(out).toContain('__abideRemoteProxy__("GET", "/rpc/feed", { streaming: true })')
        /* The import line survives textually (DCE drops it at build); the handler BODY is elided. */
        expect(out).not.toContain('readSource()')
        expect(out).not.toContain('=>')
    })

    test('streaming + opts → streaming flag spread over the live opts', () => {
        const out = clientRewrite(
            streamMod('GET((a) => jsonl(source()), { stream: { n: 20 } })'),
            '/rpc/feed',
        )
        expect(out).toContain(
            '__abideRemoteProxy__("GET", "/rpc/feed", { streaming: true, ...({ stream: { n: 20 } }) })',
        )
    })

    test('a trailing comma after opts does not leak into the emitted call', () => {
        const out = clientRewrite(getMod('GET((a) => a, { cache: { ttl: 5 } },)'))
        expect(out).toContain('__abideRemoteProxy__("GET", "/rpc/rates", { cache: { ttl: 5 } })')
    })

    test('policy alongside schemas / clients is forwarded whole (no per-key extraction)', () => {
        const out = clientRewrite(
            getMod(
                'GET((a) => a, { schemas: { input, output }, clients: { browser: true }, cache: { ttl: 5, shared: true } })',
            ),
        )
        expect(out).toContain(
            '__abideRemoteProxy__("GET", "/rpc/rates", { schemas: { input, output }, clients: { browser: true }, cache: { ttl: 5, shared: true } })',
        )
    })
})
