import type { VerbRegistryEntry } from './types/VerbRegistryEntry.ts'

/*
Process-wide registry of every verb-bound RPC declared in the app.
defineRpc inserts on first construction (which happens at module-load
time inside the rpc dispatcher cache or eagerly when MCP / CLI walks the
rpc manifest). MCP server reads this to build its tools list; the CLI
binary reads it to generate subcommands. The browser path never touches
this — the client stub has no schema or clients metadata to register.
*/
export const verbRegistry = new Map<string, VerbRegistryEntry>()
