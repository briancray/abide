import { describe, expect, test } from 'bun:test'
import { createClient } from '../src/lib/cli/createClient.ts'
import { json } from '../src/lib/server/json.ts'
import { request } from '../src/lib/server/request.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { sse } from '../src/lib/server/sse.ts'
import { streamResponse } from '../src/lib/shared/streamResponse.ts'
import { testSchema } from './standardSchema.ts'

describe('createClient in-process happy path', () => {
    test('plain call decodes the body; .raw returns the Response', async () => {
        defineRpc('GET', '/rpc/cli-ping', ({ n }: { n?: string }) => json({ pong: n ?? '0' }), {
            inputSchema: testSchema({ type: 'object', properties: { n: { type: 'string' } } }),
        })
        const client = createClient()

        expect(await client['cli-ping']({ n: '5' })).toEqual({ pong: '5' })

        const response = await client['cli-ping'].raw({ n: '5' })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ pong: '5' })
    })

    test('runs in a request scope — request() resolves instead of throwing', async () => {
        defineRpc('GET', '/rpc/cli-where', () => json({ host: new URL(request().url).host }))
        const client = createClient()

        expect(await client['cli-where']()).toEqual({ host: 'localhost' })
    })

    test('.raw on a streaming rpc yields frames through streamResponse', async () => {
        defineRpc('GET', '/rpc/cli-feed', () =>
            sse(
                (async function* () {
                    yield { n: 1 }
                    yield { n: 2 }
                })(),
            ),
        )
        const client = createClient()

        const response = await client['cli-feed'].raw()
        const frames: Array<{ n: number }> = []
        for await (const frame of streamResponse<{ n: number }>(response)) {
            frames.push(frame)
        }
        expect(frames).toEqual([{ n: 1 }, { n: 2 }])
    })
})
