// build(dir) — the production client build (BP1.3, TODO #6): the code-split client written as
// content-hashed files (loader entry + per-route chunks + shared chunks + CSS) plus a manifest, into
// `dist/_app/<hash>/`, alongside the baked type-derived schema map.
//
// A MODULE rather than a function body inside `main.ts`, because `main.ts` is the CLI DISPATCHER and
// this is a step of the build pipeline. While it lived there, `stageCompileEntry` — itself a build
// module — had to `import { build } from './main.ts'` to reach it, so the compile lane depended on the
// argv parser: `main.ts → compile.ts → stageCompileEntry.ts → main.ts`. Nothing about compiling an app
// needs to know what `--port` means.
//
// It returns the DESCRIPTION of what it built, not just a path. `stageCompileEntry` needs the manifest
// and the baked schemas, and while the only return was `outDir` it recovered both by re-reading the two
// JSON files this function had just written — re-declaring the manifest's shape locally to do it (a
// third copy, after this one and `clientBundle`'s). A caller that wants only the directory reads
// `.outDir`; a caller that wants what is IN it no longer has to go back to disk to find out.

import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClientBuild } from '../server/internal/clientBundle.ts'
import {
    buildClient,
    ENCODING_EXTENSION,
    loadClientBuild,
} from '../server/internal/clientBundle.ts'
import { loadApp, writeBakedSchemas } from '../server/internal/loadApp.ts'
import { writeHealthCompanion } from './writeHealthCompanion.ts'

// The manifest as it is written to `index.json` / `manifest.json`. Declared HERE, where it is
// produced, so the readers can import it instead of restating it.
export interface ClientManifest {
    entry: string
    css: string | null
    files: string[]
    encodings: Record<string, string[]>
    chunkByPattern: Record<string, string>
}

export interface BuildResult {
    // Absolute path of the content-addressed output directory (`dist/_app/<hash>/`).
    outDir: string
    // The content hash the directory is named for.
    hash: string
    manifest: ClientManifest
}

export async function build(dir: string): Promise<BuildResult> {
    // Drop any prior baked schema map so this build derives FRESH from the current source (§11.5),
    // rather than loadApp reusing a stale `dist/schemas.json`.
    await rm(join(dir, 'dist', 'schemas.json'), { force: true })
    // The health companion (CO2.4) is generated, gitignored, and therefore absent on a fresh CI clone —
    // where a `tsc` run that never opened an editor would otherwise type `health()` as the bare
    // baseline and fail on the app's own fields.
    await writeHealthCompanion(dir)
    const config = await loadApp(dir)
    config.dev = false // production build → minify the client bundle (TODO #6).
    const built = await buildClient(config)
    const names = [...built.files.keys()].sort()
    // Which encodings each asset ships as a sidecar. Part of the manifest — and therefore part of the
    // hash below — because the set of representations served at a URL is part of what that URL IS: a
    // build that gains brotli must land in a fresh immutable directory, not overwrite an old one that
    // clients and shared caches still hold identity bytes for.
    const encodings: Record<string, string[]> = {}
    for (const name of names) {
        const asset = built.files.get(name)
        if (asset === undefined) continue
        const available: string[] = []
        if (asset.brotli !== null) available.push('brotli')
        if (asset.gzip !== null) available.push('gzip')
        if (available.length > 0) encodings[name] = available
    }
    const manifest: ClientManifest = {
        entry: built.entry,
        css: built.cssFile ?? null,
        files: names,
        encodings,
        chunkByPattern: Object.fromEntries(built.chunkByPattern),
    }
    const hash = new Bun.CryptoHasher('sha256')
        .update(JSON.stringify(manifest))
        .digest('hex')
        .slice(0, 16)
    const outDir = join(dir, 'dist', '_app', hash)
    await mkdir(outDir, { recursive: true })
    for (const name of names) {
        const asset = built.files.get(name)
        if (asset === undefined) continue
        await Bun.write(join(outDir, name), asset.identity)
        if (asset.brotli !== null)
            await Bun.write(join(outDir, name + ENCODING_EXTENSION.brotli), asset.brotli)
        if (asset.gzip !== null)
            await Bun.write(join(outDir, name + ENCODING_EXTENSION.gzip), asset.gzip)
    }
    const record = JSON.stringify({ hash, ...manifest }, null, 2)
    await Bun.write(join(outDir, 'index.json'), record)
    // Stable top-level pointer so `abide start` finds the current build without scanning hash dirs.
    await Bun.write(join(dir, 'dist', 'manifest.json'), record)
    // Bake the type-derived schemas (§11.5) alongside the manifest, so `abide start` (and a future
    // source-less `compile`/`cli`) merges them at boot without a tsgo pass. `config.routes` already
    // carry the freshly-derived schemas from the `loadApp` above.
    if (config.routes !== undefined) await writeBakedSchemas(dir, config.routes)
    return { outDir, hash, manifest }
}

// Ensure a production client build exists on disk (build it if missing) and load it for serving, so
// `abide start` serves the EXACT `abide build` artifacts with no bundler at boot.
export async function ensureClientBuild(dir: string): Promise<ClientBuild> {
    let built = await loadClientBuild(dir)
    if (built === undefined) {
        await build(dir)
        built = await loadClientBuild(dir)
    }
    if (built === undefined) throw new Error('abide start: failed to produce a client build')
    return built
}
