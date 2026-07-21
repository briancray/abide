import { describe, expect, test } from 'bun:test'
import { DROP } from './internal/socketHub.ts'
import { socket } from './socket.ts'

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

// Pull `count` messages from a subscriber, then break out (which unsubscribes). Runs on its own
// microtask timeline so publishes made after subscribing are seen live.
async function collect<T>(source: AsyncIterable<T>, count: number): Promise<T[]> {
    const received: T[] = []
    for await (const message of source) {
        received.push(message)
        if (received.length >= count) break
    }
    return received
}

describe('socket — replay (tail / ttl)', () => {
    test('tail:0 — a later subscriber does NOT see an earlier publish', async () => {
        const sock = socket<number>()
        sock.publish(1)

        const gotFirst = collect(sock, 1)
        await delay(5)
        sock.publish(2)

        expect(await gotFirst).toEqual([2])
    })

    test('tail:3 — a new subscriber replays the last 3 messages in order', async () => {
        const sock = socket<number>({ tail: 3 })
        sock.publish(1)
        sock.publish(2)
        sock.publish(3)
        sock.publish(4)

        const replayed = await collect(sock, 3)
        expect(replayed).toEqual([2, 3, 4])
    })

    test('ttl — tail entries older than ttl are not replayed', async () => {
        const sock = socket<number>({ tail: 5, ttl: 20 })
        sock.publish(1)
        await delay(40) // 1 ages past ttl
        sock.publish(2)

        const replayed = await collect(sock, 1)
        expect(replayed).toEqual([2])
    })
})

describe('socket — fanout & ordering', () => {
    test('two concurrent subscribers both receive a publish (fanout)', async () => {
        const sock = socket<string>()
        const a = collect(sock, 1)
        const b = collect(sock, 1)
        await delay(5)
        sock.publish('hello')

        expect(await a).toEqual(['hello'])
        expect(await b).toEqual(['hello'])
    })

    test('per-socket FIFO by publish order', async () => {
        const sock = socket<number>()
        const got = collect(sock, 4)
        await delay(5)
        sock.publish(10)
        sock.publish(20)
        sock.publish(30)
        sock.publish(40)

        expect(await got).toEqual([10, 20, 30, 40])
    })
})

describe('socket — unsubscribe lifecycle', () => {
    test('early break unsubscribes cleanly — a later publish does not error', async () => {
        const sock = socket<number>()
        const first = collect(sock, 1)
        await delay(5)
        sock.publish(1)
        await first // subscriber broke after 1 message

        // No live subscribers now; publishing must not throw.
        expect(() => sock.publish(2)).not.toThrow()

        // A fresh subscriber still works after the earlier one left.
        const second = collect(sock, 1)
        await delay(5)
        sock.publish(3)
        expect(await second).toEqual([3])
    })
})

describe('socket — ingressPublish (client-mediated)', () => {
    test('no handler — ingressPublish is a pass-through relay', async () => {
        const sock = socket<number>()
        const got = collect(sock, 1)
        await delay(5)
        await sock.__socket.ingressPublish(7)

        expect(await got).toEqual([7])
    })

    test('handler transforms — the transformed value is republished', async () => {
        const sock = socket<number>({ handler: (n) => n * 10 })
        const got = collect(sock, 1)
        await delay(5)
        await sock.__socket.ingressPublish(4)

        expect(await got).toEqual([40])
    })

    test('handler returning DROP suppresses the publish', async () => {
        const sock = socket<number>({ handler: (n) => (n < 0 ? DROP : n) })
        const got = collect(sock, 1)
        await delay(5)
        await sock.__socket.ingressPublish(-1) // dropped
        await sock.__socket.ingressPublish(9) // delivered

        expect(await got).toEqual([9])
    })

    test('handler that throws rejects the publisher and delivers nothing', async () => {
        const sock = socket<number>({
            handler: (n) => {
                if (n === 13) throw new Error('unlucky')
                return n
            },
        })
        const got = collect(sock, 1)
        await delay(5)
        await expect(sock.__socket.ingressPublish(13)).rejects.toThrow('unlucky')
        await sock.__socket.ingressPublish(5)

        expect(await got).toEqual([5])
    })

    test('server publish bypasses the handler', async () => {
        const sock = socket<number>({ handler: () => DROP })
        const got = collect(sock, 1)
        await delay(5)
        sock.publish(1) // server path ignores the drop-everything handler

        expect(await got).toEqual([1])
    })
})
