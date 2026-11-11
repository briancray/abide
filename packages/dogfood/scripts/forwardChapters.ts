// EVERY CHAPTER APP IS THE CRM SO FAR: `bun packages/dogfood/scripts/forwardChapters.ts` copies each
// chapter's feature directory into every later chapter's app, and writes each app's home page, root
// layout, stylesheet and `.env` from the chapters it holds. Edit a feature in the chapter that owns
// it, then run this; `tests/examples.test.ts` compares `forwarded()` to disk and fails while a file
// differs.
//
// AND EVERY CHAPTER APP IS WHAT `abide scaffold` WRITES: its root files are taken from a scaffold run
// rather than kept by hand, so a downloaded app has the scripts, config and agent notes a new app
// has (38.1) — the manifest keeps its own name, description and workspace dependencies.

import { mkdtemp, rm } from 'node:fs/promises' // bun exposes no recursive removal or temporary directory
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import { spawned } from '@abide/harness/gate'

import { SITE } from '../src/lib/SITE.ts'
import { CHAPTER_FEATURES } from './CHAPTER_FEATURES.ts'

const EXAMPLES = Bun.fileURLToPath(new URL('../examples/', import.meta.url))
const appOf = (chapter: number) => `crm-${String(chapter).padStart(2, '0')}`

/** Every later chapter's copy of an earlier chapter's feature directory, which `forwarded()` fills. */
export function forwardedDirectories(): string[] {
    const directories: string[] = []
    for (let chapter = 2; chapter <= CHAPTER_FEATURES.length; chapter += 1)
        for (let earlier = 1; earlier < chapter; earlier += 1) {
            const [feature] = CHAPTER_FEATURES[earlier - 1] as [string, string]
            directories.push(`${EXAMPLES}${appOf(chapter)}/src/${feature}`)
        }
    return directories
}

/** Every file this script writes, by absolute path, as it would write it. */
export async function forwarded(): Promise<Map<string, string>> {
    const files = new Map<string, string>()
    // Chapter 7 is where the CRM first files a page-wide hook (a CSP on every page).
    const signedLayout = await Bun.file(
        `${EXAMPLES}${appOf(7)}/src/layout.abide`,
    ).text()
    const plainLayout = await Bun.file(
        `${EXAMPLES}${appOf(1)}/src/layout.abide`,
    ).text()

    // Chapter N is the Nth guide page.
    const chapterTitles: string[] = []
    for (const { pages } of SITE)
        for (const page of pages)
            if (page.route.startsWith('/guide/')) chapterTitles.push(page.title)

    const temporary = await mkdtemp(`${tmpdir()}/abide-starter-`)
    try {
        // `spawned`, because `examples.test.ts` runs this in a `--parallel` worker: a deadline, and a
        // failure that names the command and carries its stderr.
        const scaffolded = await spawned(
            [
                process.execPath,
                Bun.fileURLToPath(
                    new URL('../../abide/bin/abide.ts', import.meta.url),
                ),
                'scaffold',
                'starter',
            ],
            { cwd: temporary },
        )
        if (scaffolded.exitCode !== 0)
            throw new Error(`abide scaffold failed: ${scaffolded.stderr}`)
        const starter = `${temporary}/starter`
        const rootFiles = new Map<string, string>()
        for (const file of [
            'bunfig.toml',
            'Dockerfile',
            '.dockerignore',
            '.gitignore',
            'CLAUDE.md',
        ])
            rootFiles.set(file, await Bun.file(`${starter}/${file}`).text())
        const starterManifest = (await Bun.file(
            `${starter}/package.json`,
        ).json()) as {
            scripts: Record<string, string>
            devDependencies: Record<string, string>
        }
        // The starter's notes up to what is the starter's own; the CRM's own section is written per app.
        const starterNotes = await Bun.file(`${starter}/AGENTS.md`).text()
        const agentNotes = starterNotes.slice(
            0,
            starterNotes.indexOf('## This app'),
        )
        // Chapter 1 owns the stylesheet every app opens: tailwind, then the CRM's look, which the docs
        // app's own `app.css` imports too.
        const stylesheets = new Map<string, string>()
        for (const file of ['app.css', 'crm.css'])
            stylesheets.set(
                file,
                await Bun.file(`${EXAMPLES}${appOf(1)}/src/lib/${file}`).text(),
            )

        for (
            let chapter = 1;
            chapter <= CHAPTER_FEATURES.length;
            chapter += 1
        ) {
            const app = appOf(chapter)
            const root = `${EXAMPLES}${app}`
            for (let earlier = 1; earlier < chapter; earlier += 1) {
                const [feature] = CHAPTER_FEATURES[earlier - 1] as [
                    string,
                    string,
                ]
                const owner = `${EXAMPLES}${appOf(earlier)}/src/${feature}`
                for (const file of new Bun.Glob('**').scanSync({
                    cwd: owner,
                    dot: true,
                }))
                    files.set(
                        `${root}/src/${feature}/${file}`,
                        await Bun.file(`${owner}/${file}`).text(),
                    )
            }
            let links = ''
            for (const [feature, label] of CHAPTER_FEATURES.slice(0, chapter))
                links += `    <p><a href={url('/${feature}')}>${label}</a></p>\n`
            files.set(
                `${root}/src/index.abide`,
                `<script>\nimport { url } from '@abide/abide'\n</script>\n\n<head><title>CRM</title></head>\n\n<main>\n    <h1>CRM</h1>\n${links}</main>\n`,
            )
            files.set(
                `${root}/src/layout.abide`,
                chapter >= 7 ? signedLayout : plainLayout,
            )
            if (chapter > 1)
                for (const [file, text] of stylesheets)
                    files.set(`${root}/src/lib/${file}`, text)
            for (const [file, text] of rootFiles)
                files.set(`${root}/${file}`, text)
            const manifest = await Bun.file(`${root}/package.json`).json()
            // The chapter's title from SITE; what follows it after a colon is the app's own.
            const subtitle = /: (.*)$/.exec(manifest.description ?? '')?.[1]
            manifest.description = `The CRM at the end of chapter ${chapter}, ${chapterTitles[chapter - 1]}${subtitle === undefined ? '' : `: ${subtitle}`}`
            manifest.scripts = starterManifest.scripts
            manifest.devDependencies = {
                ...starterManifest.devDependencies,
                '@abide/harness': 'workspace:*',
            }
            files.set(
                `${root}/package.json`,
                `${JSON.stringify(manifest, null, 4)}\n`,
            )
            let features = ''
            for (const [feature, label] of CHAPTER_FEATURES.slice(0, chapter))
                features += `- \`src/${feature}\` — ${label}\n`
            files.set(
                `${root}/AGENTS.md`,
                `${agentNotes}## This app\n\n${manifest.description}, from the abide guide.\nEach chapter is one directory under \`src\`:\n\n${features}`,
            )
            let env = ''
            if (chapter >= 7)
                env +=
                    '# Seals the sign-in cookie: set your own where the app is deployed.\nABIDE_PRINCIPAL_SECRET=crm-development-secret-change-me\n'
            if (chapter >= 8) env += `RETRIES=5\nDEBUG=${app}:billing\n`
            if (env !== '') files.set(`${root}/.env`, env)
        }
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
    return files
}

if (import.meta.main) {
    const files = await forwarded()
    for (const directory of forwardedDirectories())
        await rm(directory, { recursive: true, force: true })
    for (const [path, text] of files) await Bun.write(path, text)
    console.log(`forwarded: ${files.size} files`)
}
