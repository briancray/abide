// EVERY CHAPTER APP IS THE CRM SO FAR: `bun packages/dogfood/scripts/forwardChapters.ts` copies each
// chapter's feature directory into every later chapter's app, and writes each app's home page, root
// layout and `.env` from the chapters it holds. Edit a feature in the chapter that owns it, then run
// this; `tests/examples.test.ts` fails while a later copy differs.

import { cp, rm } from 'node:fs/promises' // bun exposes no recursive copy or removal of its own
import { CHAPTER_FEATURES } from './CHAPTER_FEATURES.ts'

const EXAMPLES = Bun.fileURLToPath(new URL('../examples/', import.meta.url))
const appOf = (chapter: number) => `crm-${String(chapter).padStart(2, '0')}`

// Chapter 7 is where the CRM first files a page-wide hook (a CSP on every page).
const SIGNED_LAYOUT = await Bun.file(
    `${EXAMPLES}${appOf(7)}/src/layout.abide`,
).text()
const PLAIN_LAYOUT = await Bun.file(
    `${EXAMPLES}${appOf(1)}/src/layout.abide`,
).text()

for (let chapter = 1; chapter <= CHAPTER_FEATURES.length; chapter += 1) {
    const app = appOf(chapter)
    const src = `${EXAMPLES}${app}/src`
    for (let earlier = 1; earlier < chapter; earlier += 1) {
        const [feature] = CHAPTER_FEATURES[earlier - 1] as [string, string]
        await rm(`${src}/${feature}`, { recursive: true, force: true })
        await cp(
            `${EXAMPLES}${appOf(earlier)}/src/${feature}`,
            `${src}/${feature}`,
            {
                recursive: true,
            },
        )
    }
    let links = ''
    for (const [feature, label] of CHAPTER_FEATURES.slice(0, chapter))
        links += `    <p><a href={url('/${feature}')}>${label}</a></p>\n`
    await Bun.write(
        `${src}/index.abide`,
        `<script>\nimport { url } from '@abide/abide'\n</script>\n\n<head><title>CRM</title></head>\n\n<main>\n    <h1>CRM</h1>\n${links}</main>\n`,
    )
    await Bun.write(
        `${src}/layout.abide`,
        chapter >= 7 ? SIGNED_LAYOUT : PLAIN_LAYOUT,
    )
    let env = ''
    if (chapter >= 7)
        env +=
            '# Seals the sign-in cookie: set your own where the app is deployed.\nABIDE_PRINCIPAL_SECRET=crm-development-secret-change-me\n'
    if (chapter >= 8) env += `RETRIES=5\nDEBUG=${app}:billing\n`
    if (env !== '') await Bun.write(`${EXAMPLES}${app}/.env`, env)
    console.log(`${app}: ${chapter} feature${chapter === 1 ? '' : 's'}`)
}
