import type { SvelteConfig } from './types/SvelteConfig.ts'

const EXTENSIONS = ['js', 'mjs', 'ts'] as const

/*
Looks for `svelte.config.{js,mjs,ts}` in `cwd` and returns its default export.
Falls back to an empty config if no file is found.
*/
export async function loadSvelteConfig(cwd: string = process.cwd()): Promise<SvelteConfig> {
    for (const extension of EXTENSIONS) {
        const path = `${cwd}/svelte.config.${extension}`
        if (await Bun.file(path).exists()) {
            const module = await import(path)
            return module.default as SvelteConfig
        }
    }
    return {}
}
