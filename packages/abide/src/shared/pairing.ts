// 44.70 — THIS BROWSER'S PAIRING WITH A CLAUDE CODE BRIDGE, and the click that pairs one, read off
// `/__abide/pairing`, the handler abide mounts (44.67), so an app writes neither the handler nor the
// click.
//
// THE CLICK OPENS AN `abide-bridge:` LINK, and a browser cannot say whether a link of a scheme opened
// anything. The app that opens it taking focus blurs the page, so a click that blurs nothing and pairs
// nothing within `PAIR_WAIT` had no app to open it, and `step` offers the command that installs one
// (44.72).
//
// PURE at import, for `health`'s reason: an app that never names `pairing` does not ship it.

import { PAIRING_ADDRESS } from './ADDRESSES.ts'
import { answered, answerOf } from './answerOf.ts'
import type { BridgeStatus } from './BridgeStatus.ts'
import { isFailed } from './Failed.ts'
import { answerChunks } from './framing.ts'
import { isServer } from './isServer.ts'
import { mounted } from './mount.ts'
import { reactive } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'
import { owned } from './reactive/watch.ts'
import { rpcRequest } from './rpcRequest.ts'

/** How long a click waits for the page to blur, or the bridge to pair, before offering the install. */
const PAIR_WAIT = 2500
/** How long `copied` holds once the install command is on the clipboard. */
const COPIED_FOR = 1200

/** This browser's pairing with a Claude Code bridge, and the click that pairs one. */
export function pairing(): {
    status: Reactive<BridgeStatus | undefined>
    step: Reactive<'click' | 'waiting' | 'install'>
    copied: Reactive<boolean>
    start: () => void
    copyInstall: () => Promise<void>
} {
    const reading = new AbortController()
    // 44.70 — a server renders no pairing: the stream is the browser's, and a render would wait on it.
    const statuses = reactive(async function* () {
        if (!isServer()) yield* statusesOf(reading.signal)
    })
    const status = reactive(() =>
        (statuses() as BridgeStatus[]).at(-1),
    ) as Reactive<BridgeStatus | undefined>
    const step = reactive<'click' | 'waiting' | 'install'>('click')
    const copied = reactive(false)
    let waiting: ReturnType<typeof setTimeout> | undefined
    let copying: ReturnType<typeof setTimeout> | undefined
    let onBlur: (() => void) | undefined
    // A click reads the status as it stands, and one that has not landed has no link to open.
    const current = (): BridgeStatus | undefined =>
        status.ready() && status.error() === undefined ? status() : undefined
    const stopWaiting = (): void => {
        clearTimeout(waiting)
        waiting = undefined
        if (onBlur !== undefined) window.removeEventListener('blur', onBlur)
        onBlur = undefined
    }
    // 44.74.
    owned(() => {
        reading.abort()
        stopWaiting()
        clearTimeout(copying)
        copying = undefined
    })
    return {
        status,
        step,
        copied,
        // 44.71, 44.72.
        start() {
            const link = current()?.link
            if (link === undefined || reading.signal.aborted) return
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
        // 44.73.
        async copyInstall() {
            const install = current()?.install
            if (install === undefined || navigator.clipboard === undefined)
                return
            await navigator.clipboard.writeText(install)
            if (reading.signal.aborted) return
            copied.set(true)
            clearTimeout(copying)
            copying = setTimeout(() => {
                copying = undefined
                copied.set(false)
                step.set('click')
            }, COPIED_FOR)
        },
    }
}

/**
 * The statuses `/__abide/pairing` answers this browser, as they land — `wire`'s stream less the
 * follow, as `seededDocument` is its call: the mux carries no production of abide's own.
 */
async function* statusesOf(signal: AbortSignal): AsyncGenerator<BridgeStatus> {
    // 44.75 — no tools: the server's `ABIDE_BRIDGE_TOOLS` decides what a pairing grants.
    const request = rpcRequest('GET', mounted(PAIRING_ADDRESS), undefined)
    try {
        const answer = await answerOf(request, true, signal)
        if (answer.body !== undefined && answer.body !== null) {
            yield* answerChunks(
                answer.body,
                answer.framing,
            ) as AsyncIterable<BridgeStatus>
            return
        }
        const value = answered(answer, request)
        if (isFailed(value)) throw value
    } catch (thrown) {
        // 44.74 — a pairing read until its scope was disposed ends there, not in a failure.
        if (!signal.aborted) throw thrown
    }
}
