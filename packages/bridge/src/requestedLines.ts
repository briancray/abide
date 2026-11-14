// WHAT A LINK ASKS OF THIS MACHINE, AS A VISITOR READS IT (44.92): each built-in tool by what it lets
// the site do, several tools sharing one line, and every MCP tool on one line naming its server and how
// many of that server's tools it asks for — a site asking for many tools one by one is a few lines, and
// the count says how much it asked.

import { serverOf } from './grant.ts'

// The built-in tools by what they let a site do, in the order the lines are read: what reaches this
// machine furthest first. A tool that only keeps Claude Code's own notes is no line at all.
const CAPABILITIES: readonly { line: string; tools: readonly string[] }[] = [
    { line: 'Run commands', tools: ['Bash', 'BashOutput', 'KillShell'] },
    {
        line: 'Change your files',
        tools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
    },
    {
        line: 'Read and search your files',
        tools: ['Read', 'Glob', 'Grep', 'LS'],
    },
    { line: 'Search the web', tools: ['WebSearch'] },
    { line: 'Open web pages', tools: ['WebFetch'] },
    { line: 'Start helper agents', tools: ['Agent', 'Task'] },
]
const UNSHOWN = new Set(['TodoWrite', 'ExitPlanMode'])

/**
 * The lines naming what `tools` ask of this machine: one per capability their built-in tools give, in
 * `CAPABILITIES`' order, then any built-in it does not name by its own name, then one naming every MCP
 * server with how many of its tools are asked for — `all tools` where a whole server is.
 */
export function requestedLines(tools: readonly string[]): string[] {
    const lines: string[] = []
    for (const { line, tools: covered } of CAPABILITIES)
        for (const tool of covered)
            if (tools.includes(tool)) {
                lines.push(line)
                break
            }
    const servers = new Map<string, number | 'all'>()
    for (const tool of tools) {
        const server = serverOf(tool)
        if (server === undefined) {
            let named = UNSHOWN.has(tool)
            for (const { tools: covered } of CAPABILITIES)
                if (covered.includes(tool)) named = true
            if (!named) lines.push(`Use ${tool}`)
            continue
        }
        const counted = servers.get(server) ?? 0
        servers.set(
            server,
            counted === 'all' || tool === `mcp__${server}`
                ? 'all'
                : counted + 1,
        )
    }
    if (servers.size > 0) {
        const named: string[] = []
        for (const [server, count] of servers)
            named.push(
                `${server} (${count === 'all' ? 'all tools' : count === 1 ? '1 tool' : `${count} tools`})`,
            )
        lines.push(`MCP servers: ${named.join(', ')}`)
    }
    return lines
}
