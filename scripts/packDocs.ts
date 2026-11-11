#!/usr/bin/env bun
/*
What `@abide/abide` carries for a reader who has `node_modules` and nothing else — an agent in a
fresh app above all, which knows no abide it was not handed. Run by the package's `prepack`, so
what is published was read off this checkout:

- `docs/abide.md`, every docs page in reading order, fetched from the built docs app at the address
  that serves it, so the words keep the one home a page's `index.abide` gives them (RULEBOOK 38.106)
- `docs/RULEBOOK.md`, which every `RULEBOOK n.nn` a refusal ends with resolves in (38.105), and
  `docs/REGISTRY.md`, the names its clauses hang off

The three are copies, so `packages/abide/docs/` is ignored rather than checked in.
*/

import { serveDocsApp } from '../packages/abide/bench/serveDocsApp.ts'

const REPO = new URL('../', import.meta.url).pathname
const OUT = `${REPO}packages/abide/docs`

/** `/abide.md` as the built docs app answers it, on a port the OS picks. */
async function documentation(): Promise<string> {
    const { origin, stop } = await serveDocsApp()
    try {
        const answer = await fetch(`${origin}/abide.md`)
        if (!answer.ok)
            throw new Error(`packDocs: /abide.md answered ${answer.status}`)
        return await answer.text()
    } finally {
        stop()
    }
}

await Bun.write(`${OUT}/abide.md`, await documentation())
for (const name of ['RULEBOOK.md', 'REGISTRY.md'])
    await Bun.write(
        `${OUT}/${name}`,
        await Bun.file(`${REPO}docs/${name}`).text(),
    )
console.log(`packDocs: abide.md, RULEBOOK.md and REGISTRY.md -> ${OUT}`)
