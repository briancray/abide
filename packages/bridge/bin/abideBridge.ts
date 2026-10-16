#!/usr/bin/env bun
// `abide-bridge <site> <code> [--claude <path>] [-- <claude options>]` — the command an abide site shows
// you to connect your Claude Code to its assistant. `--claude <path>` names the executable where `claude`
// is not on PATH; whatever follows `--` is passed to Claude Code as you wrote it, and is how you give a
// site what reaches this machine — `-- --tools WebSearch,WebFetch` for the built-in tools it asks for.

import { bridge } from '../src/bridge.ts'

const all = process.argv.slice(2)
const split = all.indexOf('--')
const args = split === -1 ? all : all.slice(0, split)
const claudeArgs = split === -1 ? [] : all.slice(split + 1)
const flag = args.indexOf('--claude')
const claude = flag === -1 ? undefined : args[flag + 1]
const [site, code] = args.filter(
    (_arg, index) => flag === -1 || (index !== flag && index !== flag + 1),
)

if (site === undefined || code === undefined) {
    console.error(
        'usage: abide-bridge <site> <code> [--claude <path>] [-- <claude options>]',
    )
    process.exit(2)
}
if (claude === undefined && Bun.which('claude') === null) {
    console.error(
        'Claude Code is not installed here: `claude` is not on PATH. Install it, sign in, and run this again.',
    )
    process.exit(1)
}

try {
    await bridge({
        site,
        code,
        claudeArgs,
        ...(claude === undefined ? {} : { claude }),
    })
    process.exit(0)
} catch (thrown) {
    console.error(thrown instanceof Error ? thrown.message : String(thrown))
    process.exit(1)
}
