// CO2 — observability: log (channels + format), trace (W3C traceparent), health, online, reachable.

import { afterEach, describe, expect, test } from 'bun:test'
import { GET } from '../server/GET.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { health } from './health.ts'
import { log } from './log.ts'
import { online } from './online.ts'
import { reachable } from './reachable.ts'
import { trace } from './trace.ts'

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/

// Capture what log writes to stdout for the duration of `run`, restoring the real stream after.
function captureStdout(run: () => void): string[] {
    const writes: string[] = []
    const original = process.stdout.write.bind(process.stdout)
    ;(process.stdout as { write: (chunk: string) => boolean }).write = (chunk: string): boolean => {
        writes.push(String(chunk))
        return true
    }
    try {
        run()
    } finally {
        ;(process.stdout as { write: typeof original }).write = original
    }
    return writes
}

// Capture what log writes to stderr (warn/error) for the duration of `run`.
function captureStderr(run: () => void): string[] {
    const writes: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    ;(process.stderr as { write: (chunk: string) => boolean }).write = (chunk: string): boolean => {
        writes.push(String(chunk))
        return true
    }
    try {
        run()
    } finally {
        ;(process.stderr as { write: typeof original }).write = original
    }
    return writes
}

afterEach(() => {
    delete Bun.env.DEBUG
    delete Bun.env.ABIDE_LOG_FORMAT
    delete Bun.env.ABIDE_APP_NAME
    delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('log — channel gating by DEBUG', () => {
    test('a channel emits only when DEBUG names it (or *)', () => {
        const writes = captureStdout(() => {
            delete Bun.env.DEBUG
            log.channel('cache')('hidden')

            Bun.env.DEBUG = 'cache,rpc'
            log.channel('cache')('shown')
            log.channel('other')('still hidden')

            Bun.env.DEBUG = '*'
            log.channel('anything')('wildcard')
        })
        expect(writes.length).toBe(2)
        expect(writes[0]).toContain('shown')
        expect(writes[0]).toContain('[cache]')
        expect(writes[1]).toContain('wildcard')
    })

    test('base log levels always emit regardless of DEBUG', () => {
        const writes = captureStdout(() => {
            delete Bun.env.DEBUG
            log.info('always')
        })
        expect(writes.length).toBe(1)
        expect(writes[0]).toContain('always')
    })

    test('error bypasses gating on a named channel (failures always surface)', () => {
        const writes = captureStderr(() => {
            delete Bun.env.DEBUG
            log.channel('abide:rpc').error('boom')
            log.channel('abide:rpc').warn('quiet') // warn stays gated
        })
        expect(writes.length).toBe(1)
        expect(writes[0]).toContain('boom')
        expect(writes[0]).toContain('[abide:rpc]')
    })

    test('a channel emits when localStorage.debug names it (browser gate)', () => {
        const writes = captureStdout(() => {
            delete Bun.env.DEBUG
            ;(globalThis as { localStorage?: { getItem(k: string): string | null } }).localStorage =
                { getItem: (key) => (key === 'debug' ? 'abide:*' : null) }
            log.channel('abide:cache')('via localStorage')
        })
        expect(writes.length).toBe(1)
        expect(writes[0]).toContain('via localStorage')
        expect(writes[0]).toContain('[abide:cache]')
    })
})

describe('log — default channel is the app name', () => {
    test('the un-channeled logger is labeled "abide" by default', () => {
        const writes = captureStdout(() => {
            delete Bun.env.ABIDE_APP_NAME
            log.info('hello')
        })
        expect(writes[0]).toContain('[abide]')
    })

    test('ABIDE_APP_NAME sets the default channel label', () => {
        const writes = captureStdout(() => {
            Bun.env.ABIDE_APP_NAME = 'myapp'
            log.info('hello')
        })
        expect(writes[0]).toContain('[myapp]')
        expect(writes[0]).not.toContain('[abide]')
    })
})

describe('log — format toggles on ABIDE_LOG_FORMAT', () => {
    test('json format writes a parseable JSON line', () => {
        const writes = captureStdout(() => {
            Bun.env.ABIDE_LOG_FORMAT = 'json'
            log.info('hello')
        })
        const firstWrite = writes[0]
        if (firstWrite === undefined) throw new Error('expected a stdout write')
        const parsed = JSON.parse(firstWrite.trim())
        expect(parsed.level).toBe('info')
        expect(parsed.message).toBe('hello')
        expect(typeof parsed.time).toBe('string')
    })

    test('default format is tab-separated (not JSON)', () => {
        const writes = captureStdout(() => {
            delete Bun.env.ABIDE_LOG_FORMAT
            log.info('hello')
        })
        const firstWrite = writes[0]
        if (firstWrite === undefined) throw new Error('expected a stdout write')
        expect(firstWrite).toContain('\t')
        expect(() => JSON.parse(firstWrite.trim())).toThrow()
    })
})

describe('trace — W3C traceparent within a request', () => {
    test('returns undefined outside a request scope', () => {
        expect(trace()).toBeUndefined()
    })

    test('is a valid traceparent and stable within one request', async () => {
        const traceRpc = GET(() => {
            const first = trace()
            const second = trace()
            return { first, stable: first === second }
        })
        const app = await createTestApp({ routes: { traceRpc } })
        try {
            const traceRpcCall = app.rpc.traceRpc
            if (traceRpcCall === undefined) throw new Error('expected traceRpc on the test app')
            const body = (await traceRpcCall()) as { first: string; stable: boolean }
            expect(body.first).toMatch(TRACEPARENT)
            expect(body.stable).toBe(true)
        } finally {
            await app.stop()
        }
    })

    test('propagates an incoming traceparent header', async () => {
        const traceRpc = GET(() => ({ value: trace() }))
        const app = await createTestApp({ routes: { traceRpc } })
        const incoming = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`
        try {
            const response = await app.fetch('/__abide/rpc/traceRpc', {
                method: 'GET',
                headers: { traceparent: incoming },
            })
            const body = (await response.json()) as { value: string }
            expect(body.value).toBe(incoming)
            expect(response.headers.get('traceparent')).toBe(incoming)
            expect(response.headers.get('traceresponse')).toBe(incoming)
        } finally {
            await app.stop()
        }
    })
})

describe('health / online / reachable', () => {
    test('health() reports reachable: true and the abide version (server baseline)', async () => {
        const doc = await health()
        expect(doc.reachable).toBe(true)
        expect(typeof doc.version).toBe('string')
    })

    test('online() is true on the server', () => {
        expect(online()).toBe(true)
    })

    test('reachable() is true for a live origin and false for a dead one', async () => {
        const app = await createTestApp({})
        try {
            expect(await reachable(app.origin)).toBe(true)
            expect(await reachable('http://127.0.0.1:1')).toBe(false)
        } finally {
            await app.stop()
        }
    })
})
