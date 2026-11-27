// 44.58 — WHERE A BRIDGE FINDS THE VISITOR'S MCP SERVERS: each `--mcp-config` they passed after `--`, and
// the user scope of their Claude Code configuration where they passed none or the bridge runs `--full`,
// which reads every server `claude` would (44.82).

import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs' // bun has no temporary directory of its own
import { tmpdir } from 'node:os' // nor the system's temporary directory

import { grantFor } from '../src/grant.ts'

const directory = mkdtempSync(`${tmpdir()}/grant-`)
afterAll(() => rmSync(directory, { recursive: true, force: true }))
const passed = `${directory}/passed.json`
await Bun.write(
    passed,
    JSON.stringify({ mcpServers: { notes: { command: 'notes' } } }),
)
await Bun.write(
    `${directory}/.claude.json`,
    JSON.stringify({ mcpServers: { calendar: { command: 'calendar' } } }),
)

const ASKED = ['mcp__calendar__meetings', 'mcp__notes__read']

async function grantedWith(
    full: boolean,
): Promise<{ mcp: string[]; unserved: string[] }> {
    const kept = Bun.env.CLAUDE_CONFIG_DIR
    Bun.env.CLAUDE_CONFIG_DIR = directory
    try {
        const { grant } = await grantFor(
            ASKED,
            ['--tools', ASKED.join(','), '--mcp-config', passed],
            full,
        )
        return { mcp: grant.mcp, unserved: grant.unserved }
    } finally {
        if (kept === undefined) delete Bun.env.CLAUDE_CONFIG_DIR
        else Bun.env.CLAUDE_CONFIG_DIR = kept
    }
}

// THE REVERT: read only the `--mcp-config` a full bridge was passed in `grantFor`; the calendar tool,
// which the full turn can use, reads `unserved`.
test('a full bridge passed an --mcp-config finds the user scope too — 44.58, 44.82', async () => {
    expect(await grantedWith(true)).toEqual({ mcp: ASKED, unserved: [] })
})

test('a bridge passed an --mcp-config, not full, finds that config alone — 44.58', async () => {
    expect(await grantedWith(false)).toEqual({
        mcp: ['mcp__notes__read'],
        unserved: ['mcp__calendar__meetings'],
    })
})
