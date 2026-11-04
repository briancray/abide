import { packageDirectory } from './packageDirectory.ts'

/**
 * The app's own bundler plugins, loaded from `bunfig.toml`'s `[serve.static] plugins`.
 *
 * 38.43 — declared where bun already has an app declare them, the key `bun-plugin-tailwind`
 * documents. `Bun.build` reads no bunfig, so both client builds read this one — the app's
 * package's (`packageDirectory`), beside the `package.json` `config` reads.
 */
export async function appPlugins(root: string): Promise<Bun.BunPlugin[]> {
    const directory = packageDirectory(root)
    const file = Bun.file(`${directory}/bunfig.toml`)
    if (!(await file.exists())) return []
    const parsed = Bun.TOML.parse(await file.text()) as {
        serve?: { static?: { plugins?: string[] } }
    }
    const plugins: Bun.BunPlugin[] = []
    for (const specifier of parsed.serve?.static?.plugins ?? [])
        plugins.push(
            (await import(Bun.resolveSync(specifier, directory)))
                .default as Bun.BunPlugin,
        )
    return plugins
}
