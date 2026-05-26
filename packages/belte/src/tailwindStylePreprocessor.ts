import type { PreprocessorGroup } from 'svelte/compiler'

/*
Svelte preprocessor that runs Tailwind v4 over each component `<style>` block.
Without this, directives like `@apply` and `@import "tailwindcss/theme" reference;`
pass straight through the Svelte compiler into the bundle — the `@import` becomes
a runtime fetch and `@apply` is dropped silently. `bun-plugin-tailwind` only
processes `.css` files, so scoped styles need this hook instead.

Returns undefined when `tailwindcss` isn't installed, so consumers without
Tailwind get the same behaviour as before.
*/

function dirname(filepath: string): string {
    const lastSlash = filepath.lastIndexOf('/')
    return lastSlash === -1 ? '' : filepath.slice(0, lastSlash)
}

function fileUrlToPath(href: string): string {
    return new URL(href).pathname
}

function pathToFileUrl(path: string): string {
    return new URL(path, 'file://').href
}

export async function tailwindStylePreprocessor(): Promise<PreprocessorGroup | undefined> {
    let tailwind: typeof import('tailwindcss')
    try {
        tailwind = await import('tailwindcss')
    } catch {
        return undefined
    }
    const TAILWIND_DIRECTIVE = /@(?:apply|reference|tailwind|import\s+["']tailwindcss)/
    return {
        name: 'belte-tailwind-style',
        async style({ content, filename }) {
            if (!TAILWIND_DIRECTIVE.test(content)) {
                return undefined
            }
            const base = filename ? dirname(filename) : process.cwd()
            const result = await tailwind.compile(content, {
                base,
                loadStylesheet: async (uri, fromBase) => {
                    const fromUrl = pathToFileUrl(`${fromBase}/`)
                    const resolved = fileUrlToPath(import.meta.resolve(uri, fromUrl))
                    return {
                        path: resolved,
                        base: dirname(resolved),
                        content: await Bun.file(resolved).text(),
                    }
                },
                loadModule: async () => {
                    throw new Error(
                        'Tailwind plugins/configs in component <style> blocks are not supported',
                    )
                },
            })
            return { code: result.build([]) }
        },
    }
}
