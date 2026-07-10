import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { serverSlot } from '../src/lib/server/runtime/serverSlot.ts'
import { defineSocket } from '../src/lib/server/sockets/defineSocket.ts'
import { settle } from './support/settle.ts'

/*
The no-remote-subscriber skip: publish() must gate the encodeRefJson + native
server.publish fan-out behind subscriberCount(topic) > 0, while the in-process
notify() path (the live `for await` iterators) stays unconditional. These tests
drive a fake Bun server whose subscriberCount is switchable and whose publish is
counted — publish being called is the observable proxy for the encode having run,
since encodeRefJson's only consumer is the very arg handed to server.publish.
*/

// A minimal Server stand-in: subscriberCount is dialled per-test; publish records its calls.
function fakeServer(subscriberCount: number) {
    const publishedTopics: string[] = []
    const queriedTopics: string[] = []
    const server = {
        subscriberCount: (topic: string) => {
            queriedTopics.push(topic)
            return subscriberCount
        },
        publish: (topic: string) => {
            publishedTopics.push(topic)
            return 1
        },
    } as unknown as Server<unknown>
    return { server, publishedTopics, queriedTopics }
}

describe('socket publish with zero remote subscribers', () => {
    const previousServer = serverSlot.active
    afterEach(() => {
        serverSlot.active = previousServer
    })

    test('skips native fan-out (and the encode it feeds) when no ws clients subscribe', async () => {
        const { server, publishedTopics, queriedTopics } = fakeServer(0)
        serverSlot.active = server
        const feed = defineSocket<{ n: number }>('no-sub-skip', {})

        // In-process iterator: the live path must still receive every message.
        const received: { n: number }[] = []
        const reader = (async () => {
            for await (const message of feed) {
                received.push(message)
                if (received.length === 3) {
                    break
                }
            }
        })()
        await settle()

        feed.publish({ n: 1 })
        feed.publish({ n: 2 })
        feed.publish({ n: 3 })
        await reader

        // In-process delivery is unconditional.
        expect(received).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
        // The gate was consulted once per publish on the right topic.
        expect(queriedTopics).toEqual([
            'socket:no-sub-skip',
            'socket:no-sub-skip',
            'socket:no-sub-skip',
        ])
        // Zero subscribers → zero native publishes → zero encodeRefJson walks.
        expect(publishedTopics).toEqual([])
    })

    test('fans out (encoding once) when at least one ws client is subscribed', () => {
        const { server, publishedTopics } = fakeServer(1)
        serverSlot.active = server
        const feed = defineSocket<{ n: number }>('has-sub-fanout', {})

        feed.publish({ n: 1 })
        feed.publish({ n: 2 })

        // Both publishes cross the gate and reach native fan-out on the topic.
        expect(publishedTopics).toEqual(['socket:has-sub-fanout', 'socket:has-sub-fanout'])
    })
})
