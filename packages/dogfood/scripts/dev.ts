#!/usr/bin/env bun

// `bun run dev` — the docs, live. Two watchers, because there are two sources: `abide dev`
// watches `src/` and rebuilds the app (38.4), and this watches `content/` and the renderers,
// and recompiles the markdown into `src/ui/pages` when a word changes. The second write lands
// in the first one's tree, so a save in `content/` reaches the browser the same way a save in
// a `.abide` does.

import { watch } from 'node:fs' // bun exposes no file watcher of its own

import { buildPages } from './buildPages.ts'

const DOGFOOD = new URL('../', import.meta.url).pathname
const ABIDE = new URL('../../abide/bin/abide.ts', import.meta.url).pathname

// THE SOCKET `abide start` USES, so the address is the same whichever way the docs are being
// served and the browser gate does not need a second one. `--port` on this command wins, and
// `PORT` wins over the default — which is what the CLI does on its own and what the docs say.
const PORT = '3131'

// The same settle the dev server uses: an editor's save is more than one event, and one
// regeneration per event is three passes over eighty-five pages for one keystroke.
const SETTLE_MILLISECONDS = 25

await buildPages()

// Everything after `bun run dev` is the command's, so `--port 4000` reaches `abide dev`.
const given = Bun.argv.slice(2)
const port = given.includes('--port')
    ? []
    : ['--port', process.env.PORT ?? PORT]

const app = Bun.spawn(
    ['bun', ABIDE, 'dev', '--root', `${DOGFOOD}src`, ...port, ...given],
    { stdout: 'inherit', stderr: 'inherit' },
)

let settling: ReturnType<typeof setTimeout> | undefined
// `examples/`, `scripts/` and `src/` as well as `content/`: a card's manifest, the renderer that
// turns it into markup and the source its Files panel quotes are all things a page is made of.
// What the build WRITES under `src/` is skipped, or every build would schedule the next one.
const WRITTEN = ['ui/pages/', 'ui/public/', 'ui/NAV_ITEMS.ts']
for (const directory of ['content', 'examples', 'scripts', 'assets', 'src'])
    watch(`${DOGFOOD}${directory}`, { recursive: true }, (_event, name) => {
        if (
            directory === 'src' &&
            WRITTEN.some((written) => String(name).startsWith(written))
        )
            return
        if (settling !== undefined) clearTimeout(settling)
        settling = setTimeout(() => {
            void buildPages().catch((thrown: unknown) => {
                // KEPT UP, for `abide dev`'s reason: a half-written directive is the common case
                // in a writing loop, and a command that exits on one is one you restart by hand.
                console.error(`docs: ${String(thrown)}`)
            })
        }, SETTLE_MILLISECONDS)
    })

await app.exited
