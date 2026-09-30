// 38.51 — A COMPILED APP'S COMMAND LINE: `abide`'s list (`commands.ts`), over the app the executable
// holds rather than one on disk, and spoken under the name it was started by — a `--platforms` build
// is `ledger-linux-x64`, and that is what a reader types.

import { type Host, runCommands } from './commands.ts'
import { type AppOrigin, bootApp } from './createApp.ts'
import { type BuildParts, builtSources, serveApp } from './serveBuild.ts'

export async function runCompiled(
    origin: AppOrigin,
    parts: BuildParts,
    // 38.57 — every specifier a script `run` may import out of the executable: abide's own entries
    // and the app's handler modules, each to the module it holds.
    specifiers: Record<string, () => Promise<Record<string, unknown>>>,
): Promise<void> {
    // REGISTERED AT START AND LOADED ON FIRST IMPORT: a handler module a script never names never
    // runs its top level, as it would not under `abide run`.
    Bun.plugin({
        name: 'abide:compiled-specifiers',
        setup(build) {
            for (const [name, load] of Object.entries(specifiers))
                build.module(name, async () => ({
                    exports: await load(),
                    loader: 'object',
                }))
        },
    })
    const host: Host = {
        name: process.execPath.slice(process.execPath.lastIndexOf('/') + 1),
        handlers: async () => parts.handlers,
        appPackage: () => origin.package,
        boot: () => bootApp(origin, () => builtSources(parts)),
        // 38.50.
        serve: ({ values: { port } }) =>
            serveApp(
                origin,
                () => builtSources(parts),
                port === undefined ? undefined : Number(port),
            ),
        source: undefined,
    }
    const code = await runCommands(host, Bun.argv.slice(2))
    if (code !== undefined) process.exit(code)
}
