#!/usr/bin/env bun
// `abide-bridge <site> <code>` — the command an abide site shows you to connect your Claude Code to its
// assistant. `--claude <path>` names the executable where `claude` is not on PATH.

import { bridge } from '../src/bridge.ts'

const args = process.argv.slice(2)
const flag = args.indexOf('--claude')
const claude = flag === -1 ? undefined : args[flag + 1]
const [site, code] = args.filter(
    (_arg, index) => flag === -1 || (index !== flag && index !== flag + 1),
)

if (site === undefined || code === undefined) {
    console.error('usage: abide-bridge <site> <code> [--claude <path>]')
    process.exit(2)
}
if (claude === undefined && Bun.which('claude') === null) {
    console.error(
        'Claude Code is not installed here: `claude` is not on PATH. Install it, sign in, and run this again.',
    )
    process.exit(1)
}

try {
    await bridge({ site, code, ...(claude === undefined ? {} : { claude }) })
    process.exit(0)
} catch (thrown) {
    console.error(thrown instanceof Error ? thrown.message : String(thrown))
    process.exit(1)
}
