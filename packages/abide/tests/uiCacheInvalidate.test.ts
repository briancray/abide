import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})
afterEach(() => {
    cacheStoreSlot.resolver = undefined
    cacheStoreSlot.fallback = undefined
})

/* Lets pending cache promises + their swaps settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/*
A `cache()` read inside a `<template await>` is a tracked abide-ui dependency: the
cache store's createSubscriber subscribes the key to the
await block's effect, so cache.invalidate() of that key re-runs the block — re-
fetching and swapping the resolved branch in place. No bridge.
*/
describe('cache.invalidate() re-runs an await block', () => {
    test('re-fetches and swaps when the read’s key is invalidated', async () => {
        let calls = 0
        async function loadUsers() {
            calls += 1
            return [`user${calls}`]
        }
        const store = createCacheStore()
        cacheStoreSlot.resolver = () => store

        const source = `
            <script>let load = cache(loadUsers)</script>
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
            computed,
            effect,
            appendText,
            appendStatic,
            on,
            each,
            awaitBlock,
            cache,
            loadUsers,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])
        const host = document.createElement('div')
        new Function('host', ...names, compileComponent(source))(host, ...values)

        await flush()
        expect(calls).toBe(1)
        expect(host.textContent).toContain('user1')

        // invalidate the producer's key → the await block re-runs and swaps
        cache.invalidate(loadUsers)
        await flush()
        expect(calls).toBe(2)
        expect(host.textContent).toContain('user2')
        expect(host.textContent).not.toContain('user1')
    })
})
