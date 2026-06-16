import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { activeCacheStore } from '../src/lib/shared/activeCacheStore.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import type { Route } from '../src/lib/ui/runtime/types/Route.ts'
import { startClient } from '../src/lib/ui/startClient.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})
afterEach(() => {
    cacheStoreSlot.resolver = undefined
    cacheStoreSlot.fallback = undefined
    delete (globalThis as { __SSR__?: unknown }).__SSR__
})

/*
The official abide-ui client entry: it seeds the tab cache store from the SSR
snapshot (so warm reads resolve without a fetch) and starts the router into #app.
*/
/* The router imports route chunks on demand, so the mount lands a microtask after
   startClient returns — drain the queue before asserting. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('startClient', () => {
    test('seeds the cache from __SSR__ and mounts the matching route', async () => {
        const url = 'https://x.test/api/users'
        const key = keyForRemoteCall('GET', url, undefined)
        ;(globalThis as { __SSR__?: unknown }).__SSR__ = {
            base: '',
            cache: [
                {
                    key,
                    url,
                    method: 'GET',
                    status: 200,
                    statusText: 'OK',
                    headers: [['content-type', 'application/json']],
                    body: JSON.stringify(['ada']),
                },
            ],
        }

        const host = document.createElement('div')
        const home: Route = (target) => {
            target.appendChild(document.createTextNode('home'))
            return () => undefined
        }
        const load = (): Promise<{ default: Route }> => Promise.resolve({ default: home })
        const dispose = startClient({ '/': load, '*': load }, {}, host)

        // the router imported and mounted the matching page into the target
        await flush()
        expect(host.textContent).toBe('home')
        // the snapshot seeded the tab store, so the key reads warm (no fetch)
        const entry = activeCacheStore().entries.get(key)
        expect(entry?.value).toEqual(['ada'])

        dispose()
    })

    test('throws when no #app target is found', () => {
        ;(globalThis as { __SSR__?: unknown }).__SSR__ = {}
        expect(() => startClient({}, {}, null)).toThrow('missing #app target')
    })
})
