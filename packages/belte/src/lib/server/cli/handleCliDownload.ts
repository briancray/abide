import { belteLog } from '../../shared/belteLog.ts'
import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { exeSuffix } from '../../shared/exeSuffix.ts'
import { isCompileTarget } from '../../shared/isCompileTarget.ts'
import { normalizeTarget } from '../../shared/normalizeTarget.ts'
import { buildEnvContent } from './buildEnvContent.ts'
import { createTarGz } from './createTarGz.ts'
import { maxSourceMtime } from './maxSourceMtime.ts'

// The sibling server binary's name for a platform — `server` / `server.exe` — must
// match what resolveServerBinary() looks for next to the unpacked CLI binary.
function serverBinaryName(platform: string): string {
    return `server${exeSuffix(normalizeTarget(platform))}`
}

/*
Process-wide per-platform build coalescing. Two concurrent curls for
the same /__belte/cli/<platform> share one promise; the later requests
await the same one the first installed. The promise both runs the
freshness check AND the rebuild, so the map insertion is synchronous
relative to the first request's entry into the function — no window
between an `await` and `pendingBuilds.set` for a second concurrent
request to slip through and fire its own buildCli against the same
output paths.
*/
const pendingBuilds = new Map<string, Promise<string | undefined>>()

async function ensurePlatformBinary(
    platform: string,
    programName: string,
    cwd: string,
): Promise<string | undefined> {
    const existing = pendingBuilds.get(platform)
    if (existing) {
        return existing
    }
    const promise = computeBinary(platform, programName, cwd)
    pendingBuilds.set(platform, promise)
    /*
    Drop the entry after settlement so a later request rebuilds if the
    source has changed again. Identity-guard so a still-pending entry
    installed by a follow-up request isn't evicted by ours.
    */
    promise.finally(() => {
        if (pendingBuilds.get(platform) === promise) {
            pendingBuilds.delete(platform)
        }
    })
    return promise
}

async function computeBinary(
    platform: string,
    programName: string,
    cwd: string,
): Promise<string | undefined> {
    const dir = `${cwd}/dist/cli-thin/${platform}`
    const binaryPath = `${dir}/${programName}`
    const serverPath = `${dir}/${serverBinaryName(platform)}`
    /*
    On-disk binaries are fresh when both the CLI and its sibling server exist AND
    the CLI's mtime beats the newest rpc/socket source mtime. The mtime check
    catches the common dev iteration where the user edits an rpc handler but didn't
    run `belte cli` again; the server-exists check forces a rebuild for a dist
    produced before the CLI co-shipped a server. Other source paths (project lib,
    transitive imports) fall back to manual rebuild.
    */
    const binaryFile = Bun.file(binaryPath)
    const serverFile = Bun.file(serverPath)
    if ((await binaryFile.exists()) && (await serverFile.exists())) {
        const binaryMtime = (await binaryFile.stat()).mtimeMs
        const sourceMtime = await maxSourceMtime(cwd)
        if (binaryMtime >= sourceMtime) {
            return binaryPath
        }
        belteLog.info(`thin cli for ${platform} is stale — rebuilding`)
    }
    try {
        belteLog.info(`lazy-building cli + server for ${platform}…`)
        // Lazy-import buildCli so the build pipeline isn't pulled into
        // production processes that never serve a download.
        const { buildCli } = await import('../../../buildCli.ts')
        await buildCli({
            cwd,
            platforms: [normalizeTarget(platform)],
        })
        return (await binaryFile.exists()) && (await serverFile.exists()) ? binaryPath : undefined
    } catch (error) {
        belteLog.error(error)
        return undefined
    }
}

/*
Handles GET /__belte/cli/<platform> — streams a gzipped tarball
containing the platform-specific thin binary + a `.env` carrying
BELTE_APP_URL (and BELTE_APP_TOKEN if the inbound request was authenticated).

Thin binaries live at `dist/cli-thin/<platform>/<programName>`
(produced by `belte cli` with BELTE_APP_URL set). Missing platforms produce
404 — the install script reports it, doesn't try to fall back.
*/
export async function handleCliDownload(
    request: Request,
    platform: string,
    programName: string,
    cwd: string,
): Promise<Response> {
    /*
    Validate the URL-supplied platform against the known target set before any
    filesystem access or lazy build. Without this, an arbitrary `platform`
    segment flows into `dist/cli-thin/<platform>` paths (a traversal/oracle
    surface) and a cache miss triggers an expensive cross-compile — so spraying
    distinct junk strings amplifies into unbounded concurrent builds.
    */
    const binaryPath = isCompileTarget(normalizeTarget(platform))
        ? await ensurePlatformBinary(platform, programName, cwd)
        : undefined
    if (!binaryPath) {
        return new Response(`unknown platform: ${platform}`, {
            status: 404,
            headers: { 'Cache-Control': NO_STORE },
        })
    }
    const appUrl = new URL(request.url).origin
    const auth = request.headers.get('authorization')
    const bearer = auth?.toLowerCase().startsWith('bearer ')
        ? auth.slice('bearer '.length)
        : undefined
    const envContent = buildEnvContent(appUrl, bearer)

    const serverPath = `${cwd}/dist/cli-thin/${platform}/${serverBinaryName(platform)}`
    const [binaryBytes, serverBytes] = await Promise.all([
        Bun.file(binaryPath).bytes(),
        Bun.file(serverPath).bytes(),
    ])
    // Ship the server beside the CLI so `/start` can spawn a local instance.
    const archive = createTarGz([
        { name: programName, content: binaryBytes, mode: 0o755 },
        { name: serverBinaryName(platform), content: serverBytes, mode: 0o755 },
        { name: '.env', content: new TextEncoder().encode(envContent), mode: 0o644 },
    ])
    return new Response(archive, {
        headers: {
            'Content-Type': 'application/gzip',
            'Content-Disposition': `attachment; filename="${programName}-${platform}.tar.gz"`,
            'Cache-Control': NO_STORE,
        },
    })
}
