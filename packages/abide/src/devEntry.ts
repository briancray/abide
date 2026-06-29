import { watch } from 'node:fs'
import type { Subprocess } from 'bun'
import { build } from './build.ts'
import { DEFAULT_PORT } from './lib/server/runtime/DEFAULT_PORT.ts'
import { DEV_READY_MESSAGE } from './lib/server/runtime/DEV_READY_MESSAGE.ts'
import { DEV_REBUILD_MESSAGE } from './lib/server/runtime/DEV_REBUILD_MESSAGE.ts'
import { findOpenPort } from './lib/server/runtime/findOpenPort.ts'
import { abideLog } from './lib/shared/abideLog.ts'
import { changeAffectsClient } from './lib/shared/changeAffectsClient.ts'

/*
Dev orchestrator. Replaces `bun --watch` (which only watches the import graph,
so new files / CSS / public assets never triggered a restart) with an explicit
loop we own end to end:

  1. Build the client once — uncompressed, unminified (compressing on every
     rebuild dwarfs the bundle; the server serves the plain bytes when no .gz exists).
  2. Spawn the server as a child against a fixed dev port and ABIDE_DEV=1, which
     makes it mount the /__abide/dev live-reload channel.
  3. Watch src/ recursively. On any change, rebuild then swap the worker: the
     replacement boots alongside the incumbent (both bind the port via
     reusePort) and the incumbent is retired only once the replacement reports
     ready over IPC — the port keeps answering across the whole restart. SSR
     renders pages through Bun's module cache, so a fresh module graph (a new
     process) is the reliable way to reflect a source edit — Bun has no stable
     in-process invalidation. Killing the incumbent drops the browser's
     live-reload channel; it reconnects straight onto the already-listening
     replacement and reloads itself.

Restarts are serialized (a build mid-flight queues the next) and the port is
fixed so the browser tab stays valid across restarts. A failed build — or a
replacement that dies or hangs while booting — keeps the last-good server
running rather than tearing the loop down. A worker that crashes while active
is respawned, bounded so a boot-time crash loop gives up and waits for a save.
*/
const cwd = process.cwd()
const PRELOAD = new URL('./preload.ts', import.meta.url).pathname
const SERVER_ENTRY = new URL('./serverEntry.ts', import.meta.url).pathname
const SOURCE_DIR = `${cwd}/src`
// Coalesce editor save bursts (and multi-file saves) into one rebuild.
const REBUILD_DEBOUNCE_MS = 60
// How long a booting replacement gets to report ready before it is discarded.
const READY_TIMEOUT_MS = 30000
// Consecutive worker exits with no ready signal in between before the
// crash-respawn loop gives up and waits for the next save.
const MAX_EXITS_WITHOUT_READY = 3
/*
Generated dir the build itself writes into src/ (route type declarations). It
must be ignored or each rebuild's write retriggers the watcher — an endless
rebuild loop.
*/
const GENERATED_DIR = '.abide'

// True for paths under src/.abide (the build's own generated output).
function isGenerated(filename: string): boolean {
    return filename.split(/[\\/]/).includes(GENERATED_DIR)
}

// clean:false leaves the live dist in place — each build swaps _app in atomically,
// so the running server never serves a half-built or emptied bundle.
const buildOptions = {
    cwd,
    minify: false,
    compress: false,
    clean: false,
    exitOnFailure: false,
    dev: true,
} as const

// The worker currently meant to be serving; undefined while crashed or replaced.
let server: Subprocess | undefined
let shuttingDown = false
// Worker exits since the last ready signal — bounds the crash-respawn loop.
let exitsWithoutReady = 0

/*
Spawn a server worker against the fixed dev port. `ready` resolves when the
worker reports its listener is up and init() has run (DEV_READY_MESSAGE) — the
cue that a replacement may retire its predecessor.
*/
function spawnWorker(port: number): { proc: Subprocess; ready: Promise<void> } {
    const readiness = Promise.withResolvers<void>()
    const proc = Bun.spawn({
        cmd: ['bun', '--preload', PRELOAD, SERVER_ENTRY],
        cwd,
        /*
        ABIDE_PARENT_PID activates serverEntry's exitWithParent watchdog: the
        worker polls this orchestrator and self-exits if it dies abruptly
        (kill -9, OOM) without running its shutdown handlers, so a wedged
        orchestrator can't leave the worker orphaned holding the dev port.
        */
        env: {
            ...process.env,
            PORT: String(port),
            ABIDE_DEV: '1',
            ABIDE_PARENT_PID: String(process.pid),
        },
        stdio: ['inherit', 'inherit', 'inherit'],
        // The child's POST /__abide/reload route signals a rebuild over IPC, so the
        // trigger rides the app's own port instead of a side channel.
        ipc(message) {
            if (message === DEV_REBUILD_MESSAGE) {
                void rebuild(port)
            }
            if (message === DEV_READY_MESSAGE) {
                exitsWithoutReady = 0
                readiness.resolve()
            }
        },
    })
    respawnOnUnexpectedExit(proc, port)
    return { proc, ready: readiness.promise }
}

/*
A worker that dies while it is the active server — an app crash, not a swap or
shutdown — used to leave the port dead until a manual restart. Respawn it,
giving up after MAX_EXITS_WITHOUT_READY exits in a row so a crash-on-boot
doesn't spin; the next save retries through rebuild.
*/
function respawnOnUnexpectedExit(proc: Subprocess, port: number): void {
    void proc.exited.then((exitCode) => {
        if (shuttingDown || server !== proc) {
            return
        }
        server = undefined
        exitsWithoutReady += 1
        if (exitsWithoutReady >= MAX_EXITS_WITHOUT_READY) {
            abideLog.warn(
                `server keeps exiting (code ${exitCode}) — fix the error and save to retry`,
            )
            return
        }
        abideLog.warn(`server exited unexpectedly (code ${exitCode}) — restarting`)
        server = spawnWorker(port).proc
    })
}

/* Terminate a worker and wait for it to exit (SIGKILL watchdog for a wedged exit). */
async function stopWorker(proc: Subprocess): Promise<void> {
    proc.kill()
    const watchdog = setTimeout(() => proc.kill('SIGKILL'), 3000)
    await proc.exited
    clearTimeout(watchdog)
}

/*
Zero-downtime swap. The replacement overlaps the incumbent — both bind the dev
port via reusePort (see createServer) and the kernel keeps delivering
connections to the incumbent until it stops — so the port answers throughout
the new module graph's boot. Only a replacement that reports ready retires the
incumbent; one that dies or hangs booting is discarded and the last-good server
keeps serving, mirroring how a failed build is handled.
*/
async function replaceServer(port: number): Promise<void> {
    const previous = server
    const next = spawnWorker(port)
    const outcome = await Promise.race([
        next.ready.then(() => 'ready' as const),
        next.proc.exited.then(() => 'exited' as const),
        Bun.sleep(READY_TIMEOUT_MS).then(() => 'timeout' as const),
    ])
    if (outcome !== 'ready') {
        if (outcome === 'timeout') {
            await stopWorker(next.proc)
        }
        abideLog.warn('new server failed to boot — the previous one (if any) keeps serving')
        return
    }
    server = next.proc
    if (previous) {
        await stopWorker(previous)
    }
}

let building = false
let queued = false
// True once any change collapsed into the queued run needs the client rebuilt;
// a client-affecting change can never be downgraded to a server-only restart.
let queuedNeedsClient = false

/*
Apply a change: rebuild the client (unless `skipClientBuild` — a server/MCP-only
change leaves the client bundle byte-identical), then on success swap in a fresh
server child. The worker restart always runs: SSR renders through Bun's module
cache, so a new process is the only reliable way to reflect any source edit,
client-affecting or not.

Serialized: a change arriving mid-build sets `queued` so exactly one more run
follows, collapsing further changes in between; `queuedNeedsClient` records
whether any of them needs the client, so the collapsed run never skips a client
rebuild a queued change required. A failed build leaves the current child
untouched — the error is logged and the last-good server keeps serving.
*/
async function rebuild(port: number, skipClientBuild = false): Promise<void> {
    if (building) {
        queued = true
        queuedNeedsClient ||= !skipClientBuild
        return
    }
    building = true
    try {
        const succeeded = skipClientBuild ? true : await build(buildOptions)
        if (succeeded) {
            await replaceServer(port)
        }
        /* A server/MCP-only change reuses the existing client bundle. That's correct for
           an rpc/socket handler BODY edit, but changing an rpc's method, its export name,
           or `outbox: true` changes the client proxy stub too — the stale bundle then
           calls with the old shape (e.g. a 405). Flag the skip so that case isn't silent. */
        if (skipClientBuild) {
            abideLog.info(
                'server-only change — kept the existing client bundle; if you changed an rpc method, export name, or outbox, save a client file (or restart dev) for a full rebuild',
            )
        }
    } finally {
        building = false
        if (queued) {
            queued = false
            const needsClient = queuedNeedsClient
            queuedNeedsClient = false
            void rebuild(port, !needsClient)
        }
    }
}

/*
Pick a free port once and reuse it for every restart, so the browser tab keeps
pointing at the same address. Scans upward from the shared default so dev lands
on the same predictable 3000+ address as `bun start`; reusing the number across
restarts (not re-scanning) is what keeps the tab valid.
*/
const port = findOpenPort(DEFAULT_PORT)
const firstBuild = await build(buildOptions)
if (!firstBuild) {
    abideLog.warn('initial build failed — fix the error and save to retry')
}
server = spawnWorker(port).proc

/*
ABIDE_DEV_NO_WATCH=1 skips the fs watcher: rebuild only on demand via POST
/__abide/reload (always mounted under dev), so a long-lived in-process job — e.g.
an agent editing the app's own source — isn't yanked mid-run by a save.
*/
const manualRebuild = Bun.env.ABIDE_DEV_NO_WATCH === '1'

let debounce: ReturnType<typeof setTimeout> | undefined
/*
True only while every change collapsed into the pending debounce is server/MCP-
only; one client-affecting change in the burst flips it false (latches until the
debounce fires), so a multi-file save that touches the client never skips the
client rebuild.
*/
let pendingSkipClientBuild = true
const watcher = manualRebuild
    ? undefined
    : watch(SOURCE_DIR, { recursive: true }, (_event, filename) => {
          if (!filename || isGenerated(filename)) {
              return
          }
          pendingSkipClientBuild &&= !changeAffectsClient(filename)
          clearTimeout(debounce)
          debounce = setTimeout(() => {
              const skipClientBuild = pendingSkipClientBuild
              pendingSkipClientBuild = true
              void rebuild(port, skipClientBuild)
          }, REBUILD_DEBOUNCE_MS)
      })
if (manualRebuild) {
    abideLog.info(
        `manual rebuild mode — POST http://localhost:${port}/__abide/reload to apply changes`,
    )
}

/* Tear down the watcher and the child on shutdown so neither outlives the orchestrator. */
const shutdown = async () => {
    shuttingDown = true
    watcher?.close()
    if (server) {
        await stopWorker(server)
    }
    process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGHUP', shutdown)

/*
Last-resort sync cleanup: Bun.spawn'd children aren't reaped when the parent
dies, so a crash (uncaught error, terminal close) would otherwise leave the
server holding the dev port. 'exit' fires for every exit path; kill is
synchronous, which is enough to signal the child before we go.
*/
process.on('exit', () => {
    server?.kill()
})
