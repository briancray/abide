import type { CliManifestEntry } from './CliManifestEntry.ts'

/*
Map from command name (URL-derived via commandNameForUrl, e.g. "getReport"
or "users-list") to its manifest entry. Built by the bundler from
rpcRegistry and socketRegistry; entries are emitted for rpcs and sockets
with `clients.cli: true`. Sockets produce `<base>-tail` (and `-publish`
when `allowClientPublish` is set). The CLI binary and any programmatic
createClient caller read this to dispatch calls.
*/
export type CliManifest = Record<string, CliManifestEntry>
