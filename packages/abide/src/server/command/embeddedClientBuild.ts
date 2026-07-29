// embeddedClientBuild(app) — read a compiled binary's EMBEDDED client assets back into the same
// `ClientBuild` the router serves from `dist/_app/<hash>/` (BP1.7).
//
// Each chunk AND each precompressed sidecar was embedded as its own file, so `/__abide/chunk/*`
// negotiates `Accept-Encoding` inside a binary exactly as it does off disk — the router cannot tell
// the difference, which is the point.

import type { ChunkAsset, ClientBuild } from '../internal/clientBundle.ts'
import { preloadGraphOf } from '../internal/preloadGraphOf.ts'
import type { CompiledApp } from './compiledAppConfig.ts'

export async function embeddedClientBuild(app: CompiledApp): Promise<ClientBuild> {
    const files = new Map<string, ChunkAsset>()
    for (const asset of app.assets) {
        files.set(asset.name, {
            identity: await Bun.file(asset.identity).bytes(),
            gzip: asset.gzip === undefined ? null : await Bun.file(asset.gzip).bytes(),
            brotli: asset.brotli === undefined ? null : await Bun.file(asset.brotli).bytes(),
        })
    }
    return {
        entry: app.client.entry,
        cssFile: app.client.css ?? undefined,
        files,
        chunkByPattern: new Map(Object.entries(app.client.chunkByPattern)),
        // Derived from the embedded bytes for the same reason the `dist/` loader derives it: the preload
        // graph is a property of the chunks themselves, so a binary and a `dist/` serve identical head
        // preloads without the compile step having to record anything extra.
        ...preloadGraphOf(
            app.client.entry,
            new Map(Object.entries(app.client.chunkByPattern)),
            files,
        ),
    }
}
