import { appDirectories } from './appDirectories.ts'

/**
 * The app's own bundler plugins, loaded from `bunfig.toml`'s `[serve.static] plugins`.
 *
 * 38.43 — declared where bun already has an app declare them, the key `bun-plugin-tailwind`
 * documents. `Bun.build` reads no bunfig, so both client builds read this one — in
 * `appDirectories`, as `config` finds the app's `package.json`.
 */
export async function appPlugins(root: string): Promise<Bun.BunPlugin[]> {
    for (const directory of appDirectories(root)) {
        const file = Bun.file(`${directory}/bunfig.toml`)
        if (!(await file.exists())) continue
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
    return []
}
