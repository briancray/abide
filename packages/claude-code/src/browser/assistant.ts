import type { AgentFrame, NeutralMessage } from '@belte/belte/server/agent'
import { createSubscriber } from 'svelte/reactivity'
import { BRIDGE_PORT } from '../BRIDGE_PORT.ts'
import type { CAPABILITY_TOOLS } from '../CAPABILITY_TOOLS.ts'

/* Site-requestable capabilities — the closed vocabulary from CAPABILITY_TOOLS.
The page can request from this set; it can never name a shell/fs tool. */
type AssistantCapability = keyof typeof CAPABILITY_TOOLS

/* The accumulated assistant turn — text-so-far plus the tools it has touched.
`ask()` yields this (not raw deltas) so belte's subscribe() can surface the
whole snapshot as its `latest`, which a delta stream couldn't. */
type AssistantReply = {
    text: string
    tools: { id: string; name: string; ok?: boolean }[]
    done: boolean
}

const EMPTY_REPLY: AssistantReply = { text: '', tools: [], done: false }

/* The shape subscribe() reads: an AsyncIterable carrying a stable `name` (the
registry/dedupe key). Declared structurally so the package needn't depend on
belte's internal Subscribable type. */
type Subscribable<T> = AsyncIterable<T> & { name: string }

/* Fold one frame into the running snapshot, returning a NEW object each call so
subscribe()'s reactive read always sees a changed value. */
function applyFrame(reply: AssistantReply, frame: AgentFrame): AssistantReply {
    if (frame.type === 'text') {
        return { ...reply, text: reply.text + frame.delta }
    }
    if (frame.type === 'tool_use') {
        return { ...reply, tools: [...reply.tools, { id: frame.id, name: frame.name }] }
    }
    if (frame.type === 'tool_result') {
        return {
            ...reply,
            tools: reply.tools.map((tool) =>
                tool.id === frame.id ? { ...tool, ok: frame.ok } : tool,
            ),
        }
    }
    return { ...reply, done: true }
}

type AssistantConfig = {
    // The belte site whose MCP the local agent drives. Defaults to location.origin.
    url?: string
    port?: number
    // Browser↔bridge secret; sent on the handshake, rendered into `command`.
    token?: string
    /* Behavioral instruction sent per-chat over the socket — shapes output within
    granted tools, never expands them, so it's safe from the page (not in `command`). */
    systemPrompt?: string
    // Capability REQUEST surfaced in `command` for the user to grant by running it.
    capabilities?: AssistantCapability[]
}

type AssistantHandle = {
    // Reactive: true while the loopback socket is open.
    readonly available: boolean
    // The copy-paste `serve` command that starts the bridge for this site.
    readonly command: string
    /* The assistant's reply to `messages`, as a Subscribable of accumulating
    snapshots: `subscribe(assistant.ask(messages))` drives the turn reactively.
    Keyed by messages+bridge, so re-renders share one run and the LLM doesn't
    re-fire until the conversation actually changes. */
    ask(messages: NeutralMessage[]): Subscribable<AssistantReply>
}

/* One WebSocket per bridge address, shared across handles/components. Presence is
the connection being open; chat turns are multiplexed over it, id-tagged so a
turn yields only its own frames. */
type Connection = {
    readonly connected: boolean
    // createSubscriber tap: reading it in a reactive scope opens the socket; last reader closes it.
    track: () => void
    send(messages: NeutralMessage[], systemPrompt?: string): AsyncIterable<AgentFrame>
}

const connections = new Map<string, Connection>()

function createConnection(url: string): Connection {
    let socket: WebSocket | undefined
    let connected = false
    let nextId = 0
    // createSubscriber's start/stop fire once, so presence is a boolean, not a count.
    let watched = false
    let update: (() => void) | undefined
    // Resolves when the current socket opens; one per open(), awaited by send() before it writes.
    let opened: Promise<void> | undefined
    // id -> deliver a frame, or undefined to signal the stream ended because the socket dropped.
    const inflight = new Map<number, (frame: AgentFrame | undefined) => void>()

    // The socket stays alive while a presence reader watches OR a turn is in flight.
    function closeIfIdle() {
        if (!watched && inflight.size === 0) {
            socket?.close()
            socket = undefined
        }
    }

    function open() {
        const ws = new WebSocket(url)
        socket = ws
        let onOpen: () => void
        opened = new Promise((resolve) => {
            onOpen = resolve
        })
        ws.onopen = () => {
            connected = true
            update?.()
            onOpen()
        }
        ws.onmessage = (event) => {
            const { id, frame } = JSON.parse(event.data as string) as {
                id: number
                frame: AgentFrame
            }
            inflight.get(id)?.(frame)
        }
        ws.onclose = () => {
            connected = false
            update?.()
            // End every in-flight stream; reconnect only while a presence reader is watching.
            inflight.forEach((deliver) => {
                deliver(undefined)
            })
            inflight.clear()
            if (watched) {
                setTimeout(() => {
                    if (watched) {
                        open()
                    }
                }, 1000)
            }
        }
    }

    function ensureOpen(): Promise<void> {
        if (!socket) {
            open()
        }
        return connected ? Promise.resolve() : (opened ?? Promise.resolve())
    }

    const track = createSubscriber((u) => {
        update = u
        watched = true
        ensureOpen()
        return () => {
            watched = false
            update = undefined
            closeIfIdle()
        }
    })

    return {
        get connected() {
            return connected
        },
        track,
        async *send(messages, systemPrompt) {
            const id = nextId++
            const queue: (AgentFrame | undefined)[] = []
            let wake: (() => void) | undefined
            inflight.set(id, (frame) => {
                queue.push(frame)
                wake?.()
            })
            try {
                await ensureOpen()
                socket?.send(JSON.stringify({ id, messages, systemPrompt }))
                for (;;) {
                    while (queue.length > 0) {
                        const frame = queue.shift()
                        // undefined = socket dropped; a `done` frame = clean end of this turn.
                        if (frame === undefined) {
                            return
                        }
                        yield frame
                        if (frame.type === 'done') {
                            return
                        }
                    }
                    await new Promise<void>((resolve) => {
                        wake = resolve
                    })
                    wake = undefined
                }
            } finally {
                inflight.delete(id)
                closeIfIdle()
            }
        },
    }
}

function getConnection(url: string): Connection {
    const cached = connections.get(url)
    if (cached) {
        return cached
    }
    const connection = createConnection(url)
    connections.set(url, connection)
    return connection
}

function siteOrigin(url?: string): string {
    if (url) {
        return url
    }
    return typeof location === 'undefined' ? '' : location.origin
}

/*
Browser-side handle to a local Claude Code assistant bridge over a loopback
WebSocket: reactive presence, a chat stream, and the copy-paste command that
starts the bridge. `capabilities` and `systemPrompt` are the site's REQUEST
surface — they never grant local power (tools/permissions live with `serve`, on
the user's machine). Render the assistant only when `available`; otherwise show
`command` as the first-run hint.
*/
export function assistant(config: AssistantConfig = {}): AssistantHandle {
    const origin = siteOrigin(config.url)
    const port = config.port ?? BRIDGE_PORT
    const wsUrl = `ws://127.0.0.1:${port}${config.token ? `?token=${config.token}` : ''}`
    return {
        get available() {
            // SSR can't hold a loopback socket; the not-available branch (command hint) renders.
            if (typeof window === 'undefined') {
                return false
            }
            const connection = getConnection(wsUrl)
            connection.track()
            return connection.connected
        },
        get command() {
            const parts = [`bunx @belte/claude-code serve --url ${origin}`]
            if (port !== BRIDGE_PORT) {
                parts.push(`--port ${port}`)
            }
            if (config.token) {
                parts.push(`--token ${config.token}`)
            }
            for (const capability of config.capabilities ?? []) {
                parts.push(`--allow ${capability}`)
            }
            return parts.join(' ')
        },
        ask(messages: NeutralMessage[]): Subscribable<AssistantReply> {
            const frames = getConnection(wsUrl).send(messages, config.systemPrompt)
            async function* snapshots() {
                let reply = EMPTY_REPLY
                for await (const frame of frames) {
                    reply = applyFrame(reply, frame)
                    yield reply
                }
            }
            // name = bridge + conversation: same messages dedupe to one run across readers/re-renders.
            return Object.assign(snapshots(), { name: `${wsUrl} ${JSON.stringify(messages)}` })
        },
    }
}
