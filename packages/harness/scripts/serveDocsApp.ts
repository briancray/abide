// THE DOCS, BUILT AND SERVED, for the two things that drive them from the outside: `bun run
// status` puts its own page beside them, and the measure pass walks every card in them.
//
// A SUBPROCESS RUNNING THE REAL COMMAND. The docs are an abide app now, so what a script drives
// has to be `abide start` over `abide build`'s output — a second server reading the same files
// would be a second answer to "what does this address serve", and the whole point of driving the
// built app is that a card measured here is the card a reader gets.

import { buildPages } from '../../dogfood/scripts/buildPages.ts'

const DOGFOOD = new URL('../../dogfood/', import.meta.url).pathname
const ABIDE = new URL('../../abide/bin/abide.ts', import.meta.url).pathname

export type DocsApp = {
    // The origin `abide start` bound, with no trailing slash.
    origin: string
    stop: () => void
}

export async function serveDocsApp(): Promise<DocsApp> {
    await buildPages()
    const built = Bun.spawnSync([
        'bun',
        ABIDE,
        'build',
        '--root',
        `${DOGFOOD}src`,
        '--out',
        `${DOGFOOD}.abide`,
    ])
    if (built.exitCode !== 0)
        throw new Error(`abide build failed: ${built.stderr.toString()}`)

    // `--port 0` and the address read back off stdout: this runs beside whatever else a
    // developer has bound, and a fixed port is the one way a script that works alone fails on a
    // busy machine.
    const server = Bun.spawn(
        [
            'bun',
            ABIDE,
            'start',
            '--root',
            `${DOGFOOD}src`,
            '--out',
            `${DOGFOOD}.abide`,
            '--port',
            '0',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )

    let seen = ''
    for await (const chunk of server.stdout as ReadableStream<Uint8Array>) {
        seen += new TextDecoder().decode(chunk)
        const found = /http:\/\/[^\s]+/.exec(seen)
        if (found)
            return {
                origin: new URL(found[0]).origin,
                stop: () => {
                    server.kill()
                },
            }
    }
    throw new Error(`abide start printed no address: ${seen}`)
}
