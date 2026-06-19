import { describe, expect, test } from 'bun:test'
import { createScope } from '../src/lib/ui/createScope.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { Patch } from '../src/lib/ui/runtime/types/Patch.ts'
import { sync } from '../src/lib/ui/sync.ts'
import type { SyncTransport } from '../src/lib/ui/types/SyncTransport.ts'

/* An in-memory hub: a patch one peer sends reaches every OTHER peer's inbound
   handler (never its own — the transport-level half of the echo guard). */
const makeChannel = () => {
    const handlers = new Set<(patch: Patch) => void>()
    return {
        connect(): SyncTransport {
            let mine: ((patch: Patch) => void) | undefined
            return {
                send: (patch) => {
                    for (const handler of handlers) {
                        if (handler !== mine) {
                            handler(patch)
                        }
                    }
                },
                subscribe: (onPatch) => {
                    mine = onPatch
                    handlers.add(onPatch)
                    return () => handlers.delete(onPatch)
                },
            }
        },
    }
}

describe('sync — real-time shared state across peers', () => {
    test('two synced docs mirror each other, both directions', () => {
        const channel = makeChannel()
        const a = doc({ count: 0 })
        const b = doc({ count: 0 })
        sync(a, channel.connect())
        sync(b, channel.connect())

        a.replace('count', 5)
        expect(b.read<number>('count')).toBe(5) // a → b

        b.replace('count', 9)
        expect(a.read<number>('count')).toBe(9) // b → a
    })

    test('no echo loop: applying a peer patch does not re-publish it', () => {
        const channel = makeChannel()
        const a = doc({ n: 0 })
        const b = doc({ n: 0 })
        let bSends = 0
        const aTransport = channel.connect()
        const bTransport = channel.connect()
        sync(a, aTransport)
        /* wrap b's send to count outbound publishes */
        sync(b, { send: (p) => (bSends++, bTransport.send(p)), subscribe: bTransport.subscribe })

        a.replace('n', 1)
        expect(b.read<number>('n')).toBe(1) // b received and applied
        expect(bSends).toBe(0) // …but b did NOT echo it back out
    })

    test('concurrent edits to different paths both survive (no false conflict)', () => {
        const channel = makeChannel()
        const a = doc({ x: 0, y: 0 })
        const b = doc({ x: 0, y: 0 })
        sync(a, channel.connect())
        sync(b, channel.connect())

        a.replace('x', 1)
        b.replace('y', 2)
        expect(a.snapshot()).toEqual({ x: 1, y: 2 })
        expect(b.snapshot()).toEqual({ x: 1, y: 2 })
    })

    test('scope().broadcast() shares a scope; dispose stops syncing', () => {
        const channel = makeChannel()
        const a = createScope({ title: '' })
        const b = createScope({ title: '' })
        a.broadcast(channel.connect())
        b.broadcast(channel.connect())

        a.replace('title', 'live')
        expect(b.read<string>('title')).toBe('live')

        a.dispose() // detaches a from the channel
        b.replace('title', 'after')
        expect(a.read<string>('title')).toBe('live') // a no longer receives
    })
})
