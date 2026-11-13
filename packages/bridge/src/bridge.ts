// THE BRIDGE: this machine's Claude Code, lent to one browser on one abide site. It dials OUT — a page
// cannot reach a process on its own machine from https — and holds a server-sent stream open to the
// site, which sends it turns; what it reports goes back as posts.
//
// TOOLS ARE RELAYED, NEVER CALLED FROM HERE. Claude Code is handed an MCP server on loopback, behind a
// path no other process is told; each request it makes there is posted to the site, which answers it
// inside the page's own request, as the person at the page. No credential of theirs reaches this
// machine, and none of this machine's reaches the site.

import { BRIDGE_PATH } from './BRIDGE_PATH.ts'
import { grantFor, withheldNotices } from './grant.ts'
import { HEARTBEAT_MILLISECONDS } from './HEARTBEAT_MILLISECONDS.ts'
import { siteOf } from './pairingLink.ts'
import { readLines } from './readLines.ts'
import { RESUME_MILLISECONDS } from './RESUME_MILLISECONDS.ts'
import { serveTurns, type TurnFrame, type TurnReport } from './serveTurns.ts'
import { siteTls } from './siteTls.ts'

// How long reports gather before they are posted, so a streamed reply is not a post per token.
const BATCH_MILLISECONDS = 15
// 44.25 — the first wait before redialing a dropped stream, doubled per failed dial up to the last.
const FIRST_REDIAL_MILLISECONDS = 250
const LAST_REDIAL_MILLISECONDS = 8_000
// 44.27 — how long the stream may go without a line before it is taken for dropped.
export const SILENCE_MILLISECONDS = 3 * HEARTBEAT_MILLISECONDS

type SiteFrame =
    | { type: 'paired'; token: string; tools?: string[] }
    | TurnFrame
    | { type: 'bye' }

type Report = TurnReport | { type: 'missing'; tools: string[] }

/** Pairs with `site` by `code`, and serves its turns until the site or the stream ends it. */
export async function bridge(options: {
    site: string
    code: string
    claude?: string
    claudeArgs?: string[]
    /** Everything `claude` has is the site's to use, prompts asked of its page. 44.82. */
    full?: boolean
    say?: (line: string) => void
    replyMilliseconds?: number
    silenceMilliseconds?: number
}): Promise<void> {
    const site = siteOf(new URL(options.site))
    const tls = siteTls()
    // WHAT IS SAID IS READ AS A NOTIFICATION, where a link opened the bridge (`opened.ts`): one short
    // sentence naming the site by its host. The detail goes to Claude Code, in the failure it is answered.
    const host = new URL(site).host
    const say = options.say ?? ((line: string) => console.error(line))
    const full = options.full ?? false
    const silenceMilliseconds =
        options.silenceMilliseconds ?? SILENCE_MILLISECONDS
    // What cuts the stream being read, where it went silent.
    let dialed = new AbortController()
    let stream = await fetch(
        `${site}${BRIDGE_PATH}?code=${encodeURIComponent(options.code)}`,
        {
            headers: { accept: 'text/event-stream' },
            signal: dialed.signal,
            tls,
        },
    )
    if (!stream.ok || stream.body === null)
        throw new Error(
            `${host} refused to pair (${stream.status}). ${await stream.text()}`,
        )

    let token = ''
    const outbox: Report[] = []
    let flushing: Promise<void> = Promise.resolve()
    let scheduled = false
    // 44.45 — `failing` once a report the site did not take has been said, until one is taken; a
    // redial is what is said while it lasts (44.25), and no failed report is.
    let link: 'up' | 'failing' | 'redialing' = 'up'
    const flush = async (): Promise<void> => {
        scheduled = false
        const batch = outbox.splice(0)
        if (batch.length === 0) return
        const lines: string[] = []
        for (const item of batch) lines.push(JSON.stringify(item))
        let failure: string | undefined
        let notice = ''
        try {
            const posted = await fetch(`${site}${BRIDGE_PATH}`, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${token}`,
                    'content-type': 'application/jsonl',
                },
                body: lines.join('\n'),
                tls,
            })
            if (!posted.ok) {
                failure = `${site} refused a report (${posted.status}): ${await posted.text()}`
                notice = `${host} didn’t take Claude Code’s reply (${posted.status}), so it stopped.`
            } else await posted.body?.cancel()
        } catch (thrown) {
            failure = `${site} could not be reached: ${thrown instanceof Error ? thrown.message : String(thrown)}`
            notice = `Can’t reach ${host}, so Claude Code stopped its reply.`
        }
        if (failure === undefined) {
            if (link === 'failing') link = 'up'
            return
        }
        if (link === 'up') {
            say(notice)
            link = 'failing'
        }
        // 44.46 — a turn the site missed part of has no answer left to give, and is ended: what it
        // still waits on is answered as `run` ends it, and the reason is what it reports it failed with.
        for (const item of batch)
            // A lost `missing` is said again by the next look, rather than taken as said.
            if (item.type === 'missing') reported = undefined
            else
                core.miss(
                    item.turn,
                    `The site missed part of this turn, so it was ended: ${failure}`,
                )
    }
    // One post at a time, in order: a turn's `end` never overtakes its last event.
    const report = (item: Report): void => {
        outbox.push(item)
        if (scheduled) return
        scheduled = true
        setTimeout(() => {
            flushing = flushing.then(flush)
        }, BATCH_MILLISECONDS)
    }

    // A notice a turn repeats is said once, not once per turn.
    const said = new Set<string>()
    const sayOnce = (line: string): void => {
        if (said.has(line)) return
        said.add(line)
        say(line)
    }

    // 44.61 — WHAT THE PAIRING ASKED FOR AND THIS MACHINE CANNOT GIVE, reported once it pairs and again
    // before a turn where it changed: a server the visitor adds meanwhile is found at the next turn.
    let pairingAsked: string[] = []
    let reported: string | undefined
    const reportMissing = async (): Promise<void> => {
        const { grant } = await grantFor(
            pairingAsked,
            options.claudeArgs ?? [],
            full,
            sayOnce,
        )
        const missing = [...grant.ungranted, ...grant.unserved]
        const key = missing.join(',')
        if (key === reported) return
        reported = key
        for (const notice of withheldNotices(grant)) sayOnce(notice)
        report({ type: 'missing', tools: missing })
    }

    const core = serveTurns({
        site,
        claude: options.claude ?? 'claude',
        claudeArgs: options.claudeArgs ?? [],
        full,
        report,
        say: sayOnce,
        beforeTurn: reportMissing,
        ...(options.replyMilliseconds === undefined
            ? {}
            : { replyMilliseconds: options.replyMilliseconds }),
    })
    // 44.30 — A SIGNAL ENDS THE RUNS WITH THE BRIDGE: exiting on one skips every `finally`, so a run
    // still going would outlive it, orphaned.
    const signals = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const
    const stopped = (signal: keyof typeof signals): void => {
        core.cancelAll()
        process.exit(signals[signal])
    }
    for (const signal of Object.keys(signals) as (keyof typeof signals)[])
        process.on(signal, stopped)

    // 44.25 — THE STREAM REDIALED BY ITS TOKEN, each wait twice the last, until the site refuses it or
    // stops holding the pairing.
    const redial = async (): Promise<Response | undefined> => {
        if (token === '') return undefined
        say(`Lost ${host}. Reconnecting…`)
        link = 'redialing'
        const until = Date.now() + RESUME_MILLISECONDS
        let delay = FIRST_REDIAL_MILLISECONDS
        while (Date.now() < until) {
            await Bun.sleep(delay)
            delay = Math.min(delay * 2, LAST_REDIAL_MILLISECONDS)
            try {
                dialed = new AbortController()
                const resumed = await fetch(`${site}${BRIDGE_PATH}`, {
                    headers: {
                        accept: 'text/event-stream',
                        authorization: `Bearer ${token}`,
                    },
                    signal: dialed.signal,
                    tls,
                })
                if (resumed.ok && resumed.body !== null) {
                    say(`Reconnected to ${host}.`)
                    link = 'up'
                    return resumed
                }
                await resumed.body?.cancel()
                if (resumed.status < 500) return undefined
            } catch {
                // Unreachable for now: the next dial is the retry.
            }
        }
        return undefined
    }

    try {
        let bye = false
        for (;;) {
            // 44.27 — a stream silent past the bound is cut, and redialed as one that dropped.
            const silence = setTimeout(
                () => dialed.abort(),
                silenceMilliseconds,
            )
            try {
                for await (const line of readLines(
                    stream.body as ReadableStream<Uint8Array>,
                )) {
                    silence.refresh()
                    if (!line.startsWith('data: ')) continue
                    const frame = JSON.parse(
                        line.slice('data: '.length),
                    ) as SiteFrame
                    if (frame.type === 'paired') {
                        token = frame.token
                        pairingAsked = frame.tools ?? []
                        say(
                            full
                                ? `Connected to ${host}, which can use everything your Claude Code can. Close the page to disconnect.`
                                : `Connected to ${host}. Close the page to disconnect.`,
                        )
                        void reportMissing()
                    } else if (frame.type === 'bye') {
                        bye = true
                        break
                    } else core.take(frame)
                }
            } catch {
                // A stream cut mid-read is a drop like one that ended.
            } finally {
                clearTimeout(silence)
            }
            if (bye) break
            const resumed = await redial()
            if (resumed === undefined) break
            stream = resumed
        }
    } finally {
        for (const signal of Object.keys(signals) as (keyof typeof signals)[])
            process.off(signal, stopped)
        core.cancelAll()
        await flushing
        await flush()
        core.stop()
        say(`Disconnected from ${host}.`)
    }
}
