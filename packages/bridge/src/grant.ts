// WHAT A SITE IS GIVEN OF THIS MACHINE (44.29, 44.58): the tools it asked for that the visitor granted —
// built-in ones by name, an MCP server's as Claude Code names them, `mcp__<server>__<tool>`, or all of
// a server's as `mcp__<server>` — and of those, the MCP tools whose server the visitor's own Claude Code
// configuration holds. A site names tools and never a server: a server is a command this machine runs.

/** What Claude Code names the one MCP server the bridge hands it, and so the prefix on each of its tools. */
export const SERVER_NAME = 'app'

/** What `asked` is given, and why each tool it is not given is not. */
export type Grant = {
    /** Built-in tools, as Claude Code's `--tools` names them. */
    builtIn: string[]
    /** MCP tools, as `--allowedTools` names them. */
    mcp: string[]
    /** The visitor's servers those MCP tools are of, as an MCP config's `mcpServers` holds them. */
    servers: Record<string, unknown>
    /** Asked for and not granted. */
    ungranted: string[]
    /** Granted, of a server the visitor's configuration does not hold. */
    unserved: string[]
}

/**
 * The values the visitor gave a flag by any of its `spellings` — `--flag a b`, `--flag a,b` or
 * `--flag=a` — taken out of `args`, or `undefined` where they never gave it.
 */
export function takeFlag(
    args: string[],
    spellings: string[],
): string[] | undefined {
    let values: string[] | undefined
    for (let index = 0; index < args.length;) {
        const arg = args[index] as string
        const [flag, inline] = arg.split(/=(.*)/s) as [string, string?]
        if (!spellings.includes(flag)) {
            index++
            continue
        }
        values ??= []
        if (inline !== undefined) {
            values.push(inline)
            args.splice(index, 1)
        } else {
            let end = index + 1
            while (end < args.length && !(args[end] as string).startsWith('-'))
                end++
            values.push(...args.slice(index + 1, end))
            args.splice(index, end - index)
        }
    }
    return values
}

/** The tools the visitor granted, each `--tools` value split on commas and spaces. */
function grantedOf(values: string[] | undefined): Set<string> {
    const granted = new Set<string>()
    for (const value of values ?? [])
        for (const tool of value.split(/[\s,]+/))
            if (tool !== '') granted.add(tool)
    return granted
}

/** The server an MCP tool name is of — `calendar` for `mcp__calendar__meetings` or `mcp__calendar` — or `undefined` for a built-in. */
export function serverOf(tool: string): string | undefined {
    if (!tool.startsWith('mcp__')) return undefined
    const rest = tool.slice('mcp__'.length)
    const end = rest.indexOf('__')
    return end === -1 ? rest : rest.slice(0, end)
}

/** A server's name as Claude Code writes it into its tools' names. */
function toolNameOf(server: string): string {
    return server.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** The Claude Code configuration file whose user scope holds the servers `claude mcp add --scope user` adds. */
function userConfiguration(): string {
    const directory = Bun.env.CLAUDE_CONFIG_DIR
    return directory === undefined || directory === ''
        ? `${Bun.env.HOME ?? Bun.env.USERPROFILE ?? ''}/.claude.json`
        : `${directory}/.claude.json`
}

/**
 * The MCP servers the visitor's Claude Code is configured with, by the name its tools carry: those of
 * each `--mcp-config` they passed — a file, or JSON written out — or, where they passed none, the user
 * scope of their Claude Code configuration. Read each time, so a server added since is found. 44.58.
 *
 * Throws where a source they named cannot be read.
 */
export async function visitorServers(
    sources: string[] | undefined,
): Promise<Map<string, unknown>> {
    const servers = new Map<string, unknown>()
    const read: { mcpServers?: Record<string, unknown> }[] = []
    if (sources === undefined) {
        // Claude Code rewrites this file while it runs, so a read caught mid-write is no servers rather
        // than a failed turn — the visitor named no source to be told about.
        try {
            read.push(await Bun.file(userConfiguration()).json())
        } catch {}
    } else
        for (const source of sources) {
            const written = source.trim()
            try {
                read.push(
                    written.startsWith('{')
                        ? JSON.parse(written)
                        : await Bun.file(written).json(),
                )
            } catch (thrown) {
                throw new Error(
                    `The --mcp-config ${source} could not be read: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
                )
            }
        }
    for (const configuration of read)
        for (const [name, server] of Object.entries(
            configuration.mcpServers ?? {},
        ))
            servers.set(toolNameOf(name), server)
    // The bridge's own server is the site's, never one of the visitor's.
    servers.delete(SERVER_NAME)
    return servers
}

/** What a site asking for `asked` is given by a visitor who granted `granted` and is configured with `configured`. 44.29. */
export function grantOf(
    asked: readonly string[],
    granted: ReadonlySet<string>,
    configured: ReadonlyMap<string, unknown>,
): Grant {
    const grant: Grant = {
        builtIn: [],
        mcp: [],
        servers: {},
        ungranted: [],
        unserved: [],
    }
    for (const tool of asked) {
        const server = serverOf(tool)
        if (server === undefined) {
            ;(granted.has(tool) ? grant.builtIn : grant.ungranted).push(tool)
            continue
        }
        if (!granted.has(tool) && !granted.has(`mcp__${server}`)) {
            grant.ungranted.push(tool)
            continue
        }
        const configuration = configured.get(server)
        if (configuration === undefined) {
            grant.unserved.push(tool)
            continue
        }
        grant.mcp.push(tool)
        grant.servers[server] = configuration
    }
    return grant
}

/**
 * What a site asking for `asked` is given by a visitor who passed `claudeArgs`, beside those args with
 * `--tools` and `--mcp-config` taken out. The visitor's servers are read only where an MCP tool is asked.
 *
 * Throws where an `--mcp-config` they named cannot be read, unless `unreadable` is given: then that is
 * said to it, and the grant is of no server.
 */
export async function grantFor(
    asked: readonly string[],
    claudeArgs: readonly string[],
    unreadable?: (message: string) => void,
): Promise<{ grant: Grant; args: string[] }> {
    const args = [...claudeArgs]
    const granted = grantedOf(takeFlag(args, ['--tools']))
    const sources = takeFlag(args, ['--mcp-config'])
    let asksMcp = false
    for (const tool of asked) if (serverOf(tool) !== undefined) asksMcp = true
    let configured = new Map<string, unknown>()
    if (asksMcp)
        try {
            configured = await visitorServers(sources)
        } catch (thrown) {
            if (unreadable === undefined) throw thrown
            unreadable(
                thrown instanceof Error ? thrown.message : String(thrown),
            )
        }
    return { grant: grantOf(asked, granted, configured), args }
}

/** The servers `unserved` tools are of, as one list to name in a sentence. */
export function serversNamed(unserved: readonly string[]): string {
    const servers = new Set<string>()
    for (const tool of unserved) servers.add(serverOf(tool) as string)
    return [...servers].join(', ')
}

/** What the bridge says of each tool `grant` withholds, a line per reason. */
export function withheldNotices(grant: Grant): string[] {
    const notices: string[] = []
    if (grant.ungranted.length > 0)
        notices.push(
            `The site asked for ${grant.ungranted.join(', ')}, which this bridge wasn’t given. Add \`-- --tools ${grant.ungranted.join(',')}\` to allow it.`,
        )
    if (grant.unserved.length > 0)
        notices.push(
            `The site asked for ${grant.unserved.join(', ')}, but your Claude Code has no ${serversNamed(grant.unserved)} MCP server. Add it with \`claude mcp add --scope user\`.`,
        )
    return notices
}
