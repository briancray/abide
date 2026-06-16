import packageJson from '../../../package.json' with { type: 'json' }

/*
The framework's own version, inlined at build time from abide's package.json
(a compiled binary has no node_modules to read at runtime). Rides the health
payload's `abide` field — truthy for the "is this a abide server" check,
informative for skew diagnosis.
*/
export const ABIDE_VERSION: string = packageJson.version
