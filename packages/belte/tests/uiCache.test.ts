import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheEntryFromSnapshot } from '../src/lib/shared/cacheEntryFromSnapshot.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { openRoot } from '../src/lib/ui/dom/openRoot.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { RESUME } from '../src/lib/ui/runtime/RESUME.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})
/* Reset before and after: the shared cache slot + the global resume manifest are
   process-wide, so guard against a prior test leaving an entry that would route
   this read down the manifest path instead of the cache path. */
function resetState(): void {
    cacheStoreSlot.resolver = undefined
    cacheStoreSlot.fallback = undefined
    delete RESUME[0]
}
beforeEach(resetState)
afterEach(resetState)

/*
The new UI framework composes with belte's real `belte/shared/cache`: a warm
cache entry — as the SSR cache snapshot would seed on the client — makes a
`<template await={cache(fn)()}>` block adopt the server-rendered branch on
hydrate, synchronously, without re-fetching. This is the keyed counterpart to the
positional resume manifest: the store is warm, so any reader of the key is sync.
*/
describe('cache() + UI await-block hydration', () => {
    test('adopts the SSR branch from a warm cache entry — no fetch', () => {
        // a remote-shaped function that records whether it was actually called
        let fetched = false
        const url = 'https://x.test/api/users'
        const rawFn = Object.assign(
            () => {
                fetched = true
                return Promise.resolve(new Response('[]'))
            },
            { method: 'GET' as const, url },
        )
        const getUsers = Object.assign(() => Promise.resolve([] as string[]), {
            raw: rawFn,
            [REMOTE_FUNCTION]: true,
        })

        // a warm client store, seeded exactly as hydrateCacheFromSnapshot would
        const store = createCacheStore()
        const key = keyForRemoteCall('GET', url, undefined)
        store.entries.set(
            key,
            cacheEntryFromSnapshot({
                key,
                url,
                method: 'GET',
                status: 200,
                statusText: 'OK',
                headers: [['content-type', 'application/json']],
                body: JSON.stringify(['ada', 'margaret']),
            }),
        )
        cacheStoreSlot.resolver = () => store

        // the server-rendered DOM: shell with the resolved branch already in place
        const host = document.createElement('div')
        host.innerHTML =
            '<main><!--belte:await:0--><ul><li>ada</li><li>margaret</li></ul><!--/belte:await:0--></main>'
        const ul = (host.childNodes[0] as unknown as { childNodes: unknown[] })
            .childNodes[1] as unknown as { childNodes: { textContent: string }[] }
        const firstRowBefore = ul.childNodes[0]

        const source = `
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
        const body = compileComponent(source)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(target, ...values)
        })

        expect(fetched).toBe(false) // warm cache read — the remote never fired
        expect(RESUME[0]).toBeUndefined() // proven via the cache store, not the manifest
        expect(ul.childNodes[0]).toBe(firstRowBefore) // SSR rows adopted, not recreated
        expect(ul.childNodes.map((row) => row.textContent)).toEqual(['ada', 'margaret'])
    })
})
