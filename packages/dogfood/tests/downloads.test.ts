// WHAT THE DOCS APP HANDS A READER TO TAKE AWAY, asked of the built app as a reader asks it: the
// example app as a tarball they unpack and install outside this repo.

import { expect, test } from 'bun:test'

import { exampleDirectory } from '../src/lib/exampleDirectory.server.ts'
import { servedDocs } from './docsPages.ts'

type Manifest = {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
}

// 40.26 — THE CRM AS A GZIPPED TARBALL: every file of the app under `crm/`, save what an install and
// a build make, and no `workspace:` dependency, which nothing outside this repo resolves.
// THE REVERT: drop the two `published(...)` calls from `exampleArchive`; `@abide/abide` and `@abide/harness` read `workspace:*` where a published `^` version is due.
test('the example app is served as a gzipped tarball an install outside the repo resolves — 40.26', async () => {
    const { base } = await servedDocs()
    const answer = await Bun.fetch(`${base}/examples/crm.tar.gz`)
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toBe('application/gzip')
    const bytes = new Uint8Array(await answer.arrayBuffer())
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b])

    const files = await new Bun.Archive(bytes).files()
    const directory = exampleDirectory() as string
    const expected: string[] = []
    for (const path of new Bun.Glob('**').scanSync({
        cwd: directory,
        dot: true,
    }))
        if (!path.startsWith('node_modules/') && !path.startsWith('.abide/'))
            expected.push(`crm/${path}`)
    expect([...files.keys()].sort()).toEqual(expected.sort())

    const manifest = (await (
        files.get('crm/package.json') as File
    ).json()) as Manifest
    const unresolvable: string[] = []
    for (const listed of [manifest.dependencies, manifest.devDependencies])
        for (const [name, version] of Object.entries(listed ?? {}))
            if (
                version.startsWith('workspace:') ||
                (name.startsWith('@abide/') && !/^\^\d/.test(version))
            )
                unresolvable.push(`${name}@${version}`)
    expect(unresolvable).toEqual([])
})
