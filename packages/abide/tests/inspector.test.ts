import { afterEach, describe, expect, test } from 'bun:test'
import { maybeMountInspector } from '../src/lib/server/runtime/maybeMountInspector.ts'
import { emitLogRecord } from '../src/lib/shared/emitLogRecord.ts'
import { logTapSlot } from '../src/lib/shared/logTapSlot.ts'
import { socketTapSlot } from '../src/lib/shared/socketTapSlot.ts'

const APP = { name: 'testapp', version: '1.2.3' }

const request = (path: string) =>
    [new Request(`http://x${path}`), new URL(`http://x${path}`)] as const

afterEach(() => {
    delete process.env.ABIDE_ENABLE_INSPECTOR
    logTapSlot.tap = undefined
    socketTapSlot.tap = undefined
})

describe('maybeMountInspector', () => {
    test('returns undefined when ABIDE_ENABLE_INSPECTOR is unset — off by default', async () => {
        const handler = await maybeMountInspector(APP)
        expect(handler).toBeUndefined()
        expect(logTapSlot.tap).toBeUndefined()
    })

    test('mounts on flag=true and serves the surface catalog as JSON', async () => {
        process.env.ABIDE_ENABLE_INSPECTOR = 'true'
        const handler = await maybeMountInspector(APP)
        expect(handler).toBeDefined()

        const response = await handler!(...request('/__abide/inspector/surface'))
        expect(response.headers.get('Content-Type')).toContain('application/json')
        const surface = (await response.json()) as { verbs: unknown[]; sockets: unknown[] }
        expect(Array.isArray(surface.verbs)).toBe(true)
        expect(Array.isArray(surface.sockets)).toBe(true)
    })

    test('serves the global cache snapshot as JSON', async () => {
        process.env.ABIDE_ENABLE_INSPECTOR = 'true'
        const handler = await maybeMountInspector(APP)
        const response = await handler!(...request('/__abide/inspector/cache'))
        expect(response.headers.get('Content-Type')).toContain('application/json')
        const snapshot = (await response.json()) as { entries: unknown[] }
        expect(Array.isArray(snapshot.entries)).toBe(true)
    })

    test('serves the standalone UI page for the mount root', async () => {
        process.env.ABIDE_ENABLE_INSPECTOR = 'true'
        const handler = await maybeMountInspector(APP)
        const response = await handler!(...request('/__abide/inspector'))
        expect(response.headers.get('Content-Type')).toContain('text/html')
        const html = await response.text()
        expect(html).toContain('abide inspector')
        expect(html).toContain(APP.name)
    })

    test('installs a log tap whose feed replays emitted records', async () => {
        process.env.ABIDE_ENABLE_INSPECTOR = 'true'
        const handler = await maybeMountInspector(APP)
        expect(logTapSlot.tap).toBeTypeOf('function')

        // Emitted through the real chokepoint — the tap captures it into the buffer.
        emitLogRecord({ level: 'info', msg: 'hello-inspector' })
        const response = await handler!(...request('/__abide/inspector/events'))
        expect(response.headers.get('Content-Type')).toContain('text/event-stream')

        // Replay enqueues each retained record as its own chunk; accumulate a
        // few until our record shows up (earlier chunks are the mount's own logs).
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let seen = ''
        for (let read = 0; read < 5 && !seen.includes('hello-inspector'); read++) {
            const { value } = await reader.read()
            seen += decoder.decode(value)
        }
        expect(seen).toContain('hello-inspector')
        await reader.cancel()
    })

    test('folds published socket frames into the feed as socket-channel records', async () => {
        process.env.ABIDE_ENABLE_INSPECTOR = 'true'
        const handler = await maybeMountInspector(APP)
        expect(socketTapSlot.tap).toBeTypeOf('function')

        // A publish reaches the inspector through the socket tap, shaped as a record.
        socketTapSlot.tap!({ socket: 'chat', message: { text: 'frame-payload' } })
        const response = await handler!(...request('/__abide/inspector/events'))
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let seen = ''
        for (let read = 0; read < 6 && !seen.includes('frame-payload'); read++) {
            const { value } = await reader.read()
            seen += decoder.decode(value)
        }
        expect(seen).toContain('"channel":"socket"')
        expect(seen).toContain('frame-payload')
        await reader.cancel()
    })
})
