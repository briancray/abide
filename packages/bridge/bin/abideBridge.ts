#!/usr/bin/env bun
// `abide-bridge <site> <code> [--claude <path>] [--env NAME=VALUE]... [-- <claude options>]` — the command
// an abide site shows you to connect your Claude Code to its assistant. `--claude <path>` names the
// executable where `claude` is not on PATH; each `--env` sets a variable Claude Code runs with; whatever
// follows `--` is passed to Claude Code as you wrote it, and is how you give a site what reaches this
// machine — `-- --tools WebSearch,WebFetch` for the built-in tools it asks for.
//
// `abide-bridge install` takes the same options and builds and registers, on macOS, Linux or Windows,
// what opens the pairing link a site shows beside its command, so a click pairs instead of a terminal —
// every link it opens runs with the `--env` and the `--` options given here (44.44); `abide-bridge
// uninstall` takes it away. `abide-bridge forget [<site>]` stops always allowing a site, or every site.

import { allowedIn, forget } from '../src/allowedSites.ts'
import { bridge } from '../src/bridge.ts'
import {
    handlerDirectory,
    install,
    installDirectory,
    uninstall,
} from '../src/install.ts'

const USAGE =
    'usage: abide-bridge <site> <code> [--claude <path>] [--env NAME=VALUE]... [-- <claude options>]\n       abide-bridge install [--claude <path>] [--env NAME=VALUE]... [-- <claude options>]\n       abide-bridge uninstall\n       abide-bridge forget [<site>]'

const all = process.argv.slice(2)
const split = all.indexOf('--')
const args = split === -1 ? all : all.slice(0, split)
const claudeArgs = split === -1 ? [] : all.slice(split + 1)
let claude: string | undefined
const env: Record<string, string> = {}
const positional: string[] = []
let malformed = false
for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string
    if (arg === '--claude') claude = args[++index]
    else if (arg === '--env') {
        const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(
            args[++index] ?? '',
        )
        if (assignment === null) malformed = true
        else env[assignment[1] as string] = assignment[2] as string
    } else positional.push(arg)
}
const [site, code] = positional

if (
    malformed ||
    site === undefined ||
    (site !== 'uninstall' &&
        site !== 'install' &&
        site !== 'forget' &&
        code === undefined)
) {
    console.error(USAGE)
    process.exit(2)
}

try {
    if (site === 'uninstall') {
        await uninstall()
        console.error(`Removed ${installDirectory()}.`)
    } else if (site === 'forget') {
        const forgotten = await forget(
            allowedIn(handlerDirectory(installDirectory())),
            code,
        )
        console.error(
            forgotten === 0
                ? `No site was always allowed${code === undefined ? '' : ` as ${code}`}.`
                : `Forgot ${forgotten === 1 ? 'one site' : `${forgotten} sites`}. The next link from ${forgotten === 1 ? 'it' : 'them'} asks you again.`,
        )
    } else {
        // Absolute, because an installed handler runs from no directory of the visitor's and on no shell's PATH.
        const found = Bun.which(claude ?? 'claude')
        if (found === null)
            throw new Error(
                claude === undefined
                    ? 'Claude Code is not installed here: `claude` is not on PATH. Install it, sign in, or name it with --claude <path>, and run this again.'
                    : `--claude ${claude} is no executable here. Name the path to Claude Code, and run this again.`,
            )
        if (site === 'install') {
            const app = await install({
                bun: process.execPath,
                claude: found,
                path: Bun.env.PATH ?? '',
                claudeArgs,
                env,
            })
            console.error(
                `Installed ${app}. A site's pairing link now opens here, and asks you before it pairs. \`abide-bridge uninstall\` removes it.`,
            )
        } else {
            // Claude Code is started with this process's environment.
            Object.assign(process.env, env)
            await bridge({
                site,
                code: code as string,
                claudeArgs,
                claude: found,
            })
        }
    }
    process.exit(0)
} catch (thrown) {
    console.error(thrown instanceof Error ? thrown.message : String(thrown))
    process.exit(1)
}
