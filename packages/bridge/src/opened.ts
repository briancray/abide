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
    allowedIn,
    allowedSites,
    allowsUnasked,
} from './allowedSites.ts'
import { BRIDGE_PATH } from './bridge.ts'
import { type Answer, ask, notify } from './desktop.ts'
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
    env: Record<string, string>
}

/**
 * What the visitor is asked before `pairing` runs, naming each MCP tool it asks for of a server their
 * Claude Code is not configured with, `unserved` (44.65).
 */
export function question(
    pairing: Pairing,
    settings: HandlerSettings,
    unserved: readonly string[] = [],
): string {
    const tools =
        pairing.tools.length === 0
            ? 'It gets none of this computer’s tools.'
            : `It also asks for these tools of this computer’s: ${pairing.tools.join(', ')}.`
    const missing =
        unserved.length === 0
            ? ''
            : `\n\nYour Claude Code has no ${serversNamed(unserved)} MCP server, so it can’t give ${unserved.join(', ')}. Add it with \`claude mcp add --scope user\` before you ask.`
    // A variable's value is only named, never shown: it is as likely a token as a host.
    const names = Object.keys(settings.env)
    const kept =
        settings.claudeArgs.length === 0 && names.length === 0
            ? ''
            : `\n\nIt also gets what you gave install for every site: ${[...settings.claudeArgs, ...names].join(' ')}.`
    return `${pairing.site} wants to use your Claude Code as its assistant, with its own tools, on your Claude account.\n\n${tools}${missing}${kept}\n\nIt runs @abide/bridge ${pairing.version}. Allow it only if you just asked to pair on that site.`
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
export async function holderOf(pairing: Pairing): Promise<string | undefined> {
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
        () => {},
    )
    return grant.unserved
}

/**
 * Whether `pairing` may pair: unasked where the visitor always allows its site for the holder its code
 * was minted for and it asks for no tool beyond those allowed then (44.62), else as `askVisitor`
 * answers — offering to always allow only where the site named a holder — keeping an always in
 * `allowedFile`.
 */
export async function consented(
    pairing: Pairing,
    settings: HandlerSettings,
    allowedFile: string,
    askVisitor: (question: string, offerAlways: boolean) => Promise<Answer>,
    say: (line: string) => void,
): Promise<boolean> {
    // None waits on another, and the holder is a round trip to the site.
    const [holder, allowed, unserved] = await Promise.all([
        holderOf(pairing),
        allowedSites(allowedFile),
        unservedOf(pairing, settings),
    ])
    if (
        holder !== undefined &&
        allowsUnasked(allowed, pairing.site, holder, pairing.tools)
    ) {
        say(
            `Pairing with ${new URL(pairing.site).host}, which you always allow.`,
        )
        return true
    }
    const answer = await askVisitor(
        question(pairing, settings, unserved),
        holder !== undefined,
    )
    if (answer === 'always' && holder !== undefined)
        await allowAlways(allowedFile, pairing.site, holder, pairing.tools)
    return answer !== 'deny'
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
    function say(line: string): void {
        console.error(line)
        logged = logged.then(() =>
            appendFile(log, `${new Date().toISOString()} ${line}\n`).catch(
                () => {},
            ),
        )
        notifications.show(line)
    }
    async function settled(code: number): Promise<number> {
        await notifications.settled()
        await logged
        return code
    }
    try {
        return settled(await pairWith(link, say))
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
): Promise<number> {
    const pairing = pairingOf(link)
    if (pairing === undefined) {
        say('That link isn’t one this bridge can pair with.')
        return 1
    }
    const settings = (await Bun.file(
        `${import.meta.dir}/settings.json`,
    ).json()) as HandlerSettings
    if (
        !(await consented(
            pairing,
            settings,
            allowedIn(import.meta.dir),
            ask,
            say,
        ))
    )
        return 0
    const running = Bun.spawn(bridgeArguments(pairing, settings), {
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
