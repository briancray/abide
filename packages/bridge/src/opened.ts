// WHAT RUNS WHEN A PAIRING LINK IS OPENED: the handler `abide-bridge install` bundles beside the app it
// registers, started with the link. It asks the visitor first (44.42) — unless they always allow the
// site for whoever the link's code was minted for (44.62) — then runs the release of the bridge the
// link names, as the command a site shows would — so a site is answered by the bridge that speaks its
// relay, while what asks is the one the visitor installed.
//
// RUN BY THE DESKTOP, NOT A SHELL: nothing of the visitor's login is here, so `bun`, `claude` and the
// `PATH` are what install found (`settings.json`) — an npm-installed `claude` is a `node` script, and
// finds `node` only on the PATH it was installed from. Every line the bridge says is written to the
// log in the install directory and shown as a notification.

import { appendFile } from 'node:fs/promises' // bun has no append of its own

import {
    allowAlways,
    allowedAs,
    allowedIn,
    allowedSites,
} from './allowedSites.ts'
import { BRIDGE_PATH } from './BRIDGE_PATH.ts'
import { type Answer, ask, notify, type Question } from './desktop.ts'
import { grantFor, serversNamed } from './grant.ts'
import { type Pairing, pairingOf } from './pairingLink.ts'
import { readLines } from './readLines.ts'
import { siteTls } from './siteTls.ts'

/**
 * What install found, kept beside this file: `bun`, `claude`, and the `PATH` it was run on — and what
 * the visitor gave it for every link (44.44): the Claude Code options after its `--` and each `--env`.
 */
export type HandlerSettings = {
    bun: string
    claude: string
    path: string
    claudeArgs: string[]
    /** `abide-bridge install --full`: every link's bridge is run `--full` (44.82). An older install's settings hold none. */
    full: boolean
    env: Record<string, string>
}

/** A site as the visitor reads it: what a link names, without its scheme. */
function shownSite(site: string): string {
    return site.slice(site.indexOf('://') + 3)
}

/** Whether the visitor's options leave Claude Code in auto mode (44.81). */
function inAutoMode(claudeArgs: readonly string[]): boolean {
    for (const arg of claudeArgs)
        if (
            arg.startsWith('--permission-mode') ||
            arg.startsWith('--dangerously-skip-permissions')
        )
            return false
    return true
}

/**
 * What the visitor is asked before `pairing` runs (44.42): a site asking for full access is named as
 * asking for it, and none of its tools (44.85); else each tool it asks for, and each MCP tool of a
 * server their Claude Code is not configured with, `unserved` (44.65).
 */
export function question(
    pairing: Pairing,
    settings: HandlerSettings,
    unserved: readonly string[] = [],
): Question {
    const site = shownSite(pairing.site)
    const auto = inAutoMode(settings.claudeArgs)
        ? `Claude Code stays in auto mode: it does safe steps on its own and asks you on ${site}’s page before anything risky.`
        : ''
    let headline: string
    let said: string[]
    if (settings.full === true) {
        headline = `${site} wants to use your Claude Code. You installed it to give every site full access.`
        said = [auto]
    } else if (pairing.full) {
        headline = `${site} is requesting full access to your local Claude Code.`
        said = [
            `It could do anything your Claude Code can, on your Claude account. ${auto}`,
            `Or allow only ${site}’s own tools, so it can answer from the site without touching this computer.`,
        ]
    } else if (pairing.tools.length === 0) {
        headline = `${site} wants to use your Claude Code with its own tools only. It gets none of this computer’s.`
        said = []
    } else {
        headline = `${site} wants to use your Claude Code with its own tools, plus these of this computer’s: ${pairing.tools.join(', ')}.`
        said = [auto]
        if (unserved.length > 0)
            said.push(
                `Your Claude Code has no ${serversNamed(unserved)} MCP server, so it can’t use ${unserved.join(', ')}. Add it with \`claude mcp add --scope user\` first.`,
            )
    }
    // A variable's value is only named, never shown: it is as likely a token as a host.
    const kept = [...settings.claudeArgs, ...Object.keys(settings.env)]
    if (kept.length > 0)
        said.push(
            `It also gets what you gave install for every site: ${kept.join(' ')}.`,
        )
    said.push(`Allow it only if you just asked to pair on ${site}.`)
    let body = ''
    for (const paragraph of said)
        if (paragraph.trim() !== '')
            body += `${body === '' ? '' : '\n\n'}${paragraph.trim()}`
    return { headline, body }
}

/**
 * The bridge the link names, run as the command a site shows would run it (44.32), with the options
 * install kept ahead of the link's tools (44.44).
 */
export function bridgeArguments(
    pairing: Pairing,
    settings: HandlerSettings,
): string[] {
    const claudeArgs = claudeArgsOf(pairing, settings)
    return [
        settings.bun,
        'x',
        `@abide/bridge@${pairing.version}`,
        pairing.site,
        pairing.code,
        '--claude',
        settings.claude,
        ...(settings.full === true || pairing.full ? ['--full'] : []),
        ...(claudeArgs.length === 0 ? [] : ['--', ...claudeArgs]),
    ]
}

/** The Claude Code options the bridge for `pairing` is run with: install's, then the link's tools. */
function claudeArgsOf(pairing: Pairing, settings: HandlerSettings): string[] {
    const claudeArgs = [...settings.claudeArgs]
    if (pairing.tools.length > 0)
        claudeArgs.push('--tools', pairing.tools.join(','))
    return claudeArgs
}

/**
 * The `PATH` the bridge runs on: the directories of `bun` and `claude`, then the one install was run
 * on, joined by the platform's separator — `;` on Windows.
 */
export function searchPath(settings: HandlerSettings): string {
    const separator = process.platform === 'win32' ? ';' : ':'
    const directories: string[] = []
    for (const directory of [
        directoryOf(settings.bun),
        directoryOf(settings.claude),
        ...settings.path.split(separator),
    ])
        if (directory !== '' && !directories.includes(directory))
            directories.push(directory)
    return directories.join(separator)
}

function directoryOf(file: string): string {
    return file.slice(
        0,
        Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')),
    )
}

/**
 * Who `pairing`'s code was minted for, as `/__abide/bridge` names them (44.63), or `undefined` where the
 * site names no one — a release before it did, or a code it did not mint.
 */
export async function holderOf(
    pairing: Pick<Pairing, 'site' | 'code'>,
): Promise<string | undefined> {
    try {
        const answer = await fetch(
            `${pairing.site}${BRIDGE_PATH}?holder=${encodeURIComponent(pairing.code)}`,
            { tls: siteTls(), signal: AbortSignal.timeout(10_000) },
        )
        if (!answer.ok) {
            await answer.body?.cancel()
            return undefined
        }
        const { holder } = (await answer.json()) as { holder?: unknown }
        return typeof holder === 'string' && holder !== '' ? holder : undefined
    } catch {
        return undefined
    }
}

/** The MCP tools `pairing` asks for whose server the visitor's Claude Code is not configured with. 44.65. */
export async function unservedOf(
    pairing: Pairing,
    settings: HandlerSettings,
): Promise<string[]> {
    // An unreadable config is no server here: the bridge says why when it runs.
    const { grant } = await grantFor(
        pairing.tools,
        claudeArgsOf(pairing, settings),
        settings.full === true,
        () => {},
    )
    return grant.unserved
}

/** `pairing` with only the site's own tools: none of this machine's, and not full. 44.85. */
function siteToolsOnly(pairing: Pairing): Pairing {
    return { ...pairing, tools: [], full: false }
}

/**
 * `pairing` as the visitor allows it, or `undefined` where they do not: unasked where they allowed its
 * site before for the holder its code was minted for, as they allowed it then (44.62), else as
 * `askVisitor` answers — offering the site's own tools alone where it asks for full access (44.85) —
 * keeping what they allowed in `allowedFile` where the site named a holder (44.86).
 */
export async function consented(
    pairing: Pairing,
    settings: HandlerSettings,
    allowedFile: string,
    askVisitor: (
        question: Question,
        offerSiteTools: boolean,
    ) => Promise<Answer>,
    say: (line: string) => void,
): Promise<Pairing | undefined> {
    // None waits on another, and the holder is a round trip to the site.
    const [holder, allowed, unserved] = await Promise.all([
        holderOf(pairing),
        allowedSites(allowedFile),
        unservedOf(pairing, settings),
    ])
    // An install run `--full` gives full access to every link, so a link's ask for it is moot.
    const asksFull = pairing.full && settings.full !== true
    const before =
        holder === undefined
            ? undefined
            : allowedAs(allowed, pairing.site, holder, {
                  tools: pairing.tools,
                  full: asksFull,
              })
    if (before !== undefined) {
        say(`Pairing with ${shownSite(pairing.site)}, which you always allow.`)
        return asksFull && before.full === false
            ? siteToolsOnly(pairing)
            : pairing
    }
    const answer = await askVisitor(
        question(pairing, settings, unserved),
        asksFull,
    )
    if (answer === 'deny') return undefined
    const allowedAsAnswered =
        answer === 'siteTools' ? siteToolsOnly(pairing) : pairing
    if (holder !== undefined)
        await allowAlways(
            allowedFile,
            pairing.site,
            holder,
            allowedAsAnswered.tools,
            asksFull ? answer === 'allow' : undefined,
        )
    return allowedAsAnswered
}

/**
 * Shows `line` as a notification, coalesced: one at a time, and a line arriving while one shows
 * replaces any still waiting, so a burst on the bridge's stderr is never read at its pace.
 */
function notifier(): { show(line: string): void; settled(): Promise<void> } {
    let waiting: string | undefined
    let showing: Promise<void> | undefined
    async function drain(): Promise<void> {
        while (waiting !== undefined) {
            const line = waiting
            waiting = undefined
            await notify(line)
        }
        showing = undefined
    }
    return {
        show(line) {
            waiting = line
            showing ??= drain()
        },
        async settled() {
            await showing
        },
    }
}

/** Opens `link`: asks the visitor, then runs the bridge until it ends. Answers the exit code. */
async function open(link: string): Promise<number> {
    const notifications = notifier()
    const log = `${import.meta.dir}/../bridge.log`
    let logged = Promise.resolve()
    /** Writes `line` to the log alone. */
    function record(line: string): void {
        console.error(line)
        logged = logged.then(() =>
            appendFile(log, `${new Date().toISOString()} ${line}\n`).catch(
                () => {},
            ),
        )
    }
    function say(line: string): void {
        record(line)
        notifications.show(line)
    }
    async function settled(code: number): Promise<number> {
        await notifications.settled()
        await logged
        return code
    }
    try {
        return settled(await pairWith(link, say, record))
    } catch (thrown) {
        // The applet discards this process's output, so a throw is only seen if it is said.
        say(
            `The bridge could not open: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        )
        return settled(1)
    }
}

async function pairWith(
    link: string,
    say: (line: string) => void,
    record: (line: string) => void,
): Promise<number> {
    const pairing = pairingOf(link)
    if (pairing === undefined) {
        say('That link isn’t one this bridge can pair with.')
        return 1
    }
    const settings = (await Bun.file(
        `${import.meta.dir}/settings.json`,
    ).json()) as HandlerSettings
    record(`${pairing.site} asks for @abide/bridge ${pairing.version}.`)
    const allowed = await consented(
        pairing,
        settings,
        allowedIn(import.meta.dir),
        ask,
        say,
    )
    if (allowed === undefined) return 0
    const running = Bun.spawn(bridgeArguments(allowed, settings), {
        stdout: 'ignore',
        stderr: 'pipe',
        // The visitor's own `--env` last, so a `PATH` they gave install wins over the one it found.
        env: { ...Bun.env, PATH: searchPath(settings), ...settings.env },
    })
    for await (const line of readLines(
        running.stderr as ReadableStream<Uint8Array>,
    )) {
        const said = line.trim()
        if (said !== '') say(said)
    }
    return running.exited
}

if (import.meta.main) process.exit(await open(process.argv[2] ?? ''))
