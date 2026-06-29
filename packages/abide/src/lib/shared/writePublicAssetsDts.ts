import { augmentModule } from './augmentModule.ts'
import { writeDts } from './writeDts.ts'

/*
Emits a `.d.ts` that augments abide's `PublicAssets` interface with one entry
per file under `public/`, keyed by its site-root path (`/logo.png`) — the same
key createPublicAssetServer serves it at. Keys only (value `true`): the map
exists purely so `url('/logo.png')` autocompletes known assets; it carries no
type beyond the path. Written to `src/.abide/publicAssets.d.ts` so the
consumer's src tsconfig include picks it up, keyed on the project's abide
import name like writeRoutesDts / writeRpcDts.
*/
export async function writePublicAssetsDts({
    cwd,
    publicFiles,
    importName,
}: {
    cwd: string
    publicFiles: string[]
    importName: string
}): Promise<void> {
    const entries = publicFiles
        .map((file): [string, string] => [`/${file}`, 'true'])
        .toSorted(([a], [b]) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
    const module = augmentModule(`${importName}/shared/url`, 'PublicAssets', entries)
    await writeDts(cwd, 'publicAssets', module)
}
