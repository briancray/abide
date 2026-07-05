import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheEntryFromSnapshot } from '../src/lib/shared/cacheEntryFromSnapshot.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { encodeRefJson } from '../src/lib/shared/encodeRefJson.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
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

const URL_USERS = 'https://x.test/api/users'

/* A remote-shaped function recording whether its wire call actually fired. */
function makeRemote(onFetch: () => void) {
    const rawFn = Object.assign(
        () => {
            onFetch()
            return Promise.resolve(new Response('[]'))
        },
        { method: 'GET' as const, url: URL_USERS },
    )
    return Object.assign(() => Promise.resolve([] as string[]), {
        raw: rawFn,
        [REMOTE_FUNCTION]: true,
    })
}

/* A tab store seeded from the SSR cache snapshot, as startClient does. */
function warmStore() {
    const store = createCacheStore()
    store.entries.set(
        keyForRemoteCall('GET', URL_USERS, undefined),
        cacheEntryFromSnapshot({
            key: keyForRemoteCall('GET', URL_USERS, undefined),
            url: URL_USERS,
            method: 'GET',
            status: 200,
            statusText: 'OK',
            headers: [['content-type', 'application/json']],
            body: JSON.stringify(['ada', 'margaret']),
        }),
    )
    return store
}

/*
abide-ui composes with abide's real `abide/shared/cache` by two complementary,
abide-native mechanisms: the keyed SSR cache snapshot warms the tab store (so reads
serve without a fetch), and the positional resume manifest drives no-flash
hydration (a `<template await>` adopts the server DOM from the streamed value,
never calling cache() on the first pass). cache() itself is uniformly async.
*/
describe('cache() + UI await-block hydration', () => {
    test('a warm cache read serves the snapshot value without fetching (async)', async () => {
        let fetched = false
        const getUsers = makeRemote(() => {
            fetched = true
        })
        cacheStoreSlot.resolver = () => warmStore()

        const result = await cache(getUsers)
        expect(fetched).toBe(false) // served from the snapshot, the remote never fired
        expect(result).toEqual(['ada', 'margaret'])
    })

    test('an await(cache()) block hydrates seamlessly from the resume manifest', () => {
        let fetched = false
        const getUsers = makeRemote(() => {
            fetched = true
        })
        /* The store is warm (snapshot) for post-hydration reads; the resume manifest
           carries the streamed value the await block adopts the SSR DOM from. */
        cacheStoreSlot.resolver = () => warmStore()
        RESUME[0] = encodeRefJson({ ok: true, value: ['ada', 'margaret'] })

        const host = document.createElement('div')
        host.innerHTML =
            '<main><!--a--><!--abide:await:0--><ul><!--[--><li>ada</li><!--]--><!--[--><li>margaret</li><!--]--></ul><!--/abide:await:0--></main>'
        const ul = (host.childNodes[0] as unknown as { childNodes: unknown[] })
            .childNodes[2] as unknown as {
            childNodes: { textContent: string }[]
            children: { textContent: string }[]
        }
        const firstRowBefore = ul.children[0] // [.children] skips the per-row markers

        const source = `
            <script>let load = () => cache(getUsers)</script>
            <main>
                {#await load()}
                    <p>loading…</p>
                    {:then users}
                        <ul>{#for u of users by u}<li>{u}</li>{/for}</ul>
                {/await}
            </main>
        `
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
        const body = compileComponent(source)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(target, ...values)
        })

        expect(fetched).toBe(false) // adopted from the manifest — cache never dispatched
        expect(ul.children[0]).toBe(firstRowBefore) // SSR rows adopted in place, no flash
        expect(ul.childNodes.map((row) => row.textContent).filter(Boolean)).toEqual([
            'ada',
            'margaret',
        ])
    })

    test('a resume-hydrated await re-subscribes — cache.invalidate re-runs it', async () => {
        /* Regression: a resume-adopted await read the manifest value, not cache, so it
           subscribed to nothing and a later invalidate was a no-op. The fix reads the
           promise on the first hydrate pass to subscribe (warm for a cache-remote). A
           producer is used here so the cold re-run is observable without rpc metadata. */
        const store = createCacheStore()
        cacheStoreSlot.resolver = () => store
        let runs = 0
        function loadData(): Promise<string> {
            runs += 1
            return Promise.resolve(`v${runs}`)
        }
        RESUME[0] = encodeRefJson({ ok: true, value: 'resumed' })

        const host = document.createElement('div')
        host.innerHTML =
            '<main><!--a--><!--abide:await:0--><span>resumed</span><!--/abide:await:0--></main>'
        const source = `
            <script>let read = () => cache(loadData)</script>
            <main>{#await read()}{:then v}<span>{v}</span>{/await}</main>
        `
        const runtime = {
            doc,
            state,
            computed,
            effect,
            appendText,
            appendStatic,
            on,
            awaitBlock,
            cache,
            loadData,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])
        const body = compileComponent(source)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(target, ...values)
        })
        await Promise.resolve()
        await Promise.resolve()

        const adopted = (host.childNodes[0] as unknown as { childNodes: { textContent: string }[] })
            .childNodes
        expect(adopted.map((n) => n.textContent).filter(Boolean)).toContain('resumed') // adopted, no flash
        const before = runs
        cache.invalidate(loadData)
        await Promise.resolve()
        await Promise.resolve()
        expect(runs).toBeGreaterThan(before) // re-ran after invalidate — it WAS subscribed
    })
})
