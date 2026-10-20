// SECTION 45 — THE SERVICE WORKER'S OWN SCRIPT, run in a stand-in for the scope a browser gives it:
// its listeners, a cache storage and a `fetch`, so what is asserted is the bytes the server answers
// with. A browser runs it in `e2e/offline.spec.ts`; the cases here are the ones no navigation there
// reaches — a sign-in, a form, a second build.

import { afterAll, expect, spyOn, test } from 'bun:test'
import { answerWorker } from '#server/answerWorker.ts'
import { appManifest } from '#server/appManifest.ts'
import type { Manifest } from '#server/manifestOf.ts'
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

const page = (): Response =>
    new Response('<p>page</p>', { headers: { 'content-type': 'text/html' } })

/**
 * The worker `manifest` names — or the removing one, for none — evaluated in a scope of its own,
 * over `stores`: the cache storage, which a second build's worker shares with the first's.
 */
async function worker(
    manifest: Manifest | undefined,
    answer: (request: Request) => Response = page,
    stores = new Map<string, Map<string, Response>>(),
) {
    const script = await answerWorker(manifest).text()
    const listeners = new Map<string, (event: Event) => void>()
    const fetched: string[] = []
    const scope = { unregistered: false, windows: [] as { url: string }[] }
    const keyOf = (request: Request | string): string =>
        typeof request === 'string'
            ? new URL(request, ORIGIN).href
            : request.url
    const fetchIn = async (request: Request | string): Promise<Response> => {
        const asked =
            typeof request === 'string' ? new Request(keyOf(request)) : request
        fetched.push(asked.url)
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
        match: async (request: Request, options: { cacheName: string }) =>
            stores.get(options.cacheName)?.get(keyOf(request)),
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
            navigationPreload: undefined,
            unregister: async () => {
                scope.unregistered = true
            },
        },
    }
    new Function('self', 'caches', 'fetch', script)(self, caches, fetchIn)

    /** Dispatches one event, and answers what it responded with once all it waits on settles. */
    async function dispatch(
        type: string,
        init: { request?: Request; data?: unknown } = {},
    ): Promise<Response | undefined> {
        const waiting: Promise<unknown>[] = []
        let responded: Promise<Response> | undefined
        listeners.get(type)?.({
            ...init,
            preloadResponse: Promise.resolve(undefined),
            waitUntil: (work) => {
                waiting.push(work)
            },
            respondWith: (answer) => {
                responded = answer
            },
        })
        const response = await responded
        await Promise.all(waiting)
        return response
    }
    const saved = (name: string): string[] => [...storeOf(name).keys()].sort()
    const navigate = (path: string, method = 'GET') =>
        dispatch('fetch', {
            request: new Request(`${ORIGIN}${path}`, {
                method,
                ...({ mode: 'navigate' } as RequestInit),
            }),
        })
    return { dispatch, navigate, saved, fetched, scope, stores }
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

// 45.3 — A HANDLER'S ANSWER AND A PUBLIC FILE, SAVED AS A PAGE IS, and answered from there once the
// network is gone; with no copy, a call fails as it would with no worker and a page says why. THE
// REVERT: answer `Response.error()` in place of `saved` in the worker's `answer`; the read offline
// is refused where the saved note is due.
test("a handler's answer and a public file are saved, and answered offline — 45.3", async () => {
    let online = true
    const offline = await worker(MANIFEST, (request) => {
        if (!online) throw new TypeError('Failed to fetch')
        return new URL(request.url).pathname === '/logo.png'
            ? new Response('png', { headers: { 'content-type': 'image/png' } })
            : Response.json({ note: 'saved' })
    })
    const get = (path: string) =>
        offline.dispatch('fetch', { request: new Request(`${ORIGIN}${path}`) })
    await get('/notes/getNote')
    await get('/logo.png')
    expect(offline.saved('abide:saved')).toEqual([
        `${ORIGIN}/logo.png`,
        `${ORIGIN}/notes/getNote`,
    ])
    online = false
    expect(await (await get('/notes/getNote'))?.json()).toEqual({
        note: 'saved',
    })
    expect((await get('/notes/never'))?.type).toBe('error')
    expect((await offline.navigate('/never'))?.status).toBe(503)
})

// 45.4 — SAVED ONLY FROM A 200 THAT IS NOT A STREAM. THE REVERT: drop the status check from `kept`;
// `/missing` is saved.
test('an answer is saved only where it is a 200 and not a stream — 45.4', async () => {
    const offline = await worker(MANIFEST, (request) => {
        const path = new URL(request.url).pathname
        if (path === '/missing')
            return new Response('<p>no</p>', {
                status: 404,
                headers: { 'content-type': 'text/html' },
            })
        if (path === '/lines')
            return new Response('1\n2\n', {
                headers: { 'content-type': 'application/jsonl' },
            })
        if (path === '/data') return Response.json({ a: 'value' })
        return new Response('<p>page</p>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
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
    for (const [, type] of body.matchAll(/startsWith\('([^']+)'\)/g))
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
    next.scope.windows.push({ url: `${ORIGIN}/open` })
    await next.dispatch('install')
    await next.dispatch('activate')
    expect(next.saved('abide:saved')).toEqual([`${ORIGIN}/open`])
    expect(next.stores.has('abide:pages')).toBe(false)
    expect(next.saved('abide:bundle')).toEqual(
        [...BUNDLE.slice(1), `${ORIGIN}/__abide/client/entry-b.js`].sort(),
    )
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
// browser registers by and the worker saving this build unless `ABIDE_OFFLINE` is off, neither of
// them and the removing worker where it is. THE REVERT: write the tag whatever `client.offline` is,
// in `appSources`; `0` and `FALSE` read `tag true`.
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
    for (const name of new Bun.Glob('*.js').scanSync(`${app}/.abide/client`))
        if (
            (await Bun.file(`${app}/.abide/client/${name}`).text()).includes(
                'did not register',
            )
        )
            registers = true
    expect(`registers: ${registers}`).toBe('registers: true')
    const said: string[] = []
    for (const setting of ['0', 'FALSE', 'yes', undefined]) {
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
        'yes: tag true, saving true, removing false, linked true, manifest 192x192',
        'undefined: tag true, saving true, removing false, linked true, manifest 192x192',
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
