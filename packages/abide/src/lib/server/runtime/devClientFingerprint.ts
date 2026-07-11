import { relative } from 'node:path'
import { isLayoutFile } from '../../shared/isLayoutFile.ts'
import { compileComponent } from '../../ui/compile/compileComponent.ts'
import { nearestProjectRoot } from '../../ui/compile/nearestProjectRoot.ts'
import { globToPathSet } from './globToPathSet.ts'
import type { DevReloadStamp } from './types/DevReloadStamp.ts'

// The shell's entry-stylesheet link: any `/_app/*.css` href, either quote style.
const CSS_HREF = /href=(["'])([^"']*\/_app\/[^"']*\.css)\1/
// Every `/_app/<hashed-asset>` ref in the shell (the JS entry, the stylesheet) —
// content-hashed names that move on any rebuild. Normalised out of `structure` so
// a component/CSS edit (which re-hashes the bundle) doesn't read as a reload; the
// source-based signals (component bodies, non-component hashes, cssHref) catch real changes.
const APP_ASSET = /\/_app\/[^"'\s)]*/g
// src/.abide is the build's own generated output (route d.ts) — rewritten every
// rebuild, so it must stay out of the hash or the page would always reload.
const GENERATED = /(^|\/)\.abide\//

/*
The dev live-reload stamp, computed once at worker boot from SOURCE (the dev
watcher only watches src/, so source is what a rebuild can reflect). Splits the
edit space so the browser keeps its page where it can:

  - `structure` fingerprints every source signal a reload must react to: each
    `.abide`'s client BUILD hash (`compileComponent`, which carries NO CSS — so a
    style-only edit leaves it unchanged), the component-id set (adding/removing a
    component reloads), non-`.abide` source, public assets, and the shell (with the
    content-hashed `/_app/*` asset names normalised out, so a rebuild's re-hash isn't
    itself a change). Any change here reloads.
  - `cssHref` is the entry stylesheet's content-hashed URL; a change here ALONE swaps
    the `<link>` in place — a CSS edit restyles the live page with no reload and no
    state loss.

A compile failure (mid-edit syntax error) falls back to a raw-source hash, so the
worst case is a reload, never a throw at boot.
*/
export async function devClientFingerprint({
    srcDir,
    publicDir,
    shell,
    projectRoot,
}: {
    srcDir: string
    publicDir: string
    shell: string
    projectRoot: string
}): Promise<DevReloadStamp> {
    const srcFiles = [...(await globToPathSet(srcDir, '**/*', (file) => file, { dot: true }))]
        .filter((file) => !GENERATED.test(file))
        .sort()

    const componentBodies: string[] = []
    const componentIds: string[] = []
    const otherSource: string[] = []

    await Promise.all(
        srcFiles.map(async (file) => {
            const full = `${srcDir}/${file}`
            if (!file.endsWith('.abide')) {
                const bytes = await Bun.file(full)
                    .arrayBuffer()
                    .catch(() => undefined)
                otherSource.push(`${file}:${bytes ? Bun.hash(bytes) : 0}`)
                return
            }
            const source = await Bun.file(full)
                .text()
                .catch(() => '')
            const moduleId = relative(nearestProjectRoot(full, projectRoot), full)
            componentIds.push(moduleId)
            let bodyHash: string
            try {
                bodyHash = Bun.hash(
                    compileComponent(source, isLayoutFile(moduleId), moduleId),
                ).toString(36)
            } catch {
                bodyHash = Bun.hash(source).toString(36)
            }
            componentBodies.push(`${moduleId}:${bodyHash}`)
        }),
    )

    const publicFiles = [
        ...(await globToPathSet(publicDir, '**/*', (file) => file, { dot: true })),
    ].sort()
    const publicStamps = publicFiles.map((file) => {
        const stat = Bun.file(`${publicDir}/${file}`)
        return `${file}:${stat.size}:${stat.lastModified}`
    })

    const cssHref = shell.match(CSS_HREF)?.[2]
    const structureShell = shell.replace(APP_ASSET, '/_app/HASH')
    const structure = Bun.hash(
        [
            otherSource.sort().join('\n'),
            publicStamps.join('\n'),
            structureShell,
            componentIds.sort().join(','),
            componentBodies.sort().join('\n'),
        ].join('\0'),
    ).toString(36)
    return { structure, cssHref }
}
