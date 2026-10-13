import { realpathSync } from 'node:fs' // bun exposes no realpath of its own

// A root that is not there is refused by the command that reads it, at the path it was given.
export function realOrAsGiven(path: string): string {
    try {
        return realpathSync(path)
    } catch {
        return path
    }
}
