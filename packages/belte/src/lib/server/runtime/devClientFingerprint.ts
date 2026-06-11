import { globToPathSet } from './globToPathSet.ts'

/*
Fingerprint of everything the browser consumes, computed once at dev worker
boot and announced as the first event on the live-reload channel. The browser
reloads only when a reconnect carries a different value, so a server-only edit
keeps the page — and its UI state — alive across the worker swap
(DEV_RELOAD_CLIENT_SCRIPT holds the comparing half).

Three inputs:
  - dist/_app contents, hashed per file: chunk names are content-hashed but
    `[name].[ext]` assets are not, and every rebuild rewrites the whole tree
    (atomic staging swap), so neither names nor mtimes alone identify a build.
  - public/ stamps (name:size:mtime): user-edited, never rewritten by a
    rebuild, and possibly large media — a stat beats hashing the bytes.
  - the served shell, whose edits change SSR output without touching dist.
*/
export async function devClientFingerprint({
    distDir,
    publicDir,
    shell,
}: {
    distDir: string
    publicDir: string
    shell: string
}): Promise<string> {
    const appDir = `${distDir}/_app`
    const appFiles = [...(await globToPathSet(appDir, '**/*', (file) => file))].sort()
    const appHashes = await Promise.all(
        appFiles.map(async (file) => {
            // A file swapped away mid-read stamps as 0 — the next boot re-fingerprints.
            const bytes = await Bun.file(`${appDir}/${file}`)
                .arrayBuffer()
                .catch(() => undefined)
            return `${file}:${bytes ? Bun.hash(bytes) : 0}`
        }),
    )
    const publicFiles = [
        ...(await globToPathSet(publicDir, '**/*', (file) => file, { dot: true })),
    ].sort()
    const publicStamps = publicFiles.map((file) => {
        const stat = Bun.file(`${publicDir}/${file}`)
        return `${file}:${stat.size}:${stat.lastModified}`
    })
    return Bun.hash([appHashes.join('\n'), publicStamps.join('\n'), shell].join('\0')).toString(36)
}
