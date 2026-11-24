// `node:fs` for `existsSync`: the walk is synchronous, so a render's setup can take it before its
// first byte (41.19) — an async read would answer after the page's markdown twin read it.
import { existsSync } from 'node:fs'

/**
 * The nearest directory at or above this module holding `marker`, or `undefined` where none does —
 * walked up to rather than computed from depth, because where the server's modules sit is the build's
 * business.
 */
export function directoryAbove(marker: string): string | undefined {
    let directory = import.meta.dir
    while (!existsSync(`${directory}/${marker}`)) {
        const parent = directory.slice(0, directory.lastIndexOf('/'))
        if (parent === '' || parent === directory) return undefined
        directory = parent
    }
    return directory
}
