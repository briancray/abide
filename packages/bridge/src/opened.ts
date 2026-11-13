// WHAT RUNS WHEN A PAIRING LINK IS OPENED: the handler `abide-bridge install` bundles beside the app it
// registers, started with the link — or, installed from a checkout (44.89), the checkout's own, which
// then runs the checkout's bridge whatever release the link names. It asks the visitor first (44.42) — unless they always allow the
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
    /** The bridge package install was run from, where it is a checkout rather than a release (44.89). */
    checkout?: string
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
 * What the visitor is asked before `pairing` runs (44.42), by the app `asker` names beside its site
 * where the site names one, with its `note` as its own words (44.91): a site asking for full access is named as asking for it, and none of its tools
 * (44.85); else each tool it asks for, and each MCP tool of a server their Claude Code is not
 * configured with, `unserved` (44.65). Its icon is the caller's to lay on.
 */
export function question(
    pairing: Pairing,
    settings: HandlerSettings,
    unserved: readonly string[] = [],
    {
        name,
        note,
    }: { name?: string | undefined; note?: string | undefined } = {},
): Question {
    const site = shownSite(pairing.site)
    // The name is the site's to choose, so the site it is served from is always beside it.
    const asker = name === undefined ? site : `${name} (${site})`
    const owner = name ?? site
    const auto = inAutoMode(settings.claudeArgs)
        ? 'Claude Code will run with permissions in auto mode: it will do safe steps on its own and ask you before anything risky.'
        : ''
    // One headline at every level, so what is asked for is read in the body, where there is room for it.
    const headline = `${asker} is requesting access to Claude Code.`
    let said: string[]
    if (settings.full === true)
        said = [
            `You installed the bridge to give every site full access. ${auto}`,
        ]
    else if (pairing.full)
        said = [
            auto,
            'Only Site Tools is the safest option but may limit full functionality.',
        ]
    else if (pairing.tools.length === 0)
        said = [
            `It’s asking for its own tools only, and gets none of this computer’s.`,
        ]
    else {
        said = [
            `It’s asking for its own tools, plus these of this computer’s: ${pairing.tools.join(', ')}. ${auto}`,
        ]
        if (unserved.length > 0)
            said.push(
                `Your Claude Code has no ${serversNamed(unserved)} MCP server, so it can’t use ${unserved.join(', ')}. Add it with \`claude mcp add --scope user\` first.`,
            )
    }
    // 44.91 — the app's own words, said to be its own, ahead of what the bridge says.
    if (note !== undefined) said.unshift(`From ${owner}: ${note}`)
    // A variable's value is only named, never shown: it is as likely a token as a host.
    const kept = [...settings.claudeArgs, ...Object.keys(settings.env)]
    if (kept.length > 0)
        said.push(
            `It also gets what you gave install for every site: ${kept.join(' ')}.`,
        )
    // A site asking for full access offers its own tools alone in its place, which says enough.
    if (!pairing.full || settings.full === true)
        said.push(`Allow it only if you just asked to pair on ${site}.`)
    let body = ''
    for (const paragraph of said)
        if (paragraph.trim() !== '')
            body += `${body === '' ? '' : '\n\n'}${paragraph.trim()}`
    return { title: owner, headline, body, icon: undefined }
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
        ...(settings.checkout === undefined
            ? ['x', `@abide/bridge@${pairing.version}`]
            : [`${settings.checkout}/bin/abideBridge.ts`]),
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

/** The longest app name the question shows; a longer one is cut, so it cannot push the site out of view. */
const LONGEST_NAME = 60
/** The longest note the question shows: a sentence on why, never a page that buries the question. 44.91. */
const LONGEST_NOTE = 200

/**
 * What a site wrote, as one line a reader sees: each control character a space, each run of spaces one,
 * and cut at `longest` with an ellipsis where it ran past — or `undefined` where nothing is left.
 */
function oneLine(written: unknown, longest: number): string | undefined {
    if (typeof written !== 'string') return undefined
    const line = written
        .replace(/\p{Cc}/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if (line === '') return undefined
    return line.length > longest ? `${line.slice(0, longest - 1)}…` : line
}

const NO_ASKER = { holder: undefined, name: undefined, note: undefined }

/**
 * Who `pairing`'s code was minted for, as `/__abide/bridge` names them (44.63), the app's name and the
 * note the code was minted with (44.91), or `undefined` for each the site names none of — a release
 * before it did, or a code it did not mint.
 */
export async function askerOf(
    pairing: Pick<Pairing, 'site' | 'code'>,
): Promise<{
    holder: string | undefined
    name: string | undefined
    note: string | undefined
}> {
    try {
        const answer = await fetch(
            `${pairing.site}${BRIDGE_PATH}?holder=${encodeURIComponent(pairing.code)}`,
            { tls: siteTls(), signal: AbortSignal.timeout(10_000) },
        )
        if (!answer.ok) {
            await answer.body?.cancel()
            return NO_ASKER
        }
        const { holder, name, note } = (await answer.json()) as {
            holder?: unknown
            name?: unknown
            note?: unknown
        }
        return {
            holder:
                typeof holder === 'string' && holder !== ''
                    ? holder
                    : undefined,
            name: oneLine(name, LONGEST_NAME),
            note: oneLine(note, LONGEST_NOTE),
        }
    } catch {
        return NO_ASKER
    }
}

/** The largest icon the question shows: an app icon is a few hundred kilobytes at most. */
const LARGEST_ICON = 1024 * 1024
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * The icon `site` publishes at `/icon.png`, abide's app icon (45.15), or `undefined` where
 * it publishes none, it is no PNG, or it is larger than any app icon — the question waits on it, so it
 * is given three seconds.
 */
export async function iconOf(site: string): Promise<Uint8Array | undefined> {
    try {
        const answer = await fetch(`${site}/icon.png`, {
            tls: siteTls(),
            signal: AbortSignal.timeout(3_000),
        })
        const declared = Number(answer.headers.get('content-length') ?? 0)
        if (!answer.ok || declared > LARGEST_ICON) {
            await answer.body?.cancel()
            return undefined
        }
        const bytes = await answer.bytes()
        if (bytes.length > LARGEST_ICON) return undefined
        for (let at = 0; at < PNG_SIGNATURE.length; at++)
            if (bytes[at] !== PNG_SIGNATURE[at]) return undefined
        return bytes
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
    // None waits on another, and the asker and the icon are each a round trip to the site.
    const [asker, icon, allowed, unserved] = await Promise.all([
        askerOf(pairing),
        iconOf(pairing.site),
        allowedSites(allowedFile),
        unservedOf(pairing, settings),
    ])
    // An install run `--full` gives full access to every link, so a link's ask for it is moot.
    const asksFull = pairing.full && settings.full !== true
    const { holder } = asker
    const before =
        holder === undefined
            ? undefined
            : allowedAs(allowed, pairing.site, holder, {
                  tools: pairing.tools,
                  full: asksFull,
              })
    if (before !== undefined) {
        say(
            `Pairing with ${asker.name ?? shownSite(pairing.site)}, which you always allow.`,
        )
        return asksFull && before.full === false
            ? siteToolsOnly(pairing)
            : pairing
    }
    const answer = await askVisitor(
        {
            ...question(pairing, settings, unserved, asker),
            icon,
        },
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

/**
 * Opens `link` with the settings and the allowed sites kept in `directory`: asks the visitor, then runs
 * the bridge until it ends. Answers the exit code.
 */
export async function open(link: string, directory: string): Promise<number> {
    const notifications = notifier()
    const log = `${directory}/../bridge.log`
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
        return settled(await pairWith(link, directory, say, record))
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
    directory: string,
    say: (line: string) => void,
    record: (line: string) => void,
): Promise<number> {
    const pairing = pairingOf(link)
    if (pairing === undefined) {
        say('That link isn’t one this bridge can pair with.')
        return 1
    }
    const settings = (await Bun.file(
        `${directory}/settings.json`,
    ).json()) as HandlerSettings
    record(`${pairing.site} asks for @abide/bridge ${pairing.version}.`)
    const allowed = await consented(
        pairing,
        settings,
        allowedIn(directory),
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

if (import.meta.main)
    process.exit(await open(process.argv[2] ?? '', import.meta.dir))
