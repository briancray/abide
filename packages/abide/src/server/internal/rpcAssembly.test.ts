// WHAT A READ AND A MUTATION AGREE ON, asserted through the two factories.
//
// `makeRead`/`makeMutation` had no direct test: everything reached them through `GET`/`POST` plus a router,
// so the memo half — the eight decisions both verbs make in the same order — was only ever checked by its
// consequences several layers up. The assembly having one owner (`assembleRpc`) makes the agreement itself
// assertable, and these are the properties that used to be one copy-pasted comment apiece.

import { describe, expect, test } from 'bun:test'
import { GET } from '../GET.ts'
import { POST } from '../POST.ts'

// The `__rpc` meta each factory attaches. Read through the same field the ROUTER enforces against, so a
// drift here is a drift in what dispatch sees.
function meta(callable: unknown): {
    method: string
    read: boolean
    timeout: number
    options: { memo?: unknown }
} {
    return (callable as { __rpc: ReturnType<typeof meta> }).__rpc
}

describe('the two verbs agree on the memo half', () => {
    test('both resolve the same default deadline, and both honour a declared one', () => {
        expect(meta(GET(() => 1)).timeout).toBe(meta(POST(() => 1)).timeout)
        expect(meta(GET(() => 1, { timeout: 1_234 })).timeout).toBe(1_234)
        expect(meta(POST(() => 1, { timeout: 1_234 })).timeout).toBe(1_234)
    })

    test('both carry the whole probe surface, and the router door on both', () => {
        // The mutation surface IS the read surface plus a body — `MutationSurface extends Rpc` — so a probe
        // missing from one is the asymmetry `attachSurface` exists to prevent.
        for (const callable of [GET(() => 1), POST(() => 1)]) {
            for (const probe of [
                'peek',
                'pending',
                'refreshing',
                'error',
                'watch',
                'refresh',
                'invalidate',
                'publish',
                'raw',
                'chunks',
                'done',
                'resumeStream',
                'seed',
                'seedStream',
                'snapshot',
                'bindBroadcast',
                // The two chain doors (ADR 0030): `__bare` is the producer minus the chain, which the
                // router invokes because it composes the chain around the whole of dispatch.
                '__bare',
                '__bindChain',
            ]) {
                expect(typeof (callable as unknown as Record<string, unknown>)[probe]).toBe(
                    'function',
                )
            }
        }
    })

    test('only the `read` flag and the verb differ in the meta', () => {
        const read = meta(GET(() => 1))
        const mutation = meta(POST(() => 1))
        expect(read.read).toBe(true)
        expect(mutation.read).toBe(false)
        expect(read.method).toBe('GET')
        expect(mutation.method).toBe('POST')
    })
})

describe("the producer is the difference, and it is the factory's", () => {
    // ADR 0030 D2: `__bare` is handed in by each factory rather than rebuilt from the memo, because a
    // mutation's producer is not "call the memo". These assert the two producers by BEHAVIOUR, since that
    // is the only place the difference is observable.
    test("a read's bare call routes through the memo, so a second call coalesces onto the first", async () => {
        let runs = 0
        const read = GET(async () => {
            runs++
            return runs
        })
        const [first, second] = await Promise.all([read(undefined), read(undefined)])
        expect(first).toBe(1)
        expect(second).toBe(1)
        expect(runs).toBe(1)
    })

    // `memo: false` on a READ keeps the memo at ttl:0 (the reactive surface stays live), so identical
    // CONCURRENT calls still coalesce. On a MUTATION it is a full bypass — every call runs.
    test('memo: false coalesces a concurrent read and does NOT coalesce a concurrent mutation', async () => {
        let reads = 0
        const read = GET(
            async () => {
                reads++
                return reads
            },
            { memo: false },
        )
        await Promise.all([read(undefined), read(undefined)])
        expect(reads).toBe(1)

        let writes = 0
        const write = POST(
            async () => {
                writes++
                return writes
            },
            { memo: false },
        )
        await Promise.all([write(undefined), write(undefined)])
        expect(writes).toBe(2)
    })

    // The mutation's own default: ttl:0 retains nothing, so a SEQUENTIAL second call runs again even
    // though a read at the default ttl would serve the retained value.
    test('a mutation retains nothing by default; a read retains', async () => {
        let writes = 0
        const write = POST(async () => {
            writes++
            return writes
        })
        expect(await write(undefined)).toBe(1)
        expect(await write(undefined)).toBe(2)

        let reads = 0
        const read = GET(async () => {
            reads++
            return reads
        })
        expect(await read(undefined)).toBe(1)
        expect(await read(undefined)).toBe(1)
    })
})
