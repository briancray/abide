// 44.69 — THIS BROWSER'S PAIRING WITH A CLAUDE CODE BRIDGE, and the click that pairs one, read off
// `/__abide/pairing`, the handler abide mounts (44.67), so an app writes neither the handler nor the
// click.
//
// 44.75 — READ ONCE, THEN FOLLOWED over the mux the page already holds, which sends a refresh
// whenever the pairing changes or its code expires (18.36) — so watching a pairing for the life of
// a page holds no http connection. ONE COPY PER PAGE, however many `pairing` read it: a follow is one
// per handler and args (18.3), and it ends with the last reader (44.73).
//
// THE CLICK OPENS AN `abide-bridge:` LINK, and a browser cannot say whether a link of a scheme opened
// anything. The app that opens it taking focus blurs the page, so a click that blurs nothing and pairs
// nothing within `PAIR_WAIT` had no app to open it, and `step` offers the command that installs one
// (44.71).
//
// PURE at import, for `health`'s reason: an app that never names `pairing` does not ship it.

import { PAIRING_ADDRESS } from './ADDRESSES.ts'
import { answered, answerOf } from './answerOf.ts'
import type { BridgeStatus } from './BridgeStatus.ts'
import type { Failed } from './Failed.ts'
import { isServer } from './isServer.ts'
import { mounted } from './mount.ts'
import { MUX_FOLLOWS } from './MUX_FOLLOWS.ts'
import { onPrincipalRotated } from './principalRotated.ts'
import { reactive } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'
import { collectWatches, owned, unowned, watch } from './reactive/watch.ts'
import { rpcRequest } from './rpcRequest.ts'

/** How long a click waits for the page to blur, or the bridge to pair, before offering the install. */
const PAIR_WAIT = 2500
/** How long `copied` holds once the install command is on the clipboard. */
const COPIED_FOR = 1200

/** What a read of `/__abide/pairing` fails with: it declares no refusal, so the transport's (16.8). */
type PairingFailure = Failed<'HttpError', undefined>

/** This browser's pairing with a Claude Code bridge, and the click that pairs one. */
export function pairing(): {
    status: Reactive<BridgeStatus, BridgeStatus, PairingFailure>
    step: Reactive<'click' | 'waiting' | 'install'>
    copied: Reactive<boolean>
    start: () => void
    copyInstall: () => Promise<void>
    stop: () => void
    [Symbol.dispose]: () => void
} {
    // 44.69 — A SERVER HOLDS NOTHING, AND NOTHING IN FLIGHT: the copy is the browser's, and with no
    // producer there is no sink for a render to hold open (3.4), where a read in flight would be one.
    const read = isServer() ? undefined : readPairing()
    // 44.73 — WHAT IS BUILT HERE STOPS WITH `stop`, collected rather than listed: the status's
    // derivation, `copied`'s write back (6.14) and the watch that ends the install step. `stop` is
    // then handed to whatever owns this call, so a setup's dispose runs it, and a `pairing` built
    // anywhere else — a click handler — is stopped by its caller. A server's request already owns
    // all of it (12.5), so nothing is collected there to be stopped twice.
    const stops: (() => void)[] = []
    const previous = read === undefined ? undefined : collectWatches(stops)
    let built: ReturnType<typeof setUp>
    try {
        built = setUp(read)
    } finally {
        if (read !== undefined) collectWatches(previous)
    }
    const { status, step, copied, current } = built
    let waiting: ReturnType<typeof setTimeout> | undefined
    let onBlur: (() => void) | undefined
    const stopWaiting = (): void => {
        clearTimeout(waiting)
        waiting = undefined
        if (onBlur !== undefined) window.removeEventListener('blur', onBlur)
        onBlur = undefined
    }
    let disposed = false
    const stop = (): void => {
        if (disposed) return
        disposed = true
        read?.release()
        stopWaiting()
        for (const stopOne of stops) stopOne()
    }
    owned(stop)
    return {
        status,
        step,
        copied,
        // 44.70, 44.71.
        start() {
            const link = current()?.link
            if (link === undefined || disposed) return
            stopWaiting()
            step.set('waiting')
            let blurred = false
            const blur = (): void => {
                blurred = true
            }
            onBlur = blur
            window.addEventListener('blur', blur, { once: true })
            location.assign(link)
            waiting = setTimeout(() => {
                stopWaiting()
                // Paired already: a reconnect that opened no app leaves the old bridge answering.
                step.set(blurred || current()?.paired ? 'click' : 'install')
            }, PAIR_WAIT)
        },
        // 44.72.
        async copyInstall() {
            const install = current()?.install
            if (install === undefined || navigator.clipboard === undefined)
                return
            await navigator.clipboard.writeText(install)
            if (disposed) return
            copied.set(true)
        },
        // 44.73.
        stop,
        [Symbol.dispose]: stop,
    }
}

/** A pairing's values over `read`, the page's copy, or over nothing on a server. */
function setUp(read: ReturnType<typeof readPairing> | undefined): {
    status: Reactive<BridgeStatus, BridgeStatus, PairingFailure>
    step: Reactive<'click' | 'waiting' | 'install'>
    copied: Reactive<boolean>
    current: () => BridgeStatus | undefined
} {
    // 44.69 — IN FLIGHT UNTIL THE FIRST ANSWER LANDS, so `await status` waits for it; a read that
    // failed throws here, which is `status`'s failure.
    const status = (
        read === undefined
            ? reactive<BridgeStatus>()
            : reactive(() => read.copy())
    ) as Reactive<BridgeStatus, BridgeStatus, PairingFailure>
    const step = reactive<'click' | 'waiting' | 'install'>('click')
    // 44.72 — 6.2 writes `false` back `COPIED_FOR` after a copy, and that is what ends the install
    // step.
    const copied = reactive(false, { ttl: COPIED_FOR })
    watch([copied], () => {
        if (!copied.peek()) step.set('click')
    })
    // A click reads the status as it stands, and one that has not landed has no link to open.
    const current = (): BridgeStatus | undefined =>
        status.ready() && status.error() === undefined ? status() : undefined
    return { status, step, copied, current }
}

/** The page's one copy of its pairing, and how many `pairing` read it. */
let reading:
    | {
          copy: Reactive<BridgeStatus>
          readers: number
          aborted: AbortController
      }
    | undefined
// Whether a sign-in in any tab reads the pairing again (26.24): heard once a page reads one.
let listening = false

/**
 * The page's copy of `/__abide/pairing` — made by the first reader, released by the last — and what
 * releases this reader's hold on it.
 */
function readPairing(): {
    copy: Reactive<BridgeStatus>
    release: () => void
} {
    if (reading === undefined) {
        const address = mounted(PAIRING_ADDRESS)
        const aborted = new AbortController()
        // UNOWNED: it outlives the reader that made it, and ends with the last one.
        const copy: Reactive<BridgeStatus> = unowned(() =>
            reactive(async () => {
                // 44.73 — a refresh the follow sends after the last reader went reads nothing.
                if (aborted.signal.aborted) return copy.peek()
                // 44.74 — no tools: the server's `ABIDE_BRIDGE_TOOLS` decides what a pairing grants.
                const request = rpcRequest('GET', address, undefined)
                const answer = await answerOf(request, false, aborted.signal)
                if (answer.ok && !aborted.signal.aborted)
                    MUX_FOLLOWS.follow?.(
                        address,
                        undefined,
                        answer.version,
                        answer.life,
                        () => copy,
                    )
                return answered(answer, request) as BridgeStatus
            }),
        )
        reading = { copy, readers: 0, aborted }
        // 44.34 — WHOEVER SIGNS IN AT THE BROWSER IS THE PAIRING READ FROM THEN ON: the mux reopens
        // as them (18.25), and the copy reads the pairing again as them.
        if (!listening) {
            listening = true
            onPrincipalRotated(() => reading?.copy.refresh(), true)
        }
    }
    const held = reading
    held.readers += 1
    let released = false
    return {
        copy: held.copy,
        release() {
            if (released) return
            released = true
            held.readers -= 1
            if (held.readers > 0 || reading !== held) return
            reading = undefined
            held.aborted.abort()
            MUX_FOLLOWS.unfollow?.(mounted(PAIRING_ADDRESS), undefined)
        },
    }
}
