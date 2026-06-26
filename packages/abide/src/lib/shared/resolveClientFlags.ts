import type { ClientFlags } from './types/ClientFlags.ts'

/*
Fills in the missing keys of a user-supplied `clients` option. Browser
always defaults to true (the historical surface). The mcp/cli auto-on
defaults are decided by the caller and passed in, since the safe default
differs per declaration: a read-only rpc may auto-expose to MCP while a
mutating one must not, and sockets gate differently again. Explicit
values in `flags` always win over the computed defaults.
*/
export function resolveClientFlags(
    flags: Partial<ClientFlags> | undefined,
    defaults: { mcp: boolean; cli: boolean },
): ClientFlags {
    return {
        browser: flags?.browser ?? true,
        mcp: flags?.mcp ?? defaults.mcp,
        cli: flags?.cli ?? defaults.cli,
    }
}
