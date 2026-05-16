import type { ResolveHook } from './createServer.ts'

export type LayoutViewModule = { default: any }
export type LayoutDataModule = { resolve?: ResolveHook }

export type LayoutEntry = {
    view?: () => Promise<LayoutViewModule>
    resolve?: () => Promise<LayoutDataModule>
}

/**
 * Merged map of directory prefix → layout entry.
 *
 *   ""           → routes/layout.svelte and/or routes/layout.ts
 *   "admin"      → routes/admin/layout.svelte and/or routes/admin/layout.ts
 *
 * For a hit route, every layout whose prefix is a parent directory runs
 * root-to-leaf: data resolves are awaited (merged shallow, redirect short-
 * circuits); view components wrap the page recursively (outermost = root).
 */
export type Layouts = Record<string, LayoutEntry>
