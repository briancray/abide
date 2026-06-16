import { afterEach, describe, expect, test } from 'bun:test'
import { createLivenessWatch } from '../src/lib/shared/createLivenessWatch.ts'
import { online } from '../src/lib/shared/online.ts'
import { requestScopeSlot } from '../src/lib/shared/requestScopeSlot.ts'
import type { RequestScopeInfo } from '../src/lib/shared/types/RequestScopeInfo.ts'

/* A request scope reporting a given connectivity, standing in for createServer's resolver. */
const scopeWith = (online: boolean | undefined) => () =>
    ({ method: 'GET', path: '/', elapsedMs: 0, online }) as unknown as RequestScopeInfo

describe('online() on the server', () => {
    afterEach(() => {
        requestScopeSlot.resolver = undefined
    })

    test('true outside any request scope — boot, cron, the server is its own backend', () => {
        expect(online()).toBe(true)
    })

    test('false when the request scope reports the calling client offline (OFFLINE_HEADER)', () => {
        requestScopeSlot.resolver = scopeWith(false)
        expect(online()).toBe(false)
    })

    test('true when the scope omits online — a non-abide-client request carries no header', () => {
        requestScopeSlot.resolver = scopeWith(undefined)
        expect(online()).toBe(true)
    })
})

describe('createLivenessWatch', () => {
    test('successes reset the miss count; failureLimit consecutive misses declare lost once', async () => {
        const lost: string[] = []
        const script = [true, false, true, false, false]
        let calls = 0
        const watcher = createLivenessWatch({
            probe: async () => script[calls++] ?? false,
            onLost: (url) => lost.push(url),
            intervalMs: 1,
            failureLimit: 2,
        })
        watcher.watch('http://target.local')
        await Bun.sleep(50)
        expect(lost).toEqual(['http://target.local'])
        // The watch stopped itself at the declaration — no probes after the fifth.
        expect(calls).toBe(5)
    })

    test('stop() before the first interval means no probe ever fires', async () => {
        let calls = 0
        const watcher = createLivenessWatch({
            probe: async () => {
                calls += 1
                return true
            },
            onLost: () => {},
            intervalMs: 1,
        })
        watcher.watch('http://target.local')
        watcher.stop()
        await Bun.sleep(20)
        expect(calls).toBe(0)
    })

    test('a probe resolving after a re-watch is discarded (staleness guard)', async () => {
        const lost: string[] = []
        let release: (alive: boolean) => void = () => {}
        const watcher = createLivenessWatch({
            probe: (url) =>
                url === 'http://old.local'
                    ? new Promise<boolean>((resolve) => {
                          release = resolve
                      })
                    : Promise.resolve(true),
            onLost: (url) => lost.push(url),
            intervalMs: 1,
            failureLimit: 1,
        })
        watcher.watch('http://old.local')
        await Bun.sleep(10)
        // The old target's probe is in flight; move to a new target, then fail the old one.
        watcher.watch('http://new.local')
        release(false)
        await Bun.sleep(10)
        expect(lost).toEqual([])
    })
})
