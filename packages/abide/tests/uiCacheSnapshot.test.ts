import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { serializeCacheSnapshot } from '../src/lib/server/runtime/serializeCacheSnapshot.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheEntryFromSnapshot } from '../src/lib/shared/cacheEntryFromSnapshot.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import type { CacheSnapshotEntry } from '../src/lib/shared/types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { applyResolved } from '../src/lib/ui/dom/applyResolved.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { RESUME } from '../src/lib/ui/runtime/RESUME.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

const options = { logRequests: false }

/* The whole loop, through abide's real machinery: a defineVerb remote read via
   cache() inside a `<template await>`, server-rendered and streamed, its store
   serialized by the actual serializeCacheSnapshot, seeded on a fresh client store,
   then the page hydrated — adopting the SSR branch from the warm cache without re-
   dispatching the verb. The keyed counterpart to the positional resume manifest. */
let handlerCalls = 0
const getUsers = defineVerb('GET', '/rpc/ui-users', () => {
    handlerCalls += 1
    return json(['ada', 'margaret'])
})

const SOURCE = `
    <script>let load = cache(getUsers)</script>
    <main>
        <template await={load()}>
            <p>loading…</p>
            <template then="users">
                <ul><template each={users} as="u" key="u"><li>{u}</li></template></ul>
            </template>
        </template>
    </main>
`

beforeAll(() => {
    installMiniDom()
    /* Server resolver: the request-scoped store, exactly as the server entry installs. */
    cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
})
afterAll(() => {
    cacheStoreSlot.resolver = undefined
})
afterEach(() => {
    delete RESUME[0]
})

describe('cache() snapshot → UI hydration (full server→client loop)', () => {
    test('streams a {#await} read created mid-stream and resumes it warm, no re-dispatch', async () => {
        handlerCalls = 0

        // 1) server: mirror createUiPageRenderer's ordering. Render ONCE, snapshot the store
        //    AT RENDER-RETURN (the {#await} thunk hasn't run, so the store is empty — this is
        //    the timing the bug lived in), then drain the stream (which runs the thunk,
        //    creating + settling the entry) and snapshot again to get the warm partition.
        //    (runWithRequestScope's callback returns a Response, so stash outputs.)
        let chunks: string[] = []
        let streamed: CacheSnapshotEntry[] = []
        await runWithRequestScope(new Request('https://test.local/data'), options, async () => {
            const ssr = new Function(
                'doc',
                'state',
                'computed',
                'effect',
                'cache',
                'getUsers',
                compileSSR(SOURCE),
            )(doc, state, computed, effect, cache, getUsers) as SsrRender
            const store = requestContext.getStore()?.cache as CacheStore

            const atReturn = await serializeCacheSnapshot(store)
            expect(atReturn).toHaveLength(0) // lazy {#await} read — not created yet
            expect(store.entries.size).toBe(0)

            const collected: string[] = []
            for await (const chunk of renderToStream(() => ssr)) {
                collected.push(chunk)
            }
            /* Flush the microtask that flips the cache entry's settled flag. */
            await new Promise((resolve) => setTimeout(resolve, 0))
            chunks = collected
            /* Created and settled during the stream — the partition the client seeds from. */
            streamed = await serializeCacheSnapshot(store)
            return json(null)
        })
        expect(handlerCalls).toBe(1) // the verb dispatched once, on the server
        expect(streamed).toHaveLength(1) // the mid-stream entry serialized post-drain

        // 2) reconstruct the server DOM the browser received
        const host = document.createElement('div')
        host.innerHTML = chunks[0]
        for (const frame of chunks.slice(1)) {
            applyResolved(host, frame)
        }
        const ul = (host.childNodes[0] as unknown as { childNodes: unknown[] })
            .childNodes[2] as unknown as { childNodes: { textContent: string }[] }
        const firstRowBefore = ul.childNodes[0]

        // 3) client: a fresh store seeded from the streamed snapshot (warms post-hydration
        //    reads), then hydrate — the await block adopts the SSR DOM from the streamed
        //    resume manifest, so the verb is never re-dispatched
        const clientStore = createCacheStore()
        for (const entry of streamed) {
            clientStore.entries.set(entry.key, cacheEntryFromSnapshot(entry))
        }
        cacheStoreSlot.resolver = () => clientStore

        const runtime = {
            doc,
            state,
            computed,
            effect,
            appendText,
            appendStatic,
            on,
            each,
            awaitBlock,
            cache,
            getUsers,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])
        const body = compileComponent(SOURCE)
        try {
            hydrate(host, (target) => {
                new Function('host', ...names, body)(target, ...values)
            })

            expect(handlerCalls).toBe(1) // warm cache on the client — the verb never re-ran
            expect(ul.childNodes[0]).toBe(firstRowBefore) // SSR rows adopted, not recreated
            expect(ul.childNodes.map((row) => row.textContent).filter(Boolean)).toEqual([
                'ada',
                'margaret',
            ])
        } finally {
            cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
        }
    })

    /* The bundle-side stream consumer (streaming SPA nav / socket SSR): a script set via
       innerHTML never runs, so the cache channel rides an `<abide-cache>` data frame that
       applyResolved seeds — paired with the DOM swap so the reserved path can't adopt a
       resolved branch while dropping its cache key (the asymmetry behind the refetch). */
    test('applyResolved seeds the store from an <abide-cache> frame; a miss frame is a no-op', () => {
        const store = createCacheStore()
        cacheStoreSlot.resolver = () => store
        try {
            const host = document.createElement('div')
            const snapshot = {
                key: 'GET /rpc/streamed',
                url: 'https://test.local/rpc/streamed',
                method: 'GET' as const,
                status: 200,
                statusText: 'OK',
                headers: [['content-type', 'application/json']] as Array<[string, string]>,
                body: JSON.stringify(['ada']),
            }
            applyResolved(host, `<abide-cache>${JSON.stringify(snapshot)}</abide-cache>`)
            expect(store.entries.get(snapshot.key)?.value).toEqual(['ada']) // warmed, no fetch

            applyResolved(
                host,
                `<abide-cache>${JSON.stringify({ key: 'GET /rpc/miss', miss: true })}</abide-cache>`,
            )
            expect(store.entries.has('GET /rpc/miss')).toBe(false) // miss → left cold, re-fetches
        } finally {
            cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
        }
    })
})
