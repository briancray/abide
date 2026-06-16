import { DEFAULT_PORT } from '../server/runtime/DEFAULT_PORT.ts'
import { findOpenPort } from '../server/runtime/findOpenPort.ts'
import { parsePort } from '../server/runtime/parsePort.ts'
import { binaryDirEnvPath } from '../shared/binaryDirEnvPath.ts'
import { dataDirEnvPath } from '../shared/dataDirEnvPath.ts'
import { readEnvFile } from '../shared/readEnvFile.ts'
import { resolveServerBinary } from './resolveServerBinary.ts'
import { waitForServer } from './waitForServer.ts'

/*
The port the embedded server binds. A `PORT` from the shell, the data-dir `.env`
(where the config form writes), or the shipped binary-dir `.env` is honored — so
the server answers at a fixed, known address another machine can reliably connect
to. With none set, the first open port at/above 3000 is chosen (matching the
standalone server's default). Precedence matches the server's own env stack:
shell > data-dir > binary-dir. A configured port is used as-is — if it's taken,
the bind failure surfaces rather than silently moving.
*/
async function resolveEmbeddedPort(programName: string): Promise<number> {
    const [dataDirEnv, binaryDirEnv] = await Promise.all([
        readEnvFile(dataDirEnvPath(programName)),
        readEnvFile(binaryDirEnvPath()),
    ])
    return (
        parsePort(process.env.PORT ?? dataDirEnv.PORT ?? binaryDirEnv.PORT) ??
        findOpenPort(DEFAULT_PORT)
    )
}

/*
Spawns the sibling server binary on a free port and waits for it to answer,
returning the live URL plus the child so the caller owns its lifetime (reaping on
disconnect/exit). Readiness is raced against the child's exit so a server that
crashes on boot (missing config) surfaces immediately instead of stalling out
waitForServer's full timeout; the loser branch resolves (never rejects) so it
can't surface as an unhandled rejection once the child is later reaped. Does not
reap a previous child — the caller owns that.
*/
export async function spawnEmbeddedServer({
    programName,
    timeoutMs,
}: {
    programName: string
    timeoutMs?: number
}): Promise<{ url: string; child: ReturnType<typeof Bun.spawn> }> {
    const port = await resolveEmbeddedPort(programName)
    const url = `http://localhost:${port}`
    const child = Bun.spawn({
        cmd: [resolveServerBinary()],
        // ABIDE_PARENT_PID lets the child exit if the parent is force-quit (a clean
        // shutdown reaps it directly). The server resolves its own config from its
        // data-dir/binary-dir .env at boot, so nothing else is injected.
        env: { ...process.env, PORT: String(port), ABIDE_PARENT_PID: String(process.pid) },
        stdio: ['inherit', 'inherit', 'inherit'],
    })
    const outcome = await Promise.race([
        waitForServer(url, timeoutMs ? { timeoutMs } : undefined).then(() => undefined),
        child.exited,
    ])
    if (outcome !== undefined) {
        throw new Error(`[abide] embedded server exited (code ${outcome}) before binding`)
    }
    return { url, child }
}
