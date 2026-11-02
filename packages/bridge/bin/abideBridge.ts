#!/usr/bin/env bun
// `abide-bridge <site> <code> [--claude <path>] [-- <claude options>]` — the command an abide site shows
// you to connect your Claude Code to its assistant. `--claude <path>` names the executable where `claude`
// is not on PATH; whatever follows `--` is passed to Claude Code as you wrote it, and is how you give a
// site what reaches this machine — `-- --tools WebSearch,WebFetch` for the built-in tools it asks for.
//
// `abide-bridge install [--claude <path>]` builds and registers, on macOS, the app that opens the pairing
// link a site shows beside its command, so a click pairs instead of a terminal; `abide-bridge uninstall`
// takes it away.

import { bridge } from '../src/bridge.ts'
import { install, installDirectory, uninstall } from '../src/install.ts'

const all = process.argv.slice(2)
const split = all.indexOf('--')
const args = split === -1 ? all : all.slice(0, split)
const claudeArgs = split === -1 ? [] : all.slice(split + 1)
const flag = args.indexOf('--claude')
const claude = flag === -1 ? undefined : args[flag + 1]
const [site, code] = args.filter(
    (_arg, index) => flag === -1 || (index !== flag && index !== flag + 1),
)

if (
    site === undefined ||
    (site !== 'uninstall' && site !== 'install' && code === undefined)
) {
    console.error(
        'usage: abide-bridge <site> <code> [--claude <path>] [-- <claude options>]\n       abide-bridge install [--claude <path>]\n       abide-bridge uninstall',
    )
    process.exit(2)
}

try {
    if (site === 'uninstall') {
        await uninstall()
        console.error(`Removed ${installDirectory()}.`)
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
            })
            console.error(
                `Installed ${app}. A site's pairing link now opens here, and asks you before it pairs. \`abide-bridge uninstall\` removes it.`,
            )
        } else
            await bridge({
                site,
                code: code as string,
                claudeArgs,
                claude: found,
            })
    }
    process.exit(0)
} catch (thrown) {
    console.error(thrown instanceof Error ? thrown.message : String(thrown))
    process.exit(1)
}
