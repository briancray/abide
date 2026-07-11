import type { Server } from 'bun'
import type { McpServer } from '../../mcp/types/McpServer.ts'
import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { CLI_PATH } from '../../shared/CLI_PATH.ts'
import { DEV_REBUILD_PATH } from '../../shared/DEV_REBUILD_PATH.ts'
import { DEV_RELOAD_PATH } from '../../shared/DEV_RELOAD_PATH.ts'
import { HEALTH_PATH } from '../../shared/HEALTH_PATH.ts'
import { MCP_PATH } from '../../shared/MCP_PATH.ts'
import { IDENTITY_PATH } from '../../shared/IDENTITY_PATH.ts'
import { INSPECTOR_PATH } from '../../shared/INSPECTOR_PATH.ts'
import { lenientDecode } from '../../shared/lenientDecode.ts'
import { SOCKETS_PATH } from '../../shared/SOCKETS_PATH.ts'
import { TEXT_PLAIN } from '../../shared/TEXT_PLAIN.ts'
import { handleCliDownload } from '../cli/handleCliDownload.ts'
import { handleCliInstall } from '../cli/handleCliInstall.ts'
import type { createSocketDispatcher } from '../sockets/createSocketDispatcher.ts'
import type { buildHealthPayload } from './buildHealthPayload.ts'
import { crossOriginGate } from './crossOriginGate.ts'
import { DEV_REBUILD_MESSAGE } from './DEV_REBUILD_MESSAGE.ts'
import { devReloadResponse } from './devReloadResponse.ts'
import { disableIdleTimeoutForStream } from './disableIdleTimeoutForStream.ts'
import { gzipResponse } from './gzipResponse.ts'
import { textResponse } from './textResponse.ts'
import type { DevReloadStamp } from './types/DevReloadStamp.ts'
import type { RequestStore } from './types/RequestStore.ts'

const SOCKETS_REST_PREFIX = `${SOCKETS_PATH}/`
const CLI_DOWNLOAD_PREFIX = `${CLI_PATH}/`

/*
Returned by the router when a request matches none of its framework routes, so
the fetch handler falls through to the app's rpc/page/asset routes. A dedicated
sentinel — not `undefined` — because a successful socket upgrade legitimately
returns `undefined` (Bun's signal that it took the connection over), which must
stay distinct from "not a plumbing route".
*/
export const PLUMBING_PASS: unique symbol = Symbol('abide.plumbingPass')

/* Either the handled response (buffered, streamed, or `undefined` for a socket
   upgrade handoff) or the pass sentinel. Returned synchronously so the common
   app-route path pays no extra await/promise allocation — only a matched route
   yields a promise. */
type PlumbingResult = Response | undefined | Promise<Response | undefined> | typeof PLUMBING_PASS

/* dispatchRequest, injected: runs a handler inside the per-request scope + app.handle middleware. */
type DispatchRequest = (
    req: Request,
    pathParams: Record<string, string>,
    handler: (
        req: Request,
        pathParams: Record<string, string>,
        store: RequestStore,
    ) => Promise<Response>,
    url: URL,
) => Promise<Response>

/*
The framework's own HTTP surface — health/identity probe, inspector, the dev
live-reload + rebuild channels, the sockets upgrade and its
SSE/JSON HTTP face, the MCP endpoint, and CLI install/download — resolved ahead
of the app's rpc/page routes. Extracted from createServer's fetch handler as a
sibling of createRouteDispatcher: the app-route half already sat behind a seam,
this is the framework-plumbing half, testable without a live socket. The probe
and dev/inspector channels answer directly (ahead of app.handle) so they land
even when the app guards everything behind auth; the sockets-REST/MCP/CLI faces
run through dispatchRequest so app.handle auth applies like the rpc paths.
Returns PLUMBING_PASS for any path it doesn't own, so the caller continues to
the app routes.
*/
export function createPlumbingRouter({
    dev,
    clientFingerprint,
    inspectorHandler,
    socketDispatcher,
    mcp,
    cliName,
    cliCwd,
    healthPayload,
    dispatchRequest,
}: {
    dev: boolean
    clientFingerprint: DevReloadStamp | undefined
    inspectorHandler: ((request: Request, url: URL) => Promise<Response>) | undefined
    socketDispatcher: ReturnType<typeof createSocketDispatcher>
    mcp: McpServer | undefined
    cliName: string
    cliCwd: string
    healthPayload: (req: Request) => ReturnType<typeof buildHealthPayload>
    dispatchRequest: DispatchRequest
}): (req: Request, url: URL, bunServer: Server<unknown>) => PlumbingResult {
    /*
    Health/identity probe — answered directly, ahead of any app.handle
    middleware, so the bundle's connect screen, the CLI, and the client
    health() can confirm a URL really is a live abide server even when the app
    guards everything behind auth (reporting `authenticated: false` requires
    exactly that). The app's optional health hook contributes fields; the
    framework's identity keys win on collision, and a thrown hook is logged and
    skipped so an app bug can't masquerade as an unreachable server.
    IDENTITY_PATH is the compatibility alias for the same payload.
    */
    async function healthProbe(req: Request, url: URL): Promise<Response> {
        const payload = await healthPayload(req)
        return gzipResponse(
            req,
            Response.json(
                /*
                The IDENTITY_PATH alias keeps the legacy `abide: true` shape:
                already-shipped probers check it with strict equality, and a
                version string would make them treat an upgraded healthy server
                as not-abide.
                */
                url.pathname === IDENTITY_PATH ? { ...payload, abide: true } : payload,
                { headers: { 'Cache-Control': NO_STORE } },
            ),
        )
    }

    return function routePlumbing(req, url, bunServer) {
        if (url.pathname === HEALTH_PATH || url.pathname === IDENTITY_PATH) {
            return healthProbe(req, url)
        }
        /*
        Inspector surface — answered directly, ahead of app.handle, since it's
        privileged operator tooling gated by ABIDE_ENABLE_INSPECTOR (not the
        app's user auth). Undefined handler = flag off, so the whole block
        compiles out of the hot path when the inspector's off.
        */
        if (
            inspectorHandler &&
            (url.pathname === INSPECTOR_PATH || url.pathname.startsWith(`${INSPECTOR_PATH}/`))
        ) {
            // The events feed is long-lived SSE: opt it out of the idle timeout,
            // else Bun reaps it and the reconnect replays the whole buffer
            // (duplicate boot logs every ~10s).
            return inspectorHandler(req, url).then((response) =>
                disableIdleTimeoutForStream(bunServer, req, response),
            )
        }
        /*
        Dev live-reload channel — answered directly, ahead of app.handle, so a
        restart-driven reconnect always lands even when the app guards
        everything behind auth. Only mounted under `abide dev`.
        */
        if (clientFingerprint !== undefined && url.pathname === DEV_RELOAD_PATH) {
            // Long-lived SSE: opt out of the idle timeout, else Bun reaps it and
            // the reconnect triggers a spurious reload loop.
            return disableIdleTimeoutForStream(bunServer, req, devReloadResponse(clientFingerprint))
        }
        /*
        Manual rebuild trigger: signal the orchestrator parent over IPC to
        rebuild + restart. Same-origin sibling of the live-reload channel, so a
        script refreshes on the app's own port. process.send exists only when
        the dev orchestrator spawned us with ipc; the optional chain no-ops on a
        bare server.
        */
        if (dev && req.method === 'POST' && url.pathname === DEV_REBUILD_PATH) {
            process.send?.(DEV_REBUILD_MESSAGE)
            return new Response('rebuilding\n', { headers: { 'Content-Type': TEXT_PLAIN } })
        }
        if (url.pathname === SOCKETS_PATH) {
            // Reject cross-origin upgrades (CSWSH) before handing off to Bun.
            const upgradeForbidden = crossOriginGate(req, url)
            if (upgradeForbidden) {
                return upgradeForbidden
            }
            if (bunServer.upgrade(req, { data: {} })) {
                return undefined
            }
            return textResponse(400, 'Upgrade failed')
        }
        /*
        HTTP face of a socket (`/__abide/sockets/<name>`) — tail over SSE / JSON
        and publish — for the CLI and MCP. Runs through dispatchRequest so
        app.handle auth applies, like the rpc paths. The socket name may contain
        `/` (nested files), so it's the whole remaining pathname, percent-decoded.
        */
        if (url.pathname.startsWith(SOCKETS_REST_PREFIX)) {
            /*
            Gate cross-origin browser publishes (CSRF, see crossOriginGate). GET
            tail reads stay open cross-origin like rpc reads; only the mutating
            POST is gated.
            */
            const publishForbidden = crossOriginGate(req, url, { allowReadOnly: true })
            if (publishForbidden) {
                return publishForbidden
            }
            const name = lenientDecode(url.pathname.slice(SOCKETS_REST_PREFIX.length))
            return dispatchRequest(req, {}, async () => socketDispatcher.rest(req, name), url)
        }
        if (url.pathname === MCP_PATH && mcp) {
            // Gate cross-site browser posts (CSRF, see crossOriginGate).
            const mcpForbidden = crossOriginGate(req, url)
            if (mcpForbidden) {
                return mcpForbidden
            }
            return dispatchRequest(req, {}, async () => mcp.handle(req), url)
        }
        if (url.pathname === CLI_PATH) {
            return dispatchRequest(req, {}, async () => handleCliInstall(req, cliName), url)
        }
        if (url.pathname.startsWith(CLI_DOWNLOAD_PREFIX)) {
            const platform = url.pathname.slice(CLI_DOWNLOAD_PREFIX.length)
            return dispatchRequest(
                req,
                {},
                async () => handleCliDownload(req, platform, cliName, cliCwd),
                url,
            )
        }
        return PLUMBING_PASS
    }
}
