#!/usr/bin/env bun
import { CAPABILITY_TOOLS } from '../src/CAPABILITY_TOOLS.ts'
import { launch } from '../src/launch.ts'
import type { PermissionMode } from '../src/PermissionMode.ts'
import { serve } from '../src/serve.ts'

/* Local abide dev server default — mirrors abide's DEFAULT_PORT. The package owns
its own default so it needs no internal abide import. */
const DEFAULT_APP_PORT = 3000

const [, , command, ...rest] = process.argv

// Reads `--name=value` or `--name value` from argv.
function parseFlag(name: string): string | undefined {
    const prefix = `--${name}=`
    const match = rest.find((arg) => arg.startsWith(prefix))
    if (match) {
        return match.slice(prefix.length)
    }
    const index = rest.indexOf(`--${name}`)
    if (index !== -1 && index + 1 < rest.length) {
        return rest[index + 1]
    }
    return undefined
}

const url = parseFlag('url') ?? `http://localhost:${DEFAULT_APP_PORT}`
const mcpToken = parseFlag('mcp-token')

if (command === 'serve') {
    const port = parseFlag('port')
    /* Each `--allow <capability>` maps to the one built-in tool it enables, via
    the closed CAPABILITY_TOOLS vocabulary — an unknown capability resolves to no
    tool, so the page can never widen this set. */
    const tools = rest
        .map((arg, index) =>
            arg === '--allow'
                ? CAPABILITY_TOOLS[rest[index + 1] as keyof typeof CAPABILITY_TOOLS]
                : undefined,
        )
        .filter((tool) => tool !== undefined)
    const server = serve({
        url,
        port: port ? Number(port) : undefined,
        token: parseFlag('token'),
        mcpToken,
        tools,
        // End the process once the page goes away (a reload reconnects within the grace).
        onIdle: () => process.exit(0),
    })
    console.error(`abide assistant bridge on http://127.0.0.1:${server.port} -> ${url}`)
} else {
    // Default action: the interactive TUI against the local (or --url) app.
    const permissionMode = parseFlag('permission-mode') as PermissionMode | undefined
    await launch({ url, mcpToken, ...(permissionMode ? { permissionMode } : {}) })
}
