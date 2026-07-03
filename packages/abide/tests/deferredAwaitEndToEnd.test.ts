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
import { DEFER_MIN_ARRAY_LENGTH } from '../src/lib/shared/DEFER_MIN_ARRAY_LENGTH.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import type { CacheSnapshotEntry } from '../src/lib/shared/types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { deferResume } from '../src/lib/ui/deferResume.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { DeferMarker, ResumeEntry } from '../src/lib/ui/runtime/RESUME.ts'
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

/* A length-controllable read for exercising the defer size gate directly. */
let sizedLength = 10
const getSized = defineRpc('GET', '/rpc/sized-users', () =>
    json(Array.from({ length: sizedLength }, (_, i) => `u${i}`)),
)

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

const RUNTIME = {
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

/* Server-render SOURCE inside a request scope; return the SSR html, resume manifest, and the
   streamed (lazy) cache snapshot — the three things startClient seeds a deferred block from. */
async function renderOnServer(): Promise<{
    html: string
    resume: SsrRender['resume']
    streamed: CacheSnapshotEntry[]
}> {
    let out = { html: '', resume: {} as SsrRender['resume'], streamed: [] as CacheSnapshotEntry[] }
    await runWithRequestScope(
        new Request('https://test.local/data'),
        { logRequests: false },
        async () => {
            const ssr = (await new Function(
                'state',
                'computed',
                'effect',
                'cache',
                'getUsers',
                compileSSR(SOURCE),
            )(state, computed, effect, cache, getUsers)) as SsrRender
            const store = requestContext.getStore()?.cache as CacheStore
            out = {
                html: ssr.html,
                resume: ssr.resume,
                streamed: await serializeCacheSnapshot(store),
            }
            return json(null)
        },
    )
    return out
}

/* Seed a fresh client store + resume manifest from a server render (as startClient would) and
   hydrate the markup — the client half both tests share up to the boot-inert assertion. */
function bootClient(rendered: {
    html: string
    resume: SsrRender['resume']
    streamed: CacheSnapshotEntry[]
}): {
    host: HTMLElement
    clientStore: CacheStore
} {
    const clientStore = createCacheStore()
    for (const entry of rendered.streamed) {
        clientStore.entries.set(entry.key, cacheEntryFromSnapshot(entry))
    }
    cacheStoreSlot.resolver = () => clientStore
    RESUME[0] = tryEncodeResume(rendered.resume[0] as never, 0) as string

    const host = document.createElement('div')
    host.innerHTML = rendered.html
    const names = Object.keys(RUNTIME)
    const values = names.map((n) => RUNTIME[n as keyof typeof RUNTIME])
    const body = compileComponent(SOURCE)
    hydrate(host, (target) => {
        new Function('host', ...names, body)(target, ...values)
    })
    return { host, clientStore }
}

describe('blocking {#await … then} — full server→client loop, deferred', () => {
    test('resume ships {defer,key} + lazy body; hydrates inert with no boot decode; re-reads on invalidate', async () => {
        const rendered = await renderOnServer()

        // Resume is the KEY marker, not the value; the body ships once, flagged lazy.
        expect(rendered.resume[0]).toEqual({ defer: true, key: KEY })
        expect(rendered.streamed).toHaveLength(1)
        expect(rendered.streamed[0]?.key).toBe(KEY)
        expect(rendered.streamed[0]?.lazy).toBe(true)
        expect(handlerCalls).toBe(1) // dispatched once, on the server
        // SSR HTML carries the values as text (that's the display, and it stays).
        expect(rendered.html).toContain('user-v1-0')

        try {
            const { host, clientStore } = bootClient(rendered)
            expect(clientStore.entries.get(KEY)?.value).toBeUndefined() // lazy — not decoded at seed

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

    /* The wake half: with NO invalidate, the inert branch materializes itself in the first idle
       gap. It reads WARM — decoding the lazily-seeded body, not refetching (handlerCalls stays 1,
       content stays v1) — but the branch is now live (its cache entry is decoded and its inner
       bindings have effects). This is what makes auto-defer safe: inert is a boot-frame state,
       gone before a human acts, so a deferred grid is interactive, not frozen. */
    test('materializes live on idle, warm — no invalidate, no refetch', async () => {
        const rendered = await renderOnServer()
        try {
            const { host, clientStore } = bootClient(rendered)
            // Boot: inert, lazy body still undecoded.
            expect(clientStore.entries.get(KEY)?.value).toBeUndefined()
            expect(handlerCalls).toBe(1)

            // One idle gap later, no invalidate: the block wakes and materializes from the warm body.
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(handlerCalls).toBe(1) // WARM — the server was not hit again
            expect(clientStore.entries.get(KEY)?.value).toBeDefined() // decoded by the wake
            expect(host.textContent).toContain('user-v1-0') // same value, now live
        } finally {
            cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
        }
    })
})

/* The defer decision is size-gated: only a genuinely large array is worth shipping inert. A
   modest grid inlines its value and hydrates eagerly — interactive from the first frame, never
   inert — which is what keeps a small searchable list from freezing (the reported gap, fixed at
   the source rather than only papered over by idle-wake). */
describe('deferResume size gate', () => {
    test('a small array inlines eagerly; a large one defers', async () => {
        /* runWithRequestScope's callback must return a Response, so capture the resume values
           through outer bindings and return json(null) — same shape as the loop test above. */
        let small!: ResumeEntry | DeferMarker
        let large!: ResumeEntry | DeferMarker
        await runWithRequestScope(
            new Request('https://test.local/sized'),
            { logRequests: false },
            async () => {
                const load = cache(getSized)

                sizedLength = DEFER_MIN_ARRAY_LENGTH - 1
                const smallPromise = load()
                small = deferResume(smallPromise, await smallPromise)

                /* Same key would dedupe onto the small entry — invalidate so the large read
                   dispatches fresh and lands its own settled entry. */
                cache.invalidate(getSized)
                sizedLength = DEFER_MIN_ARRAY_LENGTH + 1
                const largePromise = load()
                large = deferResume(largePromise, await largePromise)

                return json(null)
            },
        )

        // Below the threshold: the value ships inline, no defer marker, no inert phase.
        expect(small).toMatchObject({ ok: true })
        expect('defer' in small).toBe(false)
        // Above it: only the key ships; the block hydrates inert and wakes on idle.
        expect(large).toMatchObject({ defer: true })
    })
})
