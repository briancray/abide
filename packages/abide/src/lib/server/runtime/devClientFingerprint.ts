import { relative } from 'node:path'
import { fileName } from '../../shared/fileName.ts'
import { isLayoutFile } from '../../shared/isLayoutFile.ts'
import { analyzeComponent } from '../../ui/compile/analyzeComponent.ts'
import { compileComponent } from '../../ui/compile/compileComponent.ts'
import { nearestProjectRoot } from '../../ui/compile/nearestProjectRoot.ts'
import { globToPathSet } from './globToPathSet.ts'
import type { DevReloadStamp } from './types/DevReloadStamp.ts'

// The shell's entry-stylesheet link: any `/_app/*.css` href, either quote style.
const CSS_HREF = /href=(["'])([^"']*\/_app\/[^"']*\.css)\1/
// Every `/_app/<hashed-asset>` ref in the shell (the JS entry, the stylesheet) —
// content-hashed names that move on any rebuild. Normalised out of `structure` so
// a component/CSS edit (which re-hashes the bundle) doesn't read as a reload; the
// source-based signals (components, non-component hashes, cssHref) catch real changes.
const APP_ASSET = /\/_app\/[^"'\s)]*/g
// src/.abide is the build's own generated output (route d.ts) — rewritten every
// rebuild, so it must stay out of the hash or the page would always reload.
const GENERATED = /(^|\/)\.abide\//

// page.abide / layout.abide are router-mounted, not `mountChild`-tracked, so they
// can't hot-swap — they fold into `structure` (a reload) instead.
function isPageOrLayout(moduleId: string): boolean {
    return fileName(moduleId) === 'page.abide' || isLayoutFile(moduleId)
}

/*
The dev live-reload stamp, computed once at worker boot from SOURCE (the dev
watcher only watches src/, so source is what a rebuild can reflect). Splits the
edit space so the browser keeps its page where it can:

  - Each `.abide` is hashed by its client BUILD (`compileComponent`, which carries
    no CSS), so a style-only edit doesn't change it. A leaf component with no
    imports that isn't a page/layout is hot-swappable: its hash goes in
    `components`, keyed by the same module id the loader stamps (so it matches the
    registry). Every other component (page, layout, import-bearing) folds its hash
    into `structure` — editing it reloads.
  - `structure` also covers non-`.abide` source, public stamps, the shell (with
    the stylesheet href normalised out), and the sorted component-id set (so
    adding/removing a component reloads).
  - `cssHref` is the entry stylesheet's current URL, read from the shell.

A compile failure (mid-edit syntax error) falls back to a raw-source hash marked
non-hot, so the worst case is a reload, never a throw at boot.
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

    const components: Record<string, string> = {}
    const nonHotComponents: string[] = []
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
            let hot = false
            try {
                const isLayout = isLayoutFile(moduleId)
                bodyHash = Bun.hash(compileComponent(source, isLayout, moduleId)).toString(36)
                hot = analyzeComponent(source).imports === '' && !isPageOrLayout(moduleId)
            } catch {
                bodyHash = Bun.hash(source).toString(36)
            }
            if (hot) {
                components[moduleId] = bodyHash
            } else {
                nonHotComponents.push(`${moduleId}:${bodyHash}`)
            }
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
            nonHotComponents.sort().join('\n'),
        ].join('\0'),
    ).toString(36)
    return { structure, cssHref, components }
}
