import { existsSync } from 'node:fs'
import { Glob } from 'bun'

/*
Returns the most-recent mtime across every rpc + socket source file in
the project, or 0 when both directories are absent. The lazy CLI
download path compares this to the binary's mtime to decide whether to
rebuild — covers the common dev iteration of "user edited an rpc
handler" without needing to scan transitively-imported modules. Globs and
stats run concurrently since each file is independent.
*/
export async function maxSourceMtime(cwd: string): Promise<number> {
    const roots = [`${cwd}/src/server/rpc`, `${cwd}/src/server/sockets`].filter(existsSync)
    const perRoot = await Promise.all(
        roots.map(async (root) => {
            const files = await Array.fromAsync(
                new Glob('**/*.ts').scan({ cwd: root, onlyFiles: true }),
            )
            return files.map((file) => `${root}/${file}`)
        }),
    )
    const mtimes = await Promise.all(
        perRoot.flat().map(async (path) => (await Bun.file(path).stat()).mtimeMs),
    )
    return mtimes.reduce((newest, mtime) => Math.max(newest, mtime), 0)
}
