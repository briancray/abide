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

// The same settle the dev server uses: an editor's save is more than one event, and one
// regeneration per event is three passes over eighty-five pages for one keystroke.
const SETTLE_MILLISECONDS = 25

await buildPages()

const app = Bun.spawn(
    ['bun', ABIDE, 'dev', '--root', `${DOGFOOD}src`, '--port', '3131'],
    { stdout: 'inherit', stderr: 'inherit' },
)

let settling: ReturnType<typeof setTimeout> | undefined
// `examples/` and `scripts/` as well as `content/`: a card's source and the renderer that turns
// it into markup are both things a page is made of.
for (const directory of ['content', 'examples', 'scripts', 'assets'])
    watch(`${DOGFOOD}${directory}`, { recursive: true }, () => {
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
