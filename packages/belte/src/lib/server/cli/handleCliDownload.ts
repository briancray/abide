import { existsSync, statSync } from 'node:fs'
import { NO_STORE } from '../../shared/cacheControlValues.ts'
import { log } from '../../shared/log.ts'
import { normalizeTarget } from '../../shared/normalizeTarget.ts'
import { buildEnvContent } from './buildEnvContent.ts'
import { createTarGz } from './createTarGz.ts'
import { maxSourceMtime } from './maxSourceMtime.ts'

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
    const binaryPath = `${cwd}/dist/cli-thin/${platform}/${programName}`
    /*
    On-disk binary is fresh when it exists AND its mtime beats the
    newest rpc/socket source mtime. The mtime check catches the
    common dev iteration where the user edits an rpc handler but
    didn't run `belte cli` again. Other source paths (project lib,
    transitive imports) fall back to manual rebuild.
    */
    if (existsSync(binaryPath)) {
        const binaryMtime = statSync(binaryPath).mtimeMs
        const sourceMtime = await maxSourceMtime(cwd)
        if (binaryMtime >= sourceMtime) {
            return binaryPath
        }
        log.info(`thin cli for ${platform} is stale — rebuilding`)
    }
    try {
        log.info(`lazy-building thin cli for ${platform}…`)
        // Lazy-import buildCli so the build pipeline isn't pulled into
        // production processes that never serve a download.
        const { buildCli } = await import('../../../buildCli.ts')
        await buildCli({
            cwd,
            platforms: [normalizeTarget(platform)],
            thin: true,
        })
        return existsSync(binaryPath) ? binaryPath : undefined
    } catch (error) {
        log.error(error)
        return undefined
    }
}

/*
Handles GET /__belte/cli/<platform> — streams a gzipped tarball
containing the platform-specific thin binary + a `.env` carrying
APP_URL (and APP_TOKEN if the inbound request was authenticated).

Thin binaries live at `dist/cli-thin/<platform>/<programName>`
(produced by `belte cli` with APP_URL set). Missing platforms produce
404 — the install script reports it, doesn't try to fall back.
*/
export async function handleCliDownload(
    request: Request,
    platform: string,
    programName: string,
    cwd: string,
): Promise<Response> {
    const binaryPath = await ensurePlatformBinary(platform, programName, cwd)
    if (!binaryPath) {
        return new Response(`unknown platform: ${platform}`, {
            status: 404,
            headers: { 'Cache-Control': NO_STORE },
        })
    }
    const url = new URL(request.url)
    const appUrl = `${url.protocol}//${url.host}`
    const auth = request.headers.get('authorization')
    const bearer =
        auth && auth.toLowerCase().startsWith('bearer ') ? auth.slice('bearer '.length) : undefined
    const envContent = buildEnvContent(appUrl, bearer)

    const binaryBytes = await Bun.file(binaryPath).bytes()
    const archive = createTarGz([
        { name: programName, content: binaryBytes, mode: 0o755 },
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
