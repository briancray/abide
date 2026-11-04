// WHAT RUNS WHEN A PAIRING LINK IS OPENED: the handler `abide-bridge install` bundles beside the app it
// registers, started by that app with the link. It asks the visitor first (44.42), then runs the
// release of the bridge the link names, as the command a site shows would — so a site is answered by
// the bridge that speaks its relay, while what asks is the one the visitor installed.
//
// RUN BY THE APP, NOT A SHELL: nothing of the visitor's login is here, so `bun`, `claude` and the
// `PATH` are what install found (`settings.json`) — an npm-installed `claude` is a `node` script, and
// finds `node` only on the PATH it was installed from. Every line the bridge says is written to the
// log the app opened and shown as a notification.

import { type Pairing, pairingOf } from './pairingLink.ts'
import { readLines } from './readLines.ts'

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
 * What the visitor is asked before `pairing` runs. EVERY LINK IS ASKED (44.42): a code proves only
 * that the site minted it, never that this visitor's browser asked for it, so an answer kept for a
 * site would pair any page's link to whoever minted its code.
 */
export function question(pairing: Pairing, settings: HandlerSettings): string {
    const tools =
        pairing.tools.length === 0
            ? 'It gets none of this Mac’s tools.'
            : `It also asks for these tools of this Mac’s: ${pairing.tools.join(', ')}.`
    // A variable's value is only named, never shown: it is as likely a token as a host.
    const names = Object.keys(settings.env)
    const kept =
        settings.claudeArgs.length === 0 && names.length === 0
            ? ''
            : `\n\nIt also gets what you gave install for every site: ${[...settings.claudeArgs, ...names].join(' ')}.`
    return `${pairing.site} wants to use your Claude Code as its assistant, with its own tools, on your Claude account.\n\n${tools}${kept}\n\nIt runs @abide/bridge ${pairing.version}. Allow it only if you just asked to pair on that site.`
}

/**
 * The bridge the link names, run as the command a site shows would run it (44.32), with the options
 * install kept ahead of the link's tools (44.44).
 */
export function bridgeArguments(
    pairing: Pairing,
    settings: HandlerSettings,
): string[] {
    const claudeArgs = [...settings.claudeArgs]
    if (pairing.tools.length > 0)
        claudeArgs.push('--tools', pairing.tools.join(','))
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

/** The `PATH` the bridge runs on: the directories of `bun` and `claude`, then the one install was run on. */
export function searchPath(settings: HandlerSettings): string {
    const directories: string[] = []
    for (const directory of [
        settings.bun.slice(0, settings.bun.lastIndexOf('/')),
        settings.claude.slice(0, settings.claude.lastIndexOf('/')),
        ...settings.path.split(':'),
    ])
        if (directory !== '' && !directories.includes(directory))
            directories.push(directory)
    return directories.join(':')
}

/** Runs one AppleScript with `argument` as `item 1 of argv`, answering what it printed, or `undefined` where it failed. */
async function appleScript(
    lines: string[],
    argument: string,
): Promise<string | undefined> {
    const script: string[] = ['-e', 'on run argv']
    for (const line of lines) script.push('-e', line)
    script.push('-e', 'end run')
    const child = Bun.spawn(['osascript', ...script, argument], {
        stdout: 'pipe',
        stderr: 'ignore',
    })
    const printed = (await new Response(child.stdout).text()).trim()
    return (await child.exited) === 0 ? printed : undefined
}

/** Asks the visitor about `pairing` in a dialog; closing it is a no. */
async function allowed(
    pairing: Pairing,
    settings: HandlerSettings,
): Promise<boolean> {
    const pressed = await appleScript(
        [
            'display dialog (item 1 of argv) with title "abide bridge" buttons {"Don’t Allow", "Allow"} default button "Don’t Allow" cancel button "Don’t Allow" with icon caution',
            'button returned of result',
        ],
        question(pairing, settings),
    )
    return pressed === 'Allow'
}

/**
 * Shows `line` as a notification, coalesced: one `osascript` at a time, and a line arriving while one
 * shows replaces any still waiting, so a burst on the bridge's stderr is never read at its pace.
 */
function notifier(): { show(line: string): void; settled(): Promise<void> } {
    let waiting: string | undefined
    let showing: Promise<void> | undefined
    async function drain(): Promise<void> {
        while (waiting !== undefined) {
            const line = waiting
            waiting = undefined
            await appleScript(
                [
                    'display notification (item 1 of argv) with title "abide bridge"',
                ],
                line,
            )
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
    function say(line: string): void {
        console.error(line)
        notifications.show(line)
    }
    const pairing = pairingOf(link)
    if (pairing === undefined) {
        say('That link isn’t one this bridge can pair with.')
        await notifications.settled()
        return 1
    }
    const settings = (await Bun.file(
        `${import.meta.dir}/settings.json`,
    ).json()) as HandlerSettings
    if (!(await allowed(pairing, settings))) return 0
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
    const code = await running.exited
    await notifications.settled()
    return code
}

if (import.meta.main) process.exit(await open(process.argv[2] ?? ''))
