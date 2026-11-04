import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { dirname } from 'node:path' // bun exposes no path helpers of its own

/**
 * The package the app under `root` belongs to: `root` where it holds a `package.json`, else the
 * directory above it.
 *
 * `root` is the app's root — `src/` beside its package, or the package itself where it has no
 * `src`. What is the package's rather than the source's — its `package.json`, its `bunfig.toml`, its
 * build (38.27) — is found here and nowhere else.
 */
export function packageDirectory(root: string): string {
    return existsSync(`${root}/package.json`) ? root : dirname(root)
}
