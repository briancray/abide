import type { NeutralMessage } from '@belte/belte/server/agent'
import { BRIDGE_PORT } from './BRIDGE_PORT.ts'
import type { ClaudePermissions } from './ClaudePermissions.ts'
import { cliEngine } from './cliEngine.ts'

/*
Runs on the USER's machine, on loopback, so a remote belte site's browser can
drive the user's local Claude Code over its own MCP surface. A separate process
from any deployed server — apps that don't use this pay nothing. Drives the
installed `claude` binary (via cliEngine), so it needs only Bun + claude on PATH,
no @anthropic-ai/claude-agent-sdk.

The page reaches the bridge over a single WebSocket: presence IS the connection
being open (no polling), and chat frames ride the same socket, id-tagged so
concurrent turns don't interleave. This is the loopback channel only — Claude
still talks to the app's MCP over HTTP (the `mcp__<app>__*` server).

The trust boundary: capabilities (`tools`/`permissions`) are chosen HERE, by the
user starting the bridge — never sent from the page, which could only ever author
a request, not a grant. Defaults are locked down: `tools: []` exposes only the
site's `mcp__<app>__*` verbs (no shell/fs) and sidesteps the headless no-TTY
permission prompt, with prompting left at `default`.
*/
type ServeConfig = {
    // The belte site whose MCP this agent drives, and (by default) the only origin allowed in.
    url: string
    port?: number
    // Origins permitted to reach this bridge. Defaults to [url]; doubles as a DNS-rebind guard.
    allowOrigins?: string[]
    // Optional browser↔bridge secret echoed by the page on the handshake; rejects other sites.
    token?: string
    // Optional bridge→site MCP bearer, distinct from `token`.
    mcpToken?: string
    // Built-in tools the local agent may use, on top of the site's verbs. Default [] — site verbs only.
    tools?: string[]
    permissions?: ClaudePermissions
}

// One chat turn from the page: `id` correlates the frames streamed back on the shared socket.
type ChatRequest = { id: number; messages: NeutralMessage[]; systemPrompt?: string }

/* Per-connection state: the abort controllers for this socket's in-flight turns,
so closing the page can cancel each run — killing its spawned Claude process
rather than leaving it running on the user's machine. */
type WsData = { controllers: Set<AbortController> }

export function serve(config: ServeConfig) {
    const allowOrigins = config.allowOrigins ?? [config.url]

    return Bun.serve<WsData>({
        // Loopback only — never 0.0.0.0.
        hostname: '127.0.0.1',
        port: config.port ?? BRIDGE_PORT,
        // Origin allow-list + token are checked on the handshake (also the rebind guard);
        // a passing request is upgraded to the WebSocket, anything else is refused.
        fetch(request, server) {
            const origin = request.headers.get('origin') ?? ''
            if (!allowOrigins.includes(origin)) {
                return new Response(null, { status: 403 })
            }
            if (config.token && new URL(request.url).searchParams.get('token') !== config.token) {
                return new Response(null, { status: 401 })
            }
            if (server.upgrade(request, { data: { controllers: new Set() } })) {
                return undefined
            }
            return new Response('Upgrade required', { status: 426 })
        },
        websocket: {
            async message(ws, raw) {
                let request: ChatRequest
                try {
                    request = JSON.parse(String(raw))
                } catch {
                    return
                }
                /* Per-turn controller, registered so close() can abort this run even
                while it's idle (between frames) — the readyState check below only
                fires on the next frame, which a stalled run never produces. */
                const controller = new AbortController()
                ws.data.controllers.add(controller)
                /* Per-message engine so the site's behavioral systemPrompt can vary
                per turn — it shapes output within the granted tools, never expands
                them, so it's safe to take from the page. */
                const runAgent = cliEngine({
                    tools: config.tools ?? [],
                    permissions: config.permissions ?? { defaultMode: 'default' },
                    mcpToken: config.mcpToken,
                    systemPrompt: request.systemPrompt,
                    abortController: controller,
                })
                // The engine ignores `surface` — it dials the site's MCP via `origin`.
                const frames = runAgent({
                    surface: undefined as never,
                    messages: request.messages,
                    origin: config.url,
                })
                try {
                    for await (const frame of frames) {
                        // Stop the run if the page closed the socket mid-stream.
                        if (ws.readyState !== 1) {
                            break
                        }
                        ws.send(JSON.stringify({ id: request.id, frame }))
                    }
                } catch (error) {
                    // An abort (page closed) is expected; surface only real failures.
                    if (!controller.signal.aborted) {
                        console.error(error)
                    }
                } finally {
                    ws.data.controllers.delete(controller)
                }
            },
            // Page gone: abort every in-flight run so its Claude process dies with the socket.
            close(ws) {
                ws.data.controllers.forEach((controller) => {
                    controller.abort()
                })
                ws.data.controllers.clear()
            },
        },
    })
}
