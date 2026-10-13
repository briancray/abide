import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { dirname } from 'node:path' // bun exposes no path helpers of its own

/** The nearest file or directory at `name` at or above `from`, or `undefined`. */
export function nearest(from: string, name: string): string | undefined {
    let at = from
    while (true) {
        const candidate = `${at}/${name}`
        if (existsSync(candidate)) return candidate
        const up = dirname(at)
        if (up === at) return undefined
        at = up
    }
}
