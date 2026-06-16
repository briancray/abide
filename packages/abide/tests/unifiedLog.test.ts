import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { appNameSlot } from '../src/lib/shared/appNameSlot.ts'
import { log } from '../src/lib/shared/log.ts'
import { logClosingRecord } from '../src/lib/shared/logClosingRecord.ts'
import { requestScopeSlot } from '../src/lib/shared/requestScopeSlot.ts'
import { trace } from '../src/lib/shared/trace.ts'
import type { RequestScopeInfo } from '../src/lib/shared/types/RequestScopeInfo.ts'

const SCOPE: RequestScopeInfo = {
    trace: { traceId: 'a3ce929d0e0e4736a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', flags: '01' },
    elapsedMs: 12.3,
    method: 'GET',
    path: '/post/1',
}

// ANSI escapes vary with TTY detection; assertions strip them. (Built dynamically — biome rejects control chars in regex literals.)
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[^m]*m`, 'g')
const stripAnsi = (line: string) => line.replace(ANSI_ESCAPE, '')

/* Captures console output for one synchronous-ish emission, restoring everything after. */
function capture(level: 'log' | 'warn' | 'error', run: () => void | Promise<void>) {
    const lines: unknown[][] = []
    const spy = spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args)
    })
    const finish = () => {
        spy.mockRestore()
        return lines
    }
    const result = run()
    if (result instanceof Promise) {
        return result.then(finish, (error) => {
            finish()
            throw error
        })
    }
    return finish()
}

const previousResolver = requestScopeSlot.resolver
const previousAppName = appNameSlot.name

beforeEach(() => {
    /* Unset → the default channel falls back to 'app'. */
    appNameSlot.name = undefined
})

afterEach(() => {
    requestScopeSlot.resolver = previousResolver
    appNameSlot.name = previousAppName
    delete process.env.ABIDE_LOG_FORMAT
    delete process.env.DEBUG
})

describe('unified log format', () => {
    test('the closing request record carries cache tallies in json', () => {
        requestScopeSlot.resolver = () => SCOPE
        process.env.ABIDE_LOG_FORMAT = 'json'
        const lines = capture('log', () =>
            logClosingRecord('GET', '/post/1', 200, 63.12, { hits: 2, misses: 1, coalesced: 0 }),
        ) as unknown[][]
        const record = JSON.parse(String(lines[0]?.[0]))
        expect(record).toMatchObject({
            status: 200,
            durationMs: 63.12,
            channel: 'abide',
            cache: { hits: 2, misses: 1, coalesced: 0 },
        })
    })

    test('in-scope lines carry the trace8 +elapsed verb+path prefix', () => {
        requestScopeSlot.resolver = () => SCOPE
        const lines = capture('log', () => log('user created', { id: 7 })) as unknown[][]
        const line = stripAnsi(String(lines[0]?.[0]))
        expect(line).toBe('a3ce929d\tGET /post/1\t[app] user created\t+12.30ms')
        // The data argument passes through untouched for object inspection.
        expect(lines[0]?.[1]).toEqual({ id: 7 })
    })

    test('out-of-scope lines are just the message', () => {
        requestScopeSlot.resolver = undefined
        const lines = capture('log', () => log('plain fact')) as unknown[][]
        expect(stripAnsi(String(lines[0]?.[0]))).toBe('[app] plain fact')
    })

    test('trace() reflects the scope and goes undefined outside one', () => {
        requestScopeSlot.resolver = () => SCOPE
        expect(trace()).toBe('00-a3ce929d0e0e4736a3ce929d0e0e4736-00f067aa0ba902b7-01')
        requestScopeSlot.resolver = undefined
        expect(trace()).toBeUndefined()
    })

    test('ABIDE_LOG_FORMAT=json emits one structured record per line', () => {
        requestScopeSlot.resolver = () => SCOPE
        process.env.ABIDE_LOG_FORMAT = 'json'
        const lines = capture('warn', () => log.warn('quota at 90%', { used: 0.9 })) as unknown[][]
        const record = JSON.parse(String(lines[0]?.[0]))
        expect(record).toMatchObject({
            level: 'warn',
            msg: 'quota at 90%',
            channel: 'app',
            trace: 'a3ce929d0e0e4736a3ce929d0e0e4736',
            elapsedMs: 12.3,
            method: 'GET',
            path: '/post/1',
            data: { used: 0.9 },
        })
        // ts is the absolute anchor only the json format prints; ISO so ingestion parses it.
        expect(new Date(record.ts).getTime()).toBeGreaterThan(0)
    })

    test('negation shuts off the always-on channels', () => {
        requestScopeSlot.resolver = undefined
        process.env.DEBUG = '-app'
        const appLines = capture('log', () => log('silenced')) as unknown[][]
        expect(appLines).toHaveLength(0)
        // Levels never gate: a silenced channel is silent at every level.
        const warnLines = capture('warn', () => log.warn('also silenced')) as unknown[][]
        expect(warnLines).toHaveLength(0)
        // Other channels are untouched by the negation.
        process.env.DEBUG = '-app,abide:cache'
        const channelLines = capture('log', () =>
            log.channel('abide:cache')('still on'),
        ) as unknown[][]
        expect(channelLines).toHaveLength(1)
    })

    test('negation wins over inclusion for gated channels', () => {
        requestScopeSlot.resolver = undefined
        process.env.DEBUG = 'abide:*,-abide:svelte'
        const onLines = capture('log', () => log.channel('abide:cache')('on')) as unknown[][]
        expect(onLines).toHaveLength(1)
        const offLines = capture('log', () => log.channel('abide:svelte')('off')) as unknown[][]
        expect(offLines).toHaveLength(0)
    })

    test('channels gate on DEBUG and tag their records', () => {
        requestScopeSlot.resolver = undefined
        const channel = log.channel('abide:cache')
        const silent = capture('log', () => channel('miss posts(1)')) as unknown[][]
        expect(silent).toHaveLength(0)
        process.env.DEBUG = 'abide:*'
        const lines = capture('log', () => channel('miss posts(1)')) as unknown[][]
        expect(stripAnsi(String(lines[0]?.[0]))).toBe('[abide:cache] miss posts(1)')
    })

    test('log.trace times the work, names the record, and passes the result through', async () => {
        requestScopeSlot.resolver = () => SCOPE
        const lines = (await capture('log', async () => {
            const result = await log.trace('checkout.submit', () => Promise.resolve(42))
            expect(result).toBe(42)
        })) as unknown[][]
        const line = stripAnsi(String(lines[0]?.[0]))
        expect(line).toMatch(
            /^a3ce929d\tGET \/post\/1\t\[app\] checkout\.submit \d+\.\d\dms\t\+12\.30ms$/,
        )
    })

    test('log.trace rethrows failures and reports them as error records', async () => {
        requestScopeSlot.resolver = undefined
        process.env.ABIDE_LOG_FORMAT = 'json'
        const lines = (await capture('error', async () => {
            await expect(
                log.trace('explode', () => {
                    throw new Error('kaboom')
                }),
            ).rejects.toThrow('kaboom')
        })) as unknown[][]
        const record = JSON.parse(String(lines[0]?.[0]))
        expect(record.level).toBe('error')
        expect(record.name).toBe('explode')
        expect(record.msg).toBe('kaboom')
        expect(record.spanId).toMatch(/^[0-9a-f]{16}$/)
        expect(record.durationMs).toBeGreaterThanOrEqual(0)
    })
})
