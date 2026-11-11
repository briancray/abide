// Abide's own package directory in this install, with its trailing slash — what a scaffold depends
// on, what a compiled entry resolves abide's entries against, and what a build's freshness reads.
export const ABIDE_DIRECTORY = Bun.fileURLToPath(
    new URL('../../', import.meta.url),
)
