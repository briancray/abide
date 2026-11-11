// SECTION 18 — THE MUX. Every `GET` a page follows is carried over one web socket per browser (18.1),
// at `SOCKET_ADDRESS`, and each subscription on it is a frame naming the handler's address and its
// args. What goes back is the value, and then what each patch wrote over it (18.6, 18.11) — the same
// frames an event stream writes as events (18.20), multiplexed so a page following many values holds
// one connection.
//
// THE FRAMES are `BrowserFrame` in and `ServerFrame` out, as JSON.
//
// 18.3 — every subscription is followed for the handler's triggers, whether its value is `global` or
// built per request, since a trigger names args rather than a value. A `global` value is also fed its productions, a guarded one only to a
// subscription its rungs admitted when it opened (18.8) — they run once, in the connection's request.

import { problemOf } from '#shared/Failed.ts'
import { namedLogger } from '#shared/log.ts'
import { unmounted } from '#shared/mount.ts'
import type { BrowserFrame } from '#shared/muxFrames.ts'
import { isThenable } from '#shared/reactive/isThenable.ts'
import { refuse } from '#shared/refuse.ts'

import { positiveSetting } from './config.ts'
import { crossingOrigin } from './crossingOrigin.ts'
import { type Followers, Frame, type Peer } from './Followers.ts'
import { failureOf } from './hooks.ts'
import { admitsFollower, followedArgs } from './invokeHandler.ts'
import type { FollowedHandler } from './mountHandlers.ts'
import { sendOrClose, type Socket } from './muxUpgrade.ts'
import {
    inOpenScope,
    RECEIVED_FROM,
    releaseScope,
    type RequestScope,
    scopeFor,
} from './requestScope.ts'

// 18.31 — a page follows each value it reads once, so a thousand is a page no one could read.
const MAX_SUBSCRIPTIONS = 1024

/** A socket's peer: each frame as the `ServerFrame` JSON a browser parses. */
class SocketPeer implements Peer {
    readonly socket: Socket
    constructor(socket: Socket) {
        this.socket = socket
    }
    send(id: number, frame: Frame): void {
        sendOrClose(this.socket, frame.json(id))
    }
    close(code: number, reason: string): unknown {
        return this.socket.close(code, reason)
    }
}

const SOCKET_LOG = namedLogger('abide:socket')

/** A refusal's frame: the failure `error` is, as Problem Details (15.21). */
function refusal(error: unknown): Frame {
    return new Frame(
        'error',
        undefined,
        undefined,
        JSON.stringify(problemOf(failureOf(error))),
    )
}

/**
 * The mux over the handlers a browser may follow: what a listener hands each connection it upgraded,
 * and what closes them all when the app stops (42.11).
 */
export class Mux {
    /** The `GET` a browser follows at an address below the mount, or `undefined` (`followedIn`). */
    readonly followedAt: (address: string) => FollowedHandler | undefined
    /** Who follows what in the app this mux carries for. 18.3. */
    readonly followers: Followers
    // 42.12 — the app a frame's scope answers `rpc.raw` and the MCP surface through.
    readonly app: RequestScope['app']
    readonly connections = new Set<MuxConnection>()

    constructor(
        followedAt: (address: string) => FollowedHandler | undefined,
        followers: Followers,
        app: RequestScope['app'],
    ) {
        this.followedAt = followedAt
        this.followers = followers
        this.app = app
    }

    /** One connection, upgraded from `request`, whose frames go to `socket`. */
    connect(request: Request, socket: Socket): MuxConnection {
        if (SOCKET_LOG.enabled())
            SOCKET_LOG.debug('open', new URL(request.url).pathname)
        const connection = new MuxConnection(
            this,
            request,
            new SocketPeer(socket),
        )
        this.connections.add(connection)
        return connection
    }

    closeAll(code: number, reason: string): void {
        for (const connection of this.connections) {
            connection.close()
            connection.peer.close(code, reason)
        }
    }
}

/** One browser's connection to the mux: its subscriptions, and the scope its frames are answered in. */
export class MuxConnection {
    readonly mux: Mux
    readonly peer: Peer
    readonly subscriptions = new Map<number, () => void>()
    /**
     * The origin a connection from another origin came from, and `null` for the app's own.
     *
     * 18.2 — read once at the upgrade, since every frame on the connection shares it.
     */
    readonly crossing: string | null
    // 18.18 — what aborts the upgrade's signal at the close.
    readonly hangUp = new AbortController()
    // 18.16 — every frame is answered in this one scope; 18.17 — torn down at the close.
    readonly scope: RequestScope

    constructor(mux: Mux, upgrade: Request, peer: Peer) {
        this.mux = mux
        this.peer = peer
        this.crossing = crossingOrigin(
            upgrade.headers.get('origin'),
            upgrade.url,
        )
        // NO `received`: an upgraded connection has no http idle timeout for 16.23 to set.
        const request = new Request(upgrade, { signal: this.hangUp.signal })
        // 22.12 — every frame came from where the upgrade did.
        if (RECEIVED_FROM.has(upgrade))
            RECEIVED_FROM.set(request, RECEIVED_FROM.get(upgrade) ?? null)
        this.scope = scopeFor(request, undefined, mux.app)
        // 22.10 — the headers went out with the upgrade, so nothing a frame writes is carried.
        this.scope.applied = true
    }

    message(raw: string | Buffer): Promise<void> {
        return inOpenScope(this.scope, () => this.answerFrame(raw))
    }

    /** Stops every subscription and tears the scope down; a second close does nothing. */
    close(): void {
        if (!this.mux.connections.delete(this)) return
        this.hangUp.abort()
        for (const stop of this.subscriptions.values()) stop()
        this.subscriptions.clear()
        releaseScope(this.scope)
    }

    private async answerFrame(raw: string | Buffer): Promise<void> {
        // Partial: it is whatever the browser sent.
        let frame: Partial<BrowserFrame>
        try {
            frame = JSON.parse(String(raw))
        } catch {
            return
        }
        const id = frame.id ?? 0
        // THE ADDRESS BELOW THE MOUNT, which is what the handlers are keyed by: a browser names it
        // as its wrapper resolved it, which is a whole URL, or a path under the app's mount.
        const address = addressIn(frame.address ?? '')
        const subscriptions = this.subscriptions
        if (frame.op === 'unsub') {
            subscriptions.get(id)?.()
            subscriptions.delete(id)
            return
        }
        // 18.31 — A CONNECTION FOLLOWS AT MOST `ABIDE_MAX_SOCKET_SUBSCRIPTIONS` VALUES; 18.32 — a frame
        // naming an id it already holds replaces that one rather than adding to them.
        if (frame.op === 'sub' && !subscriptions.has(id)) {
            const most = positiveSetting(
                'ABIDE_MAX_SOCKET_SUBSCRIPTIONS',
                MAX_SUBSCRIPTIONS,
            )
            if (subscriptions.size >= most) {
                this.peer.send(
                    id,
                    refusal(
                        refuse(
                            429,
                            `This connection follows ${most} values already.`,
                        ),
                    ),
                )
                return
            }
        }
        const followed =
            frame.op === 'sub' ? this.mux.followedAt(address) : undefined
        if (followed === undefined) {
            this.peer.send(
                id,
                refusal(
                    refuse(
                        404,
                        `No handler a browser follows answers at ${address}.`,
                    ),
                ),
            )
            return
        }
        // A SUBSCRIPTION IS HELD FROM THE FRAME ON, not from when its rungs let it through: an
        // `unsub` or the connection's close that lands while a rung is pending stops this
        // placeholder, and the rungs resolving to find another in its place install nothing.
        const pending = (): void => {}
        try {
            // 18.2, 18.3 — the origin gate and the args a `GET` over http is answered with.
            const args = followedArgs(followed, frame.args, this.crossing)
            subscriptions.get(id)?.()
            subscriptions.set(id, pending)
            // 18.8, 18.26 — run once, in this connection's request.
            const admits = admitsFollower(
                followed,
                args,
                this.scope.request as Request,
            )
            const admitted = isThenable(admits) ? await admits : admits
            if (subscriptions.get(id) !== pending) return
            follow(this, id, followed, args, frame.version, admitted)
        } catch (thrown) {
            if (subscriptions.get(id) === pending) subscriptions.delete(id)
            this.peer.send(id, refusal(thrown))
        }
    }
}

/** Follows `followed` for `id` on the connection, in place of whatever `id` followed. 18.3, 18.32. */
function follow(
    connection: MuxConnection,
    id: number,
    followed: FollowedHandler,
    args: unknown,
    held: number | undefined,
    admitted: boolean,
): void {
    connection.subscriptions.get(id)?.()
    connection.subscriptions.set(
        id,
        connection.mux.followers.follow(
            connection.peer,
            id,
            followed,
            args,
            held,
            admitted,
        ),
    )
}

function addressIn(named: string): string {
    const path = URL.parse(named)?.pathname ?? named
    return unmounted(path) ?? path
}
