// What tells an open browser that `abide dev` restarted, and what it does about it.
//
// Its own module rather than part of `serve.ts` because it is the one part of the dev server that
// runs in a BROWSER, and `serve.ts` cannot be imported to be tested: it is a worker, and it posts
// `ready` to a main thread at load. The client is a string, so a case can run it against a stubbed
// socket and clock and assert what it does — which is the only way to gate behaviour that fails
// silently, with the page rendering and the server fine and nothing in the console.
//
// The whole mechanism is three decisions, and each one of them was a bug that left a tab spinning:
// which id is compared, when it is compared, and when this file is allowed to run.

import { mounted, reserved } from '$shared/internal/mount.ts'
import { RELOAD_PATH, SOCKET_PREFIX } from '$shared/internal/PATHS.ts'
import { NEVER, NOSNIFF } from './assets.ts'

/**
 * Where a browser waits to be told the app came back.
 *
 * Under the reserved prefix and through the ordinary socket mux, so a dev server claims no address
 * an operator does not already proxy with one pattern — and so the reload path is the same transport
 * every other socket in the app uses rather than a private one that only works in development.
 *
 * Namespaced under `abide/` because the id space is the app's: a project with its own
 * `server/sockets/reload.ts` registers `reload`, and two declarations at one address is one of them
 * silently winning.
 */
export const RELOAD_ID = 'abide/reload'

/**
 * This worker's identity, so a RECONNECT can be told from a RESTART.
 *
 * Reopening the socket was taken as proof the app had come back, and it is not: a laptop that slept,
 * a proxy that timed the connection out, a browser reclaiming an idle socket all close it against a
 * server that never went anywhere. The page then reloaded for no reason — and because a reload
 * queued behind a busy main thread lands the moment it frees, what that looks like is a long-running
 * page throwing everything away the instant it finishes. Every measurement on `/bench`, gone, with
 * nothing in the console and nothing having changed on disk.
 *
 * A boot id makes the question answerable: the DOCUMENT carries the id of the worker that rendered
 * it, and the client asks on every open whether the server on the other end is still that process.
 *
 * The id is the document's rather than this file's, and that is the whole of what makes the question
 * honest. A page whose own socket attempt failed goes on to fetch this script from whatever worker is
 * up NEXT, so an id baked in HERE would be the new worker's — the client would compare a stale page
 * against the server that is serving it and find them equal.
 */
export const BOOT_ID = Bun.randomUUIDv7()

/** What the client appends to `RELOAD_PATH` to ask who is answering. See `BOOT_ID`. */
const BOOT_QUERY = '?boot'

/**
 * The reload client, hand-written and served from this worker's memory at `RELOAD_PATH`.
 *
 * Not from the bundle, because a client build that is BROKEN is exactly when a developer needs the
 * page to still reconnect and reload itself once the build is fixed.
 *
 * EVERY open asks, the first one included, and the first one is the one that matters. A page loaded
 * from a worker that is already being replaced has its own socket attempt refused, so its first
 * SUCCESSFUL open is against the next worker — which is exactly the moment it must reload, and was
 * exactly the moment a `seen` flag skipped. The socket is healthy after that, so `onclose` never
 * fires again and there is no second chance: the page sits there showing what the files used to say,
 * for as long as it is left open.
 *
 * A file rather than an inline `<script>` for the reason `RELOAD_PATH` states: an app running `csp()`
 * refuses inline script it did not stamp, and a head cut once at boot has no per-request nonce to be
 * stamped with. That failure is the quiet kind — the page renders, and only the reloading stops.
 *
 * The backoff exists so a page left open after Ctrl-C is not a socket attempt every 100ms forever.
 *
 * A function rather than a constant because the mount is `APP_URL`'s and config is not resolved when
 * this module loads. Still ONE string per dev process, not one per request: the id it compares
 * against is the DOCUMENT's, read off this file's own `src`.
 */
export const reloadSource = (): string =>
    '(()=>{' +
    `const at=(location.protocol==='https:'?'wss://':'ws://')+location.host+${JSON.stringify(mounted(SOCKET_PREFIX + RELOAD_ID))};` +
    `const who=${JSON.stringify(mounted(RELOAD_PATH) + BOOT_QUERY)};` +
    // Off the tag the DOCUMENT carries rather than out of this string. See `BOOT_ID`. Nothing to
    // compare means nothing to conclude — a bare request for this file is not a page.
    "const id=document.currentScript.src.split('?')[1]||'';if(id==='')return;" +
    'let wait=100;' +
    // The open ASKS rather than assumes, and a fetch that FAILS closes the socket instead of being
    // swallowed: the check gets one chance per open, so a transient failure with the socket left
    // healthy is a page that never asks again. Closing puts it back on the one recovery path there is.
    'const open=()=>{const live=new WebSocket(at);' +
    'live.onopen=()=>fetch(who,{cache:"no-store"}).then(r=>r.text()).then(t=>{wait=100;if(t!==id)location.reload()},()=>live.close());' +
    'live.onclose=()=>setTimeout(open,wait=Math.min(wait*2,1000))};' +
    'open()})()'

/**
 * What the head carries instead — appended to the end of the shell's head.
 *
 * `async` rather than `defer`, and the difference is the whole of whether a stuck page can recover.
 * Both keep the document's parse off this fetch, which is what a streaming page needs; only `async`
 * RUNS before the parse finishes. A document severed mid-body never finishes parsing — the tab is
 * left spinning on `readyState: 'loading'` for as long as it is open — so a deferred client is one
 * that never executes on precisely the page that needs it, and the socket that would have noticed
 * the restart is never opened.
 *
 * Nothing here touches the DOM, so running early costs it nothing.
 *
 * The boot id rides in the QUERY because that is the only place a page can carry it: this tag is cut
 * into the head by the worker that renders the document, where the file behind it may be served by a
 * later one.
 */
export const reloadTag = (): string => `<script async src="${mounted(RELOAD_PATH)}?${BOOT_ID}"></script>`

/** Dev's own file, in FRONT of the app — or `undefined` when the request is the app's. */
export function reloadClient(request: Request, source: string): Response | undefined {
    // The raw url text first and the parsed pathname deciding, exactly as the bundle route does it:
    // an app's own request pays one substring test rather than a URL parse.
    if (!request.url.includes(RELOAD_PATH)) return undefined
    const url = new URL(request.url)
    // `reserved` rather than `unmounted`, which is what this used to ask and is the one crossing that
    // cannot answer it: under a mount it hands a ROOT `/__abide/reload.js` back unchanged, and this
    // route would then serve the dev client at an address the bundle route refuses.
    if (reserved(url.pathname, RELOAD_PATH) !== RELOAD_PATH) return undefined
    // Who is answering, for a client deciding whether its socket came back to the SAME process. The
    // same address rather than one of its own: it is already exempt from the app's pipeline, already
    // uncached, and already the one path a page loaded by `abide dev` is guaranteed to be able to
    // reach — a second route would be a second thing to keep in front of `csp()` and the mount.
    if (url.search === BOOT_QUERY) {
        return new Response(BOOT_ID, {
            headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': NEVER },
        })
    }
    // `NEVER` and `NOSNIFF` are `assets.ts`'s, which is the other route answered in FRONT of the
    // pipeline: the dev caching rule and the sniffing rule are one each, not one per file that skips
    // `headersFor`. What this hands back is JavaScript on the app's own origin.
    return new Response(source, {
        headers: {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': NEVER,
            'x-content-type-options': NOSNIFF,
        },
    })
}
