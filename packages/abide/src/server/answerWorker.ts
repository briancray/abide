// SECTION 45 — THE SERVICE WORKER, written by the server rather than bundled: what it saves is the
// build's own file list, which the server holds (38.5), and a script whose bytes change with the
// build is how a browser learns there is a new one to install.
//
// WRITTEN AS TEXT, NOT AS A FUNCTION'S SOURCE: an executable `abide compile` writes carries its code
// as bytecode (38.93), where a function has no source to read back.

import { CLIENT_ADDRESS } from '#shared/ADDRESSES.ts'
import { MOUNT, mounted } from '#shared/mount.ts'
import { NAVIGATION_HEADER } from '#shared/NAVIGATION_HEADER.ts'
import {
    OFFLINE_BUNDLE,
    OFFLINE_CACHE_PREFIX,
    OFFLINE_SAVED,
} from '#shared/OFFLINE_CACHES.ts'
import { PRINCIPAL_HEADER } from '#shared/PRINCIPAL_HEADER.ts'
import type { Manifest } from './manifestOf.ts'

// What `framingOf` reads as a framed stream (16.32), and a binary's bytes (16.34), which may be one —
// spelled again as a list because `framingOf`, in every page's client closure, reads them as branches.
const STREAMED_TYPES = [
    'text/event-stream',
    'application/jsonl',
    'application/x-ndjson',
    'application/octet-stream',
]

const CACHES = `const OURS = ${JSON.stringify(OFFLINE_CACHE_PREFIX)}
const SAVED = ${JSON.stringify(OFFLINE_SAVED)}
const BUNDLE = ${JSON.stringify(OFFLINE_BUNDLE)}

async function dropOurs(keeping) {
    for (const name of await caches.keys())
        if (name.startsWith(OURS) && name !== keeping) await caches.delete(name)
}
`

// 45.3 through 45.8, and 45.13.
const SAVING = `
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(BUNDLE)
            .then((cache) => cache.addAll([...FILES]))
            .then(() => self.skipWaiting()),
    )
})

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            await dropOurs(BUNDLE)
            const cache = await caches.open(BUNDLE)
            for (const request of await cache.keys())
                if (!FILES.has(request.url)) await cache.delete(request)
            await self.registration.navigationPreload?.enable()
            await self.clients.claim()
            for (const client of await self.clients.matchAll({ type: 'window' }))
                await fetch(client.url).then(
                    (response) =>
                        kept(response)
                            ? keep(new Request(client.url), response)
                            : response.body?.cancel(),
                    () => {},
                )
        })(),
    )
})

self.addEventListener('message', (event) => {
    if (event.data === 'rotated') event.waitUntil(caches.delete(SAVED))
})

self.addEventListener('fetch', (event) => {
    const request = event.request
    if (request.mode === 'navigate') {
        if (request.method === 'GET') event.respondWith(answer(event, true))
        else event.waitUntil(caches.delete(SAVED))
        return
    }
    if (request.method !== 'GET') return
    if (FILES.has(request.url)) {
        event.respondWith(
            caches
                .match(request, { cacheName: BUNDLE })
                .then((saved) => saved ?? fetch(request)),
        )
        return
    }
    if (new URL(request.url).origin !== self.location.origin) return
    if (request.headers.has(NAVIGATION) || request.headers.has('range')) return
    if ((request.headers.get('accept') ?? '').includes('text/event-stream'))
        return
    event.respondWith(answer(event, false))
})

async function answer(event, page) {
    let response
    try {
        response =
            (page ? await event.preloadResponse : undefined) ??
            (await fetch(event.request))
    } catch {
        const saved = await caches.match(event.request, {
            cacheName: SAVED,
            ignoreVary: true,
        })
        return saved ?? (page ? offline() : Response.error())
    }
    // A copy nothing reads is a tee holding every chunk, so one is cloned only to be saved.
    const copy = kept(response) ? response.clone() : undefined
    const rotated = response.headers.has(PRINCIPAL)
    event.waitUntil(
        (rotated ? caches.delete(SAVED) : Promise.resolve()).then(() =>
            copy === undefined ? undefined : keep(event.request, copy),
        ),
    )
    return response
}

function kept(response) {
    if (response.status !== 200) return false
    const type = response.headers.get('content-type') ?? ''
    return !STREAMED.some((streamed) => type.startsWith(streamed))
}

async function keep(request, response) {
    const cache = await caches.open(SAVED)
    await cache.put(request, response)
}

function offline() {
    return new Response(OFFLINE, {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8' },
    })
}
`

// 45.11 — the page a navigation with no network and no saved copy is answered with.
const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title></head><body><p>You're offline, and this page wasn't saved on this device. It loads once you're back online.</p></body></html>`

// 45.9 — THE WORKER THAT REMOVES ITSELF, for a browser still holding one an earlier build registered.
const REMOVING = `${CACHES}
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            await dropOurs(undefined)
            await self.registration.unregister()
        })(),
    )
})
`

/** Every file of the build's bundle, by name: the entry, its stylesheet and each route's chunks. */
function bundleFiles(manifest: Manifest): Set<string> {
    const files = new Set<string>()
    if (manifest.entry !== undefined) files.add(manifest.entry)
    if (manifest.stylesheet !== undefined) files.add(manifest.stylesheet)
    for (const chunks of Object.values(manifest.chunks))
        for (const chunk of chunks) files.add(chunk)
    return files
}

/**
 * The service worker's script: the one saving the build `manifest` names, or, with none, the one that
 * removes itself.
 *
 * 45.2 — ALLOWED THE MOUNT'S WHOLE SCOPE from below `/__abide`, where a worker's own directory would
 * be all it could reach.
 */
export function answerWorker(manifest: Manifest | undefined): Response {
    let script = REMOVING
    if (manifest !== undefined) {
        const paths: string[] = []
        for (const name of bundleFiles(manifest))
            paths.push(mounted(`${CLIENT_ADDRESS}/${name}`))
        script = `${CACHES}const PRINCIPAL = ${JSON.stringify(PRINCIPAL_HEADER)}
const NAVIGATION = ${JSON.stringify(NAVIGATION_HEADER)}
// 45.4 — the types a stream 16.32 frames, which has no end to save.
const STREAMED = ${JSON.stringify(STREAMED_TYPES)}
const OFFLINE = ${JSON.stringify(OFFLINE)}
const FILES = new Set(${JSON.stringify(paths)}.map((path) => new URL(path, self.location).href))
${SAVING}`
    }
    return new Response(script, {
        headers: {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-cache',
            'service-worker-allowed': `${MOUNT.current()}/`,
        },
    })
}
