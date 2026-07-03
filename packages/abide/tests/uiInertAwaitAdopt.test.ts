import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { encodeRefJson } from '../src/lib/shared/encodeRefJson.ts'
import { producerKey } from '../src/lib/shared/producerKey.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { RESUME } from '../src/lib/ui/runtime/RESUME.ts'
import type { State } from '../src/lib/ui/runtime/types/State.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})
const globalWithObserver = globalThis as { IntersectionObserver?: unknown }
afterEach(() => {
    cacheStoreSlot.resolver = undefined
    cacheStoreSlot.fallback = undefined
    delete RESUME[0]
    delete globalWithObserver.IntersectionObserver
})

/* Lets pending cache promises + their swaps settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/* A controllable IntersectionObserver so a deferred block takes the visible-wake path and a
   test can decide WHEN the branch scrolls into view. */
function installFakeObserver(): { fire: () => void } {
    let callback: (entries: { isIntersecting: boolean }[]) => void = () => undefined
    class FakeObserver {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
            callback = cb
        }
        observe(): void {}
        disconnect(): void {}
    }
    globalWithObserver.IntersectionObserver = FakeObserver
    return { fire: () => callback([{ isIntersecting: true }]) }
}

/*
Inert await adoption, unit-level. A `{#await cache()}` whose resume ships a `{ defer, key }`
marker instead of the value hydrates by adopting the server branch VERBATIM — no value
materialization, no decode, no fetch on the boot path — and only reads the value for real on
the first cache.invalidate re-read, which the display-first read replaces the branch on anyway.

The server DOM, resume marker and lazy stub entry are hand-built to exercise awaitBlock's
hydrate path in isolation; deferredAwaitEndToEnd covers the same behaviour through the real
server→client loop.
*/
describe('deferred await adopts inert', () => {
    test('no value materialization at boot; materializes + swaps on invalidate', async () => {
        let calls = 0
        async function loadUsers(): Promise<string[]> {
            calls += 1
            return [`user${calls}`]
        }
        const store = createCacheStore()
        cacheStoreSlot.resolver = () => store
        const load = cache(loadUsers)
        const key = producerKey(loadUsers, undefined)

        /* The deferred seed places a LAZY entry (present so invalidate matches it and a re-read
           finds it, but with NO precomputed `value` — that decode is what the spike defers).
           Server-side this is the lazy/out-of-band seed; here it stands in for it. */
        store.entries.set(key, {
            key,
            promise: Promise.resolve(undefined),
            ttl: undefined,
            expiresAt: undefined,
            settled: true,
        })

        /* Server-rendered branch (the value is already painted) bounded by the await markers. */
        const host = document.createElement('div')
        host.innerHTML = '<!--abide:await:0--><span>user0</span><!--/abide:await:0-->'

        /* The server shipped a DEFER marker in place of the value (ref-json string, as RESUME holds). */
        RESUME[0] = encodeRefJson({ defer: true, key })

        const renderThen = (parent: Node, value: unknown): void => {
            const cell = value as State<unknown>
            appendText(parent, () => String((cell.value as string[])?.[0] ?? ''))
        }

        hydrate(host, () => {
            awaitBlock(host, 0, () => load(), undefined, renderThen, undefined)
        })

        /* Boot: server markup kept, value NEVER materialized (producer not called, nothing decoded). */
        expect(host.textContent).toContain('user0')
        expect(calls).toBe(0)

        /* First re-read: invalidate → the inert block re-runs, reads for real, swaps the branch. */
        cache.invalidate(loadUsers)
        await flush()
        expect(calls).toBe(1)
        expect(host.textContent).toContain('user1')
        expect(host.textContent).not.toContain('user0')
    })

    /* Below-the-fold: with an observer present and an element in the branch, the block wakes on
       VISIBLE, not idle — it stays inert through an idle gap and only materializes when its
       range scrolls into view. So a deferred grid the user never reaches decodes nothing. */
    test('a branch with an element wakes on visible, not on idle', async () => {
        const observer = installFakeObserver()
        async function loadSeed(): Promise<string[]> {
            return ['warm']
        }
        const store = createCacheStore()
        cacheStoreSlot.resolver = () => store
        const load = cache(loadSeed)
        const key = producerKey(loadSeed, undefined)
        /* Lazy stub (warm read returns undefined) so the woken branch is empty, distinguishable
           from the 'SERVER' server DOM — the assertion keys on the swap, not a refetched value. */
        store.entries.set(key, {
            key,
            promise: Promise.resolve(undefined),
            ttl: undefined,
            expiresAt: undefined,
            settled: true,
        })

        const host = document.createElement('div')
        host.innerHTML = '<!--abide:await:0--><span>SERVER</span><!--/abide:await:0-->'
        RESUME[0] = encodeRefJson({ defer: true, key })
        const renderThen = (parent: Node, value: unknown): void => {
            const cell = value as State<unknown>
            appendText(parent, () => String((cell.value as string[])?.[0] ?? ''))
        }

        hydrate(host, () => {
            awaitBlock(host, 0, () => load(), undefined, renderThen, undefined)
        })

        /* An idle gap passes with no intersection: still inert, server DOM intact. */
        await flush()
        expect(host.textContent).toContain('SERVER')

        /* Scrolled into view → the branch re-runs and swaps out the inert server DOM. */
        observer.fire()
        await flush()
        expect(host.textContent).not.toContain('SERVER')
    })
})
