import type { SvelteConfig } from '../types/SvelteConfig.ts'

const EXTENSIONS = ['js', 'mjs', 'ts'] as const

export async function loadSvelteConfig(cwd: string = process.cwd()): Promise<SvelteConfig> {
    for (const ext of EXTENSIONS) {
        const path = `${cwd}/svelte.config.${ext}`
        if (await Bun.file(path).exists()) {
            const mod = await import(path)
            return mod.default as SvelteConfig
        }
    }
    return {}
}
