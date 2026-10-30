// 44.13 — THE RELAY BETWEEN A PAGE AND THE CLAUDE CODE ON ITS VISITOR'S MACHINE. A browser cannot reach
// a process on its own machine from an https page — Safari refuses it as mixed content, and Chrome
// asks a local-network permission of every site — so the bridge dials OUT, to this address:
//
//   GET  /__abide/bridge?code=…   the pairing, answered by a server-sent stream of what the bridge is
//                                 to do: the token it posts with, each turn, each tool reply, a cancel.
//   GET  /__abide/bridge          the same stream, resumed by the token after it dropped (44.26).
//   POST /__abide/bridge          what the bridge reports, one frame per line: a turn's events, the
//                                 MCP requests its Claude Code made, the turn's end or failure.
//
// A PAIRING IS TO A BROWSER — the `abide-caller` its page carries (26.5) — and to whoever was signed
// in there when its code was minted (44.33), for as long as the bridge's stream is open, or
// resumable. HELD IN THIS PROCESS: an app served by several needs a visitor's requests to reach the
// one its bridge dialed.

import { isFailed } from '#shared/Failed.ts'
import { refuse } from '#shared/refuse.ts'

import { answered } from './answerFailure.ts'
import { bodyWithin } from './answerRpc.ts'
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
    /** The browser and the sign-in it is paired to (`pairingKey`). 44.33. */
    key: string
    token: string
    frames: Inbox<unknown>
    turns: Map<string, Inbox<TurnItem>>
    // Whether a page has watched this pairing: only a watched bridge is sent away when it goes idle.
    watched: boolean
    idle: ReturnType<typeof setTimeout> | undefined
    // Set while the stream is dropped and the pairing waits to be resumed (44.26).
    held: ReturnType<typeof setTimeout> | undefined
}

/** How long a pairing code stands unused. */
const CODE_LIFETIME = 10 * 60_000
// How long a bridge outlives the last page watching it, so a reload does not end it.
const IDLE_GRACE = 30_000
/** How long a pairing whose stream dropped waits to be resumed. 44.26. */
export const RESUME_MILLISECONDS = 60_000

const CODES = new Map<string, { key: string; expires: number }>()
const BY_KEY = new Map<string, Bridge>()
const BY_TOKEN = new Map<string, Bridge>()
const WATCHERS = new Map<string, Set<() => void>>()
const FOLLOWERS = new Map<
    string,
    Set<(caller: string, signedIn: string) => void>
>()

/**
 * What a pairing is filed under: the browser, and who was signed in there (`signedInAs`).
 *
 * 44.33 — ONE PER SIGN-IN, so pairing at a browser replaces only that sign-in's own bridge, and a
 * page watching for one sign-in neither reaches another's nor keeps it from going idle (44.22).
 */
function pairingKey(caller: string, signedIn: string): string {
    return `${caller}\n${signedIn}`
}

// 44.19 — the relay answers once the app has handed out a pairing command, and never before.
let minted = false

/** A single-use pairing code for `caller` signed in as `signedIn`, and when it stops standing. 44.14. */
export function mintCode(
    caller: string,
    signedIn: string,
): { code: string; expires: number } {
    const now = Date.now()
    for (const [code, pairing] of CODES)
        if (pairing.expires <= now) CODES.delete(code)
    const code = randomToken(12, 'base64url')
    const expires = now + CODE_LIFETIME
    CODES.set(code, { key: pairingKey(caller, signedIn), expires })
    minted = true
    return { code, expires }
}

/** The bridge paired to `caller` signed in as `signedIn`, if its stream is open. 44.33. */
export function pairedBridge(
    caller: string,
    signedIn: string,
): Bridge | undefined {
    return BY_KEY.get(pairingKey(caller, signedIn))
}

/**
 * Registers `wake` to run whenever the pairing of `caller` signed in as `signedIn` changes; the
 * returned function undoes it.
 */
export function watchPairing(
    caller: string,
    signedIn: string,
    wake: () => void,
): () => void {
    const key = pairingKey(caller, signedIn)
    let watchers = WATCHERS.get(key)
    if (watchers === undefined) {
        watchers = new Set()
        WATCHERS.set(key, watchers)
    }
    watchers.add(wake)
    const bridge = BY_KEY.get(key)
    if (bridge !== undefined) {
        bridge.watched = true
        if (bridge.idle !== undefined) clearTimeout(bridge.idle)
        bridge.idle = undefined
    }
    return () => {
        watchers.delete(wake)
        if (watchers.size > 0) return
        WATCHERS.delete(key)
        armIdle(key)
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
            if (!WATCHERS.has(bridge.key)) armIdle(bridge.key)
        },
    }
}

// 44.22 — A BRIDGE A PAGE WATCHED, THAT NO PAGE WATCHES NOW AND THAT IS ANSWERING NO TURN, is sent
// away once the grace runs.
function armIdle(key: string): void {
    const bridge = BY_KEY.get(key)
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

function wakeWatchers(key: string): void {
    for (const wake of WATCHERS.get(key) ?? []) wake()
}

/**
 * Registers `follow` to hear who signs in at `caller` from here on, and the caller a sign-out rotates
 * it to (26.9); the returned function undoes it.
 *
 * 44.34 — A STATUS STREAM OPENED BEFORE A SIGN-IN carries the cookies it was opened with, so it hears
 * of the new one here rather than off its own request.
 */
export function followSignIn(
    caller: string,
    follow: (caller: string, signedIn: string) => void,
): () => void {
    let followers = FOLLOWERS.get(caller)
    if (followers === undefined) {
        followers = new Set()
        FOLLOWERS.set(caller, followers)
    }
    followers.add(follow)
    return () => {
        followers.delete(follow)
        if (followers.size === 0) FOLLOWERS.delete(caller)
    }
}

/** Tells every status stream at `caller` that the browser is `now`, signed in as `signedIn`. 44.34. */
export function signedInAt(
    caller: string,
    now: string,
    signedIn: string,
): void {
    for (const follow of FOLLOWERS.get(caller) ?? []) follow(now, signedIn)
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
    if (BY_KEY.get(bridge.key) === bridge) BY_KEY.delete(bridge.key)
    BY_TOKEN.delete(bridge.token)
    if (bridge.idle !== undefined) clearTimeout(bridge.idle)
    bridge.idle = undefined
    if (bridge.held !== undefined) clearTimeout(bridge.held)
    bridge.held = undefined
    for (const turn of bridge.turns.values()) {
        turn.push(
            item('fail', { message: 'the Claude Code bridge disconnected' }),
        )
        turn.close()
    }
    bridge.turns.clear()
    bridge.frames.close()
    wakeWatchers(bridge.key)
}

/** Answers `/__abide/bridge`, or `undefined` until a pairing code has been minted. 44.19. */
export async function answerBridge(request: Request): Promise<unknown> {
    if (!minted) return undefined
    if (request.method === 'GET') return pair(request)
    if (request.method === 'POST') return relay(request)
    return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
}

function pair(request: Request): Response {
    const code = new URL(request.url).searchParams.get('code')
    if (code === null) return resume(request)
    const pairing = CODES.get(code)
    // 44.14 — a code pairs once.
    CODES.delete(code)
    if (pairing === undefined || pairing.expires <= Date.now())
        return answered(
            refuse(
                403,
                'This pairing code was not issued here, or it has been used, or it has expired.',
            ),
        )
    const standing = BY_KEY.get(pairing.key)
    if (standing !== undefined) {
        standing.frames.push({ type: 'bye' })
        dropBridge(standing)
    }
    const bridge: Bridge = {
        key: pairing.key,
        token: randomToken(24, 'base64url'),
        frames: new Inbox(),
        turns: new Map(),
        watched: WATCHERS.has(pairing.key),
        idle: undefined,
        held: undefined,
    }
    BY_KEY.set(bridge.key, bridge)
    BY_TOKEN.set(bridge.token, bridge)
    bridge.frames.push({ type: 'paired', token: bridge.token })
    wakeWatchers(bridge.key)
    return attach(bridge, request)
}

/** The bridge the request's bearer token was handed when it paired. */
function pairedBy(request: Request): Bridge | undefined {
    return BY_TOKEN.get(
        (request.headers.get('authorization') ?? '').replace(/^Bearer /, ''),
    )
}

// 44.26 — A DROPPED STREAM IS RESUMED BY ITS TOKEN, with every frame it had not sent: the stream it
// replaces, still open where the drop went unnoticed here, is ended.
function resume(request: Request): Response {
    const bridge = pairedBy(request)
    if (bridge === undefined)
        return answered(refuse(401, 'No bridge is paired with this token.'))
    if (bridge.held !== undefined) clearTimeout(bridge.held)
    else bridge.frames = bridge.frames.handOff()
    bridge.held = undefined
    return attach(bridge, request)
}

/** `bridge`'s frames as this request's stream, held for `RESUME_MILLISECONDS` once it drops. */
function attach(bridge: Bridge, request: Request): Response {
    const frames = bridge.frames
    request.signal.addEventListener('abort', () => {
        if (bridge.frames !== frames || !BY_TOKEN.has(bridge.token)) return
        bridge.frames = frames.handOff()
        bridge.held = setTimeout(() => dropBridge(bridge), RESUME_MILLISECONDS)
    })
    // 16.57 — `App.fetch` beats it, which is how a bridge tells a connection
    // gone silent from a quiet one (44.27).
    return framed(frames[Symbol.asyncIterator](), 'sse', new Headers(), 200)
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
    const bridge = pairedBy(request)
    if (bridge === undefined)
        return answered(refuse(401, 'No bridge is paired with this token.'))
    // 16.78 — under the environment's body ceiling, as a handler's body is.
    const body = await bodyWithin(request, undefined)
    if (isFailed(body)) return answered(body)
    // 44.23 — EVERY LINE PARSED BEFORE ANY IS RELAYED, so a post with one that is not JSON is refused
    // whole rather than relayed in part.
    const reports: BridgeReport[] = []
    for (const line of (await body.text()).split('\n')) {
        if (line === '') continue
        try {
            reports.push(JSON.parse(line) as BridgeReport)
        } catch {
            return answered(refuse(400, 'A reported line is not JSON.'))
        }
    }
    for (const report of reports) {
        const turn = bridge.turns.get(report.turn)
        if (turn === undefined) continue
        turn.push(item(report.type, report))
    }
    return new Response(null, { status: 204 })
}
