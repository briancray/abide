import type { CliManifestEntry } from './CliManifestEntry.ts'

/*
Map from rpc export-name (e.g. "getReport") to its manifest entry. Built
by the bundler from the same rpcRegistry MCP consumes; entries are
emitted only for rpcs with `clients.cli: true`. The CLI binary and any
programmatic createClient caller read this to dispatch calls.
*/
export type CliManifest = Record<string, CliManifestEntry>
