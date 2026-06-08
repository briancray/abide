import { watch } from 'node:fs'
import type { Subprocess } from 'bun'
import { build } from './build.ts'
import { DEFAULT_PORT } from './lib/server/runtime/DEFAULT_PORT.ts'
import { DEV_REBUILD_MESSAGE } from './lib/server/runtime/DEV_REBUILD_MESSAGE.ts'
import { findOpenPort } from './lib/server/runtime/findOpenPort.ts'
import { log } from './lib/shared/log.ts'

/*
Dev orchestrator. Replaces `bun --watch` (which only watches the import graph,
so new files / CSS / public assets never triggered a restart) with an explicit
loop we own end to end:

  1. Build the client once — uncompressed, unminified (zstd-22 on every rebuild
     dwarfs the bundle; the server serves the plain bytes when no .zst exists).
  2. Spawn the server as a child against a fixed dev port and BELTE_DEV=1, which
     makes it mount the /__belte/dev live-reload channel.
  3. Watch src/ recursively. On any change, rebuild then restart the child. SSR
     renders pages through Bun's module cache, so a fresh module graph (a new
     process) is the reliable way to reflect a source edit — Bun has no stable
     in-process invalidation. The browser reconnects to the restarted server's
     live-reload channel and reloads itself.

Restarts are serialized (a build mid-flight queues the next) and the port is
fixed so the browser tab stays valid across restarts. A failed build keeps the
last-good server running rather than tearing the loop down.
*/
const cwd = process.cwd()
const PRELOAD = new URL('./preload.ts', import.meta.url).pathname
const SERVER_ENTRY = new URL('./serverEntry.ts', import.meta.url).pathname
const SOURCE_DIR = `${cwd}/src`
// Coalesce editor save bursts (and multi-file saves) into one rebuild.
const REBUILD_DEBOUNCE_MS = 60
/*
Generated dir the build itself writes into src/ (route type declarations). It
must be ignored or each rebuild's write retriggers the watcher — an endless
rebuild loop.
*/
const GENERATED_DIR = '.belte'

// True for paths under src/.belte (the build's own generated output).
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
} as const

let server: Subprocess | undefined

function startServer(port: number): void {
    server = Bun.spawn({
        cmd: ['bun', '--preload', PRELOAD, SERVER_ENTRY],
        cwd,
        env: { ...process.env, PORT: String(port), BELTE_DEV: '1' },
        stdio: ['inherit', 'inherit', 'inherit'],
        // The child's POST /__belte/reload route signals a rebuild over IPC, so the
        // trigger rides the app's own port instead of a side channel.
        ipc(message) {
            if (message === DEV_REBUILD_MESSAGE) {
                void rebuild(port)
            }
        },
    })
}

/* Terminate the running child and wait for it to free the port (SIGKILL watchdog for a wedged exit). */
async function stopServer(): Promise<void> {
    if (!server) {
        return
    }
    const dying = server
    server = undefined
    dying.kill()
    const watchdog = setTimeout(() => dying.kill('SIGKILL'), 3000)
    await dying.exited
    clearTimeout(watchdog)
}

let building = false
let queued = false

/*
Rebuild the client, then (on success) restart the server child. Serialized: a
change arriving mid-build sets `queued` so exactly one more rebuild runs after,
collapsing any further changes in between. A failed build leaves the current
child untouched — the error is logged and the last-good server keeps serving.
*/
async function rebuild(port: number): Promise<void> {
    if (building) {
        queued = true
        return
    }
    building = true
    try {
        const succeeded = await build(buildOptions)
        if (succeeded) {
            await stopServer()
            startServer(port)
        }
    } finally {
        building = false
        if (queued) {
            queued = false
            void rebuild(port)
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
    log.warn('initial build failed — fix the error and save to retry')
}
startServer(port)

/*
BELTE_DEV_NO_WATCH=1 skips the fs watcher: rebuild only on demand via POST
/__belte/reload (always mounted under dev), so a long-lived in-process job — e.g.
an agent editing the app's own source — isn't yanked mid-run by a save.
*/
const manualRebuild = Bun.env.BELTE_DEV_NO_WATCH === '1'

let debounce: ReturnType<typeof setTimeout> | undefined
const watcher = manualRebuild
    ? undefined
    : watch(SOURCE_DIR, { recursive: true }, (_event, filename) => {
          if (!filename || isGenerated(filename)) {
              return
          }
          clearTimeout(debounce)
          debounce = setTimeout(() => void rebuild(port), REBUILD_DEBOUNCE_MS)
      })
if (manualRebuild) {
    log.info(`manual rebuild mode — POST http://localhost:${port}/__belte/reload to apply changes`)
}

/* Tear down the watcher and the child on shutdown so neither outlives the orchestrator. */
const shutdown = async () => {
    watcher?.close()
    await stopServer()
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
