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
//
// Every frame on that stream is written here; what the rest of the server sees is a turn run, a
// pairing's status as it changes, and a pairing code.

import { isFailed } from '#shared/Failed.ts'
import { refuse } from '#shared/refuse.ts'

import { answered } from './answerFailure.ts'
import { bodyWithin } from './answerRpc.ts'
import { framed } from './answerValue.ts'
import type { ProviderEvent } from './assistant.ts'
import { Inbox } from './Inbox.ts'
import { randomToken } from './randomToken.ts'
import { RESUME_MILLISECONDS } from './RESUME_MILLISECONDS.ts'
import { onSignInChanged } from './signInChanged.ts'

/**
 * What a turn hears from the bridge, in the order the bridge posted it: an event, an MCP request, the
 * end, or a failure. ONE SHAPE for all four, every field set, since one is built per streamed chunk.
 */
type TurnItem = {
    kind: 'event' | 'mcp' | 'end' | 'fail'
    event: unknown
    id: number
    method: string
    params: unknown
    message: string
}

/** One paired bridge: what it is sent, and the turns it is answering. */
type Bridge = {
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

const CODES = new Map<string, { key: string; expires: number }>()
const BY_KEY = new Map<string, Bridge>()
const BY_TOKEN = new Map<string, Bridge>()
const WATCHERS = new Map<string, Set<() => void>>()
const FOLLOWERS = new Map<
    string,
    Set<(caller: string, signedIn: string) => void>
>()

// 44.34 — A STATUS STREAM OPENED BEFORE A SIGN-IN carries the cookies it was opened with, so it hears
// of the new one, or of the caller a sign-out rotated it to (26.9), here rather than off its own
// request.
onSignInChanged((caller, now, signedIn) => {
    for (const follow of FOLLOWERS.get(caller) ?? []) follow(now, signedIn)
})

/**
 * What a pairing is filed under: the browser, and who was signed in there (`signedInAs`).
 *
 * 44.33 — ONE PER SIGN-IN, so pairing at a browser replaces only that sign-in's own bridge, and a
 * page watching for one sign-in neither reaches another's nor keeps it from going idle (44.22).
 */
function pairingKey(caller: string, signedIn: string): string {
    return `${caller}\n${signedIn}`
}

// 44.19 — the relay answers once the app has handed out a pairing code, and never before.
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

/**
 * One turn on the bridge paired to `caller` signed in as `signedIn`: sent `prompt` under `config`,
 * yielding the events its Claude Code reports, each MCP request it makes handed to `answer` and the
 * reply sent back. 44.13, 44.17, 44.21.
 */
export async function* runTurn({
    caller,
    signedIn,
    prompt,
    config,
    maxTurns,
    answer,
    signal,
}: {
    caller: string
    signedIn: string
    prompt: unknown[]
    config: unknown
    maxTurns: number
    /** Never rejects: its failure is a reply too. */
    answer: (method: string, params: unknown) => Promise<unknown>
    signal: AbortSignal
}): AsyncGenerator<ProviderEvent> {
    const bridge = BY_KEY.get(pairingKey(caller, signedIn))
    // 44.13, 44.33 — nothing paired by this sign-in is the page's cue to show the command.
    if (bridge === undefined)
        throw refuse(
            409,
            'No Claude Code is paired with this browser as the one signed in. claudeCode.bridgeCommand() is the command that pairs one.',
        )
    const turn = randomToken(9, 'base64url')
    const inbox = new Inbox<TurnItem>()
    bridge.turns.set(turn, inbox)
    // `bridge.frames` is read at each push: a resumed stream (44.26) replaces it.
    bridge.frames.push({ type: 'turn', id: turn, prompt, config, maxTurns })
    // 44.18 — a caller hanging up ends the run on the bridge.
    const cancel = (): void => {
        bridge.frames.push({ type: 'cancel', turn })
    }
    signal.addEventListener('abort', cancel)
    try {
        for await (const item of inbox) {
            if (item.kind === 'event') yield item.event as ProviderEvent
            else if (item.kind === 'mcp')
                void answer(item.method, item.params).then((reply) => {
                    bridge.frames.push({
                        type: 'reply',
                        turn,
                        id: item.id,
                        reply,
                    })
                })
            else if (item.kind === 'end') return
            else throw refuse(502, `Claude Code failed: ${item.message}`)
        }
    } finally {
        signal.removeEventListener('abort', cancel)
        bridge.turns.delete(turn)
        if (!WATCHERS.has(bridge.key)) armIdle(bridge.key)
    }
}

/**
 * The pairing of `caller` signed in as `signedIn` as it changes, until `signal` aborts: the code that
 * pairs it while unpaired, then `undefined` the moment a bridge connects, and a code again if it goes. A
 * code that expires while nothing is paired is replaced with a fresh one. 44.20.
 *
 * 44.34 — IT FOLLOWS WHOEVER SIGNS IN AT THE BROWSER: a sign-in or a sign-out made since is the
 * pairing it watches from then on, and the code it offers is that sign-in's.
 */
export async function* pairingStatus(
    caller: string,
    signedIn: string,
    signal: AbortSignal,
): AsyncGenerator<string | undefined> {
    // A change landing while the loop was not waiting — paused at its `yield` — stays queued, so it
    // looks again; a look that finds nothing new yields nothing.
    const changes = new Inbox<undefined>()
    const waiting = changes[Symbol.asyncIterator]()
    const rouse = (): void => changes.push(undefined)
    const follow = (now: string, next: string): void => {
        caller = now
        signedIn = next
        rouse()
    }
    let watchingKey = ''
    let unwatch = (): void => {}
    let unfollow = (): void => {}
    let pairing: { code: string; expires: number } | undefined
    // `null` until the first is said; `undefined` says paired.
    let said: string | undefined | null = null
    signal.addEventListener('abort', rouse)
    try {
        while (!signal.aborted) {
            const key = pairingKey(caller, signedIn)
            if (key !== watchingKey) {
                unwatch()
                unfollow()
                unwatch = watchPairing(key, rouse)
                unfollow = followSignIn(caller, follow)
                watchingKey = key
                pairing = undefined
            }
            const paired = BY_KEY.has(key)
            if (
                !paired &&
                (pairing === undefined || pairing.expires <= Date.now())
            )
                pairing = mintCode(caller, signedIn)
            const code = paired ? undefined : pairing?.code
            if (code !== said) {
                said = code
                yield code
            }
            const renew = paired
                ? undefined
                : setTimeout(rouse, (pairing?.expires ?? 0) - Date.now())
            await waiting.next()
            clearTimeout(renew)
        }
    } finally {
        signal.removeEventListener('abort', rouse)
        unwatch()
        unfollow()
    }
}

/** Registers `wake` to run whenever the pairing filed under `key` changes; the returned function undoes it. */
function watchPairing(key: string, wake: () => void): () => void {
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

/** Registers `follow` to hear who signs in at `caller` from here on; the returned function undoes it. */
function followSignIn(
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
