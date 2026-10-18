// A CHAPTER APP AS A TARBALL a reader unpacks and runs: every file the app is made of under `<app>/`,
// with the workspace's own dependencies rewritten to the published versions they stand for, so
// `bun install` outside this repo resolves them.

import abidePackage from '@abide/abide/package.json' with { type: 'json' }
import harnessPackage from '@abide/harness/package.json' with { type: 'json' }
import { exampleDirectory } from './exampleDirectory.server.ts'

const PUBLISHED: Record<string, string> = {
    '@abide/abide': `^${abidePackage.version}`,
    '@abide/harness': `^${harnessPackage.version}`,
}

type Manifest = {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
}

function published(dependencies: Record<string, string> | undefined): void {
    if (dependencies === undefined) return
    for (const name of Object.keys(dependencies))
        if (dependencies[name]?.startsWith('workspace:'))
            dependencies[name] = PUBLISHED[name] ?? '*'
}

/** The app as a gzipped tarball, or `undefined` for a name that is not a chapter app. */
export async function exampleArchive(app: string): Promise<Blob | undefined> {
    const directory = await exampleDirectory(app)
    if (directory === undefined) return undefined
    const entries: Record<string, Blob | string> = {}
    for (const path of new Bun.Glob('**').scanSync({
        cwd: directory,
        dot: true,
    })) {
        if (path.startsWith('node_modules/') || path.startsWith('.abide/'))
            continue
        entries[`${app}/${path}`] = Bun.file(`${directory}/${path}`)
    }
    const manifest = (await Bun.file(
        `${directory}/package.json`,
    ).json()) as Manifest
    published(manifest.dependencies)
    published(manifest.devDependencies)
    entries[`${app}/package.json`] = `${JSON.stringify(manifest, null, 4)}\n`
    return new Bun.Archive(entries, { compress: 'gzip' }).blob()
}
