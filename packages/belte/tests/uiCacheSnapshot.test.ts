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
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { applyResolved } from '../src/lib/ui/dom/applyResolved.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { openRoot } from '../src/lib/ui/dom/openRoot.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { RESUME } from '../src/lib/ui/runtime/RESUME.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

const options = { logRequests: false }

/* The whole loop, through belte's real machinery: a defineVerb remote read via
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
    test('serializes the request store and resumes the await branch warm, no re-dispatch', async () => {
        handlerCalls = 0

        // 1) server: render the shell, drain the stream (settles the cache entry),
        //    then serialize the request-scoped store with belte's real serializer.
        //    (runWithRequestScope's callback returns a Response, so stash outputs.)
        let chunks: string[] = []
        let inline: CacheSnapshotEntry[] = []
        await runWithRequestScope(new Request('https://test.local/data'), options, async () => {
            const render = (): SsrRender =>
                new Function(
                    'doc',
                    'state',
                    'derived',
                    'effect',
                    'cache',
                    'getUsers',
                    compileSSR(SOURCE),
                )(doc, state, derived, effect, cache, getUsers) as SsrRender
            const collected: string[] = []
            for await (const chunk of renderToStream(render)) {
                collected.push(chunk)
            }
            /* Flush the microtask that flips the cache entry's settled flag. */
            await new Promise((resolve) => setTimeout(resolve, 0))
            chunks = collected
            const store = requestContext.getStore()?.cache as CacheStore
            inline = (await serializeCacheSnapshot(store)).inline
            return json(null)
        })
        expect(handlerCalls).toBe(1) // the verb dispatched once, on the server
        expect(inline).toHaveLength(1) // the settled entry serialized inline

        // 2) reconstruct the server DOM the browser received
        const host = document.createElement('div')
        host.innerHTML = chunks[0]
        for (const frame of chunks.slice(1)) {
            applyResolved(host, frame)
        }
        const ul = (host.childNodes[0] as unknown as { childNodes: unknown[] })
            .childNodes[1] as unknown as { childNodes: { textContent: string }[] }
        const firstRowBefore = ul.childNodes[0]
        /* Drop the positional manifest so this proves the *cache* path specifically. */
        delete RESUME[0]

        // 3) client: a fresh store seeded from the snapshot, then hydrate
        const clientStore = createCacheStore()
        for (const entry of inline) {
            clientStore.entries.set(entry.key, cacheEntryFromSnapshot(entry))
        }
        cacheStoreSlot.resolver = () => clientStore

        const runtime = {
            doc,
            state,
            derived,
            effect,
            openChild,
            openRoot,
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
            expect(ul.childNodes.map((row) => row.textContent)).toEqual(['ada', 'margaret'])
        } finally {
            cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
        }
    })
})
