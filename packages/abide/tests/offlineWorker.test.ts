// SECTION 45 — THE SERVICE WORKER'S OWN SCRIPT, run in a stand-in for the scope a browser gives it:
// its listeners, a cache storage and a `fetch`, so what is asserted is the bytes the server answers
// with. A browser runs it in `e2e/offline.spec.ts`; the cases here are the ones no navigation there
// reaches — a sign-in, a form, a second build.

import { afterAll, expect, spyOn, test } from 'bun:test'

import { answerWorker } from '#server/answerWorker.ts'
import { buildFiles } from '#server/appBuild.ts'
import { appManifest } from '#server/appManifest.ts'
import type { Manifest } from '#server/manifestOf.ts'
import { OFFLINE_STANDIN } from '#server/OFFLINE_STANDIN.ts'
import { framingOf } from '#shared/framing.ts'
import { MOUNT } from '#shared/mount.ts'
import { PRINCIPAL_HEADER } from '#shared/PRINCIPAL_HEADER.ts'

import { appFixture, buildApp, startApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

const ORIGIN = 'http://worker.test'
const MANIFEST: Manifest = {
    entry: 'entry-a.js',
    stylesheet: 'entry-a.css',
    chunks: { 'index.abide': ['chunk-1.js', 'chunk-2.js'] },
}
const BUNDLE = [
    `${ORIGIN}/__abide/client/entry-a.js`,
    `${ORIGIN}/__abide/client/entry-a.css`,
    `${ORIGIN}/__abide/client/chunk-1.js`,
    `${ORIGIN}/__abide/client/chunk-2.js`,
]

type Event = {
    request?: Request
    data?: unknown
    preloadResponse?: Promise<Response | undefined>
    waitUntil: (work: Promise<unknown>) => void
    respondWith: (answer: Promise<Response>) => void
}

/** 21.22's default, which every `GET` a registered worker sees carries. */
const KEPT = 'private, stale-while-revalidate=604800, stale-if-error=31536000'

/** 21.25's default, which every page a registered worker sees carries. */
const PAGE_KEPT = `private, ${OFFLINE_STANDIN}`

const page = (): Response =>
    new Response('<p>page</p>', {
        headers: { 'content-type': 'text/html', 'cache-control': PAGE_KEPT },
    })

/** An answer `ageSeconds` old by its `date`, under `cacheControl`. */
const aged = (body: string, cacheControl: string, ageSeconds = 0): Response =>
    new Response(body, {
        headers: {
            'content-type': 'text/plain',
            'cache-control': cacheControl,
            date: new Date(Date.now() - ageSeconds * 1000).toUTCString(),
        },
    })

/** The message the router posts the worker once a navigation reaches `path` (45.24). */
const reachedAt = (path: string) => ({ data: { reached: `${ORIGIN}${path}` } })

/**
 * A top-level navigation's request, as a browser hands the worker one: Bun's `Request` takes the
 * `navigate` mode from an init, and has no `destination` to take.
 */
function navigation(url: string, init: RequestInit = {}): Request {
    const request = new Request(url, {
        ...init,
        ...({ mode: 'navigate' } as RequestInit),
    })
    Object.defineProperty(request, 'destination', { value: 'document' })
    return request
}

/**
 * The worker `manifest` names — or the removing one, for none — evaluated in a scope of its own,
 * over `stores`: the cache storage, which a second build's worker shares with the first's.
 */
async function worker(
    manifest: Manifest | undefined,
    answer: (request: Request) => Response | Promise<Response> = page,
    stores = new Map<string, Map<string, Response>>(),
) {
    const script = await answerWorker(manifest).text()
    const listeners = new Map<string, (event: Event) => void>()
    const fetched: string[] = []
    const scope = {
        unregistered: false,
        preloading: false,
        windows: [] as { url: string; navigated: number }[],
    }
    const keyOf = (request: Request | string): string =>
        typeof request === 'string'
            ? new URL(request, ORIGIN).href
            : request.url
    const fetchIn = async (
        request: Request | string,
        init?: RequestInit,
    ): Promise<Response> => {
        const asked =
            typeof request === 'string'
                ? new Request(keyOf(request), init)
                : request
        fetched.push(`${asked.cache} ${asked.url}`)
        return answer(asked)
    }
    const storeOf = (name: string): Map<string, Response> => {
        let store = stores.get(name)
        if (store === undefined) {
            store = new Map()
            stores.set(name, store)
        }
        return store
    }
    const caches = {
        open: async (name: string) => {
            const store = storeOf(name)
            return {
                put: async (request: Request | string, response: Response) => {
                    store.set(keyOf(request), response)
                },
                match: async (request: Request | string) =>
                    store.get(keyOf(request))?.clone(),
                addAll: async (requests: string[]) => {
                    for (const request of requests)
                        store.set(keyOf(request), await fetchIn(request))
                },
                keys: async () =>
                    [...store.keys()].map((url) => new Request(url)),
                delete: async (request: Request) => store.delete(request.url),
            }
        },
        delete: async (name: string) => stores.delete(name),
        keys: async () => [...stores.keys()],
        // A copy per match, as a browser's cache storage answers: one copy read twice is read once.
        match: async (request: Request, options: { cacheName: string }) =>
            stores.get(options.cacheName)?.get(keyOf(request))?.clone(),
    }
    const self = {
        location: new URL(`${ORIGIN}/__abide/worker.js`),
        addEventListener: (type: string, listener: (event: Event) => void) =>
            listeners.set(type, listener),
        skipWaiting: async () => {},
        clients: {
            claim: async () => {},
            matchAll: async () => scope.windows,
        },
        registration: {
            navigationPreload: {
                enable: async () => {
                    scope.preloading = true
                },
            },
            unregister: async () => {
                scope.unregistered = true
            },
        },
    }
    new Function('self', 'caches', 'fetch', script)(self, caches, fetchIn)

    /** Dispatches one event, and answers what it responded with once all it waits on settles. */
    async function dispatch(
        type: string,
        init: {
            request?: Request
            data?: unknown
            preloadResponse?: Promise<Response | undefined>
        } = {},
        // Told the moment the worker has answered, before what it went on to wait on settles.
        onAnswered?: () => void,
    ): Promise<Response | undefined> {
        const waiting: Promise<unknown>[] = []
        let responded: Promise<Response> | undefined
        listeners.get(type)?.({
            preloadResponse: Promise.resolve(undefined),
            ...init,
            waitUntil: (work) => {
                waiting.push(work)
            },
            respondWith: (answer) => {
                responded = answer
            },
        })
        const response = await responded
        onAnswered?.()
        await Promise.all(waiting)
        return response
    }
    const saved = (name: string): string[] => [...storeOf(name).keys()].sort()
    const navigate = (
        path: string,
        method = 'GET',
        init: RequestInit = {},
        preloadResponse?: Promise<Response | undefined>,
    ) =>
        dispatch('fetch', {
            request: navigation(`${ORIGIN}${path}`, { method, ...init }),
            ...(preloadResponse === undefined ? {} : { preloadResponse }),
        })
    /** An open window at `path`, which the worker may navigate. */
    const opened = (path: string) => {
        const window = {
            url: `${ORIGIN}${path}`,
            navigated: 0,
            navigate: async () => {
                window.navigated++
            },
        }
        scope.windows.push(window)
        return window
    }
    return { dispatch, navigate, opened, saved, fetched, scope, stores }
}

// 45.5, 45.6 — EVERY FILE OF THE BUNDLE SAVED AS IT INSTALLS, and answered from there: no fetch for
// one. THE REVERT: drop the `FILES.has` arm from the worker's `fetch`; the chunk is fetched, 1.
test('the bundle is saved as the worker installs, and answered from what it saved — 45.5, 45.6', async () => {
    const offline = await worker(MANIFEST)
    await offline.dispatch('install')
    expect(offline.saved('abide:bundle')).toEqual([...BUNDLE].sort())
    const before = offline.fetched.length
    const chunk = await offline.dispatch('fetch', {
        request: new Request(`${ORIGIN}/__abide/client/chunk-1.js`),
    })
    expect(chunk).toBeDefined()
    expect(`fetched: ${offline.fetched.length - before}`).toBe('fetched: 0')
})

// 45.3, 45.18 — A HANDLER'S ANSWER AND A PUBLIC FILE, SAVED AS A PAGE IS under 21.22's and 21.23's
// headers, and answered from there once the network is gone; with no copy, a call fails as it would
// with no worker and a page says why. THE REVERT: drop the `keep` from `fromNetwork`; nothing is
// saved.
test("a handler's answer and a public file are saved, and answered offline — 45.3, 45.18", async () => {
    let online = true
    const offline = await worker(MANIFEST, (request) => {
        if (!online) throw new TypeError('Failed to fetch')
        return new URL(request.url).pathname === '/logo.png'
            ? aged('png', 'public, max-age=0, stale-if-error=31536000')
            : aged('saved', KEPT)
    })
    const get = (path: string) =>
        offline.dispatch('fetch', { request: new Request(`${ORIGIN}${path}`) })
    await get('/notes/getNote')
    await get('/logo.png')
    expect(offline.saved('abide:saved')).toEqual([`${ORIGIN}/notes/getNote`])
    expect(offline.saved('abide:shared')).toEqual([`${ORIGIN}/logo.png`])
    online = false
    expect(await (await get('/notes/getNote'))?.text()).toBe('saved')
    expect(await (await get('/logo.png'))?.text()).toBe('png')
    expect((await get('/notes/never'))?.type).toBe('error')
    expect((await offline.navigate('/never'))?.status).toBe(503)
})

// 45.3 — AN ANSWER ITS OWN HEADER SAYS NOT TO STORE IS NOT SAVED, however much it would stand in
// offline. THE REVERT: drop the `no-store` test from `kept`; `/private` is saved.
test('an answer carrying no-store is not saved — 45.3', async () => {
    const offline = await worker(MANIFEST, (request) =>
        new URL(request.url).pathname === '/private'
            ? aged('mine', 'private, no-store, stale-if-error=600')
            : aged('ours', KEPT),
    )
    for (const path of ['/private', '/shared'])
        await offline.dispatch('fetch', {
            request: new Request(`${ORIGIN}${path}`),
        })
    expect(offline.saved('abide:saved')).toEqual([`${ORIGIN}/shared`])
})

// 45.3 — AN ANSWER THE SERVER DID NOT OFFER FOR OFFLINE IS NOT SAVED: one naming no stale-if-error
// is an answer this origin gave for something other than abide — a sign-in proxy's own sign-out page,
// which kept would sign nobody out — while an immutable file, which no copy of goes stale, is. THE
// REVERT: drop the `stale-if-error` test from `kept`; `/signed-out` is saved, and opens from the device.
test('an answer naming no stale-if-error is not saved, an immutable one is — 45.3', async () => {
    const offline = await worker(MANIFEST, (request) => {
        const path = new URL(request.url).pathname
        if (path === '/font.woff2')
            return aged('font', 'public, max-age=31536000, immutable')
        return new Response('<p>signed out</p>', {
            headers: { 'content-type': 'text/html' },
        })
    })
    await offline.navigate('/signed-out')
    await offline.dispatch('fetch', {
        request: new Request(`${ORIGIN}/font.woff2`),
    })
    expect([
        ...offline.saved('abide:saved'),
        ...offline.saved('abide:shared'),
    ]).toEqual([`${ORIGIN}/font.woff2`])
})

// 45.17 — A FRESH COPY IS ANSWERED AND THE NETWORK NOT ASKED. THE REVERT: drop the `life.fresh` arm
// from the worker's `answer`; the second read is fetched, 1.
test('a copy fresh by its max-age is answered without asking the network — 45.17', async () => {
    const offline = await worker(MANIFEST, () =>
        aged('tile', 'private, max-age=60, stale-if-error=600'),
    )
    const get = () =>
        offline.dispatch('fetch', {
            request: new Request(`${ORIGIN}/tile`),
        })
    await get()
    const before = offline.fetched.length
    expect(await (await get())?.text()).toBe('tile')
    expect(`fetched: ${offline.fetched.length - before}`).toBe('fetched: 0')
})

// 45.28 — A PAGE OPENS FROM ITS COPY, AT ONCE, and the navigation asked alongside it is the copy the
// next load opens: the visit after a deploy is the build before, the one after it the new — and with
// the network gone, the last copy saved. THE REVERT: drop the copy arm from the worker's `opened`; the
// first load waits on the network and opens `new build`.
test('a page opens from its copy, and the navigation asked alongside it is the next — 45.28', async () => {
    let build = 'old build'
    let online = true
    const offline = await worker(MANIFEST, () => {
        if (!online) throw new TypeError('Failed to fetch')
        return aged(build, PAGE_KEPT, 60)
    })
    await offline.navigate('/')
    build = 'new build'
    const opened = [await (await offline.navigate('/'))?.text()]
    opened.push(await (await offline.navigate('/'))?.text())
    online = false
    opened.push(await (await offline.navigate('/'))?.text())
    expect(opened).toEqual(['old build', 'new build', 'new build'])
})

// 45.28 — THE COPY IS ANSWERED BEFORE THE NETWORK IS: a signal that takes its time — the phone with
// one bar — opens the page at once, and the copy after it is the network's. THE REVERT: await the
// page asked for behind the copy before answering it, in the worker's `opened`; the order reads
// network, answered.
test('a page opens from its copy before the network answers, and is replaced behind it — 45.28', async () => {
    let body = 'old'
    let slow = false
    const order: string[] = []
    const offline = await worker(MANIFEST, () => {
        if (!slow) return aged(body, PAGE_KEPT, 60)
        return new Promise<Response>((resolve) =>
            setTimeout(() => {
                order.push('network')
                resolve(aged(body, PAGE_KEPT))
            }, 20),
        ) as unknown as Response
    })
    await offline.navigate('/')
    body = 'new'
    slow = true
    const response = await offline.dispatch(
        'fetch',
        { request: navigation(`${ORIGIN}/`) },
        () => order.push('answered'),
    )
    expect(await response?.text()).toBe('old')
    expect(order).toEqual(['answered', 'network'])
    expect(
        await offline.stores.get('abide:saved')?.get(`${ORIGIN}/`)?.text(),
    ).toBe('new')
})

// 45.18 — A STALE COPY WITHIN stale-while-revalidate IS ANSWERED BEFORE THE NETWORK IS, and replaced
// behind it. THE REVERT: drop the `life.revalidate` arm from the worker's `answer`; the read waits on
// the network and answers `new`.
test('a copy stale within stale-while-revalidate is answered at once, and replaced behind it — 45.18', async () => {
    let body = 'old'
    const offline = await worker(MANIFEST, () => aged(body, KEPT, 60))
    const get = () =>
        offline.dispatch('fetch', { request: new Request(`${ORIGIN}/data`) })
    await get()
    body = 'new'
    expect(await (await get())?.text()).toBe('old')
    expect(
        await offline.stores.get('abide:saved')?.get(`${ORIGIN}/data`)?.text(),
    ).toBe('new')
})

// 45.18 — A force-cache CALL IS ANSWERED FROM THE COPY ALONE: the wire asks it so of a first load
// only, and asks the network itself once it reads the copy (16.80, 16.85), so asking behind it here
// was every kept call asked twice. A call asked default still is. THE REVERT: drop the
// `force-cache` test from the worker's `answer`; the force-cache call is asked behind the copy, 1.
test('a force-cache call stale within stale-while-revalidate is answered and not asked behind — 45.18', async () => {
    const offline = await worker(MANIFEST, () => aged('kept', KEPT, 60))
    const call = (cache: RequestCache) =>
        offline.dispatch('fetch', {
            request: new Request(`${ORIGIN}/data`, { cache }),
        })
    await call('default')
    const said: string[] = []
    for (const cache of ['force-cache', 'default'] as const) {
        const before = offline.fetched.length
        const answer = await call(cache)
        said.push(
            `${cache}: ${answer?.headers.has('abide-kept')} ${offline.fetched.length - before}`,
        )
    }
    expect(said).toEqual(['force-cache: true 0', 'default: true 1'])
})

// 45.19 — A COPY STANDS IN FOR A NETWORK GIVING NOTHING ONLY WITHIN ITS stale-if-error, and never
// where must-revalidate says it may not. THE REVERT: answer `saved` in the worker's `answer` catch
// whenever there is one; the week-old copy and the must-revalidate one are both answered.
test('a copy stands in for no network only within its stale-if-error — 45.19', async () => {
    let online = true
    const ages: Record<string, [string, number]> = {
        '/recent': ['private, stale-if-error=600', 60],
        '/old': ['private, stale-if-error=600', 6000],
        '/strict': ['private, must-revalidate, stale-if-error=600', 60],
    }
    const offline = await worker(MANIFEST, (request) => {
        if (!online) throw new TypeError('Failed to fetch')
        const [control, age] = ages[new URL(request.url).pathname] as [
            string,
            number,
        ]
        return aged('kept', control, age)
    })
    const get = (path: string) =>
        offline.dispatch('fetch', { request: new Request(`${ORIGIN}${path}`) })
    for (const path of Object.keys(ages)) await get(path)
    online = false
    const said: string[] = []
    for (const path of Object.keys(ages))
        said.push(`${path}: ${(await get(path))?.type}`)
    expect(said).toEqual(['/recent: default', '/old: error', '/strict: error'])
})

// 45.20 — A REQUEST ASKING PAST EVERY CACHE IS THE NETWORK'S: a refresh offline is refused (and 7.19
// serves what the copy held), never answered with the saved copy as though it were new — and a
// reload, the one a deploy prompts, opens the network's page rather than its copy, which stands in
// only offline. THE REVERT: drop the `bypass` test from the worker's `answer`; the fresh copy is
// answered online without a fetch, and offline the refresh reads `kept`. Dropping `reloading` from
// `opened`, the reload online opens `kept`.
test("a no-cache call and a reload are the network's, a reload offline still the copy — 45.20", async () => {
    let online = true
    let body = 'kept'
    const offline = await worker(MANIFEST, () => {
        if (!online) throw new TypeError('Failed to fetch')
        return aged(body, 'private, max-age=60, stale-if-error=600')
    })
    const refresh = () =>
        offline.dispatch('fetch', {
            request: new Request(`${ORIGIN}/data`, { cache: 'no-cache' }),
        })
    const reload = () => offline.navigate('/', 'GET', { cache: 'no-cache' })
    await offline.dispatch('fetch', { request: new Request(`${ORIGIN}/data`) })
    await offline.navigate('/')
    const before = offline.fetched.length
    await refresh()
    expect(`fetched: ${offline.fetched.length - before}`).toBe('fetched: 1')
    body = 'new build'
    expect(await (await reload())?.text()).toBe('new build')
    online = false
    expect((await refresh())?.type).toBe('error')
    expect(await (await reload())?.text()).toBe('new build')
})

// 45.21 — THE NETWORK IS ASKED PAST THE BROWSER'S OWN CACHE, which keeps the same answers under the
// same headers and would hand a revalidation the copy it means to replace: a call, a page asked for
// behind its copy, and the open windows' pages as the worker activates — a navigation with no copy is
// 45.25's, asked as the browser asked it.
// THE REVERT: pass `request` unchanged to `fetch` in `fromNetwork`; the call is asked `default`.
test('the worker asks the network with no-cache — 45.21', async () => {
    const offline = await worker(MANIFEST, () => aged('kept', KEPT))
    offline.opened('/open')
    await offline.dispatch('activate')
    await offline.dispatch('fetch', { request: new Request(`${ORIGIN}/data`) })
    await offline.navigate('/open')
    expect(offline.fetched).toEqual([
        `no-cache ${ORIGIN}/open`,
        `no-cache ${ORIGIN}/data`,
        `no-cache ${ORIGIN}/open`,
    ])
})

// 45.25 — THE NAVIGATION IS THE BROWSER'S OWN: the preload it asked alongside the worker, which a
// sign-in proxy sees as the page load it is — `sec-fetch-dest: document`, the user's activation, the
// site it came from — where the worker's own fetch of it arrives `empty`, in chromium and webkit both,
// and is answered 401 rather than sent to sign in. Turned on as the worker activates; with no preload,
// the request the browser handed the worker, unchanged. THE REVERT: drop `navigationPreload.enable()`
// from the worker's `activate`; `preloading: false`. Asking `fetch(request)` in place of the preload
// in `opened`, the navigation is the worker's own fetch, `kept`.
test('a navigation is the preload the browser asked, or with none the navigation itself — 45.25', async () => {
    const asked: Request[] = []
    const offline = await worker(MANIFEST, (request) => {
        asked.push(request)
        return aged('kept', PAGE_KEPT)
    })
    await offline.dispatch('activate')
    expect(`preloading: ${offline.scope.preloading}`).toBe('preloading: true')
    const preloaded = await offline.navigate(
        '/',
        'GET',
        {},
        Promise.resolve(aged('preloaded', PAGE_KEPT)),
    )
    expect(await preloaded?.text()).toBe('preloaded')
    expect(`fetched: ${asked.length}`).toBe('fetched: 0')
    const unloaded = navigation(`${ORIGIN}/other`)
    await offline.dispatch('fetch', { request: unloaded })
    expect(asked.length).toBe(1)
    expect(asked[0] === unloaded).toBe(true)
})

// 45.27 — ANOTHER ORIGIN'S REQUEST AND A FRAME'S NAVIGATION ARE THE BROWSER'S: the worker answers
// neither, so an identity provider's page, and a sign-in renewed in a hidden frame, are what the
// browser alone asked for. THE REVERT: drop the `destination` test from the worker's `fetch`; the
// frame's navigation is answered, `/silent`. Dropping the origin test, the other origin's are.
test("another origin's request and a frame's navigation are left to the browser — 45.27", async () => {
    const offline = await worker(MANIFEST, () => aged('kept', KEPT))
    const frame = new Request(`${ORIGIN}/silent`, {
        ...({ mode: 'navigate' } as RequestInit),
    })
    Object.defineProperty(frame, 'destination', { value: 'iframe' })
    const answered: string[] = []
    for (const request of [
        frame,
        navigation('http://idp.test/authorize'),
        new Request('http://idp.test/session'),
        new Request('http://idp.test/__abide/client/entry-a.js'),
    ])
        if ((await offline.dispatch('fetch', { request })) !== undefined)
            answered.push(new URL(request.url).pathname)
    expect(answered).toEqual([])
})

// 45.26 — AN ANSWER THE WORKER DOES NOT SAVE STILL REPLACES THE COPY IT HELD: the session behind a
// sign-in proxy lapses, the page opens from its copy, and the navigation alongside it is answered 401
// — so the load after it goes to the network, where the proxy sends it to sign in, rather than to the
// signed-out copy. A server error leaves the copy standing. THE REVERT: return from `keep` where
// `copy` is `undefined`, as before; the load after the 401 reads `kept` from the copy.
test('a copy answered over by a 401 or a redirect is dropped, and a 5xx leaves it — 45.26', async () => {
    let answering: () => Response = () => aged('kept', PAGE_KEPT)
    const offline = await worker(MANIFEST, () => answering())
    await offline.navigate('/')
    answering = () => new Response('', { status: 503 })
    expect(await (await offline.navigate('/'))?.text()).toBe('kept')
    expect(offline.saved('abide:saved')).toEqual([`${ORIGIN}/`])
    answering = () => new Response('sign in', { status: 401 })
    expect(await (await offline.navigate('/'))?.text()).toBe('kept')
    expect(offline.saved('abide:saved')).toEqual([])
    const reloaded = await offline.navigate('/')
    expect(reloaded?.status).toBe(401)
    expect(await reloaded?.text()).toBe('sign in')
})

// 45.29 — THE WINDOW A DROPPED COPY OPENED IS OPENED AGAIN, by the browser: the proxy's redirect to
// sign in arrives as the navigation alongside the copy, so the reader is sent to sign in on this load
// rather than on a reload nobody knows to make — once, since the copy that would open it again is
// gone. A server error navigates nothing. THE REVERT: drop the `navigate` loop from `revalidated`;
// `navigated: 0` where the redirect is due 1.
test('a window opened from a copy the network now redirects is opened again, once — 45.29', async () => {
    let answering: () => Response = () => aged('kept', PAGE_KEPT)
    const offline = await worker(MANIFEST, () => answering())
    await offline.navigate('/')
    const open = offline.opened('/')
    const elsewhere = offline.opened('/elsewhere')
    answering = () => new Response('', { status: 502 })
    await offline.navigate('/')
    answering = () =>
        new Response(null, {
            status: 302,
            headers: { location: 'http://idp.test/authorize' },
        })
    await offline.navigate('/')
    await offline.navigate('/')
    expect(
        `navigated: ${open.navigated}, elsewhere ${elsewhere.navigated}`,
    ).toBe('navigated: 1, elsewhere 0')
})

// 45.22 — A COPY KEPT SAYS SO, and when the server answered it; the network's answer says nothing. THE
// REVERT: return `saved` in place of `marked(saved)` for a fresh copy in the worker's `answer`; the
// second read carries no `abide-kept`.
test('an answer from a kept copy carries abide-kept with its date — 45.22', async () => {
    const offline = await worker(MANIFEST, () =>
        aged('tile', 'private, max-age=60, stale-if-error=600', 30),
    )
    const get = () =>
        offline.dispatch('fetch', {
            request: new Request(`${ORIGIN}/tile`),
        })
    const fromNetwork = await get()
    const fromKept = await get()
    expect(fromNetwork?.headers.get('abide-kept')).toBeNull()
    expect(fromKept?.headers.get('abide-kept')).toBe(
        fromKept?.headers.get('date') as string,
    )
    expect(await fromKept?.text()).toBe('tile')
})

// 45.23 — A PAGE NO NAVIGATION ASKS FOR IS ASKED FOR AS ONE THE WORKER KEEPS, so the server writes the
// early calls a later open of it starts (41.30): an open window's as the worker activates, a page
// opened from its copy as it is asked for behind it, and an address the router reached. A navigation
// with no copy is the browser's (45.25), a document whose render writes them anyway, and a call is
// asked as it was made. THE REVERT: drop the `KEEP` header from `pageRequest`; the open window's page
// is asked without it.
test('the worker asks for a page no navigation asks for with abide-keep — 45.23', async () => {
    const kept: string[] = []
    const offline = await worker(MANIFEST, (request) => {
        kept.push(
            `${new URL(request.url).pathname} ${request.headers.get('abide-keep')}`,
        )
        return aged('kept', KEPT)
    })
    offline.opened('/open')
    await offline.dispatch('activate')
    await offline.navigate('/')
    await offline.navigate('/')
    await offline.dispatch('message', reachedAt('/reached'))
    await offline.dispatch('fetch', { request: new Request(`${ORIGIN}/data`) })
    expect(kept).toEqual([
        '/open 1',
        '/ null',
        '/ 1',
        '/reached 1',
        '/data null',
    ])
})

// 45.4 — SAVED ONLY FROM A 200 THAT IS NOT A STREAM. THE REVERT: drop the status check from `kept`;
// `/missing` is saved.
test('an answer is saved only where it is a 200 and not a stream — 45.4', async () => {
    const offline = await worker(MANIFEST, (request) => {
        const path = new URL(request.url).pathname
        // Each offered for offline, so what turns one away is its status or its type.
        const headers = { 'cache-control': KEPT }
        if (path === '/missing')
            return new Response('<p>no</p>', {
                status: 404,
                headers: { ...headers, 'content-type': 'text/html' },
            })
        if (path === '/lines')
            return new Response('1\n2\n', {
                headers: { ...headers, 'content-type': 'application/jsonl' },
            })
        if (path === '/data') return Response.json({ a: 'value' }, { headers })
        return new Response('<p>page</p>', {
            headers: { ...headers, 'content-type': 'text/html; charset=utf-8' },
        })
    })
    await offline.navigate('/')
    await offline.navigate('/missing')
    for (const path of ['/data', '/lines'])
        await offline.dispatch('fetch', {
            request: new Request(`${ORIGIN}${path}`),
        })
    expect(offline.saved('abide:saved')).toEqual([
        `${ORIGIN}/`,
        `${ORIGIN}/data`,
    ])
})

// 45.4, 16.32 — THE WORKER'S STREAMED TYPES ARE `framingOf`'s, spelled twice (`answerWorker` says
// why): a type framed in one and missing from the other is a stream with no end, saved. Read off
// `framingOf`'s source, so a type added there is checked without a test naming it. THE REVERT: drop
// `application/x-ndjson` from `STREAMED_TYPES`.
test('every type framingOf frames is one the worker leaves unsaved — 45.4, 16.32', async () => {
    const source = await Bun.file(
        new URL('../src/shared/framing.ts', import.meta.url),
    ).text()
    const body = source.slice(
        source.indexOf('export function framingOf'),
        source.indexOf('\n}\n', source.indexOf('export function framingOf')),
    )
    const script = await answerWorker(MANIFEST).text()
    const streamed = JSON.parse(
        (
            script.match(/const STREAMED = (.*)\n/) as RegExpMatchArray
        )[1] as string,
    ) as string[]
    const said: string[] = []
    for (const [, type] of body.matchAll(/=== '([^']+)'/g))
        said.push(
            `${type}: framed ${framingOf(type) !== null}, unsaved ${streamed.includes(type as string)}`,
        )
    // The scan found framingOf's types, or the check below passes over none.
    expect(said.length).toBeGreaterThanOrEqual(3)
    expect(
        said.filter((line) => !line.endsWith('framed true, unsaved true')),
    ).toEqual([])
})

// 45.4 — AN ANSWER NOT SAVED IS NOT COPIED: a clone nobody reads is a tee holding every chunk of
// the original, which for a stream with no end is the worker's memory. THE REVERT: clone every
// answer in `answer`, as before `kept`; this reads 2.
test('an answer that is not saved is not cloned — 45.4', async () => {
    const offline = await worker(MANIFEST, (request) =>
        new URL(request.url).pathname === '/lines'
            ? new Response('1\n2\n', {
                  headers: { 'content-type': 'application/jsonl' },
              })
            : new Response('no', { status: 404 }),
    )
    const clone = spyOn(Response.prototype, 'clone')
    for (const path of ['/lines', '/missing'])
        await offline.dispatch('fetch', {
            request: new Request(`${ORIGIN}${path}`),
        })
    const cloned = clone.mock.calls.length
    clone.mockRestore()
    expect(cloned).toBe(0)
})

// 45.16 — LEFT TO THE NETWORK: the router asking `middleware` (30.15), which has to fail offline for
// 30.32 to stand; a range; and a stream that never ends. THE REVERT: drop the `NAVIGATION` arm from
// the worker's `fetch`; the router's request is answered.
test('the router, a range and an event stream are left to the network — 45.16', async () => {
    const offline = await worker(MANIFEST)
    const answered: string[] = []
    for (const headers of [
        { 'abide-navigation': '1' },
        { range: 'bytes=0-1' },
        { accept: 'text/event-stream' },
    ])
        if (
            (await offline.dispatch('fetch', {
                request: new Request(`${ORIGIN}/somewhere`, { headers }),
            })) !== undefined
        )
            answered.push(Object.keys(headers)[0] as string)
    expect(answered).toEqual([])
})

// 45.24 — A PAGE THE ROUTER REACHES IS KEPT, so a reload of it with no network opens it rather than
// 45.11's page: no navigation asked for it, so it is asked for as a page kept behind the one opened.
// THE REVERT: drop the `REACHED` arm from the worker's `message`; `/farm`'s page is never asked for,
// and the reload offline answers 503.
test('a page the router reaches is saved, and opens offline — 45.24', async () => {
    let networked = true
    const asked: string[] = []
    const offline = await worker(MANIFEST, (request) => {
        if (!networked) throw new TypeError('offline')
        asked.push(
            `${request.headers.get('abide-keep')} ${request.redirect} ${request.url}`,
        )
        return aged('<p>farm</p>', KEPT)
    })
    await offline.dispatch('message', reachedAt('/farm'))
    expect(asked).toEqual([`1 manual ${ORIGIN}/farm`])
    networked = false
    const reloaded = await offline.navigate('/farm')
    expect(reloaded?.status).toBe(200)
    expect(await reloaded?.text()).toBe('<p>farm</p>')
})

// 45.24 — ONLY WHERE NO COPY WOULD STAND IN: one 45.19 would answer with is refreshed by the page's
// own next load, and asking on every step renders each page twice — but one past its stale-if-error
// is asked for again. THE REVERT: drop the `standsIn` check from `keepReached`; the last step asks
// again, 4. Skipping whatever copy is saved instead, the expired one is never replaced, 1.
test('a page the router reaches is asked for only where no copy would stand in — 45.24', async () => {
    let age = 31536000 + 60
    let pages = 0
    const offline = await worker(MANIFEST, () => {
        pages++
        return aged('<p>farm</p>', KEPT, age)
    })
    await offline.dispatch('message', reachedAt('/farm'))
    await offline.dispatch('message', reachedAt('/farm'))
    age = 60
    await offline.dispatch('message', reachedAt('/farm'))
    await offline.dispatch('message', reachedAt('/farm'))
    expect(pages).toBe(3)
})

// 45.24 — AN ADDRESS OF ANOTHER ORIGIN IS NOT ASKED FOR, whoever posted it. THE REVERT: drop the
// origin check from the worker's `message`; the other origin's page is asked, 1.
test('a reached address of another origin is not asked for — 45.24', async () => {
    let pages = 0
    const offline = await worker(MANIFEST, () => {
        pages++
        return aged('<p>elsewhere</p>', KEPT)
    })
    await offline.dispatch('message', {
        data: { reached: 'http://elsewhere.test/farm' },
    })
    expect(pages).toBe(0)
})

// 45.7 — A COPY ASKED FOR BEFORE A DROP IS NOT SAVED AFTER IT: it was asked under the cookies of then,
// and would hold the caller signed out since. THE REVERT: drop the `since !== drops` arm from `keep`;
// `/account` is saved after the sign-out dropped everything.
test('a page asked for before a sign-out is not saved after it — 45.7', async () => {
    let land = (): void => {}
    const landed = new Promise<void>((resolve) => {
        land = resolve
    })
    let ask = (): void => {}
    const asked = new Promise<void>((resolve) => {
        ask = resolve
    })
    const offline = await worker(MANIFEST, () => {
        ask()
        return landed.then(() => aged('<p>account</p>', KEPT))
    })
    const reaching = offline.dispatch('message', reachedAt('/account'))
    await asked
    await offline.dispatch('message', { data: 'rotated' })
    land()
    await reaching
    expect(offline.saved('abide:saved')).toEqual([])
})

// 45.7, 45.13, 45.24 — A PAGE KEPT BEHIND THE ONE OPENED drops the pages saved where its answer carries
// abide-principal, as a navigation's does. THE REVERT: drop the `rotated` arm from `keep`; `/old` is
// still saved beside `/account`.
test('a reached page answered with abide-principal drops the pages saved before it — 45.7, 45.24', async () => {
    let rotating = false
    const offline = await worker(
        MANIFEST,
        () =>
            new Response('<p>page</p>', {
                headers: {
                    'content-type': 'text/html',
                    'cache-control': PAGE_KEPT,
                    ...(rotating ? { [PRINCIPAL_HEADER]: 'set' } : {}),
                },
            }),
    )
    await offline.navigate('/old')
    rotating = true
    await offline.dispatch('message', reachedAt('/account'))
    expect(offline.saved('abide:saved')).toEqual([`${ORIGIN}/account`])
})

// 45.7 — A SIGN-IN OR A SIGN-OUT DROPS EVERY PAGE SAVED, whichever way the worker hears of it. THE
// REVERT: drop the `rotated` arm from `page`; `/old` is still saved beside `/signed-in`.
test('a page answered with abide-principal drops the pages saved before it — 45.7', async () => {
    let rotating = false
    const offline = await worker(
        MANIFEST,
        () =>
            new Response('<p>page</p>', {
                headers: {
                    'content-type': 'text/html',
                    'cache-control': PAGE_KEPT,
                    ...(rotating ? { [PRINCIPAL_HEADER]: 'set' } : {}),
                },
            }),
    )
    await offline.navigate('/old')
    rotating = true
    await offline.navigate('/signed-in')
    expect(offline.saved('abide:saved')).toEqual([`${ORIGIN}/signed-in`])
})

// 45.7 — THE TAB'S OWN WORD, for a sign-in a call answered rather than a page. THE REVERT: drop the
// worker's `message` listener; `/old` is still saved.
test("a tab's principal changing drops the pages saved — 45.7", async () => {
    const offline = await worker(MANIFEST)
    await offline.navigate('/old')
    await offline.dispatch('message', { data: 'rotated' })
    expect(offline.saved('abide:saved')).toEqual([])
})

// 45.7 — A FORM SUBMITTED, which may have changed anything a saved page shows, or who is signed in.
// THE REVERT: drop the `else` arm from the worker's navigation; `/old` is still saved.
test('a form submitted drops the pages saved — 45.7', async () => {
    const offline = await worker(MANIFEST)
    await offline.navigate('/old')
    await offline.navigate('/signIn', 'POST')
    expect(offline.saved('abide:saved')).toEqual([])
})

// 45.7 — WHAT ANY CALLER MAY BE ANSWERED OUTLIVES EVERY DROP: a sign-in, a tab's principal changing
// and a form submitted each drop the pages, and the font a page draws with stays, asked before a
// drop or not, to answer offline. THE REVERT: save every copy to `SAVED` in `keep`; nothing is left
// in `abide:shared` and the font offline is an error.
test('a public answer is not dropped with the pages saved — 45.7', async () => {
    let online = true
    let rotating = false
    const offline = await worker(MANIFEST, (request) => {
        if (!online) throw new TypeError('Failed to fetch')
        if (new URL(request.url).pathname === '/font.woff2')
            return aged('font', 'public, max-age=0, stale-if-error=31536000')
        return new Response('<p>page</p>', {
            headers: {
                'content-type': 'text/html',
                'cache-control': PAGE_KEPT,
                ...(rotating ? { [PRINCIPAL_HEADER]: 'set' } : {}),
            },
        })
    })
    const font = () =>
        offline.dispatch('fetch', {
            request: new Request(`${ORIGIN}/font.woff2`),
        })
    await font()
    rotating = true
    await offline.navigate('/signed-in')
    await offline.dispatch('message', { data: 'rotated' })
    await offline.navigate('/signIn', 'POST')
    expect(offline.saved('abide:saved')).toEqual([])
    expect(offline.saved('abide:shared')).toEqual([`${ORIGIN}/font.woff2`])
    online = false
    expect(await (await font())?.text()).toBe('font')
})

// 45.7 — AN ADDRESS WHOSE ANSWER WENT PUBLIC LEAVES NO PRIVATE COPY to be read ahead of the public one.
// THE REVERT: drop the `delete` from `keep`; the copy answered offline is the first, `mine`.
test('an answer saved to one cache drops its address from the other — 45.7', async () => {
    let online = true
    let answers = 0
    const offline = await worker(MANIFEST, () => {
        if (!online) throw new TypeError('Failed to fetch')
        answers++
        return answers === 1
            ? aged('mine', KEPT)
            : aged('ours', 'public, max-age=0, stale-if-error=31536000')
    })
    const get = () =>
        offline.dispatch('fetch', {
            request: new Request(`${ORIGIN}/notes/getNote`),
        })
    await get()
    await get()
    online = false
    expect(await (await get())?.text()).toBe('ours')
})

// 45.8, 45.13 — A NEW BUILD DROPS THE PAGES AND THE FILES THE OLD ONE SAVED, and saves the pages open
// as it takes over. THE REVERT: drop the prune from the worker's `activate`; the first build's entry
// is still saved.
test("a new build's worker drops what the last one saved, and saves the open pages — 45.8, 45.13", async () => {
    const first = await worker(MANIFEST)
    await first.dispatch('install')
    await first.navigate('/old')
    // A cache an earlier worker named otherwise.
    first.stores.set('abide:pages', new Map())
    const next = await worker(
        { ...MANIFEST, entry: 'entry-b.js' },
        page,
        first.stores,
    )
    next.opened('/open')
    await next.dispatch('install')
    await next.dispatch('activate')
    expect(next.saved('abide:saved')).toEqual([`${ORIGIN}/open`])
    expect(next.stores.has('abide:pages')).toBe(false)
    expect(next.saved('abide:bundle')).toEqual(
        [...BUNDLE.slice(1), `${ORIGIN}/__abide/client/entry-b.js`].sort(),
    )
})

// 45.8 — THE BUILD BEFORE'S FILES OUTLIVE ITS PAGES BY ONE BUILD: the new worker takes over at once,
// and a page of the build before still open — or opened from its copy while the new one installed —
// loads the stylesheet it names from the device, after the server has stopped serving it. The build
// after drops them. THE REVERT: delete the files the new build does not name in the worker's
// `activate`, as before; the first build's stylesheet is fetched, and the server's 404 is answered.
test("the build before's files are answered until the build after it activates — 45.8", async () => {
    const serving = new Set(BUNDLE)
    const answering = (request: Request): Response =>
        serving.has(request.url)
            ? aged('bytes', 'public, max-age=31536000, immutable')
            : new Response('', { status: 404 })
    const first = await worker(MANIFEST, answering)
    await first.dispatch('install')
    await first.dispatch('activate')
    const deploy = async (stylesheet: string) => {
        serving.clear()
        serving.add(`${ORIGIN}/__abide/client/${stylesheet}`)
        const next = await worker(
            { ...MANIFEST, stylesheet, chunks: {} },
            answering,
            first.stores,
        )
        await next.dispatch('install')
        await next.dispatch('activate')
        return next
    }
    const stylesheetA = () =>
        new Request(`${ORIGIN}/__abide/client/entry-a.css`)
    const second = await deploy('entry-b.css')
    const answered = [
        (await second.dispatch('fetch', { request: stylesheetA() }))?.status,
    ]
    const third = await deploy('entry-c.css')
    answered.push(
        (await third.dispatch('fetch', { request: stylesheetA() }))?.status,
    )
    expect(answered).toEqual([200, 404])
})

// 45.4, 45.13 — AN OPEN PAGE THAT NOW REDIRECTS IS NOT SAVED as the worker activates: a redirect followed
// would save where it led — a sign-in page, for a caller signed out since — under the address it was
// asked at, which a navigation there offline would then open. Asked as a navigation's page is, its
// redirect is the page's to follow, and no 200. THE REVERT: drop `redirect: 'manual'` from the
// worker's `pageRequest`; `/open` is saved, holding the sign-in page.
test('an open page that now redirects is not saved as the worker activates — 45.13, 45.4', async () => {
    const redirecting = (request: Request): Response =>
        request.redirect === 'manual'
            ? new Response(null, {
                  status: 302,
                  headers: { location: `${ORIGIN}/login` },
              })
            : new Response('<p>sign in</p>', {
                  headers: { 'content-type': 'text/html' },
              })
    const offline = await worker(MANIFEST, redirecting)
    offline.opened('/open')
    await offline.dispatch('install')
    await offline.dispatch('activate')
    expect(offline.saved('abide:saved')).toEqual([])
})

// 45.9 — THE WORKER THAT REMOVES ITSELF drops both stores and unregisters. THE REVERT: drop the
// `unregister` from it; this reads `unregistered: false`.
test('the removing worker drops what was saved and unregisters — 45.9', async () => {
    const removing = await worker(undefined)
    removing.stores.set('abide:saved', new Map())
    await removing.dispatch('activate')
    expect([...removing.stores.keys()]).toEqual([])
    expect(`unregistered: ${removing.scope.unregistered}`).toBe(
        'unregistered: true',
    )
})

// 45.2 — ALLOWED THE MOUNT'S WHOLE SCOPE, under a sub-path as at the root. THE REVERT: leave
// `service-worker-allowed` off `answerWorker`; this reads `null`.
test("the worker is allowed the whole of the app's mount — 45.2", () => {
    const standing = MOUNT.current
    try {
        expect(
            answerWorker(undefined).headers.get('service-worker-allowed'),
        ).toBe('/')
        MOUNT.current = () => '/docs'
        expect(
            answerWorker(undefined).headers.get('service-worker-allowed'),
        ).toBe('/docs/')
    } finally {
        MOUNT.current = standing
    }
})

// 45.1, 45.9, 45.14 — WHAT `abide start` ANSWERS, by the setting it was started under: the tag the
// browser registers by and the worker saving this build only where `ABIDE_OFFLINE` turns it on, and
// otherwise neither of them and the removing worker — unset and unreadable included. THE REVERT:
// have `settingOn` answer `true` for a setting unset or unreadable, as before; `undefined` and `yes`
// read `tag true`.
test('ABIDE_OFFLINE decides the worker abide start answers, whether a page registers it and links a manifest — 45.1, 45.9, 45.14, 45.15', async () => {
    const app = appFixture({
        'layout.abide':
            '<html lang="en"><head></head><body><slot/></body></html>',
        'index.abide': '<main>home</main>',
    })
    // A PNG's signature and header, drawn 192 by 192: all the manifest reads of it.
    const icon = new Uint8Array(33)
    icon.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
    icon.set(new TextEncoder().encode('IHDR'), 12)
    new DataView(icon.buffer).setUint32(16, 192)
    new DataView(icon.buffer).setUint32(20, 192)
    await Bun.write(`${app}/public/icon.png`, icon)
    const built = await buildApp(app)
    expect(built.exitCode).toBe(0)
    let registers = false
    for (const name of new Bun.Glob('*.js').scanSync(
        buildFiles(`${app}/.abide`).client,
    ))
        if (
            (
                await Bun.file(
                    `${buildFiles(`${app}/.abide`).client}/${name}`,
                ).text()
            ).includes('did not register')
        )
            registers = true
    expect(`registers: ${registers}`).toBe('registers: true')
    const said: string[] = []
    for (const setting of ['0', 'FALSE', 'yes', undefined, '1', 'TRUE']) {
        const { base, stop } = await startApp(app, {
            ...process.env,
            ABIDE_OFFLINE: setting,
        })
        try {
            const script = await (
                await fetch(`${base}/__abide/worker.js`)
            ).text()
            const page = await (await fetch(`${base}/`)).text()
            const manifest = await fetch(`${base}/__abide/manifest.webmanifest`)
            const sizes = manifest.ok
                ? ((await manifest.json()) as { icons: { sizes: string }[] })
                      .icons[0]?.sizes
                : manifest.status
            said.push(
                `${setting}: tag ${page.includes('name="abide-offline"')}, saving ${script.includes('const FILES')}, removing ${script.includes('unregister')}, linked ${page.includes('rel="manifest"')}, manifest ${sizes}`,
            )
        } finally {
            stop()
        }
    }
    expect(said).toEqual([
        '0: tag false, saving false, removing true, linked false, manifest 404',
        'FALSE: tag false, saving false, removing true, linked false, manifest 404',
        'yes: tag false, saving false, removing true, linked false, manifest 404',
        'undefined: tag false, saving false, removing true, linked false, manifest 404',
        '1: tag true, saving true, removing false, linked true, manifest 192x192',
        'TRUE: tag true, saving true, removing false, linked true, manifest 192x192',
    ])
}, 60_000)

// 21.22, 21.23, 21.25, 21.11, 21.17 — WHERE THE WORKER IS REGISTERED, WHAT IT MAY KEEP SAYS SO in its
// own header, for the worker and the browser's cache alike: a value a `GET` answered served stale for a
// week while asked again, a page and a public file asked on every load — a deploy is what the next
// visit opens — and all three for a year where the network fails, a `ttl`'s
// `max-age` ahead of the same windows, and none of it for a refusal, a stream or a mutation. With
// the worker off, every answer is as it was. THE REVERT: drop the `kept` write in `answerOutcome`; `/getNote` keeps `no-store` with the worker on.
test('a GET defaults to stale-while-revalidate, and a page and a public file to stale-if-error alone, where the worker is registered — 21.22, 21.23, 21.25, 21.11, 21.17', async () => {
    const IMPORTS = `import { GET, POST, response } from '@abide/abide/server'\nimport { refuse } from '@abide/abide'\n\n`
    const app = appFixture({
        'layout.abide':
            '<html lang="en"><head></head><body><slot/></body></html>',
        'index.abide': '<main>home</main>',
        'getNote.handler.ts': `${IMPORTS}export default GET(() => ({ note: 'kept' }))\n`,
        'getClock.handler.ts': `${IMPORTS}export default GET(() => ({ at: 1 }), { global: true, ttl: 90_500 })\n`,
        'getForever.handler.ts': `${IMPORTS}export default GET(() => ({ at: 1 }), { global: true, ttl: Infinity })\n`,
        'getMissing.handler.ts': `${IMPORTS}export default GET(() => refuse(404))\n`,
        'getLines.handler.ts': `${IMPORTS}export default GET(() => response.jsonl([1, 2]))\n`,
        'addNote.handler.ts': `${IMPORTS}export default POST(() => ({ added: true }))\n`,
    })
    await Bun.write(`${app}/public/logo.txt`, 'logo')
    const built = await buildApp(app)
    expect(built.exitCode).toBe(0)
    const said: string[] = []
    for (const setting of [undefined, '1']) {
        const { base, stop } = await startApp(app, {
            ...process.env,
            ABIDE_OFFLINE: setting,
        })
        try {
            for (const [path, method] of [
                ['/', 'GET'],
                ['/getNote', 'GET'],
                ['/getClock', 'GET'],
                ['/getForever', 'GET'],
                ['/getMissing', 'GET'],
                ['/getLines', 'GET'],
                ['/addNote', 'POST'],
                ['/logo.txt', 'GET'],
            ] as const) {
                const answer = await fetch(`${base}${path}`, {
                    method,
                    headers: { 'content-type': 'application/json' },
                    ...(method === 'POST' ? { body: '{}' } : {}),
                })
                await answer.arrayBuffer()
                said.push(
                    `${setting} ${path}: ${answer.headers.get('cache-control')?.replace(/max-age=(?:90|89)\b/, 'max-age=<ttl>')}`,
                )
            }
        } finally {
            stop()
        }
    }
    const KEPT = 'stale-while-revalidate=604800, stale-if-error=31536000'
    expect(said).toEqual([
        'undefined /: private, no-store',
        'undefined /getNote: private, no-store',
        'undefined /getClock: private, max-age=<ttl>',
        'undefined /getForever: private, no-store',
        'undefined /getMissing: private, no-store',
        'undefined /getLines: private, no-store',
        'undefined /addNote: private, no-store',
        'undefined /logo.txt: public, max-age=0, must-revalidate',
        '1 /: private, max-age=0, stale-if-error=31536000',
        `1 /getNote: private, ${KEPT}`,
        `1 /getClock: private, max-age=<ttl>, ${KEPT}`,
        `1 /getForever: private, ${KEPT}`,
        '1 /getMissing: private, no-store',
        '1 /getLines: private, no-store',
        '1 /addNote: private, no-store',
        '1 /logo.txt: public, max-age=0, stale-if-error=31536000',
    ])
}, 60_000)

// 45.15 — A FILE CUT OFF BEFORE ITS SIZE is no PNG to link, rather than a boot that throws. THE
// REVERT: drop the length check from `appManifest`; reading the height throws a `RangeError`.
test('an icon.png cut off before its header ends links no manifest — 45.15', async () => {
    const dir = temporaryModule({})
    const icon = new Uint8Array(20)
    icon.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await Bun.write(`${dir}/icon.png`, icon)
    let manifest: unknown = 'threw'
    try {
        manifest = await appManifest(`${dir}/icon.png`)
    } catch {}
    expect(manifest).toBeUndefined()
})
