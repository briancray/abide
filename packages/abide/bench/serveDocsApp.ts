// THE DOCS, BUILT AND SERVED, for what drives them from the outside: `bun run bench:share`
// (`nameTheShare.ts`) navigates between real docs addresses and prices the layers of each op, and
// `scripts/packDocs.ts` reads `/abide.md` off them for the published package.
//
// A SUBPROCESS RUNNING THE REAL COMMAND. The docs are an abide app now, so what a script drives
// has to be `abide start` over `abide build`'s output — a second server reading the same files
// would be a second answer to "what does this address serve", and the whole point of driving the
// built app is that a card measured here is the card a reader gets.

// The CLI-driving helpers are the framework tests' own: the bench and `packDocs` reuse them so
// "build, start on port 0, read the origin back" has one spelling, not a second to disagree with.
import { buildApp, startApp } from '../tests/builtApp.ts'

const DOGFOOD = new URL('../../dogfood/', import.meta.url).pathname

export type DocsApp = {
    /** The origin `abide start` bound, with no trailing slash. */
    origin: string
    stop: () => void
}

/**
 * Builds the docs app, starts `abide start` on it, and returns its origin and a stop.
 *
 * `--port 0` and the address read back off stdout: this runs beside whatever else a developer has
 * bound, and a fixed port is the one way a script that works alone fails on a busy machine.
 */
export async function serveDocsApp(): Promise<DocsApp> {
    const built = await buildApp(`${DOGFOOD}src`, `${DOGFOOD}.abide`)
    if (built.exitCode !== 0)
        throw new Error(`abide build failed: ${built.stderr}`)
    const { base, stop } = await startApp(
        `${DOGFOOD}src`,
        process.env,
        `${DOGFOOD}.abide`,
    )
    return { origin: base, stop }
}
