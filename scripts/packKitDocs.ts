#!/usr/bin/env bun
/*
What `@abide/kit` carries for a reader who has `node_modules` and nothing else — an agent in an app
that installed it above all. Run by the package's `prepack`, so what is published was read off this
checkout:

- `docs/kit.md`, every kit page in reading order, fetched from the built docs app at the address that
  serves it, so the words keep the one home a page's `index.abide` gives them — its cards' source,
  the styling table, and the REGISTRY rows at its foot

The clauses those pages cite are RULEBOOK's, which `@abide/abide` ships beside its own docs. A copy,
so `packages/kit/docs/` is ignored rather than checked in.
*/

import { serveDocsApp } from '../packages/abide/bench/serveDocsApp.ts'
import { SITE } from '../packages/dogfood/src/lib/SITE.ts'
import { markdownAddressOf } from '../packages/dogfood/src/lib/sitePages.ts'

const OUT = new URL('../packages/kit/docs/', import.meta.url).pathname

/** Every kit page in the order the site lists it. */
const KIT_PAGES = SITE.flatMap((group) => group.pages).filter((page) =>
    page.route.startsWith('/kit/'),
)

const { origin, stop } = await serveDocsApp()
try {
    let contents = ''
    let body = ''
    for (const page of KIT_PAGES) {
        const address = markdownAddressOf(page.route)
        const answer = await fetch(`${origin}${address}`)
        if (!answer.ok)
            throw new Error(`packKitDocs: ${address} answered ${answer.status}`)
        contents += `- ${page.nav} — \`${address.slice(1)}\`: ${page.description}\n`
        body += `\n---\n\n<!-- ${address.slice(1)} -->\n\n${await answer.text()}`
    }
    await Bun.write(
        `${OUT}kit.md`,
        `# @abide/kit documentation

Every kit page, in the order the abide docs list them. Each is also served by the docs site at its
address with \`.md\` on the end. A clause number a page cites is in
\`node_modules/@abide/abide/docs/RULEBOOK.md\`.

## Contents

${contents}${body}`,
    )
    console.log(`packKitDocs: ${KIT_PAGES.length} pages -> ${OUT}kit.md`)
} finally {
    stop()
}
