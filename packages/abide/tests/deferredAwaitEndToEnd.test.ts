import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { serializeCacheSnapshot } from '../src/lib/server/runtime/serializeCacheSnapshot.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheEntryFromSnapshot } from '../src/lib/shared/cacheEntryFromSnapshot.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import type { CacheSnapshotEntry } from '../src/lib/shared/types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { RESUME } from '../src/lib/ui/runtime/RESUME.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { tryEncodeResume } from '../src/lib/ui/tryEncodeResume.ts'
import { installMiniDom } from './support/installMiniDom.ts'

const KEY = keyForRemoteCall('GET', '/rpc/deferred-users', undefined)

let version = 1
let handlerCalls = 0
const getUsers = defineRpc('GET', '/rpc/deferred-users', () => {
    handlerCalls += 1
    const v = version
    return json(Array.from({ length: 3000 }, (_, i) => `user-v${v}-${i}`))
})

/* Blocking form (`then` on the tag): SSR renders the resolved HTML inline. */
const SOURCE = `
    <script>let load = cache(getUsers)</script>
    <main>
        {#await load() then users}
            <ul>{#for u of users by u}<li>{u}</li>{/for}</ul>
        {/await}
    </main>
`

beforeAll(() => {
    installMiniDom()
    cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
})
afterAll(() => {
    cacheStoreSlot.resolver = undefined
})
afterEach(() => {
    delete RESUME[0]
    version = 1
    handlerCalls = 0
})

const RUNTIME = { doc, state, computed, effect, appendText, appendStatic, on, each, awaitBlock, cache, getUsers }

describe('blocking {#await … then} — full server→client loop, deferred', () => {
    test('resume ships {defer,key} + lazy body; hydrates inert with no boot decode; re-reads on invalidate', async () => {
        let html = ''
        let resume: SsrRender['resume'] = {}
        let streamed: CacheSnapshotEntry[] = []

        await runWithRequestScope(new Request('https://test.local/data'), { logRequests: false }, async () => {
            const ssr = (await new Function(
                'state',
                'computed',
                'effect',
                'cache',
                'getUsers',
                compileSSR(SOURCE),
            )(state, computed, effect, cache, getUsers)) as SsrRender
            const store = requestContext.getStore()?.cache as CacheStore
            html = ssr.html
            resume = ssr.resume
            streamed = await serializeCacheSnapshot(store)
            return json(null)
        })

        // Resume is the KEY marker, not the value; the body ships once, flagged lazy.
        expect(resume[0]).toEqual({ defer: true, key: KEY })
        expect(streamed).toHaveLength(1)
        expect(streamed[0]?.key).toBe(KEY)
        expect(streamed[0]?.lazy).toBe(true)
        expect(handlerCalls).toBe(1) // dispatched once, on the server
        // SSR HTML carries the values as text (that's the display, and it stays).
        expect(html).toContain('user-v1-0')

        // Client: seed the lazy entry + the resume manifest (as startClient would), then hydrate.
        const clientStore = createCacheStore()
        for (const entry of streamed) {
            clientStore.entries.set(entry.key, cacheEntryFromSnapshot(entry))
        }
        cacheStoreSlot.resolver = () => clientStore
        RESUME[0] = tryEncodeResume(resume[0] as never, 0) as string
        expect(clientStore.entries.get(KEY)?.value).toBeUndefined() // lazy — not decoded at seed

        const host = document.createElement('div')
        host.innerHTML = html
        const names = Object.keys(RUNTIME)
        const values = names.map((n) => RUNTIME[n as keyof typeof RUNTIME])
        const body = compileComponent(SOURCE)
        try {
            hydrate(host, (target) => {
                new Function('host', ...names, body)(target, ...values)
            })

            // Inert adoption: server DOM shown, and NOTHING decoded on the hydration path.
            expect(host.textContent).toContain('user-v1-0')
            expect(handlerCalls).toBe(1) // no client re-dispatch
            expect(clientStore.entries.get(KEY)?.value).toBeUndefined() // <-- zero boot decode

            // Re-read: invalidate → inert block re-runs, refetches, swaps in the fresh (v2) payload.
            version = 2
            cache.invalidate(getUsers)
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(handlerCalls).toBe(2)
            expect(host.textContent).toContain('user-v2-0')
            expect(host.textContent).not.toContain('user-v1-0')
        } finally {
            cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
        }
    })
})
