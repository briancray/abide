// EVERY CHAPTER APP IS THE CRM SO FAR: `bun packages/dogfood/scripts/forwardChapters.ts` copies each
// chapter's feature directory into every later chapter's app, and writes each app's home page, root
// layout, stylesheet and `.env` from the chapters it holds. Edit a feature in the chapter that owns
// it, then run this; `tests/examples.test.ts` fails while a later copy differs.
//
// AND EVERY CHAPTER APP IS WHAT `abide scaffold` WRITES: its root files are taken from a scaffold run
// rather than kept by hand, so a downloaded app has the scripts, config and agent notes a new app
// has (38.1) — the manifest keeps its own name, description and workspace dependencies.

import { cp, mkdtemp, rm } from 'node:fs/promises' // bun exposes no recursive copy, removal or temporary directory
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import { SITE } from '../src/lib/SITE.ts'
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
// Chapter 1 owns the stylesheet every app opens: tailwind, then the CRM's look, which the docs app's
// own `app.css` imports too.
const STYLESHEETS = ['app.css', 'crm.css']

// Chapter N is the Nth guide page.
const CHAPTER_TITLES: string[] = []
for (const { pages } of SITE)
    for (const page of pages)
        if (page.route.startsWith('/guide/')) CHAPTER_TITLES.push(page.title)

const STARTER = await mkdtemp(`${tmpdir()}/abide-starter-`)
const scaffolded = Bun.spawn(
    [
        process.execPath,
        Bun.fileURLToPath(new URL('../../abide/bin/abide.ts', import.meta.url)),
        'scaffold',
        'starter',
    ],
    { cwd: STARTER, stdout: 'ignore' },
)
if ((await scaffolded.exited) !== 0) throw new Error('abide scaffold failed')
const starter = `${STARTER}/starter`
const ROOT_FILES = [
    'bunfig.toml',
    'Dockerfile',
    '.dockerignore',
    '.gitignore',
    'CLAUDE.md',
]
const starterManifest = (await Bun.file(`${starter}/package.json`).json()) as {
    scripts: Record<string, string>
    devDependencies: Record<string, string>
}
// The starter's notes up to what is the starter's own; the CRM's own section is written per app.
const starterNotes = await Bun.file(`${starter}/AGENTS.md`).text()
const AGENT_NOTES = starterNotes.slice(0, starterNotes.indexOf('## This app'))

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
    for (const file of STYLESHEETS)
        if (chapter > 1)
            await Bun.write(
                `${src}/lib/${file}`,
                await Bun.file(`${EXAMPLES}${appOf(1)}/src/lib/${file}`).text(),
            )
    for (const file of ROOT_FILES)
        await Bun.write(
            `${EXAMPLES}${app}/${file}`,
            await Bun.file(`${starter}/${file}`).text(),
        )
    const manifestPath = `${EXAMPLES}${app}/package.json`
    const manifest = await Bun.file(manifestPath).json()
    // The chapter's title from SITE; what follows it after a colon is the app's own.
    const subtitle = /: (.*)$/.exec(manifest.description ?? '')?.[1]
    manifest.description = `The CRM at the end of chapter ${chapter}, ${CHAPTER_TITLES[chapter - 1]}${subtitle === undefined ? '' : `: ${subtitle}`}`
    manifest.scripts = starterManifest.scripts
    manifest.devDependencies = {
        ...starterManifest.devDependencies,
        '@abide/harness': 'workspace:*',
    }
    await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`)
    let features = ''
    for (const [feature, label] of CHAPTER_FEATURES.slice(0, chapter))
        features += `- \`src/${feature}\` — ${label}\n`
    await Bun.write(
        `${EXAMPLES}${app}/AGENTS.md`,
        `${AGENT_NOTES}## This app\n\n${manifest.description}, from the abide guide.\nEach chapter is one directory under \`src\`:\n\n${features}`,
    )
    let env = ''
    if (chapter >= 7)
        env +=
            '# Seals the sign-in cookie: set your own where the app is deployed.\nABIDE_PRINCIPAL_SECRET=crm-development-secret-change-me\n'
    if (chapter >= 8) env += `RETRIES=5\nDEBUG=${app}:billing\n`
    if (env !== '') await Bun.write(`${EXAMPLES}${app}/.env`, env)
    console.log(`${app}: ${chapter} feature${chapter === 1 ? '' : 's'}`)
}
await rm(STARTER, { recursive: true, force: true })
