// embeddedClientBuild(app) — read a compiled binary's EMBEDDED client assets back into the same
// `ClientBuild` the router serves from `dist/_app/<hash>/` (BP1.7).
//
// Each chunk AND each precompressed sidecar was embedded as its own file, so `/__abide/chunk/*`
// negotiates `Accept-Encoding` inside a binary exactly as it does off disk — the router cannot tell
// the difference, which is the point.

import { clientBuildFrom } from '../internal/clientArtifact.ts'
import type { ChunkAsset, ClientBuild } from '../internal/clientBundle.ts'
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
    // The same assembly the `dist/` loader and the in-memory build use — including the derived preload
    // graph, which is why a binary and a `dist/` serve identical head preloads with nothing extra
    // recorded at compile time.
    return clientBuildFrom({
        entry: app.client.entry,
        css: app.client.css,
        chunkByPattern: app.client.chunkByPattern,
        files,
    })
}
