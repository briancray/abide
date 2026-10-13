// 45.13 — THE RELAY BETWEEN A PAGE AND THE CLAUDE CODE ON ITS VISITOR'S MACHINE. A browser cannot reach
// a process on its own machine from an https page — Safari refuses it as mixed content, and Chrome
// asks a local-network permission of every site — so the bridge dials OUT, to this address:
//
//   GET  /__abide/bridge?code=…   the pairing, answered by a server-sent stream of what the bridge is
//                                 to do: the token it posts with, each turn, each tool reply, a cancel.
//   POST /__abide/bridge          what the bridge reports, one frame per line: a turn's events, the
//                                 MCP requests its Claude Code made, the turn's end or failure.
//
// A PAIRING IS TO A BROWSER — the `abide-caller` its page carries (26.5) — for as long as the bridge's
// stream is open. HELD IN THIS PROCESS: an app served by several needs a visitor's requests to reach
// the one its bridge dialed.

import { refuse } from '#shared/refuse.ts'
import { answered } from './answerFailure.ts'
import { raiseTimeout } from './answerRpc.ts'
import { framed } from './answerValue.ts'
import { Inbox } from './Inbox.ts'
import { randomToken } from './randomToken.ts'

/**
 * What a turn hears from the bridge, in the order the bridge posted it: an event, an MCP request, the
 * end, or a failure. ONE SHAPE for all four, every field set, since one is built per streamed chunk.
 */
export type TurnItem = {
    kind: 'event' | 'mcp' | 'end' | 'fail'
    event: unknown
    id: number
    method: string
    params: unknown
    message: string
}

/** One paired bridge: what it is sent, and the turns it is answering. */
export type Bridge = {
    caller: string
    token: string
    frames: Inbox<unknown>
    turns: Map<string, Inbox<TurnItem>>
    // Whether a page has watched this pairing: only a watched bridge is sent away when it goes idle.
    watched: boolean
    idle: ReturnType<typeof setTimeout> | undefined
}

/** How long a pairing code stands unused. */
const CODE_LIFETIME = 10 * 60_000
// How long a bridge outlives the last page watching it, so a reload does not end it.
const IDLE_GRACE = 30_000

const CODES = new Map<string, { caller: string; expires: number }>()
const BY_CALLER = new Map<string, Bridge>()
const BY_TOKEN = new Map<string, Bridge>()
const WATCHERS = new Map<string, Set<() => void>>()

// 45.19 — the relay answers once the app has handed out a pairing command, and never before.
let minted = false

/** A single-use pairing code for `caller`, and when it stops standing. 45.14. */
export function mintCode(caller: string): { code: string; expires: number } {
    const now = Date.now()
    for (const [code, pairing] of CODES)
        if (pairing.expires <= now) CODES.delete(code)
    const code = randomToken(12, 'base64url')
    const expires = now + CODE_LIFETIME
    CODES.set(code, { caller, expires })
    minted = true
    return { code, expires }
}

/** The bridge paired to `caller`, if its stream is open. */
export function pairedBridge(caller: string): Bridge | undefined {
    return BY_CALLER.get(caller)
}

/** Registers `wake` to run whenever `caller`'s pairing changes; the returned function undoes it. */
export function watchPairing(caller: string, wake: () => void): () => void {
    let watchers = WATCHERS.get(caller)
    if (watchers === undefined) {
        watchers = new Set()
        WATCHERS.set(caller, watchers)
    }
    watchers.add(wake)
    const bridge = BY_CALLER.get(caller)
    if (bridge !== undefined) {
        bridge.watched = true
        if (bridge.idle !== undefined) clearTimeout(bridge.idle)
        bridge.idle = undefined
    }
    return () => {
        watchers.delete(wake)
        if (watchers.size > 0) return
        WATCHERS.delete(caller)
        armIdle(caller)
    }
}

/** A new turn on `bridge`, the inbox its events arrive in, and the undo that closes it. */
export function openTurn(bridge: Bridge): {
    id: string
    inbox: Inbox<TurnItem>
    close: () => void
} {
    const id = randomToken(9, 'base64url')
    const inbox = new Inbox<TurnItem>()
    bridge.turns.set(id, inbox)
    return {
        id,
        inbox,
        close: () => {
            bridge.turns.delete(id)
            if (!WATCHERS.has(bridge.caller)) armIdle(bridge.caller)
        },
    }
}

// 45.22 — A BRIDGE A PAGE WATCHED, THAT NO PAGE WATCHES NOW AND THAT IS ANSWERING NO TURN, is sent
// away once the grace runs.
function armIdle(caller: string): void {
    const bridge = BY_CALLER.get(caller)
    if (
        bridge === undefined ||
        !bridge.watched ||
        bridge.turns.size > 0 ||
        bridge.idle !== undefined
    )
        return
    bridge.idle = setTimeout(() => {
        bridge.frames.push({ type: 'bye' })
        dropBridge(bridge)
    }, IDLE_GRACE)
}

function wakeWatchers(caller: string): void {
    for (const wake of WATCHERS.get(caller) ?? []) wake()
}

function item(
    kind: TurnItem['kind'],
    fields: {
        event?: unknown
        id?: number
        method?: string
        params?: unknown
        message?: string
    },
): TurnItem {
    return {
        kind,
        event: fields.event,
        id: fields.id ?? 0,
        method: fields.method ?? '',
        params: fields.params,
        message: fields.message ?? '',
    }
}

function dropBridge(bridge: Bridge): void {
    if (BY_CALLER.get(bridge.caller) === bridge) BY_CALLER.delete(bridge.caller)
    BY_TOKEN.delete(bridge.token)
    if (bridge.idle !== undefined) clearTimeout(bridge.idle)
    bridge.idle = undefined
    for (const turn of bridge.turns.values()) {
        turn.push(
            item('fail', { message: 'the Claude Code bridge disconnected' }),
        )
        turn.close()
    }
    bridge.turns.clear()
    bridge.frames.close()
    wakeWatchers(bridge.caller)
}

/** Answers `/__abide/bridge`, or `undefined` until a pairing code has been minted. 45.19. */
export async function answerBridge(request: Request): Promise<unknown> {
    if (!minted) return undefined
    if (request.method === 'GET') return pair(request)
    if (request.method === 'POST') return relay(request)
    return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
}

function pair(request: Request): Response {
    const code = new URL(request.url).searchParams.get('code') ?? ''
    const pairing = CODES.get(code)
    // 45.14 — a code pairs once.
    CODES.delete(code)
    if (pairing === undefined || pairing.expires <= Date.now())
        return answered(
            refuse(
                403,
                'This pairing code was not issued here, or it has been used, or it has expired.',
            ),
        )
    const standing = BY_CALLER.get(pairing.caller)
    if (standing !== undefined) {
        standing.frames.push({ type: 'bye' })
        dropBridge(standing)
    }
    const bridge: Bridge = {
        caller: pairing.caller,
        token: randomToken(24, 'base64url'),
        frames: new Inbox(),
        turns: new Map(),
        watched: WATCHERS.has(pairing.caller),
        idle: undefined,
    }
    BY_CALLER.set(bridge.caller, bridge)
    BY_TOKEN.set(bridge.token, bridge)
    bridge.frames.push({ type: 'paired', token: bridge.token })
    // 16.57 — a pairing stays open for as long as the bridge holds it.
    raiseTimeout(Number.POSITIVE_INFINITY)
    request.signal.addEventListener('abort', () => dropBridge(bridge))
    wakeWatchers(bridge.caller)
    return framed(
        bridge.frames[Symbol.asyncIterator](),
        'sse',
        new Headers(),
        200,
    )
}

type BridgeReport = {
    type: 'event' | 'mcp' | 'end' | 'fail'
    turn: string
    event?: unknown
    id?: number
    method?: string
    params?: unknown
    message?: string
}

async function relay(request: Request): Promise<Response> {
    const token = (request.headers.get('authorization') ?? '').replace(
        /^Bearer /,
        '',
    )
    const bridge = BY_TOKEN.get(token)
    if (bridge === undefined)
        return answered(refuse(401, 'No bridge is paired with this token.'))
    for (const line of (await request.text()).split('\n')) {
        if (line === '') continue
        const report = JSON.parse(line) as BridgeReport
        const turn = bridge.turns.get(report.turn)
        if (turn === undefined) continue
        turn.push(item(report.type, report))
    }
    return new Response(null, { status: 204 })
}
