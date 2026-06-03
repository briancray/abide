import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { bindConnectedFlag } from './lib/bundle/bindConnectedFlag.ts'
import { bindRequestNavigate } from './lib/bundle/bindRequestNavigate.ts'
import { listenLocalControlServer } from './lib/bundle/listenLocalControlServer.ts'
import { probeBelteServer } from './lib/bundle/probeBelteServer.ts'
import { resolveWebviewLib } from './lib/bundle/resolveWebviewLib.ts'
import { spawnEmbeddedServer } from './lib/bundle/spawnEmbeddedServer.ts'
import { stableLocalPort } from './lib/bundle/stableLocalPort.ts'
import { appDataDir } from './lib/shared/appDataDir.ts'
import { bundleLayout } from './lib/shared/bundleLayout.ts'
import { clearLastConnection } from './lib/shared/clearLastConnection.ts'
import { log } from './lib/shared/log.ts'
import { readEnvFile } from './lib/shared/readEnvFile.ts'
import { readLastConnection } from './lib/shared/readLastConnection.ts'
import { serializeEnv } from './lib/shared/serializeEnv.ts'
import { writeLastConnection } from './lib/shared/writeLastConnection.ts'

/*
The bundle's control server, run in a Worker so it owns its own thread.

`webview_run` enters a native UI run loop that blocks the launcher's main thread
indefinitely (the window owns it until close), which freezes the main thread's
JS event loop. An in-process `Bun.serve` there can never answer a request, so the
webview pointed at it would only ever see a hung navigation — a blank window.

Running the control server on this Worker thread keeps it answering the whole time
the window is open. It owns the pieces that must live beside it: the embedded
server child it spawns, and its own FFI handle to the native menu flag (set here
because the main thread can't process a postMessage while blocked in webview_run,
yet the flag is a process-global the main-thread menu still reads).

Bun does not apply the launcher build's plugins to a worker entry, so this module
can't import belte's virtual modules (the connect-screen HTML, app title). The
launcher — which can — passes them in the `init` message; on `shutdown` it has us
reap the embedded child before the launcher exits.

Once connected it also watches the chosen server's liveness — polling its identity
endpoint — and, when it stops answering, corrects the menu flag and bounces the
window back to the connect screen, since a dead server (local crash or remote
outage) otherwise leaves a frozen page and a menu that still claims connected.

  GET  /                   → the connect screen (title injected at serve time)
  GET  /__belte/config     → { schema, values } for the first-run config form
  POST /__belte/config     → persist the form's answers to the data-dir .env
  POST /connect {url}      → record connected, reply { redirect: url }
  POST /start              → spawn the server binary, reply { redirect: localUrl }
  GET  /__belte/disconnect → reap the child, clear connected
*/

/*
Init payload from the launcher, plus the per-run state the handlers close over.
`configSchema` is the JSON Schema derived from the app's BundleWindow.config
(undefined when none declared), driving the connect screen's first-run form.
*/
type Init = {
    disconnectedHtml: string
    title: string
    programName: string
    configSchema?: Record<string, unknown>
}
let disconnectedHtml = ''
let title = ''
let programName = ''
let configSchema: Record<string, unknown> | undefined
let flag: ReturnType<typeof bindConnectedFlag> | undefined
let server: ReturnType<typeof listenLocalControlServer> | undefined

// The control-server origin (where the connect screen lives) and the webview
// handle, forwarded by the launcher — together they let the watch bounce a dead
// window back to the connect screen.
let controlOrigin = ''
let navigate: ReturnType<typeof bindRequestNavigate> | undefined
let webviewHandle: number | undefined

/*
Liveness watch over the currently-connected server. A recursive timer (not
setInterval, so a slow probe never overlaps the next) probes the identity endpoint;
a couple of consecutive misses — tolerating a transient blip or a quick restart —
count as a death. Cleared whenever we're not connected.
*/
const LIVENESS_INTERVAL_MS = 4000
const LIVENESS_FAILURE_LIMIT = 2
let connectedUrl: string | undefined
let livenessTimer: ReturnType<typeof setTimeout> | undefined
let livenessFailures = 0

// Embedded-server child, spawned on demand by Start server; undefined when none.
let serverChild: ReturnType<typeof Bun.spawn> | undefined

// Reaps the embedded server child if one is running.
function killServerChild(): void {
    if (serverChild) {
        serverChild.kill()
        serverChild = undefined
    }
}

// Begin (or restart) watching `url` for liveness once the window points at it.
function startLivenessWatch(url: string): void {
    stopLivenessWatch()
    connectedUrl = url
    livenessFailures = 0
    livenessTimer = setTimeout(runLivenessProbe, LIVENESS_INTERVAL_MS)
}

// Stop watching — on explicit disconnect, on detected death, or at shutdown.
function stopLivenessWatch(): void {
    if (livenessTimer) {
        clearTimeout(livenessTimer)
        livenessTimer = undefined
    }
    connectedUrl = undefined
    livenessFailures = 0
}

/*
One liveness probe of the connected server. Successes reset the miss count;
LIVENESS_FAILURE_LIMIT consecutive misses declare it dead and hand off to
handleConnectionLost. Reschedules itself while still connected.
*/
async function runLivenessProbe(): Promise<void> {
    const url = connectedUrl
    if (!url) {
        return
    }
    const identity = await probeBelteServer(url)
    // A disconnect or reconnect during the await may have moved us on.
    if (connectedUrl !== url) {
        return
    }
    if (identity) {
        livenessFailures = 0
    } else {
        livenessFailures += 1
        if (livenessFailures >= LIVENESS_FAILURE_LIMIT) {
            handleConnectionLost(url)
            return
        }
    }
    livenessTimer = setTimeout(runLivenessProbe, LIVENESS_INTERVAL_MS)
}

/*
The connected server stopped answering. Reap any (now-dead) embedded child, clear
the connected flag so the menu stops claiming connected, and bounce the window
back to the connect screen with a `lost` notice. The flag flip alone keeps the
menu honest even when the navigate is a no-op (off macOS, or no handle yet).
*/
function handleConnectionLost(url: string): void {
    log.warn(`connected server stopped responding: ${url}`)
    stopLivenessWatch()
    killServerChild()
    flag?.setConnected(false)
    if (webviewHandle !== undefined) {
        navigate?.requestNavigate(webviewHandle, `${controlOrigin}/?action=lost`)
    }
}

/*
Boots the embedded server via the shared spawn helper and keeps the child so
killServerChild can reap it. Any previous child is reaped first so only one
embedded server runs at a time; returns the URL to point the window at.
*/
async function startEmbeddedServer(timeoutMs?: number): Promise<string> {
    killServerChild()
    const { url, child } = await spawnEmbeddedServer({ programName, timeoutMs })
    serverChild = child
    return url
}

/*
Where the window should point on launch, resolved before it ever opens so the
connect screen never flashes. Repeats the last connection from the launcher-owned
record (which survives relaunch where the embedded server's fresh port can't):

  - embedded, config complete → boot it and point at the live server
  - embedded, config missing  → the connect screen, so the user can configure
  - remote url, still alive   → point straight at it
  - remote url, now dead       → the connect screen with a `lost` notice
  - nothing recorded           → the connect screen

Boot is bounded by a short ceiling: a failed or slow boot falls back to the
connect screen rather than leaving the launcher window-less, and reaps the child
so a half-started server doesn't hold its port.
*/
const AUTO_START_CEILING_MS = 3000
async function resolveLaunchTarget(): Promise<string> {
    const last = await readLastConnection(programName)
    if (!last) {
        return controlOrigin
    }
    if (last.kind === 'embedded') {
        if (await autoStartBlockedByConfig()) {
            return controlOrigin
        }
        try {
            const url = await startEmbeddedServer(AUTO_START_CEILING_MS)
            flag?.setConnected(true)
            startLivenessWatch(url)
            log.info(`resumed embedded server at ${url}`)
            return url
        } catch (error) {
            killServerChild()
            log.warn(`embedded server did not resume: ${String(error)}`)
            return controlOrigin
        }
    }
    const identity = await probeBelteServer(last.url)
    if (identity) {
        flag?.setConnected(true)
        startLivenessWatch(last.url)
        log.info(`reconnected to ${identity.name} at ${last.url}`)
        return last.url
    }
    log.warn(`saved server did not respond: ${last.url}`)
    return `${controlOrigin}/?action=lost`
}

// True when the app declares required config that nothing yet supplies, so an
// embedded auto-start would only crash for the lack of it — land on the connect
// screen (and its setup modal) instead.
async function autoStartBlockedByConfig(): Promise<boolean> {
    const required = (configSchema?.required as string[] | undefined) ?? []
    if (required.length === 0) {
        return false
    }
    const values = await resolveConfigValues()
    return required.some((key) => !values[key])
}

/*
Injects the app title into the connect-screen HTML just before serving — the build
left a `<!--belte:connect-config-->` marker in <head>.
*/
function renderConnectScreen(): Response {
    const script = `<script>window.__BELTE_TITLE__=${JSON.stringify(title)}</script>`
    const html = disconnectedHtml.replace('<!--belte:connect-config-->', script)
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

// The data-dir `.env` the form writes and the server loads first at boot.
function dataDirEnvPath(): string {
    return join(appDataDir(programName), '.env')
}

// The bundle's shipped `.env` (its default config layer), resolved from the binary
// directory — same source loadEnvFromBinaryDir reads at boot (dirname of the running
// binary): beside the binary in the flat layout, under Resources in a `.app`.
function binaryDirEnvPath(): string {
    return bundleLayout(dirname(process.execPath)).envPath
}

/*
Resolves the value to pre-fill each config field with, following the same
precedence the server applies below the shell: the user's saved data-dir `.env`,
then the bundle's shipped binary-dir `.env`, then the schema's own `default`.
Empty string when nothing supplies it — which is how the form spots an unmet
required field.
*/
async function resolveConfigValues(): Promise<Record<string, string>> {
    const properties = (configSchema?.properties ?? {}) as Record<string, { default?: unknown }>
    // Independent reads — fetch together; precedence is applied in the merge below.
    const [dataDirEnv, binaryDirEnv] = await Promise.all([
        readEnvFile(dataDirEnvPath()),
        readEnvFile(binaryDirEnvPath()),
    ])
    return Object.fromEntries(
        Object.keys(properties).map((key) => {
            const fallback = properties[key]?.default
            const value =
                dataDirEnv[key] ??
                binaryDirEnv[key] ??
                (fallback === undefined ? '' : String(fallback))
            return [key, value]
        }),
    )
}

/*
Persists the form's answers to the data-dir `.env`, merged over any existing
file so keys the form didn't touch survive. Creates the data dir on first run
(appDataDir only computes the path).
*/
async function writeConfig(values: Record<string, string>): Promise<void> {
    const path = dataDirEnvPath()
    const merged = { ...(await readEnvFile(path)), ...values }
    await mkdir(appDataDir(programName), { recursive: true })
    await Bun.write(path, serializeEnv(merged))
}

// GET /__belte/config — the form's schema + current values, or null schema to skip the gate.
async function handleConfigGet(): Promise<Response> {
    if (!configSchema) {
        return Response.json({ schema: null, values: {} })
    }
    return Response.json({ schema: configSchema, values: await resolveConfigValues() })
}

// POST /__belte/config — persist the form's answers to the data-dir `.env`.
async function handleConfigPost(request: Request): Promise<Response> {
    const { values } = (await request.json()) as { values: Record<string, string> }
    await writeConfig(values)
    return new Response(undefined, { status: 204 })
}

// POST /connect — point the window at a remote belte server after probing it.
async function handleConnect(request: Request): Promise<Response> {
    const { url: target } = (await request.json()) as { url: string }
    // Verify it's actually a belte server before pointing the window at it.
    const identity = await probeBelteServer(target)
    if (!identity) {
        log.warn(`no belte server responded at ${target}`)
        return Response.json({ error: `No belte server responded at ${target}` }, { status: 502 })
    }
    flag?.setConnected(true)
    startLivenessWatch(target)
    // Record the choice so the next launch reconnects here before opening.
    await writeLastConnection(programName, { kind: 'url', url: target })
    log.info(`connecting to ${identity.name} at ${target}`)
    return Response.json({ redirect: target })
}

// POST /start — boot the embedded server and point the window at it.
async function handleStart(): Promise<Response> {
    try {
        const localUrl = await startEmbeddedServer()
        flag?.setConnected(true)
        startLivenessWatch(localUrl)
        // Record the choice so the next launch boots the embedded server first.
        await writeLastConnection(programName, { kind: 'embedded' })
        log.info(`started embedded server at ${localUrl}`)
        return Response.json({ redirect: localUrl })
    } catch (error) {
        killServerChild()
        return Response.json({ error: String(error) }, { status: 500 })
    }
}

// GET /__belte/disconnect — tear down the embedded server and forget the auto-resume choice.
async function handleDisconnect(): Promise<Response> {
    stopLivenessWatch()
    killServerChild()
    flag?.setConnected(false)
    await clearLastConnection(programName)
    return new Response(undefined, { status: 204 })
}

/*
The control server's routes, keyed by `${method} ${pathname}` (exact match). The
connect screen owns localStorage + navigation; this worker owns the embedded-
server process and the native flag.
*/
const controlRoutes: Record<string, (request: Request) => Promise<Response> | Response> = {
    'GET /': () => renderConnectScreen(),
    'GET /__belte/config': handleConfigGet,
    'POST /__belte/config': handleConfigPost,
    'POST /connect': handleConnect,
    'POST /start': handleStart,
    'GET /__belte/disconnect': handleDisconnect,
}

function handleControlRequest(request: Request): Promise<Response> | Response {
    const { pathname } = new URL(request.url)
    const route = controlRoutes[`${request.method} ${pathname}`]
    return route ? route(request) : new Response('not found', { status: 404 })
}

/*
Bind the control server to 127.0.0.1 literally (not `localhost`) so the webview
reaches it without any IPv4/IPv6 name-resolution ambiguity, open the native flag
handle, then resolve where the window should open before handing back. Resolving
the launch target here — booting/probing the last connection before `ready` — is
what lets the launcher open the window straight at the live server, so the
connect screen never flashes; only an unconfigured, failed, or absent resume
falls back to it. The launcher gets both `origin` (for the File-menu actions) and
`target` (where to point the window now).
*/
async function start(init: Init): Promise<void> {
    disconnectedHtml = init.disconnectedHtml
    title = init.title
    programName = init.programName
    configSchema = init.configSchema
    const libPath = await resolveWebviewLib()
    flag = bindConnectedFlag(libPath)
    navigate = bindRequestNavigate(libPath)
    server = listenLocalControlServer(stableLocalPort(init.programName), handleControlRequest)
    controlOrigin = `http://127.0.0.1:${server.port}`
    log.info(`${title} control server listening at ${controlOrigin}`)
    const target = await resolveLaunchTarget()
    self.postMessage({ type: 'ready', origin: controlOrigin, target })
}

// Reap the child + release the server and FFI handles, then confirm so the
// launcher can exit cleanly.
function shutdown(): void {
    stopLivenessWatch()
    killServerChild()
    server?.stop(true)
    flag?.close()
    navigate?.close()
    self.postMessage({ type: 'shutdownDone' })
}

/*
The launcher drives the lifecycle: `init` (with the data this worker can't import)
starts the server, `window` forwards the webview handle the liveness watch needs to
navigate, and `shutdown` tears it all down once the window closes.
*/
self.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as
        | { type: 'init'; init: Init }
        | { type: 'window'; handle: number }
        | { type: 'shutdown' }
    if (data.type === 'init') {
        void start(data.init)
    } else if (data.type === 'window') {
        webviewHandle = data.handle
    } else if (data.type === 'shutdown') {
        shutdown()
    }
})
