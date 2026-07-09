import { existsSync } from 'node:fs'
import { Glob } from 'bun'
import { fileName } from './fileName.ts'
import type { PagesScan } from './types/PagesScan.ts'

/*
Walks src/ui/pages once and classifies each `.abide` leaf by filename: a
`page.abide` is a route (its URL is the folder path), a `layout.abide` is a
layout that wraps every page at or below its folder (keyed by the same folder
URL). Any other `.abide` file (a shared component) is ignored here — free to
live anywhere and be imported relatively. Shared by the resolver plugin's
pages/layouts manifests and generateDeclarations' routes.d.ts so the two never
diverge on what counts as a route.
*/
export async function scanPages(pagesDir: string): Promise<PagesScan> {
    if (!existsSync(pagesDir)) {
        return { pageFiles: [], layoutFiles: [] }
    }
    const allFiles = await Array.fromAsync(new Glob('**/*.abide').scan({ cwd: pagesDir }))
    const leafIs = (name: string) => (file: string) => fileName(file) === name
    return {
        pageFiles: allFiles.filter(leafIs('page.abide')),
        layoutFiles: allFiles.filter(leafIs('layout.abide')),
    }
}
