// 44.13 — THE RELAY BETWEEN A PAGE AND THE CLAUDE CODE ON ITS VISITOR'S MACHINE. A browser cannot reach
// a process on its own machine from an https page — Safari refuses it as mixed content, and Chrome
// asks a local-network permission of every site — so the bridge dials OUT, to this address:
//
//   GET  /__abide/bridge?code=…   the pairing, answered by a server-sent stream of what the bridge is
//                                 to do: the token it posts with, each turn, each tool reply, a cancel.
//   GET  /__abide/bridge?holder=… who a code was minted for, as an opaque string, without spending it, the app's name and the note it was minted with
//                                 (44.63): what a bridge always allowing a site checks a link against.
//   GET  /__abide/bridge          the same stream, resumed by the token after it dropped (44.26).
//   POST /__abide/bridge          what the bridge reports, one frame per line: a turn's events, the
//                                 MCP requests and permission prompts its Claude Code made, the turn's
//                                 end or failure, and the tools the pairing asked for that it cannot
//                                 give (44.61).
//
// A PAIRING IS TO A BROWSER — the `abide-caller` its page carries (26.5) — and to whoever was signed
// in there when its code was minted (44.33), for as long as the bridge's stream is open, or
// resumable. HELD IN THIS PROCESS: an app served by several needs a visitor's requests to reach the
// one its bridge dialed.
//
// Every frame on that stream is written here; what the rest of the server sees is a turn run, a
// pairing's status as it changes, and a pairing code.
//
// 44.77 — THE NATIVE APP'S OWN BRIDGE is one more `Bridge`, filed under no pairing: its frames are
// read in this process by the same core a bridge runs (`@abide/bridge/serveTurns`), and its reports
// land here as a post's would. It stands in for any pairing a request from the window asks after.

import { isFailed } from '#shared/Failed.ts'
import { appName, namedLogger } from '#shared/log.ts'
import { refuse } from '#shared/refuse.ts'

import { answered } from './answerFailure.ts'
import { bodyWithin } from './answerRpc.ts'
import { framed } from './answerValue.ts'
import type { ProviderEvent } from './assistant.ts'
import { callerOf } from './callerOf.ts'
import { fileIn } from './fileIn.ts'
import { Inbox } from './Inbox.ts'
import { holderOf, signedInAs } from './principal.ts'
import { randomToken } from './randomToken.ts'
import { request } from './requestScope.ts'
import { RESUME_MILLISECONDS } from './RESUME_MILLISECONDS.ts'
import { onSignInChanged } from './signInChanged.ts'

/**
 * What a turn hears from the bridge, in the order the bridge posted it: an event, an MCP request, a
 * permission prompt — the tool it asks for as `method`, its input as `params` — the end, or a failure.
 * ONE SHAPE for all five, every field set, since one is built per streamed chunk.
 */
type TurnItem = {
    kind: 'event' | 'mcp' | 'permission' | 'end' | 'fail'
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
    // 44.83 — each permission prompt the page has yet to answer, by the id its event carries.
    prompts: Map<string, { turn: string; id: number }>
    // Whether a page has watched this pairing: only a watched bridge is sent away when it goes idle.
    watched: boolean
    idle: ReturnType<typeof setTimeout> | undefined
    // Set while the stream is dropped and the pairing waits to be resumed (44.26).
    held: ReturnType<typeof setTimeout> | undefined
    // What its code asked for of the visitor's machine, and of that what it reported it cannot give.
    asked: string[]
    missing: string[]
}

/** A pairing as a status stream says it: whether a bridge is paired, the code that pairs one, and what it cannot give. */
export type PairingState = { paired: boolean; code: string; missing: string[] }

const RELAY_LOG = namedLogger('abide:assistant')

/** How long a pairing code stands unused. */
const CODE_LIFETIME = 10 * 60_000
// How long a bridge outlives the last page watching it, so a reload does not end it.
const IDLE_GRACE = 30_000

// Each code minted and unspent: the pairing it is for, who it was minted for, what it asks, and the
// app's note on why (44.91).
const CODES = new Map<
    string,
    {
        key: string
        expires: number
        holder: string
        tools: string[]
        note: string | undefined
    }
>()
const BY_KEY = new Map<string, Bridge>()
const BY_TOKEN = new Map<string, Bridge>()
const WATCHERS = new Map<string, Set<() => void>>()
const FOLLOWERS = new Map<
    string,
    Set<(caller: string, signedIn: string) => void>
>()

/** The cookie the native app's window carries its credential in. 44.79. */
export const NATIVE_COOKIE = 'abide-native-credential'

// 44.77 — the native app's own bridge: the credential its window holds, the bridge once a turn has
// started it, and the MCP servers 44.58 last found in the user scope.
const LOCAL: {
    secret: string
    bridge: Bridge | undefined
    servers: ReadonlySet<string>
} = { secret: '', bridge: undefined, servers: new Set() }

/**
 * Lends this machine's Claude Code to every request carrying `secret` in `NATIVE_COOKIE` — the
 * native app's window onto the app it started. 44.77, 44.79. Settles once the user scope's MCP
 * servers are read (44.58); a page watching before then is told when they are.
 */
export function serveLocally(secret: string): Promise<void> {
    LOCAL.secret = secret
    return refreshLocalServers()
}

/** Whether the request being answered is from the native app's window, by its credential. 44.79. */
export function fromNativeWindow(): boolean {
    if (LOCAL.secret === '') return false
    const cookie = request().headers.get('cookie')
    return (
        cookie !== null &&
        new Bun.CookieMap(cookie).get(NATIVE_COOKIE) === LOCAL.secret
    )
}

/** Whether the native app's own bridge stands for a request `local` says is from its window: Claude Code is found. */
function localStands(local: boolean): boolean {
    return local && Bun.which('claude') !== null
}

/** Whether a pairing is paired: by a code, or by the native app's own bridge. */
function pairedFor(key: string, local: boolean): boolean {
    return BY_KEY.has(key) || localStands(local)
}

/** What of `tools` the bridge a pairing reaches cannot make available. 44.60. */
function missingFor(
    key: string,
    local: boolean,
    tools: readonly string[],
): string[] {
    const bridge = BY_KEY.get(key)
    if (bridge !== undefined) return missingOf(tools, bridge.missing)
    const missing: string[] = []
    if (!localStands(local)) return missing
    // 44.78 — given every tool asked for, it lacks only an MCP tool whose server 44.58 does not find.
    for (const tool of tools) {
        const server = serverOfTool(tool)
        if (server !== undefined && !LOCAL.servers.has(server))
            missing.push(tool)
    }
    return missing
}

/** The MCP server `tool` is of, as 44.29 names it, or `undefined` for a built-in. */
function serverOfTool(tool: string): string | undefined {
    if (!tool.startsWith('mcp__')) return undefined
    const rest = tool.slice('mcp__'.length)
    const end = rest.indexOf('__')
    return end === -1 ? rest : rest.slice(0, end)
}

/** Reads the user scope's MCP servers again, and tells every page watching where they changed. 44.58, 44.61. */
async function refreshLocalServers(): Promise<void> {
    const { visitorServers } = await import('@abide/bridge/grant')
    const found = new Set((await visitorServers(undefined)).keys())
    const before = [...LOCAL.servers].join(',')
    LOCAL.servers = found
    if ([...found].join(',') === before) return
    for (const wakes of WATCHERS.values()) for (const wake of wakes) wake()
}

/** The native app's own bridge, started on its first turn. */
async function localBridge(): Promise<Bridge> {
    if (LOCAL.bridge !== undefined) return LOCAL.bridge
    const { serveTurns } = await import('@abide/bridge/serveTurns')
    if (LOCAL.bridge !== undefined) return LOCAL.bridge
    const bridge: Bridge = {
        key: '',
        token: '',
        frames: new Inbox(),
        turns: new Map(),
        prompts: new Map(),
        watched: false,
        idle: undefined,
        held: undefined,
        asked: [],
        missing: [],
    }
    LOCAL.bridge = bridge
    const core = serveTurns({
        site: 'this app',
        claude: 'claude',
        claudeArgs: [],
        full: true,
        report: (report) => delivered(bridge, report),
        say: (line) => RELAY_LOG.debug(line),
        beforeTurn: refreshLocalServers,
    })
    // 44.30 — the runs end with the process.
    process.once('exit', core.stop)
    void (async () => {
        for await (const frame of bridge.frames)
            core.take(frame as Parameters<typeof core.take>[0])
    })()
    return bridge
}

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

/**
 * A single-use pairing code for `caller` signed in as `signedIn`, asking for `tools` of the visitor's
 * machine, and when it stops standing. 44.14.
 */
export function mintCode(
    caller: string,
    signedIn: string,
    tools: readonly string[] = [],
    note?: string,
): { code: string; expires: number } {
    const now = Date.now()
    for (const [code, pairing] of CODES)
        if (pairing.expires <= now) CODES.delete(code)
    const code = randomToken(12, 'base64url')
    const expires = now + CODE_LIFETIME
    CODES.set(code, {
        key: pairingKey(caller, signedIn),
        expires,
        holder: holderOf(caller, signedIn),
        tools: [...tools],
        note,
    })
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
    local,
}: {
    caller: string
    signedIn: string
    /** Whether the request is from the native app's window (`fromNativeWindow`). */
    local: boolean
    prompt: unknown[]
    config: unknown
    maxTurns: number
    /** Never rejects: its failure is a reply too. */
    answer: (method: string, params: unknown) => Promise<unknown>
    signal: AbortSignal
}): AsyncGenerator<ProviderEvent> {
    const key = pairingKey(caller, signedIn)
    const bridge =
        BY_KEY.get(key) ??
        (localStands(local) ? await localBridge() : undefined)
    // 44.13, 44.33 — nothing paired by this sign-in is the page's cue to show the command.
    if (bridge === undefined)
        throw refuse(
            409,
            'No Claude Code is paired with this browser as the one signed in. provider.claudeCode.bridgeCommand() is the command that pairs one.',
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
            else if (item.kind === 'permission') {
                // 44.81 — a prompt is the page's to answer, by `permit`.
                const id = `${turn}.${item.id}`
                bridge.prompts.set(id, { turn, id: item.id })
                yield {
                    type: 'permission',
                    id,
                    name: item.method,
                    input: item.params,
                }
            } else if (item.kind === 'end') return
            else throw refuse(502, `Claude Code failed: ${item.message}`)
        }
    } finally {
        signal.removeEventListener('abort', cancel)
        bridge.turns.delete(turn)
        // The bridge answers what is left as the run ends.
        for (const [id, prompt] of bridge.prompts)
            if (prompt.turn === turn) bridge.prompts.delete(id)
        if (!WATCHERS.has(bridge.key)) armIdle(bridge.key)
    }
}

/**
 * Answers the permission prompt `id` of a turn on the bridge paired to `caller` signed in as
 * `signedIn` — `local` as `runTurn` reads it — allowing the call or not. 44.83.
 *
 * Throws 404 where that bridge has no such prompt waiting.
 */
export function permit({
    caller,
    signedIn,
    local,
    id,
    allow,
}: {
    caller: string
    signedIn: string
    local: boolean
    id: string
    allow: boolean
}): void {
    const bridge =
        BY_KEY.get(pairingKey(caller, signedIn)) ??
        (localStands(local) ? LOCAL.bridge : undefined)
    const prompt = bridge?.prompts.get(id)
    if (bridge === undefined || prompt === undefined)
        throw refuse(
            404,
            'No permission prompt of that id is waiting on the Claude Code paired with this browser.',
        )
    bridge.prompts.delete(id)
    bridge.frames.push({
        type: 'permit',
        turn: prompt.turn,
        id: prompt.id,
        allow,
    })
}

/**
 * The pairing of `caller` signed in as `signedIn` as it changes, until `signal` aborts: whether a bridge
 * is paired, what it reported it cannot give of `tools`, and always a code asking for `tools` that pairs
 * one — in place of the one paired, where one is (44.59). A code that expires or is spent is replaced
 * with a fresh one. 44.20.
 *
 * 44.34 — IT FOLLOWS WHOEVER SIGNS IN AT THE BROWSER: a sign-in or a sign-out made since is the
 * pairing it watches from then on, and the code it offers is that sign-in's.
 */
export async function* pairingStatus(
    caller: string,
    signedIn: string,
    tools: readonly string[],
    note: string | undefined,
    signal: AbortSignal,
    local: boolean,
): AsyncGenerator<PairingState> {
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
    // `undefined` until the first is said.
    let said: string | undefined
    signal.addEventListener('abort', rouse)
    try {
        while (!signal.aborted) {
            const key = pairingKey(caller, signedIn)
            if (key !== watchingKey) {
                unwatch()
                unfollow()
                unwatch = watchPairing(key, rouse)
                unfollow = fileIn(FOLLOWERS, caller, follow, undefined)
                watchingKey = key
                pairing = undefined
            }
            if (
                pairing === undefined ||
                pairing.expires <= Date.now() ||
                !CODES.has(pairing.code)
            )
                pairing = mintCode(caller, signedIn, tools, note)
            const state: PairingState = {
                paired: pairedFor(key, local),
                code: pairing.code,
                // 44.60 — of what this stream's code asks for: two on one page may ask for different tools.
                missing: missingFor(key, local, tools),
            }
            const saying = `${state.paired} ${state.code} ${state.missing.join(',')}`
            if (saying !== said) {
                said = saying
                yield state
            }
            const renew = setTimeout(rouse, pairing.expires - Date.now())
            await waiting.next()
            clearTimeout(renew)
        }
    } finally {
        signal.removeEventListener('abort', rouse)
        unwatch()
        unfollow()
    }
}

// 44.75 — EACH PAIRING'S STANDING CODE, by its pairing and the tools it asks for, with the timer that
// tells whoever follows it once it expires: what `/__abide/pairing` answers, rather than a code per call.
const STANDING = new Map<
    string,
    { code: string; expires: number; expiry: ReturnType<typeof setTimeout> }
>()

/**
 * The pairing of `caller` signed in as `signedIn` as it stands, with a code asking for `tools` that
 * pairs one — the one it answered last, while that is unspent and unexpired. 44.67.
 *
 * 44.75 — A CODE THAT EXPIRES IS SAID TO WHOEVER FOLLOWS THE PAIRING, which reads it again and is
 * answered a fresh one; one a bridge spends is said by the pairing that spends it (`wakeWatchers`).
 */
export function pairingNow(
    caller: string,
    signedIn: string,
    tools: readonly string[],
    note: string | undefined,
    local: boolean,
): PairingState {
    const key = pairingKey(caller, signedIn)
    const at = `${key}\n${tools.join(',')}\n${note ?? ''}`
    let standing = STANDING.get(at)
    if (
        standing === undefined ||
        standing.expires <= Date.now() ||
        !CODES.has(standing.code)
    ) {
        if (standing !== undefined) clearTimeout(standing.expiry)
        const { code, expires } = mintCode(caller, signedIn, tools, note)
        const expiry = setTimeout(() => {
            if (STANDING.get(at)?.code === code) STANDING.delete(at)
            wakeWatchers(key)
        }, expires - Date.now())
        // Nothing to say once the process is stopping.
        expiry.unref()
        standing = { code, expires, expiry }
        STANDING.set(at, standing)
    }
    return {
        paired: pairedFor(key, local),
        code: standing.code,
        missing: missingFor(key, local, tools),
    }
}

/**
 * Watches the pairing a follow of `/__abide/pairing` reads, in its connection's scope — the browser
 * and the sign-in its upgrade carried — refreshing that follow alone whenever the pairing changes.
 *
 * 18.36, 44.75 — and 44.22: a page following is a page watching, so the bridge goes idle once none does.
 */
export function watchFollowedPairing(
    poke: (member: 'refresh') => void,
): () => void {
    const caller = callerOf()
    if (caller === undefined) return () => {}
    return watchPairing(pairingKey(caller, signedInAs()), () => poke('refresh'))
}

/** Registers `wake` to run whenever the pairing filed under `key` changes; the returned function undoes it. */
function watchPairing(key: string, wake: () => void): () => void {
    const unwatch = fileIn(WATCHERS, key, wake, () => armIdle(key))
    const bridge = BY_KEY.get(key)
    if (bridge !== undefined) {
        bridge.watched = true
        if (bridge.idle !== undefined) clearTimeout(bridge.idle)
        bridge.idle = undefined
    }
    return unwatch
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
    const query = new URL(request.url).searchParams
    const holder = query.get('holder')
    if (holder !== null) return holderAnswer(holder)
    const code = query.get('code')
    if (code === null) return resume(request)
    const pairing = standingCode(code)
    // 44.14 — a code pairs once.
    CODES.delete(code)
    if (pairing === undefined) return unknownCode()
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
        prompts: new Map(),
        watched: WATCHERS.has(pairing.key),
        idle: undefined,
        held: undefined,
        asked: pairing.tools,
        missing: [],
    }
    BY_KEY.set(bridge.key, bridge)
    BY_TOKEN.set(bridge.token, bridge)
    bridge.frames.push({
        type: 'paired',
        token: bridge.token,
        tools: pairing.tools,
    })
    wakeWatchers(bridge.key)
    return attach(bridge, request)
}

// 44.63 — WHO A CODE WAS MINTED FOR, read without spending it: a code minted for someone else names
// someone else, which is what a bridge always allowing a site refuses to pair unasked. Beside it, the
// app's name, which the bridge's question shows with the site (44.42), and the note the code was minted
// with, which it shows as the app's own words (44.91).
function holderAnswer(code: string): Response {
    const pairing = standingCode(code)
    if (pairing === undefined) return unknownCode()
    return Response.json({
        holder: pairing.holder,
        name: appName(),
        ...(pairing.note === undefined ? {} : { note: pairing.note }),
    })
}

/** What `code` was minted with, while it is unspent and unexpired. */
function standingCode(code: string) {
    const pairing = CODES.get(code)
    return pairing === undefined || pairing.expires <= Date.now()
        ? undefined
        : pairing
}

function unknownCode(): Response {
    return answered(
        refuse(
            403,
            'This pairing code was not issued here, or it has been used, or it has expired.',
        ),
    )
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
    type: 'event' | 'mcp' | 'permission' | 'end' | 'fail' | 'missing'
    turn: string
    tools?: string[]
    name?: string
    input?: unknown
    event?: unknown
    id?: number
    method?: string
    params?: unknown
    message?: string
}

/** The tools of `asked` that `reported` names: a bridge says what it cannot give of no other. */
function missingOf(asked: readonly string[], reported: unknown): string[] {
    const missing: string[] = []
    if (Array.isArray(reported))
        for (const tool of asked)
            if (reported.includes(tool)) missing.push(tool)
    return missing
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
    for (const report of reports) delivered(bridge, report)
    return new Response(null, { status: 204 })
}

/** Hands what `bridge` reported to the turn it is of, or to the pairing's status. */
function delivered(bridge: Bridge, report: BridgeReport): void {
    // 44.60 — what the pairing asked for and the bridge cannot give, as the page's status says it.
    if (report.type === 'missing') {
        bridge.missing = missingOf(bridge.asked, report.tools)
        wakeWatchers(bridge.key)
        return
    }
    const kind = report.type as TurnItem['kind']
    bridge.turns.get(report.turn)?.push(
        kind === 'permission'
            ? item(kind, {
                  id: report.id ?? 0,
                  method: report.name ?? '',
                  params: report.input,
              })
            : item(kind, report),
    )
}
