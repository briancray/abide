// SECTION 45 — THE SERVICE WORKER, written by the server rather than bundled: what it saves is the
// build's own file list, which the server holds (38.5), and a script whose bytes change with the
// build is how a browser learns there is a new one to install.
//
// WRITTEN AS TEXT, NOT AS A FUNCTION'S SOURCE: an executable `abide compile` writes carries its code
// as bytecode (38.93), where a function has no source to read back.

import { CLIENT_ADDRESS } from '#shared/ADDRESSES.ts'
import { KEEP_HEADER } from '#shared/KEEP_HEADER.ts'
import { KEEP_OPENED } from '#shared/KEEP_OPENED.ts'
import { KEPT_HEADER } from '#shared/KEPT_HEADER.ts'
import { MOUNT, mounted } from '#shared/mount.ts'
import { NAVIGATION_HEADER } from '#shared/NAVIGATION_HEADER.ts'
import {
    OFFLINE_BUNDLE,
    OFFLINE_CACHE_PREFIX,
    OFFLINE_SAVED,
    OFFLINE_SHARED,
} from '#shared/OFFLINE_CACHES.ts'
import { PRINCIPAL_HEADER } from '#shared/PRINCIPAL_HEADER.ts'
import { REACHED_MESSAGE } from '#shared/REACHED_MESSAGE.ts'

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
const SHARED = ${JSON.stringify(OFFLINE_SHARED)}
const BUNDLE = ${JSON.stringify(OFFLINE_BUNDLE)}

async function dropOurs(keeping) {
    for (const name of await caches.keys())
        if (name.startsWith(OURS) && name !== keeping) await caches.delete(name)
}
`

// 45.3 through 45.8, 45.13, 45.17 through 45.21, and 45.24.
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
            // A preload would ask the network for every navigation, a kept copy answered or not.
            await self.registration.navigationPreload?.disable()
            await self.clients.claim()
            for (const client of await self.clients.matchAll({ type: 'window' }))
                await keepPage(client.url)
        })(),
    )
})

self.addEventListener('message', (event) => {
    if (event.data === 'rotated') event.waitUntil(dropSaved())
    const reached = event.data?.[REACHED]
    if (typeof reached === 'string' && reached.startsWith(\`\${self.location.origin}/\`))
        event.waitUntil(keepReached(reached))
})

self.addEventListener('fetch', (event) => {
    const request = event.request
    if (request.mode === 'navigate') {
        if (request.method === 'GET') event.respondWith(answer(event, true))
        else event.waitUntil(dropSaved())
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

// 45.17 through 45.20 — THE COPY KEPT, BY ITS OWN cache-control: fresh is answered and the network
// not asked, stale within stale-while-revalidate is answered while the network is asked for the next
// one — save by a request asking force-cache, a call whose wire asks again itself once it reads the
// copy (RULEBOOK 16.80, 16.85), so asking here too would ask twice — and stale within stale-if-error
// stands in where the network gives nothing. A request asking past every cache (a refresh, a load
// after invalidate) is the network's alone; a navigation never is, since a reload offline would
// otherwise be the page saying nothing was saved.
async function answer(event, page) {
    const request = event.request
    const bypass =
        !page &&
        (request.cache === 'no-cache' ||
            request.cache === 'reload' ||
            request.cache === 'no-store')
    const saved = bypass
        ? undefined
        : await savedCopy(request)
    const life = saved === undefined ? undefined : lifeOf(saved)
    if (life !== undefined) {
        if (life.age < life.fresh) return marked(saved)
        if (life.age < life.fresh + life.revalidate) {
            if (request.cache !== 'force-cache')
                event.waitUntil(
                    fromNetwork(event, page, false).then(
                        (response) => response.body?.cancel(),
                        () => {},
                    ),
                )
            return marked(saved)
        }
    }
    try {
        return await fromNetwork(event, page, page)
    } catch {
        if (life !== undefined && standsIn(life)) return marked(saved)
        return page ? offline() : Response.error()
    }
}

// 45.22 — A COPY KEPT SAYS SO, and when the server answered it, so a page tells it from the network's.
function marked(saved) {
    const headers = new Headers(saved.headers)
    headers.set(KEPT, saved.headers.get('date') ?? '')
    return new Response(saved.body, {
        status: saved.status,
        statusText: saved.statusText,
        headers,
    })
}

// A page as the worker asks for it, whether a navigation or the worker keeping an open window's:
// past the browser's cache, as a page kept, and with its redirects left to the page — one followed
// would be saved under the address it was asked at, holding where it led (RULEBOOK 45.4, 45.21,
// 45.23).
function pageRequest(url, headers, keep) {
    const asking = new Headers(headers)
    asking.set(KEEP, keep)
    return new Request(url, { headers: asking, redirect: 'manual', cache: 'no-cache' })
}

// 45.21 — PAST THE BROWSER'S OWN CACHE, which holds the same answers under the same headers and would
// hand a revalidation the copy it is replacing. A navigation's request takes no init of its own, so it
// is asked again by address, its redirects left to the page as a navigation's are — and 45.23, as a
// page kept, which a script's fetch is not otherwise told from (RULEBOOK 41.29, 41.30), and as the
// page the navigation opens where opened says it is, which then hydrates from what it seeded.
async function fromNetwork(event, page, opened) {
    const request = event.request
    const asked = page
        ? pageRequest(request.url, request.headers, opened ? OPENED : '1')
        : new Request(request, { cache: 'no-cache' })
    const since = drops
    const response = await fetch(asked)
    // A copy nothing reads is a tee holding every chunk, so one is cloned only to be saved.
    const copy = kept(response) ? response.clone() : undefined
    event.waitUntil(keep(request, copy, since, response.headers.has(PRINCIPAL)))
    return response
}

// 45.13, 45.24 — A PAGE NO NAVIGATION ASKED FOR, kept as a page behind the one opened is: an open
// window's as the worker activates, and an address the router reached.
function keepPage(url) {
    const since = drops
    return fetch(pageRequest(url, undefined, '1')).then((response) => {
        // Nothing reads this answer, so one 45.3 or 45.4 turns away is let go here.
        const copy = kept(response) ? response : undefined
        if (copy === undefined) response.body?.cancel()
        return keep(new Request(url), copy, since, response.headers.has(PRINCIPAL))
    }, () => {})
}

// The addresses being kept, so one reached twice before its copy lands is asked for once.
const reaching = new Set()

// 45.24 — AN ADDRESS THE ROUTER REACHED, whose page no navigation asked for, so none is saved unless
// this asks — and only where no copy saved would stand in offline: one that would is refreshed by the
// page's own next load, and asking on every step renders each page twice. A page kept holds no seed
// (RULEBOOK 41.29), so what a reload paints stale is markup its calls then answer over.
async function keepReached(url) {
    if (reaching.has(url)) return
    reaching.add(url)
    try {
        const saved = await savedCopy(url)
        if (saved === undefined || !standsIn(lifeOf(saved))) await keepPage(url)
    } finally {
        reaching.delete(url)
    }
}

// 45.19 — whether a copy kept still stands in where the network gives nothing.
function standsIn(life) {
    return life.age < life.fresh + life.error
}

// How old a kept copy is and how long each of its windows runs, in seconds; a copy with no date is
// as old as it can be.
function lifeOf(response) {
    const directives = directivesOf(response)
    const date = Date.parse(response.headers.get('date') ?? '')
    // no-cache is never fresh; it and must-revalidate are never served stale.
    const unfresh = directives.has('no-cache')
    const unstale = unfresh || directives.has('must-revalidate')
    const seconds = (name, closed) => {
        const value = Number(directives.get(name))
        return closed || !Number.isFinite(value) ? 0 : value
    }
    return {
        age: Number.isNaN(date) ? Infinity : (Date.now() - date) / 1000,
        fresh: seconds('max-age', unfresh),
        revalidate: seconds('stale-while-revalidate', unstale),
        error: seconds('stale-if-error', unstale),
    }
}

// An answer's cache-control, by directive.
function directivesOf(response) {
    const directives = new Map()
    for (const part of (response.headers.get('cache-control') ?? '').split(',')) {
        const [name, value] = part.trim().toLowerCase().split('=')
        directives.set(name, value)
    }
    return directives
}

// 45.3, 45.4 — a 200 whose cache-control lets a private cache store it, and no stream.
function kept(response) {
    if (response.status !== 200) return false
    if (directivesOf(response).has('no-store')) return false
    const type = response.headers.get('content-type') ?? ''
    return !STREAMED.some((streamed) => type.startsWith(streamed))
}

// The copy saved of an address, a caller's own ahead of one any caller may be answered.
async function savedCopy(request) {
    return (
        (await caches.match(request, { cacheName: SAVED, ignoreVary: true })) ??
        (await caches.match(request, { cacheName: SHARED, ignoreVary: true }))
    )
}

// 45.7 — EVERY PAGE SAVED DROPPED, and with them every copy asked for before the drop: one asked under
// the cookies of then would land after it holding the caller signed out since. The drop an answer's
// own abide-principal makes is the exception, since that answer is the new caller's. What any caller
// may be answered is kept apart and left standing: it was never the caller's to drop, and a font
// thrown away at sign-in is a page drawn without it offline.
let drops = 0

function dropSaved() {
    drops += 1
    return caches.delete(SAVED)
}

// Saves a copy 45.3 and 45.4 let through where no drop has come since its request was asked — after
// the drop its own answer makes where that answer rotated the principal — and cancels one where one has.
// One any caller may be answered is saved whenever it was asked, since no caller's cookies made it.
async function keep(request, copy, since, rotated) {
    if (rotated) {
        await dropSaved()
        since = drops
    }
    if (copy === undefined) return
    const shared = directivesOf(copy).has('public')
    if (!shared && since !== drops) return copy.body?.cancel()
    // An address whose answer went public or private since leaves no copy behind for savedCopy to
    // prefer over this one.
    await (await caches.open(shared ? SAVED : SHARED)).delete(request)
    await (await caches.open(shared ? SHARED : SAVED)).put(request, copy)
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
const KEPT = ${JSON.stringify(KEPT_HEADER)}
const KEEP = ${JSON.stringify(KEEP_HEADER)}
const OPENED = ${JSON.stringify(KEEP_OPENED)}
const NAVIGATION = ${JSON.stringify(NAVIGATION_HEADER)}
const REACHED = ${JSON.stringify(REACHED_MESSAGE)}
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
