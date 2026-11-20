import { mkdtemp, rm } from 'node:fs/promises' // bun has no temporary directory or recursive remove of its own
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

/** An empty directory of the bridge's own, and the removal of it with all it holds. */
export async function scratchDirectory(): Promise<{
    directory: string
    remove: () => Promise<void>
}> {
    const directory = await mkdtemp(`${tmpdir()}/abide-bridge-`)
    return {
        directory,
        remove: () => rm(directory, { recursive: true, force: true }),
    }
}
